# Phase 0 Research: MCP Tool Catalog Refresh

All unknowns from the Technical Context are resolved. No NEEDS CLARIFICATION item remains.

---

## R1. Where the refresh state lives

**Decision**: On `Client` (`pkg/mcp/client.go:29`), one set per server.

**Rationale**: The stale cache is per client. `Proxy.UpdateConfig` reuses clients by server ID (`pkg/mcp/proxy.go:98`), so a client is the stable per-server object. `Proxy` never reads `client.tools`; it only forwards calls (`pkg/mcp/proxy.go:275`). Placing the state on `Proxy` would require a second map guarded by `proxy.mu` and would not survive the client replacement that `EnsureServer` already performs.

**Alternatives considered**:

- `Proxy`-level map keyed by server ID — rejected: duplicates client lifetime, and the lock order becomes `proxy.mu` → `client.mu` → `proxy.mu` for no benefit.
- A package-level registry — rejected: untestable, and it leaks across tests.

---

## R2. Stale flag instead of a nil cache

**Decision**: Keep `tools []Tool`. Add `toolsStale bool` guarded by `c.mu` and `toolsDirty atomic.Bool` written only by the notification handler. Never assign `nil` to `tools` after the first successful list.

**Rationale**: `FindToolByName` reads `client.tools` under `client.mu.RLock()` (`pkg/mcp/proxy.go:380`). If invalidation set the slice to nil, every in-flight run would resolve no tools for the duration of the refresh, and `agent.executeTool` would answer `Unknown tool: <valid name>` (`pkg/agent/loop.go:970`). A slice published under `c.mu` is never mutated afterwards, so a reader that copied the header keeps a consistent view (FR-007).

**Alternatives considered**:

- `c.tools = nil` on invalidation — rejected: empty-catalog window and a failed refresh would leave the server unusable until the next list.
- `atomic.Pointer[[]Tool]` — rejected: it would remove `c.mu` from the read path but force changes to `FindToolByName`, the health monitor, and every test that seeds `c.tools`. No measurable gain.

---

## R3. Single-flight and the rate limit

**Decision**: One `refreshMu sync.Mutex` held across the rate-limit check and the re-list. One `lastRefresh time.Time` guarded by that mutex. Constant `toolCatalogRefreshMinInterval = 30 * time.Second`. A `catalogGen uint64` guarded by `c.mu`, incremented on every successful publication.

**Rationale**: Holding the mutex across the whole refresh makes concurrent failures queue and then observe the outcome. The generation counter is what makes the queue useful: a caller that waited for another caller's refresh returns `true` (retry now) without a second network call, because the generation moved past the value it captured before its own attempt. Without it, the waiter would hit the rate limit and return `false`, and would not retry against the fresh catalog it just waited for.

The rate limit applies only to failure-triggered refreshes (`sinceGen != 0`). A cold start (`tools == nil`) and a notification-triggered refresh are not rate limited, which preserves today's behaviour for a first list that fails.

**Alternatives considered**:

- `golang.org/x/sync/singleflight` — rejected: a new module dependency for one call site, and it does not carry the rate limit or the generation comparison.
- A condition variable — rejected: more state, and the same waiting behaviour.
- A background goroutine that polls — rejected: the defect is event-driven, and a poller would add load to every server.

**Bound**: 8 concurrent failures produce 1 re-list (SC-002). A permanently dead name produces at most 2 re-lists per server per minute (SC-003), because each attempt is rate limited by `lastRefresh`.

---

## R4. Unknown-tool detection

**Decision**: In `pkg/mcp/tool_refresh.go`:

```go
func isUnknownToolError(err error) bool
```

Returns true when either holds:

1. `errors.As(err, &rpcErr)` finds a `*jsonrpc.Error` with `Code == jsonrpc.CodeInvalidParams` (-32602) and `strings.Contains(strings.ToLower(rpcErr.Message), "unknown tool")`.
2. `strings.Contains(strings.ToLower(err.Error()), "unknown tool")`.

**Rationale**: The SDK server emits `-32602` with `fmt.Sprintf("unknown tool %q", name)` and the transport wraps it as `calling "tools/call": %w`, then `callMCPToolOnce` wraps it again as `failed to call tool: %w` (`pkg/mcp/client.go:780`). `errors.As` therefore finds the wire error, and the message check is the precise signal. Rule 2 keeps detection independent of the error chain shape.

`jsonrpc.Error` is the public alias of the internal wire error and already ships in `go-sdk v1.5.0` (`jsonrpc/jsonrpc.go`), so this adds no module.

**Alternatives considered**:

- Match `-32602` alone — rejected: older servers also return `-32602` for bad arguments, which would re-list the catalog on a user-input error.
- Add `tool not found` and `no such tool` aliases — rejected by the approved scope. A false positive costs one rate-limited re-list, but the extra phrases add untested surface.
- Inspect `result.IsError` text — rejected: the tool may already have run, so a retry could duplicate a side effect (FR-009).

---

## R5. Retry placement

**Decision**: In `callMCPToolWithContext` (`pkg/mcp/client.go:642`), above `callMCPToolWithRetry`:

```go
gen := c.catalogGeneration()
result, err := c.callMCPToolWithRetry(ctx, c.callMCPToolOnce, ...)
if err == nil || !isUnknownToolError(err) {
    return result, err
}
refreshed, refreshErr := c.refreshTools(ctx, gen)
if refreshErr != nil || !refreshed {
    return result, c.enrichUnknownToolError(err, toolName)
}
result, err = c.callMCPToolWithRetry(ctx, c.callMCPToolOnce, ...)
if err != nil && isUnknownToolError(err) {
    return result, c.enrichUnknownToolError(err, toolName)
}
return result, err
```

