# Retro-Spec: MCP Provisioning and Trace Propagation

**Capability ID**: `110-mcp-provisioning`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/mcp_provisioner.go`, `pkg/mcp/trace_propagation.go`

---

## Purpose

An operator declares MCP servers in `jsonData.mcpServers`. The plugin loads them
at start, adds runtime servers, and sends W3C trace context with each tool call.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Declare servers in provisioning YAML | yes | no | no | `provisioning/plugins/app.yaml:32` |
| Add, list, or delete a runtime server | yes | no | no | `pkg/plugin/mcp_provisioner.go:108` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/mcp/provisioner/presets` | `handleListPresets` | `pkg/plugin/mcp_provisioner.go:22` |
| GET | `/api/mcp/provisioner` | `handleProvisionerRoot` | `pkg/plugin/mcp_provisioner.go:23` |
| POST | `/api/mcp/provisioner/preset` | `handleAddPreset` | `pkg/plugin/mcp_provisioner.go:24` |
| POST | `/api/mcp/provisioner/generic` | `handleAddGeneric` | `pkg/plugin/mcp_provisioner.go:25` |
| DELETE | `/api/mcp/provisioner/{serverId}` | `handleProvisionerItem` | `pkg/plugin/mcp_provisioner.go:26` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| none | provisioning is request/response only | `pkg/plugin/mcp_provisioner.go:21` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `mcpServers[]` | `jsonData` | empty | `pkg/plugin/plugin.go:90` |
| `mcpServers[].id`, `.url`, `.type`, `.enabled` | `jsonData` | required, `enabled` false | `pkg/mcp/types.go:91` |
| `mcpServers[].timeoutSeconds` | `jsonData` | `0` means 30s | `pkg/mcp/types.go:107` |
| `mcpServerHeader.{id}.{header}` | `secureJsonData` | none | `pkg/plugin/plugin.go:149` |
| `useBuiltInMCP` | `jsonData` | `false` | `pkg/plugin/plugin.go:91` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| all tools of every provisioned server | per annotation | `pkg/mcp/client.go:466` |

## Behaviour Rules

