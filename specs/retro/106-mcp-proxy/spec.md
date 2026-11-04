# Retro-Spec: MCP Proxy, Client, and Result Cache

**Capability ID**: `106-mcp-proxy`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/mcp/`

---

## Purpose

One proxy merges many tool lists, prefixes each tool with its server ID, routes
calls to the owning client, and caches one slow read-only tool.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| List aggregated tools | yes | yes | yes, filtered later | `pkg/plugin/plugin.go:747` |
| Call a tool | yes | yes | read-only only | `pkg/plugin/plugin.go:802` |

The proxy holds no role logic. Callers filter before and after it.

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/mcp/tools` | `handleMCPTools` | `pkg/plugin/plugin.go:729` |
| POST | `/api/mcp/call-tool` | `handleMCPCallTool` | `pkg/plugin/plugin.go:761` |
| GET | `/api/mcp/servers` | `handleMCPServers` | `pkg/plugin/plugin.go:834` |

The raw JSON-RPC `/mcp` route is removed because it bypassed RBAC. `pkg/plugin/plugin.go:582`

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| `mcp_unavailable` | `message` | `pkg/agent/loop.go:683` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `mcpServers[].timeoutSeconds` | `jsonData` | `0` means 30s | `pkg/mcp/types.go:107` |
| `mcpServers[].type` | `jsonData` | none | `pkg/mcp/types.go:95` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `<serverID>_list_prometheus_metric_names` | yes — only cached tool | `pkg/mcp/result_cache.go:22` |

## Behaviour Rules

1. `UpdateConfig` keeps only configs with `Enabled: true`. `VERIFIED` — `pkg/mcp/proxy.go:73`
2. `UpdateConfig` reuses an existing client when the server ID is unchanged. `VERIFIED` — `pkg/mcp/proxy.go:98`
3. `UpdateConfig` creates one client per new server and shares one SDK HTTP client. `VERIFIED` — `pkg/mcp/proxy.go:99`
4. Removed clients are closed outside the proxy lock. `VERIFIED` — test `TestEnsureServerClosesReplacedClientOutsideLock`
5. `ListTools` returns an empty slice, not an error, when no server is registered. `VERIFIED` — `pkg/mcp/proxy.go:142`
6. `ListTools` queries all clients concurrently. `VERIFIED` — `pkg/mcp/proxy.go:153`
7. A failing server is logged and skipped. Healthy servers still return tools. `VERIFIED` — `pkg/mcp/proxy.go:166`
8. `ListTools` errors only when every server failed and no tool was collected. `VERIFIED` — `pkg/mcp/proxy.go:174`
9. Aggregated tool order is not sorted. It follows map iteration and goroutine completion. `VERIFIED` — `pkg/mcp/proxy.go:137`
10. The `{serverID}_` prefix is applied once, in the client, after discovery. `VERIFIED` — `pkg/mcp/client.go:466`
11. The client strips the prefix before the call leaves for the server. `VERIFIED` — `pkg/mcp/client.go:589`
12. Server resolution uses the longest registered ID prefix, not the first underscore. `VERIFIED` — test `TestServerIDForTool`
13. A tool name with no underscore returns `invalid tool name format`. `VERIFIED` — `pkg/mcp/proxy.go:242`
14. An unknown server prefix returns an `IsError` result with `Server not found: <prefix>`. `VERIFIED` — `pkg/mcp/proxy.go:248`
15. Only `tools/list`, `tools/call`, and `initialize` are served. Other methods return `-32601`. `VERIFIED` — `pkg/mcp/proxy.go:309`
16. Only names ending in `list_prometheus_metric_names` are cached. `VERIFIED` — test `TestCacheableTTL`
17. The cache TTL for that tool is 60 seconds. `VERIFIED` — `pkg/mcp/result_cache.go:23`
18. The cache key is `tool|org|scopeOrg|user|argsJSON`. `VERIFIED` — test `TestCacheKey_ScopesAcrossOrgUserAndArguments`
19. An `IsError` result is never stored, and an error is never stored. `VERIFIED` — `pkg/mcp/proxy.go:286`
20. Expired entries are dropped on read and swept on write. `VERIFIED` — test `TestResultCache_ExpiresAfterTTL`
21. A cache hit returns the same result pointer that was stored. `VERIFIED` — test `TestResultCache_GetSetRoundTrip`
22. The proxy builds its HTTP client with `httpclient.New`, never a bare `http.Client`. `VERIFIED` — `pkg/mcp/proxy.go:474`
23. The shared client has a 30s total timeout and a 10s dial timeout. `VERIFIED` — `pkg/mcp/proxy.go:476`
24. `TimeoutSeconds` overrides the call budget. Zero or negative uses 30s. `VERIFIED` — test `TestClient_ToolCallTimeout`
25. A `streamable-http` client is clamped to the call budget. `VERIFIED` — test `TestClient_TransportHTTPClientTimeout`
26. An `sse` client gets a zero client timeout, so the stream survives. `VERIFIED` — `pkg/mcp/client.go:300`
27. An MCP `tools/list` exchange is bounded at 10s. `VERIFIED` — `pkg/mcp/client.go:538`
28. Transport failures retry after 100ms, 300ms, and 700ms, with ±30% jitter. `VERIFIED` — test `TestJitteredDuration_BoundsAreRespected`
29. Only `ErrKindTransport` is retried. Protocol and cancelled errors return at once. `VERIFIED` — test `TestRetry_ProtocolErrorNotRetried`
30. An exhausted transport failure returns `*TransportError`. `VERIFIED` — test `TestRetry_PermanentTransportExhausts`
31. `connection closed` or `client is closing` triggers one reconnect and one retry. `VERIFIED` — `pkg/mcp/client.go:736`
32. `ClassifyError` checks cancellation first, then transport signals, then protocol. `VERIFIED` — test `TestClassifyError`
33. `TransportError` unwraps to its cause. `VERIFIED` — test `TestTransportError_UnwrapAndMessage`
34. The agent maps `TransportError` to `transport` and every other error to `protocol`. `VERIFIED` — `pkg/agent/loop.go:990`
35. Two distinct tools with transport errors emit one `mcp_unavailable` event per run. `VERIFIED` — `pkg/agent/loop.go:680`
36. A server configuration change clears the result cache. `VERIFIED` — `pkg/mcp/proxy.go:121`
37. Type `standard` is documented but cannot connect. `GAP` — `pkg/mcp/client.go:212` errors while `listStandardTools` exists at `pkg/mcp/client.go:1025`

