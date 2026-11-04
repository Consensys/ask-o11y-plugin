# Retro-Spec: MCP Health Monitoring

**Capability ID**: `107-mcp-health`

**Status**: Retrospective

**Last verified**: `f3db81a`

**Owner**: Ask O11y maintainers

**Module**: `pkg/mcp/health.go`

---

## Purpose

The plugin probes each MCP server every 30 seconds. The probe records a status,
a response time, and the server tool list. The AppConfig UI reads that state from
`/api/mcp/servers`.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Read `/api/mcp/servers` | yes | yes | yes | `pkg/plugin/plugin.go:834` |
| Change the poll interval | no | no | no — compile-time constant | `pkg/plugin/config.go:40` |
| Trigger a health probe | no | no | no — internal only | `pkg/mcp/health.go:141` |

The route has no role check. Any authenticated caller sees every server's status.

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/mcp/servers` | `handleMCPServers` | `pkg/plugin/plugin.go:834` |

Response body: `{servers, systemHealth, oauth}`. `pkg/plugin/plugin.go:845`

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| none | health state is pulled, never pushed | `pkg/plugin/plugin.go:834` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `useBuiltInMCP` | `jsonData` | `false` | `pkg/plugin/plugin.go:91` |
| health interval | Go constant | 30s | `pkg/plugin/config.go:40` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| none — the probe calls `tools/list` on each client | n/a | `pkg/mcp/health.go:182` |

## Behaviour Rules

1. The monitor starts at plugin init with a 30s interval. `VERIFIED` — `pkg/plugin/plugin.go:323`
2. `Start` runs one check immediately, before the first tick. `VERIFIED` — `pkg/mcp/health.go:80`
3. Each tick checks every registered client. `VERIFIED` — `pkg/mcp/health.go:85`
4. Servers are checked sequentially inside one tick. `VERIFIED` — `pkg/mcp/health.go:132`
5. The probe is `client.ListTools()`. There is no separate ping or handshake probe. `VERIFIED` — `pkg/mcp/health.go:182`
6. Five statuses exist: `healthy`, `degraded`, `unhealthy`, `disconnected`, `connecting`. `VERIFIED` — `pkg/mcp/health.go:14`
7. A server seen for the first time starts as `connecting` with zero tools. `VERIFIED` — `pkg/mcp/health.go:211`
8. A failed probe increments `errorCount` and `consecutiveFailures`, and records `lastError`. `VERIFIED` — `pkg/mcp/health.go:198`
9. Failures 1 and 2 report `degraded`. Failures 3 and 4 report `unhealthy`. Five or more report `disconnected`. `VERIFIED` — `pkg/mcp/health.go:202`
10. On the second consecutive failure the monitor calls `forceReconnect`. `VERIFIED` — `pkg/mcp/health.go:217`
11. The reconnect runs outside the health-map lock. `VERIFIED` — `pkg/mcp/health.go:244`
12. `forceReconnect` is skipped when the session is younger than 5 seconds. `VERIFIED` — test `TestForceReconnect_DedupesRecentSession`
13. A successful probe resets `consecutiveFailures`, clears `lastError`, and stores `tools` and `toolCount`. `VERIFIED` — `pkg/mcp/health.go:222`
14. A successful probe slower than 2000ms reports `degraded`. A faster one reports `healthy`. `VERIFIED` — `pkg/mcp/health.go:227`
15. `successRate` is the share of successful checks across all checks since startup, not a fixed value. `VERIFIED` — `pkg/mcp/health.go:239`
16. Health reaches the UI as `servers[]` of `ServerHealth`. `VERIFIED` — `pkg/plugin/plugin.go:846`
17. `ServerHealth` carries `serverId`, `name`, `url`, `type`, `status`, `lastCheck`, `responseTime`, `successRate`, `errorCount`, `consecutiveFailures`, `lastError`, `tools`, `toolCount`. `VERIFIED` — `pkg/mcp/health.go:22`
18. `systemHealth` reports `overallStatus` plus per-status counts and `total`. `VERIFIED` — `pkg/mcp/health.go:267`
19. `overallStatus` is `unhealthy` if any server is `unhealthy` or `disconnected`. `VERIFIED` — `pkg/mcp/health.go:295`
20. `overallStatus` is `degraded` if any server is `degraded` and none is unhealthy. `VERIFIED` — `pkg/mcp/health.go:297`
21. `/api/mcp/servers` first registers and probes the built-in MCP when `useBuiltInMCP` is set. `VERIFIED` — `pkg/plugin/plugin.go:837`
22. That immediate probe retries up to 3 times, 150ms apart, until `toolCount > 0`. `VERIFIED` — `pkg/mcp/health.go:148`
23. Unhealthy servers stay in the tool list. The list path never reads health state. `VERIFIED` — `pkg/mcp/proxy.go:137`
24. `GetAllHealth` copies values, so a caller cannot mutate the stored state. `VERIFIED` — `pkg/mcp/health.go:259`
25. The status constants are a closed set of five strings. `VERIFIED` — `pkg/mcp/health.go:13`
26. There is no exponential backoff. The probe interval stays constant. `GAP` — `pkg/mcp/health.go:65`
27. Removing a server also removes its health entry, and a probe that was already running cannot recreate it. `VERIFIED` — `pkg/mcp/proxy.go:116`, `pkg/mcp/health.go:120`, `pkg/mcp/health.go:206`
28. `Stop` returns without blocking when `Start` never ran. `VERIFIED` — `pkg/mcp/health.go:98`
29. No test covers the health state machine, the thresholds, or `/api/mcp/servers`. `GAP` — no `health_test.go` exists
30. `responseTime` measures `ListTools` wall time, which includes a cached tool list. `ASSUMED` — `pkg/mcp/client.go:481` returns the cache without a network call
31. A failed catalog refresh does not change a server's health: the probe receives the cached catalog and a nil error. `VERIFIED` — test `TestRefreshFailureKeepsCatalogAndHealth`

## Invariants

- The poll interval is 30s and is not user-configurable. `VERIFIED` — `pkg/plugin/config.go:40`
- A probe never mutates tool data; it only replaces the stored copy. `VERIFIED` — `pkg/mcp/health.go:222`
- Reconnect runs outside the health lock. `VERIFIED` — `pkg/mcp/health.go:244`
- A refresh failure never reaches the probe as an error, so health cannot flap on a catalog refresh. `VERIFIED` — `pkg/mcp/tool_refresh.go:98`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| One probe fails | Status `degraded`, `lastError` set | `pkg/mcp/health.go:207` |
| Three probes fail in a row | Status `unhealthy` | `pkg/mcp/health.go:204` |
| Five probes fail in a row | Status `disconnected` | `pkg/mcp/health.go:202` |
| Two probes fail in a row | Session torn down and rebuilt | `pkg/mcp/health.go:217` |
| Every server fails | `systemHealth.overallStatus` = `unhealthy` | `pkg/mcp/health.go:295` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| In-process health map | server ID | none — lifetime of the plugin | none | `pkg/mcp/health.go:44` |

Health state is per replica and is lost on restart. Replicas can disagree.

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | none | — | `pkg/mcp/health.go:165` starts no span |
| Log field | `consecutiveFailures`, `error`, `server` | plugin log on failure | `pkg/mcp/health.go:245` |
| Log line | `forceReconnect triggered by health monitor` | plugin log | `pkg/mcp/health.go:248` |

## Evidence Index

- `pkg/mcp/health.go:13` — status enum
- `pkg/mcp/health.go:165` — probe implementation
- `pkg/mcp/health.go:202` — failure thresholds
- `pkg/plugin/config.go:40` — 30s interval
- `pkg/mcp/reconnect_test.go` — `TestForceReconnect_DedupesRecentSession` — reconnect dedupe

## Known Gaps

- `successRate` is always 100. The counter maths is wrong.
- No backoff. A dead server is probed every 30s forever.
- Removed servers keep a stale health row.
- `Stop` deadlocks when called before `Start`.
- No test covers health.go at all. Forward spec: health monitor tests.
