package graphiti

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Client calls the Graphiti REST API (zepai/graphiti Docker image).
// Base paths assume FastAPI defaults; verify against /docs on a running instance.
// Writes use /v1/episodes, reads use /v1/search.
type Client struct {
	baseURL    string
	httpClient *http.Client
	logger     log.Logger
}

func NewClient(baseURL string, logger log.Logger) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

// Health pings the Graphiti service. Returns non-nil if unreachable or unhealthy.
func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("health check returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// AddEpisodes writes discovery episodes to the knowledge graph under the given groupID.
// Each episode is posted individually; partial failures are logged and skipped.
func (c *Client) AddEpisodes(ctx context.Context, groupID string, episodes []Episode) error {
	var firstErr error
	for i := range episodes {
		episodes[i].GroupID = groupID
		body, err := json.Marshal(episodes[i])
		if err != nil {
			c.logger.Warn("Failed to marshal episode, skipping", "name", episodes[i].Name, "error", err)
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/episodes", bytes.NewReader(body))
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.httpClient.Do(req)
		if err != nil {
			c.logger.Warn("Failed to add episode", "name", episodes[i].Name, "error", err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			err = fmt.Errorf("add episode %q returned HTTP %d", episodes[i].Name, resp.StatusCode)
			c.logger.Warn("Episode ingestion failed", "name", episodes[i].Name, "status", resp.StatusCode)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// SearchContext searches the knowledge graph and returns a formatted string ready
// to be injected into the agent's system prompt, or "" if nothing relevant was found.
func (c *Client) SearchContext(ctx context.Context, groupID, query string, numResults int) (string, error) {
	payload := SearchRequest{
		Query:      query,
		GroupIDs:   []string{groupID},
		NumResults: numResults,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/search", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("search returned HTTP %d", resp.StatusCode)
	}

	var result SearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return formatSearchResponse(result), nil
}

func formatSearchResponse(r SearchResponse) string {
	if len(r.Edges) == 0 && len(r.Nodes) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("\n\n## Service Map Context\n")
	sb.WriteString("The following facts about your monitored services are known:\n")
	for _, edge := range r.Edges {
		fact := edge.Fact
		if fact == "" {
			fact = edge.Name
		}
		if fact != "" {
			sb.WriteString("- ")
			sb.WriteString(fact)
			sb.WriteString("\n")
		}
	}
	for _, node := range r.Nodes {
		if node.Summary != "" {
			sb.WriteString("- ")
			sb.WriteString(node.Name)
			sb.WriteString(": ")
			sb.WriteString(node.Summary)
			sb.WriteString("\n")
		}
	}
	return sb.String()
}
