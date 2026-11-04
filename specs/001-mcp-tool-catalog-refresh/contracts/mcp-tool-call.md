# Contract: MCP Tool Call Errors and Catalog Signals

This feature adds no HTTP route and no OpenAPI field. `pkg/plugin/openapi/openapi.json` is unchanged.

The contracts below are the two surfaces that change or are newly consumed.

---

## C1. Tool-call error text (observable change)

**Direction**: plugin → agent → model → user.

**Producer**: `pkg/mcp/client.go` (`callMCPToolWithContext`), via `enrichUnknownToolError`.
**Consumer**: `pkg/agent/loop.go:1003`, which renders `Tool call error: <text>` into the tool result.

**Before**

```text
Tool call error: failed to call tool: calling "tools/call": unknown tool "alerting_manage_rules"
```

**After — retry also failed**

```text
Tool call error: failed to call tool: calling "tools/call": unknown tool "alerting_manage_rules"; this server now provides: alerting_rules_read, alerting_alertmanager_read
```

**Rules**

| ID | Rule |
|---|---|
| C1-1 | The original error text is preserved as a prefix. The hint is appended. |
| C1-2 | The error wraps the original with `%w`. `errors.As(err, *jsonrpc.Error)` and `mcp.ClassifyError` keep working. |
| C1-3 | At most 8 tool names are listed. |
| C1-4 | At most 8 names are listed. When more exist, the tail `(N more)` is appended, whether or not the names share tokens with the failed name. |
| C1-5 | The hint appears only for an unknown-tool failure that follows a successful re-list and a failing retry. A refused refresh (rate limit) or a failed re-list returns the original error unchanged, with no hint. |
| C1-6 | No HTTP response contains the text. It travels in the SSE tool result only, which is existing behaviour (Principle IV). |
| C1-7 | The failed tool name is never listed in the hint, even when a stale catalog still contains it. Candidates are compared after the `<serverID>_` strip, so a prefixed form of the failed name is excluded too. |

**Not in the contract**: the ranking order beyond "shared tokens first". Tests assert membership and the cap, not the exact order of equally-scored names.

---

## C2. Catalog-change notification (new consumer)

**Direction**: MCP server → plugin.

**Channel**: the MCP session's server-initiated stream. Only the `sse` transport keeps one; both streamable-http transports set `DisableStandaloneSSE: true` (`pkg/mcp/client.go:207`, `pkg/mcp/client.go:411`).

**Message**: JSON-RPC notification `notifications/tools/list_changed`, no params of interest.

**Handler**

```go
&mcpsdk.ClientOptions{
    ToolListChangedHandler: func(context.Context, *mcpsdk.ToolListChangedRequest) {
        c.toolsDirty.Store(true)
    },
}
```

| ID | Rule |
|---|---|
| C2-1 | The handler does no I/O, takes no lock, and returns at once. |
| C2-2 | The handler never re-lists inside the callback. The next `ListToolsWithContext` owns that. |
| C2-3 | A transport that cannot deliver the notification is valid. US1 recovery applies unchanged. |
| C2-4 | The plugin does not enable standalone SSE to widen delivery. |
| C2-5 | The dirty flag is advisory. If a notification is lost, the unknown-tool path still repairs the catalog. |

---

## C3. Unchanged surfaces

| Surface | Status | Evidence |
|---|---|---|
| `GET /api/mcp/tools` | Unchanged | `pkg/plugin/plugin.go:729` |
| `POST /api/mcp/call-tool` | Unchanged | `pkg/plugin/plugin.go:761` |
| `GET /api/mcp/servers` | Unchanged. No new field. | `pkg/plugin/plugin.go:834` |
| `<serverID>_<toolName>` prefixing | Unchanged | `pkg/mcp/client.go:466` |
| OpenAPI tool path | Unchanged, no refresh, no retry | `pkg/mcp/client.go:452`, `pkg/mcp/client.go:592` |
| Result cache key, TTL, and storage rules | Unchanged | `pkg/mcp/result_cache.go:22`, `pkg/mcp/proxy.go:286` |
| RBAC at listing and execution | Unchanged | `pkg/rbac/rbac.go`, `pkg/agent/loop.go:974` |
| `pkg/plugin/openapi/openapi.json` | Unchanged | `npm run validate:openapi` |

---

## C4. Retro-spec contract updates

Required in the same PR (Principle VII, constitution line 96).

| Retro-spec | Change |
|---|---|
| `specs/retro/106-mcp-proxy/spec.md` | New rules for stale-flag serving, single-flight, the 30s bound, the one-retry rule, OpenAPI exclusion, and the dirty flag. Remove the Known Gap "No cache invalidation on config change. Forward spec: cache invalidation." New `Last verified`. |
| `specs/retro/107-mcp-health/spec.md` | One rule: a failed refresh returns the cached catalog and does not change health status. New `Last verified`. |
| `specs/retro/104-tool-dispatch/spec.md` | One rule: a tool-call error may name refreshed tool names, and execution still resolves against the current catalog. New `Last verified`. |

Every new rule carries exactly one `VERIFIED`, `ASSUMED`, or `GAP` tag. `VERIFIED` rules point at a `path:line` that exists and is non-blank, or at a test name. `node scripts/verify-retro-specs.mjs` must pass.