**Rationale**: One extra `tools/call` at most, with no recursion. The transport backoff loop (`pkg/mcp/client.go:646-683`) stays untouched: `unknown tool` still classifies as `ErrKindProtocol` and returns immediately (`pkg/mcp/errors.go:70`), so the two retry layers stay independent. Placing this inside `callMCPToolOnce` would have coupled it to the transport loop and made the attempt count ambiguous.

**Alternatives considered**:

- Inside `callMCPToolOnce` — rejected: the transport loop would re-enter it, and a protocol error would return at `client.go:659` before any refresh.
- In `Proxy.CallToolWithContext` — rejected: `Proxy` does not own the catalog and would need a lock-order exception.

---

## R6. Naming the replacement tools in the error

**Decision**: `enrichUnknownToolError(err error, failedName string) error` wraps the original error with `%w` and appends a ranked, capped list:

```text
unknown tool "alerting_manage_rules" on server mcp-grafana; this server now provides: alerting_rules_read, alerting_alertmanager_read
```

Ranking: strip the `<serverID>_` prefix from each cached tool, split the failed name and each candidate on `_`, score by the number of shared tokens, sort by score descending then name ascending, cap at 8 names. When no candidate shares a token, list the first 8 names and append `(N more)`.

**Rationale**: The model reads the tool error text (`pkg/agent/loop.go:1003`), and the run's advertised set is a snapshot (FR-015). A ranked short list is the only way it can learn `alerting_rules_read` in the same run. Token overlap resolves exactly the observed rename: `alerting_manage_rules` shares `alerting` and `rules` with `alerting_rules_read`. The cap keeps the SSE payload small.

**Alternatives considered**:

- Reuse `pkg/agent/toolindex.go` search — rejected: `pkg/mcp` cannot import `pkg/agent` without an import cycle.
- Dump the whole catalog — rejected: mcp-grafana exposes about 100 tools; the text would dominate the prompt.
- Levenshtein distance — rejected: a rename is not a typo, and token overlap matches the real case better with less code.

---

## R7. `notifications/tools/list_changed`

**Decision**: Build the SDK client with `&mcpsdk.ClientOptions{ToolListChangedHandler: ...}` at `pkg/mcp/client.go:186`. The handler does one non-blocking write: `c.toolsDirty.Store(true)`. `ListToolsWithContext` treats a dirty flag as a refresh trigger and clears it on the next successful publication.

**Rationale**: `go-sdk v1.5.0` dispatches the notification (`mcp/client.go:1039`) and the options struct is already available. The handler must not take `c.mu`: the SDK invokes it from the connection reader, and `connectMCP` holds `c.mu` while it completes the initialize handshake. An atomic flag removes the lock-order question entirely.

Both streamable-http transports set `DisableStandaloneSSE: true` (`pkg/mcp/client.go:207`, `pkg/mcp/client.go:411`), and the SDK documents that server-initiated messages are not received in that mode. Delivery is therefore SSE-only, which the spec accepts (FR-016, US3 scenario 2).

**Alternatives considered**:

- Enable standalone SSE — rejected: a persistent GET per session, and org-scoped calls re-dial every time, so streams would churn.
- Clear the stale flag from the handler — rejected: it would need `c.mu` inside the transport callback.

---

## R8. Health monitor interaction

**Decision**: Do not modify `pkg/mcp/health.go`.

**Rationale**: `checkServer` calls `client.ListTools()` (`pkg/mcp/health.go:182`), which lands in `ListToolsWithContext`. After the change, a warm catalog with a failed refresh returns the cached slice and a nil error, so `recordHealth` records success. That satisfies FR-008 through the existing code path with no new branch. `CheckServerNow`'s `ToolCount > 0` loop keeps working.

**Alternatives considered**: an explicit `HasStaleCatalog()` hook on the health payload — rejected: it adds a field to the `/api/mcp/servers` contract, which the spec forbids.

---

## R9. Scope of the cache reset on config change

**Decision**: Leave `Proxy.UpdateConfig` and `Proxy.EnsureServer` unchanged.

**Rationale**: A server upgraded at the same URL keeps its `Client` and its catalog, but the first unknown-tool failure now repairs it (US1). A server with a changed URL or headers already gets a new client (`pkg/mcp/proxy.go:430`), whose `tools` is nil. `EnsureServer` still ignores changes to `Type`, `TimeoutSeconds`, and `OAuth`; that pre-existing gap stays a `GAP` row in 106 and is out of scope here.

**Alternatives considered**: mark every reused client stale on `UpdateConfig` — rejected: config reconciliation runs on every `CheckHealth`, which would re-list every server on every probe.

---

## R10. Test seams

**Decision**: Test through the existing `callToolOncer` seam (`pkg/mcp/client.go:635`) and a new unexported `listToolsFunc` field on `Client`, defaulting to the real list. Tests live in `package mcp` and seed `c.tools` directly, following `pkg/mcp/retry_test.go`.

**Rationale**: No real MCP server is needed. `retry_test.go` already proves this pattern: `retryTestClient(ctx)` builds a stripped `Client` with only the fields the path reads. A `listToolsFunc` field lets a test return a new catalog on the second call and count invocations.

**Alternatives considered**: a full `httptest` streamable-http server — rejected: slow and flaky for a behaviour that is decided before the wire.
