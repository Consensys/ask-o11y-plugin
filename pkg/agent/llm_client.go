package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("LLM returned status %d", resp.StatusCode)
		tracing.Error(span, err)
		return nil, err
	}

	var result ChatCompletionResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		tracing.Error(span, err)
		return nil, fmt.Errorf("decode response: %w", err)
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

	return &result, nil
}
