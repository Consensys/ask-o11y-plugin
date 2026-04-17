package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

const (
	llmEndpoint    = "/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions"
	llmModel       = "large"
	llmTimeout     = 600 * time.Second
	maxSSELineSize = 1 * 1024 * 1024 // 1 MB — large tool-call payloads (e.g. dashboard JSON) can exceed bufio's 64 KB default
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
	return &LLMClient{httpClient: httpClient, logger: logger}
}

func (c *LLMClient) ChatCompletion(ctx context.Context, req ChatCompletionRequest, grafanaURL, authToken, orgID string) (result *ChatCompletionResponse, err error) {
	ctx, span := tracing.DefaultTracer().Start(ctx, "llm_call")
	defer func() {
		if err != nil {
			tracing.Error(span, err)
		}
		span.End()
	}()

	req.Model = llmModel
	req.Stream = true

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := c.buildHTTPRequest(ctx, body, grafanaURL, authToken, orgID)
	if err != nil {
		return nil, err
	}

	c.logger.Debug("Calling LLM",
		"url", httpReq.URL.String(),
		"messageCount", len(req.Messages),
		"toolCount", len(req.Tools),
		"orgID", orgID)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("LLM request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512)) // best-effort; status error is returned regardless
		if len(errBody) > 0 {
			c.logger.Warn("LLM returned error", "status", resp.StatusCode, "body", string(errBody))
		}
		return nil, fmt.Errorf("LLM returned status %d", resp.StatusCode)
	}

	result, err = parseStream(resp)
	if err != nil {
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

// buildHTTPRequest constructs the POST request with auth headers set.
// X-Grafana-Org-Id is intentionally omitted: SA tokens are Org-1-scoped
// (grafana/grafana#91844), so pairing them with another org causes a 401.
// Grafana 12 also strips Cookie headers, so SA token is the only auth option.
// Org isolation is enforced at the MCP tool-call layer instead.
func (c *LLMClient) buildHTTPRequest(ctx context.Context, body []byte, grafanaURL, authToken, orgID string) (*http.Request, error) {
	url := strings.TrimRight(grafanaURL, "/") + llmEndpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
		if orgID != "" && orgID != "1" {
			c.logger.Warn("SA token is Org 1 scoped; LLM config may not match requested org", "orgID", orgID)
		}
	} else {
		c.logger.Warn("No auth token for LLM call; request will likely fail", "url", url, "orgID", orgID)
	}

	return req, nil
}

func parseStream(resp *http.Response) (*ChatCompletionResponse, error) {
	var (
		responseID   string
		content      strings.Builder
		toolCallMap  = map[int]ToolCall{}
		finishReason string
		usage        *Usage
	)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), maxSSELineSize)
	for scanner.Scan() {
		line := scanner.Text()
		payload, ok := strings.CutPrefix(line, "data: ")
		if !ok {
			continue
		}
		if payload == "[DONE]" {
			break
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
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
			content.WriteString(choice.Delta.Content)
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
		return nil, fmt.Errorf("read stream: %w", err)
	}

	msg := Message{Role: "assistant", Content: content.String()}

	for _, k := range slices.Sorted(maps.Keys(toolCallMap)) {
		msg.ToolCalls = append(msg.ToolCalls, toolCallMap[k])
	}

	return &ChatCompletionResponse{
		ID:      responseID,
		Choices: []Choice{{Message: msg, FinishReason: finishReason}},
		Usage:   usage,
	}, nil
}
