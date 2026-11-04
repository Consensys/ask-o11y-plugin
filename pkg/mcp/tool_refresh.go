package mcp

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
)

const (
	// toolCatalogRefreshMinInterval bounds failure-triggered catalog refreshes
	// to one per server per window. It stops a permanently dead tool name from
	// re-listing on every call, which would add load for no benefit.
	toolCatalogRefreshMinInterval = 30 * time.Second

	// unknownToolHintLimit caps how many replacement names the error text
	// advertises, so a server with a large catalog cannot flood the prompt.
	unknownToolHintLimit = 8
)

// markToolsStale records that the published catalog may disagree with the
// server. Readers keep serving the current slice: it is never emptied.
func (c *Client) markToolsStale() {
	c.mu.Lock()
	c.toolsStale = true
	c.mu.Unlock()
}

// clearToolsStale records that no refresh is outstanding. It is used when a
// refresh fails: the old catalog stays published, and only a new failure (or a
// new notification) re-arms the stale flag.
func (c *Client) clearToolsStale() {
	c.mu.Lock()
	c.toolsStale = false
	c.mu.Unlock()
}

// catalogGeneration returns the publication generation of the current catalog.
func (c *Client) catalogGeneration() uint64 {
	c.mu.RLock()
	gen := c.catalogGen
	c.mu.RUnlock()
	return gen
}

// supportsCatalogRefresh reports whether this server's transport is one whose
// catalog this package lists. The openapi and standard paths are untouched,
// so an unknown-tool error on them is returned verbatim.
func (c *Client) supportsCatalogRefresh() bool {
	switch c.config.Type {
	case "sse", "streamable-http", "http+streamable":
		return true
	default:
		return false
	}
}

// isUnknownToolError reports whether err is the server rejecting a tool name
// it does not have. Two signals qualify: a JSON-RPC invalid-params error
// (-32602) whose message names an unknown tool, and the same phrase in the
// wrapped error text.
//
// -32602 alone is not enough: older servers also use it for bad arguments, and
// re-listing the catalog on a user-input error would be a side effect for
// nothing.
func isUnknownToolError(err error) bool {
	if err == nil {
		return false
	}

	var rpcErr *jsonrpc.Error
	if errors.As(err, &rpcErr) &&
		rpcErr.Code == jsonrpc.CodeInvalidParams &&
		strings.Contains(strings.ToLower(rpcErr.Message), "unknown tool") {
		return true
	}

	return strings.Contains(strings.ToLower(err.Error()), "unknown tool")
}

// refreshTools re-lists this server's catalog once. The bool reports whether
// the caller should retry its tool call.
//
// sinceGen is the catalog generation the caller observed before its failed
// call, or zero for paths that are not recovering from a failure (cold start,
// a health probe, or a notification). A caller that waited on refreshMu behind
// another refresh sees a moved generation and returns true without repeating
// the network call.
//
// Concurrent callers are coalesced by refreshMu: the first one re-lists, the
// rest observe its outcome. Errors are logged here and returned for tests; the
// call path only uses the bool, because the original tool error is what the
// user must see (Principle IV).
func (c *Client) refreshTools(ctx context.Context, sinceGen uint64) (bool, error) {
	if !c.supportsCatalogRefresh() {
		return false, nil
	}

	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	c.mu.RLock()
	gen := c.catalogGen
	warm := c.tools != nil
	current := warm && !c.toolsStale && !c.toolsDirty.Load()
	c.mu.RUnlock()

	// Someone else re-listed while this caller waited for refreshMu.
	if sinceGen != 0 && gen != sinceGen {
		return true, nil
	}
	// Non-failure paths (cold start, probe, notification) with a current
	// catalog have nothing to do.
	if sinceGen == 0 && current {
		return true, nil
	}
	// The rate limit applies only to failure-triggered refreshes, so a first
	// listing that fails keeps retrying on later calls and a notification is
	// never swallowed.
	if sinceGen != 0 && warm && !c.lastRefresh.IsZero() &&
		time.Since(c.lastRefresh) < toolCatalogRefreshMinInterval {
		return false, nil
	}

	c.markToolsStale()
	tools, err := c.fetchTools(ctx)
	if err == nil && len(tools) == 0 {
		// An empty catalog is not a successful refresh: publishing it would
		// hide every previously working tool from FindToolByName (FR-007).
		err = fmt.Errorf("catalog refresh for server %s returned no tools", c.config.ID)
	}
	if err != nil {
		c.clearToolsStale()
		c.logger.Debug("mcp catalog refresh failed", "server", c.config.ID, "error", sanitizeError(err))
		return false, err
	}

	c.publishTools(tools)
	c.lastRefresh = time.Now()
	c.logger.Debug("mcp catalog refreshed", "server", c.config.ID, "tool_count", len(tools))
	return true, nil
}

// enrichUnknownToolError appends the names the server now provides to an
// unknown-tool error. The original error is wrapped with %w, so errors.As,
// errors.Is, and ClassifyError keep working.
//
// The hint matters because a run's advertised tool set is a snapshot: the
// error text is the only way the model can learn a replacement name in the
// same run. The failed name itself is never listed, even when a stale catalog
// still holds it: such a hint would contradict the error.
func (c *Client) enrichUnknownToolError(err error, failedName string) error {
	if err == nil {
		return nil
	}

	c.mu.RLock()
	tools := c.tools
	c.mu.RUnlock()

	if len(tools) == 0 {
		return err
	}

	prefix := c.config.ID + "_"
	deadName := strings.TrimPrefix(failedName, prefix)
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimPrefix(tool.Name, prefix)
		// A stale catalog still holds the name that just failed. Listing it
		// as "now provided" would contradict the error and invite a loop.
		if name == deadName {
			continue
		}
		names = append(names, name)
	}

	ranked := rankToolNames(failedName, names, unknownToolHintLimit)
	if len(ranked) == 0 {
		return err
	}

	hint := fmt.Sprintf("; this server now provides: %s", strings.Join(ranked, ", "))
	if len(names) > len(ranked) {
		hint += fmt.Sprintf(" (%d more)", len(names)-len(ranked))
	}
	return fmt.Errorf("%w%s", err, hint)
}

// rankToolNames orders candidates by how many underscore-delimited tokens they
// share with failedName, then by name. Token overlap resolves the observed
// rename case well: alerting_manage_rules shares "alerting" and "rules" with
// alerting_rules_read. The result is capped at limit.
func rankToolNames(failedName string, candidates []string, limit int) []string {
	failedTokens := tokenSet(failedName)

	type scored struct {
		name  string
		score int
	}

	ranked := make([]scored, 0, len(candidates))
	for _, candidate := range candidates {
		score := 0
		for token := range tokenSet(candidate) {
			if failedTokens[token] {
				score++
			}
		}
		ranked = append(ranked, scored{name: candidate, score: score})
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].name < ranked[j].name
	})

	if limit <= 0 || limit > len(ranked) {
		limit = len(ranked)
	}
	out := make([]string, 0, limit)
	for _, entry := range ranked[:limit] {
		out = append(out, entry.name)
	}
	return out
}

func tokenSet(name string) map[string]bool {
	tokens := make(map[string]bool)
	for _, token := range strings.Split(name, "_") {
		if token != "" {
			tokens[token] = true
		}
	}
	return tokens
}