1. `mcpServers` is a JSON array at the root of `jsonData`. `VERIFIED` — `provisioning/plugins/app.yaml:32`
2. Settings are decoded once with `json.Unmarshal` into `PluginSettings`. `VERIFIED` — `pkg/plugin/plugin.go:269`
3. Four `type` values are documented: `openapi`, `standard`, `sse`, `streamable-http`. `VERIFIED` — `pkg/mcp/types.go:95`
4. `http+streamable` is an alias of `streamable-http`; both use the SDK streamable transport with 3 retries, and `sse` uses the SDK SSE transport. `VERIFIED` — `pkg/mcp/client.go:202`, `pkg/mcp/client.go:198`
5. `openapi` fetches a spec from `{url}/openapi.json` when the URL lacks that suffix. `VERIFIED` — `pkg/mcp/client.go:858`
6. `standard` is declared but cannot connect. `GAP` — `pkg/mcp/client.go:212` returns an error; `listStandardTools` is unreachable
7. Any other type returns `unsupported MCP transport type: <type>`. `VERIFIED` — `pkg/mcp/client.go:217`
8. Secrets arrive as `mcpServerHeader.{serverID}.{headerName}` in `secureJsonData`. `VERIFIED` — `pkg/plugin/plugin.go:149`
9. That mapping requires a server ID without dots, because it splits at the first dot. `VERIFIED` — `pkg/plugin/plugin.go:160`
10. `trustedMCPServers` overrides `Trusted`; global `riskOverrides` copy into servers with none. `VERIFIED` — `pkg/plugin/plugin.go:188`
11. Provisioned servers are attached with `UpdateConfig` at plugin init. `VERIFIED` — `pkg/plugin/plugin.go:318`
12. Settings are read only in `NewPlugin`; a change needs a new plugin instance. `ASSUMED` — `pkg/plugin/plugin.go:265` is the only writer of `p.settings`
13. Runtime servers are restored from the dynamic server store after provisioning. `VERIFIED` — `pkg/plugin/plugin.go:398`
14. `EnsureServer` keeps an existing client when URL and headers match. `VERIFIED` — test `TestEnsureServerNoopWhenConfigMatchesExisting`
15. `EnsureServer` replaces the client when URL or headers differ. `VERIFIED` — test `TestEnsureServerClosesReplacedClientOutsideLock`
16. Replacing a client for an existing ID logs a warning with the ID and URL. `VERIFIED` — `pkg/mcp/proxy.go:435`
17. Deleting a runtime server removes the client, the OAuth config, and every user token. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:361`
18. A runtime server ID must be 1-64 chars of `[a-z0-9-]`. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:206`
19. A runtime server transport must be `streamable-http` or `sse`. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:240`
20. Presets are `github-read`, `github-write`, and `atlassian`. `VERIFIED` — `pkg/plugin/oauth/presets.go:38`
21. The built-in MCP registers as server ID `mcp-grafana`. `VERIFIED` — `pkg/plugin/plugin.go:87`
22. The built-in URL is `{grafanaURL}/api/plugins/grafana-llm-app/resources/mcp/grafana` and it authenticates with the service-account bearer. `VERIFIED` — `pkg/plugin/plugin.go:629`, `pkg/plugin/plugin.go:633`
23. With no service-account token the plugin removes the built-in client instead of failing. `VERIFIED` — `pkg/plugin/plugin.go:621`
24. The service-account token is Org 1 only, so `useBuiltInMCP` must not appear in `full.yaml_`. `ASSUMED` — documentation only: `CLAUDE.md:69`
25. No code checks the org before registering the built-in MCP. `GAP` — `pkg/plugin/plugin.go:617` takes no org argument
26. `full.yaml_` provisions servers for Org 1 and Org 2 and never sets `useBuiltInMCP`. `VERIFIED` — `provisioning/plugins/full.yaml_:17`, `provisioning/plugins/full.yaml_:54`
27. A provisioned `timeoutSeconds: 90` is honoured for the Grafana sidecar. `VERIFIED` — `provisioning/plugins/full.yaml_:38`
28. Trace context is propagated outbound only: from asko11y to the MCP server. `VERIFIED` — `pkg/mcp/trace_propagation.go:77`
29. The propagated headers are W3C `traceparent` and `tracestate`, injected directly rather than through the OTel global. `VERIFIED` — `pkg/mcp/trace_propagation.go:51`
30. Every client transport is wrapped with `tracePropagationTransport`. `VERIFIED` — `pkg/mcp/client.go:277`
31. A stashed caller span is the preferred parent source. `VERIFIED` — test `TestTracePropagationTransport_MergedContextCallerSpan`
32. Without any span the request passes through with no trace header, and the caller request is never mutated. `VERIFIED` — test `TestTracePropagationTransport_NoSpan`
33. No sampling decision is made or forwarded by the plugin. `GAP` — `pkg/mcp/trace_propagation.go:77` injects context only
34. Inbound `traceparent` from Grafana is not read. `GAP` — no handler parses `traceparent`

## Invariants

- `useBuiltInMCP: true` never appears in `full.yaml_`. `VERIFIED` — `provisioning/plugins/full.yaml_:16`
- The service-account bearer is sent only to the built-in MCP URL. `VERIFIED` — `pkg/plugin/plugin.go:633`
- Outbound trace injection never mutates the caller request. `VERIFIED` — `pkg/mcp/trace_propagation.go:74`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| `jsonData` fails to parse | Empty settings, one error log, plugin starts | `pkg/plugin/plugin.go:270` |
| No service-account token with built-in MCP | Built-in server removed, warning logged | `pkg/plugin/plugin.go:622` |
| Preset discovery or DCR fails | 502 with a provider-specific message | `pkg/plugin/mcp_provisioner.go:143` |
| Non-admin hits a provisioner route | 403 `admin role required` | `pkg/plugin/mcp_provisioner.go:37` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Redis dynamic servers | hash `mcp_dynamic_servers` | none | in-memory store | `pkg/plugin/oauth/servers.go:75` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | `mcp_tool_call` (parent of the outgoing request) | Tempo | `pkg/agent/loop.go:960` |
| Span context header | `traceparent`, `tracestate` | outgoing MCP request | `pkg/mcp/trace_propagation.go:77` |

## Evidence Index

- `provisioning/plugins/app.yaml:32` — single-org provisioning shape
- `provisioning/plugins/full.yaml_:16` — multi-org shape without built-in MCP
- `pkg/plugin/mcp_provisioner.go:21` — runtime server routes
- `pkg/mcp/trace_propagation.go:53` — outbound injection
- `pkg/mcp/trace_propagation_test.go` — `TestTracePropagationTransport_InjectsTraceparent` — header injection

## Known Gaps

- The `standard` transport is declared and unimplemented.
- A runtime server silently overrides a provisioned server with the same ID.
- The Org 1 limit on the built-in MCP is documentation only; no code enforces it.
- No sampling decision is propagated, and inbound trace context is ignored.
- The provisioner has no tests. Forward spec: provisioning route tests.
