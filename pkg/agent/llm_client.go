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

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
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

func NewLLMClient(logger log.Logger) *LLMClient {
	return &LLMClient{
		httpClient: &http.Client{Timeout: llmTimeout},
		logger:     logger,
	}
}

func (c *LLMClient) ChatCompletion(ctx context.Context, req ChatCompletionRequest, grafanaURL, authToken, orgID, userCookie string) (*ChatCompletionResponse, error) {
	req.Model = llmModel

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := strings.TrimRight(grafanaURL, "/") + llmEndpoint
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	// Prefer user cookie for LLM calls — it carries the user's org context,
	// ensuring grafana-llm-app uses the correct org's LLM configuration.
	// Falls back to SA token when cookie is not available (e.g. API-token access).
	authMethod := "none"
	if userCookie != "" {
		httpReq.Header.Set("Cookie", userCookie)
		authMethod = "cookie"
	} else if authToken != "" {
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
		return nil, fmt.Errorf("LLM request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result ChatCompletionResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("LLM returned no choices")
	}

	return &result, nil
}
