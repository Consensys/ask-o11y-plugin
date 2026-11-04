# Retro-Spec: Settings, Config, and Multi-Org

**Capability ID**: `114-settings-multi-org`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/config.go`, `pkg/plugin/plugin.go` (init and dispose)

## Purpose

An admin configures the plugin once per org through jsonData and secureJsonData.
The plugin builds its HTTP clients, stores, and MCP servers from those settings.
Every record and tool call is scoped to the org that made the request.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Change plugin settings | yes | no | no | `ASSUMED` — Grafana app config is Admin-only; no plugin-side check |
| Read the health message | yes | yes | yes | `VERIFIED` — `pkg/plugin/plugin.go:553` |
| Use the configured org stores | yes | yes | yes | `VERIFIED` — `pkg/plugin/plugin.go:2327` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/health` | `handleHealth` | `pkg/plugin/plugin.go:580` |
| GET | `/openapi.json` | `handleOpenAPISpec` | `pkg/plugin/plugin.go:581` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| None. This module emits no SSE event. | — | `pkg/plugin/plugin.go:518` |

### Configuration keys

| Key group | jsonData keys | Default | Evidence |
|---|---|---|---|
| MCP servers | `mcpServers`, `useBuiltInMCP`, `builtInMCPToolSelections`, `trustedMCPServers`, `riskOverrides` | empty, off | `pkg/plugin/plugin.go:90` |
| Prompts | `defaultSystemPrompt`, `investigationPrompt`, `performancePrompt`, `skills` | shipped constants | `pkg/plugin/plugin.go:96` |
| URL routing | `builtInMCPBaseURL`, `useLocalGrafanaURL`, `localGrafanaPort` | `http://localhost:3000`, off, `0` | `pkg/plugin/plugin.go:107` |
| Retention | `sessionTTLDays`, `graphitiEpisodeTTLDays` | `90`, `30` | `pkg/plugin/config.go:71` |
| Context | `keepRecentToolResults`, `maxToolResponseTokens`, `aggressiveToolResponseTokens`, `maxHighVolumeToolResponseTokens`, `aggressiveHighVolumeToolResponseTokens`, `toolCallSummarizationDisabled` | resolved in the loop | `pkg/plugin/plugin.go:136` |
| Other | `maxTotalTokens`, `recentMessageCount`, `graphitiScanInterval`, `serviceGraphMaxNodes`, `serviceGraphMaxEdges`, `graphitiAutoSaveSessionsDisabled`, `approvalPolicy`, `maxParallelToolCalls`, `agentEvalCaptureEnabled` | resolved at init or in the loop | `pkg/plugin/plugin.go:104` |
| Tool search | `toolSearch` | auto | `pkg/plugin/plugin.go:146` |
| Secure | `redisURL`, `mcpServerHeader.{serverID}.{headerName}` | none | `pkg/plugin/plugin.go:330` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| Every tool of the built-in server `mcp-grafana` | inherited from the server | `pkg/plugin/plugin.go:87` |

## Behaviour Rules

