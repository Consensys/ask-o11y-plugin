package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
)

const (
	llmEndpoint       = "/api/plugins/grafana-llm-app/resources/openai/v1/chat/completions"
	llmTimeout        = 600 * time.Second
	maxSSELineSize    = 1 * 1024 * 1024 // 1 MB — large tool-call payloads (e.g. dashboard JSON) can exceed bufio's 64 KB default
	maxLLMAttempts    = 2
	llmRetryBaseDelay = 250 * time.Millisecond
)

type LLMHTTPError struct {
	StatusCode   int
	Status       string
	RequestID    string
	TraceID      string
	Model        string
	MessageCount int
	ToolCount    int
	MaxTokens    int
	RequestBytes int
	Retryable    bool
}

func (e *LLMHTTPError) Error() string {
	if e == nil {
		return "LLM request failed"
	}
	if e.RequestID != "" {
		return fmt.Sprintf("LLM returned status %d (requestId=%s)", e.StatusCode, e.RequestID)
	}
	return fmt.Sprintf("LLM returned status %d", e.StatusCode)
}

func (e *LLMHTTPError) Code() string {
	if e == nil || e.StatusCode == 0 {
		return "llm_http_error"
	}
	return fmt.Sprintf("llm_http_%d", e.StatusCode)
}

func (e *LLMHTTPError) UserMessage() string {
	if e == nil {
		return "LLM request failed."
	}

	var message string
	switch e.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		message = "LLM app authorization failed. Ask an admin to verify the Ask O11y service account token and grafana-llm-app access."
	case http.StatusNotFound:
		message = "Grafana LLM app endpoint was not found. Ask an admin to verify grafana-llm-app is installed and enabled."
	case http.StatusTooManyRequests:
		message = "Grafana LLM app rate limited this request. Retry after the provider quota resets."
	default:
		if e.StatusCode >= 500 {
			message = "Grafana LLM app returned an internal error. Ask an admin to check grafana-llm-app provider configuration and backend logs."
		} else {
			message = fmt.Sprintf("Grafana LLM app rejected this request with HTTP %d.", e.StatusCode)
		}
	}
	if e.RequestID != "" {
		message += " Request ID: " + e.RequestID + "."
	}
	return message
}

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

	req.Stream = true

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	span.SetAttributes(
		attribute.String("llm.model", req.Model),
		attribute.Int("llm.message_count", len(req.Messages)),
		attribute.Int("llm.tool_count", len(req.Tools)),
		attribute.Int("llm.max_tokens", req.MaxTokens),
		attribute.Int("llm.request_bytes", len(body)),
	)

	for attempt := 1; attempt <= maxLLMAttempts; attempt++ {
		httpReq, err := c.buildHTTPRequest(ctx, body, grafanaURL, authToken, orgID)
		if err != nil {
			return nil, err
		}

		c.logger.Debug("Calling LLM",
			"url", httpReq.URL.String(),
			"messageCount", len(req.Messages),
			"toolCount", len(req.Tools),
			"maxTokens", req.MaxTokens,
			"requestBytes", len(body),
			"model", req.Model,
			"attempt", attempt,
			"orgID", orgID)

		resp, err := c.httpClient.Do(httpReq)
		if err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("LLM request failed: %w", err)
			}
			if attempt < maxLLMAttempts {
				c.logger.Warn("LLM request failed, retrying", "error", err, "attempt", attempt)
				if !sleepWithContext(ctx, retryDelay(nil, attempt)) {
					return nil, ctx.Err()
				}
				continue
			}
			return nil, fmt.Errorf("LLM request failed: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			llmErr := c.buildHTTPError(resp, req, len(body))
			resp.Body.Close()
			span.SetAttributes(
				attribute.Int("llm.http_status", llmErr.StatusCode),
				attribute.String("llm.request_id", llmErr.RequestID),
				attribute.Bool("llm.retryable", llmErr.Retryable),
			)
			c.logger.Warn("LLM returned non-OK status",
				"status", llmErr.StatusCode,
				"requestId", llmErr.RequestID,
				"traceId", llmErr.TraceID,
				"retryable", llmErr.Retryable,
				"model", llmErr.Model,
				"messageCount", llmErr.MessageCount,
				"toolCount", llmErr.ToolCount,
				"maxTokens", llmErr.MaxTokens,
				"requestBytes", llmErr.RequestBytes,
				"attempt", attempt)
			if llmErr.Retryable && attempt < maxLLMAttempts {
				if !sleepWithContext(ctx, retryDelay(resp, attempt)) {
					return nil, ctx.Err()
				}
				continue
			}
			return nil, llmErr
		}

		result, err = parseStream(resp)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		break
	}

	if result.Usage != nil {
		span.SetAttributes(
			attribute.Int("llm.prompt_tokens", result.Usage.PromptTokens),
			attribute.Int("llm.completion_tokens", result.Usage.CompletionTokens),
		)
	}

	return result, nil
}

func (c *LLMClient) buildHTTPError(resp *http.Response, req ChatCompletionRequest, requestBytes int) *LLMHTTPError {
	requestID, traceID := llmDiagnosticHeaders(resp.Header)
	return &LLMHTTPError{
		StatusCode:   resp.StatusCode,
		Status:       resp.Status,
		RequestID:    requestID,
		TraceID:      traceID,
		Model:        req.Model,
		MessageCount: len(req.Messages),
		ToolCount:    len(req.Tools),
		MaxTokens:    req.MaxTokens,
		RequestBytes: requestBytes,
		Retryable:    isRetryableLLMStatus(resp.StatusCode),
	}
}

func llmDiagnosticHeaders(headers http.Header) (requestID, traceID string) {
	for _, key := range []string{"X-Request-Id", "X-Grafana-Request-Id", "X-Request-ID", "X-Correlation-Id"} {
		if value := strings.TrimSpace(headers.Get(key)); value != "" {
			requestID = value
			break
		}
	}
	for _, key := range []string{"X-Trace-Id", "X-Grafana-Trace-Id", "Traceparent"} {
		if value := strings.TrimSpace(headers.Get(key)); value != "" {
			traceID = value
			break
		}
	}
	return requestID, traceID
}

func isRetryableLLMStatus(statusCode int) bool {
	return statusCode == http.StatusTooManyRequests ||
		statusCode == http.StatusInternalServerError ||
		statusCode == http.StatusBadGateway ||
		statusCode == http.StatusServiceUnavailable ||
		statusCode == http.StatusGatewayTimeout
}

func retryDelay(resp *http.Response, attempt int) time.Duration {
	if resp != nil {
		if retryAfter := strings.TrimSpace(resp.Header.Get("Retry-After")); retryAfter != "" {
			if seconds, err := strconv.Atoi(retryAfter); err == nil && seconds >= 0 {
				delay := time.Duration(seconds) * time.Second
				if delay > 5*time.Second {
					return 5 * time.Second
				}
				return delay
			}
		}
	}
	return time.Duration(attempt) * llmRetryBaseDelay
}

func sleepWithContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
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