## Invariants

- Lock order is `proxy.mu` then `client.mu`, never reversed. `VERIFIED` — `pkg/mcp/proxy.go:379`
- The server prefix is applied exactly once per listed tool. `VERIFIED` — `pkg/mcp/client.go:466`
- Every outbound MCP request uses an SDK-built HTTP client. `VERIFIED` — `pkg/mcp/proxy.go:474`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| One server is down | Its tools are absent, others list | `pkg/mcp/proxy.go:166` |
| Every server is down | `all servers failed: <reasons>` | `pkg/mcp/proxy.go:175` |
| Unknown tool prefix | IsError text `Server not found: <prefix>` | `pkg/mcp/proxy.go:248` |
| Transport error after retries | `Tool call error: mcp transport error: ...` | `pkg/agent/loop.go:992` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| In-process result cache | `tool\|org\|scopeOrg\|user\|args` | 60s | recompute | `pkg/mcp/result_cache.go:61` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `mcp_tool_call` | Tempo, via agent | `pkg/agent/loop.go:960` |
| Span attribute | `mcp.tool_name`, `mcp.error_kind` | Tempo | `pkg/agent/loop.go:961` |

## Evidence Index

- `pkg/mcp/proxy.go:70` — config reconciliation and client lifecycle
- `pkg/mcp/errors.go:70` — error taxonomy entry point
- `pkg/mcp/proxy_test.go` — `TestServerIDForTool` — prefix resolution
- `pkg/mcp/retry_test.go` — `TestRetry_ProtocolErrorNotRetried` — retry classification

## Known Gaps

- No cache invalidation on config change. Forward spec: cache invalidation.
- No cache size bound. A long-lived process grows until expiry.
- Tool ordering is non-deterministic. Forward spec: stable tool ordering.
- The `standard` transport is unreachable. Remove it or implement it.
