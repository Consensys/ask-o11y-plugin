package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

const (
	llmEndpoint = "/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions"
	llmModel    = "large"
	llmTimeout  = 120 * time.Second
)

type streamChunk struct {
	ID      string         `json:"id"`
	Choices []streamChoice `json:"choices"`
	Usage   *Usage         `json:"usage,omitempty"`
}

type streamChoice struct {
	Index        int         `json:"index"`
	Delta        streamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason"`
}

type streamDelta struct {
	Role      string          `json:"role,omitempty"`
	Content   string          `json:"content,omitempty"`
	ToolCalls []toolCallChunk `json:"tool_calls,omitempty"`
}

type toolCallChunk struct {
	Index    int           `json:"index"`
	ID       string        `json:"id,omitempty"`
	Type     string        `json:"type,omitempty"`
	Function functionChunk `json:"function"`
}

type functionChunk struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type LLMClient struct {
	httpClient *http.Client
	logger     log.Logger
}

func NewLLMClient(logger log.Logger, httpClient *http.Client) *LLMClient {
	return &LLMClient{
		httpClient: httpClient,
		logger:     logger,
	}
}

func (c *LLMClient) ChatCompletion(ctx context.Context, req ChatCompletionRequest, grafanaURL, authToken, orgID string) (*ChatCompletionResponse, error) {
	ctx, span := tracing.DefaultTracer().Start(ctx, "llm_call")
	defer span.End()

	req.Model = llmModel
	req.Stream = true

	body, err := json.Marshal(req)
	if err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := strings.TrimRight(grafanaURL, "/") + llmEndpoint
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	// Use SA token for LLM authentication.
	// Note: Grafana 12 strips Cookie headers from backend plugin requests,
	// so user session cookies cannot be used for auth.
	authMethod := "none"
	if authToken != "" {
		httpReq.Header.Set("Authorization", "Bearer "+authToken)
		authMethod = "sa-token"
		if orgID != "" && orgID != "1" {
			c.logger.Warn("Using SA token for non-Org-1 LLM call; SA token is Org 1 scoped, LLM config may not match requested org", "orgID", orgID)
		}
	} else {
		c.logger.Warn("No authentication available for LLM call; request will likely fail", "url", url, "orgID", orgID)
	}
	// Only set X-Grafana-Org-Id with cookie auth. SA token is Org-1-scoped
	// (grafana/grafana#91844), so pairing it with another org triggers a
	// 401 from grafana-llm-app. Org isolation is enforced at the MCP
	// tool-call layer, not here.
	if authMethod == "cookie" && orgID != "" {
		httpReq.Header.Set("X-Grafana-Org-Id", orgID)
	}

	c.logger.Debug("Calling LLM", "url", url, "messageCount", len(req.Messages), "toolCount", len(req.Tools), "authMethod", authMethod, "orgID", orgID)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("LLM request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("LLM returned status %d", resp.StatusCode)
		tracing.Error(span, err)
		return nil, err
	}

	var (
		responseID  string
		contentBuf  strings.Builder
		toolCallMap = map[int]ToolCall{}
		finishReason string
		usage        *Usage
	)

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := line[len("data: "):]
		if payload == "[DONE]" {
			break
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			tracing.Error(span, err)
			return nil, fmt.Errorf("decode stream chunk: %w", err)
		}

		if responseID == "" {
			responseID = chunk.ID
		}
		if chunk.Usage != nil {
			usage = chunk.Usage
		}

		for _, choice := range chunk.Choices {
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				finishReason = *choice.FinishReason
			}
			contentBuf.WriteString(choice.Delta.Content)
			for _, tc := range choice.Delta.ToolCalls {
				existing := toolCallMap[tc.Index]
				if tc.ID != "" {
					existing.ID = tc.ID
				}
				if tc.Type != "" {
					existing.Type = tc.Type
				}
				if tc.Function.Name != "" {
					existing.Function.Name = tc.Function.Name
				}
				existing.Function.Arguments += tc.Function.Arguments
				toolCallMap[tc.Index] = existing
			}
		}
	}
	if err := scanner.Err(); err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("read stream: %w", err)
	}

	msg := Message{
		Role:    "assistant",
		Content: contentBuf.String(),
	}
	for i := 0; i < len(toolCallMap); i++ {
		msg.ToolCalls = append(msg.ToolCalls, toolCallMap[i])
	}

	result := &ChatCompletionResponse{
		ID: responseID,
		Choices: []Choice{{
			Index:        0,
			Message:      msg,
			FinishReason: finishReason,
		}},
		Usage: usage,
	}

	if len(result.Choices) == 0 {
		err := fmt.Errorf("LLM returned no choices")
		tracing.Error(span, err)
		return nil, err
	}

	if result.Usage != nil {
		span.SetAttributes(
			attribute.Int("llm.prompt_tokens", result.Usage.PromptTokens),
			attribute.Int("llm.completion_tokens", result.Usage.CompletionTokens),
		)
	}

	return result, nil
}