1. `JSONData` is unmarshalled into `PluginSettings`; a parse failure logs and uses empty settings. `VERIFIED` — `pkg/plugin/plugin.go:269`
2. Secret values are read only from `DecryptedSecureJSONData`. `VERIFIED` — `pkg/plugin/plugin.go:276`
3. `redisURL` is the only scalar key read from secure data. `VERIFIED` — `pkg/plugin/plugin.go:330`
4. Per-server headers use the `mcpServerHeader.{serverID}.{headerName}` prefix and match an existing server ID. `VERIFIED` — `pkg/plugin/plugin.go:149`
5. The parser is tested for matching, unknown, malformed, empty, multiple, and dotted keys. `VERIFIED` — test `TestApplySecureHeaders_DottedHeaderName`
6. Header keys assume a server ID with no dot; the parser splits the key at the first dot. `VERIFIED` — `pkg/plugin/plugin.go:160`
7. The service-account token comes from `GrafanaConfig.PluginAppClientSecret`, never from plugin settings. `VERIFIED` — `pkg/plugin/plugin.go:925`
8. `maxTotalTokens` at or below zero becomes `agent.DefaultMaxTotalTokens`. `VERIFIED` — `pkg/plugin/plugin.go:280`
9. An unparsable `builtInMCPBaseURL` is cleared, and the fallback is `http://localhost:3000`. `VERIFIED` — `pkg/plugin/plugin.go:287`
10. `sessionTTLDays` at or below zero becomes 90 days. `VERIFIED` — `pkg/plugin/config.go:78`
11. The Grafana URL resolution order is: local loopback, `GrafanaConfig.AppURL`, then the base-URL fallback. `VERIFIED` — `pkg/plugin/plugin.go:54`
12. All HTTP clients come from `httpclient.New`, with a 30-second timeout for OAuth and 600 seconds for LLM calls. `VERIFIED` — `pkg/plugin/plugin.go:370`
13. The LLM client never sets `X-Grafana-Org-Id`; the SA token is Org-1 scoped. `VERIFIED` — `pkg/agent/llm_client.go:324`
14. `getOrgID` reads the server-populated plugin context and defaults to `1` when absent. `VERIFIED` — `pkg/plugin/plugin.go:2332`
15. When `orgID` is not `1`, the LLM client logs a warning and still sends the token without an org header. `VERIFIED` — `pkg/agent/llm_client.go:326`
16. MCP calls do send `X-Grafana-Org-Id` with the caller's org. `VERIFIED` — `pkg/mcp/client.go:84`
17. The context-first rule is tested. `VERIFIED` — test `TestGetOrgIDPrefersPluginContext`
18. `getUserID` hashes the login; no client header can set it. `VERIFIED` — `pkg/plugin/plugin.go:2025`
19. `useBuiltInMCP` with no SA token removes the built-in server and logs a warning. `VERIFIED` — `pkg/plugin/plugin.go:621`
20. `full.yaml_` never enables `useBuiltInMCP`. `VERIFIED` — `provisioning/plugins/full.yaml_:18`
21. `app.yaml` enables `useBuiltInMCP` for org 1. `VERIFIED` — `provisioning/plugins/app.yaml:31`
22. An empty `redisURL` still attempts `redis://localhost:6379/0`. `VERIFIED` — `pkg/plugin/plugin.go:75`
23. Redis is used only when the client builds and answers `PING`; otherwise memory wins. `VERIFIED` — `pkg/plugin/plugin.go:333`
24. Redis success and fallback are both tested. `VERIFIED` — test `TestNewPlugin_RedisSuccess`
25. `Dispose` cancels every run, closes brokers, stops the scout, stops health monitoring, closes the proxy and Redis, then cancels the context. `VERIFIED` — `pkg/plugin/plugin.go:519`
26. When Redis is absent, the health message says session sharing will not work across replicas. `VERIFIED` — `pkg/plugin/plugin.go:570`
27. Settings, sessions, and runs are all keyed by org, so org 2 gets separate records. `VERIFIED` — `pkg/plugin/sessionstore.go:94`
28. In a non-Org-1 org, the plugin keeps using the Org-1 service-account token for the LLM. The configured LLM app for that org is therefore not selected. `GAP` — `pkg/agent/llm_client.go:326`
29. The same mismatch applies to the built-in MCP: the Org-1 SA token is paired with the caller's `X-Grafana-Org-Id`. `GAP` — `pkg/mcp/client.go:84`

Coverage: `VERIFIED` = code pointer or test; `ASSUMED` = code suggests, no test; `GAP` = missing or contradictory.

## Invariants

- No secret is read from plain `JSONData`. `VERIFIED` — `pkg/plugin/plugin.go:276`
- The LLM request never carries `X-Grafana-Org-Id`. `VERIFIED` — `pkg/agent/llm_client.go:324`
- Org identity comes from the plugin context, never from a client header. `VERIFIED` — `pkg/plugin/plugin.go:2331`
- `useBuiltInMCP: true` never appears in `provisioning/plugins/full.yaml_`. `VERIFIED` — `provisioning/plugins/full.yaml_:18`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| `builtInMCPBaseURL` is invalid | Error logged; `http://localhost:3000` used | `pkg/plugin/plugin.go:287` |
| Redis connection fails | Warning; in-memory stores | `pkg/plugin/plugin.go:345` |
| SA token unavailable | Warning; built-in MCP and SA LLM calls fail | `pkg/plugin/plugin.go:926` |
| `useBuiltInMCP` with no SA token | Built-in server removed; warning | `pkg/plugin/plugin.go:622` |
| SDK HTTP client fails to build | `NewPlugin` returns an error | `pkg/plugin/plugin.go:431` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Redis client | `redisURL` from secure data | connection timeout 5s | In-memory stores | `pkg/plugin/plugin.go:330` |
| Redis sessions | `session:{id}` | `sessionTTLDays` | `SessionStore` | `pkg/plugin/sessionstore_redis.go:15` |
| Redis runs | `run:{id}` | 1 hour | `RunStore` | `pkg/plugin/runstore_redis.go:45` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | None. Init and dispose emit no span. | — | `pkg/plugin/plugin.go:265` |
| Metric | None. Init emits no metric. | — | `pkg/plugin/plugin.go:554` |
| Log field | `orgID` | LLM client warning for a non-1 org | `pkg/agent/llm_client.go:326` |

## Evidence Index

- `pkg/plugin/plugin.go:265` — `NewPlugin`
- `pkg/mcp/client.go:84` — MCP org header
- `provisioning/plugins/full.yaml_:18` — built-in MCP absent
- `pkg/agent/llm_client_test.go` — `TestLLMClient_ChatCompletion` — no org header with SA auth

## Known Gaps

- A non-Org-1 org runs on the Org-1 service-account token. A forward spec must decide whether cross-org LLM routing is supported or refused.
- An empty `redisURL` still probes `redis://localhost:6379/0`. In a cluster with a local Redis this silently changes the storage backend.
- `useBuiltInMCP` plus a non-Org-1 caller pairs an Org-1 token with another org header. The result depends on the MCP server and is not tested.
- A server ID that contains a dot cannot receive secure headers, because the parser splits the key at the first dot.
