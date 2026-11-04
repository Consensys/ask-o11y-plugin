# Feature Specification: MCP Tool Catalog Refresh

**Feature Branch**: `001-mcp-tool-catalog-refresh`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "The MCP tool catalog is cached per server for the lifetime of the Grafana process and is never invalidated. When the remote MCP server changes its tool names, every call to a stale name fails and the agent keeps the dead list until Grafana restarts. Detect an unknown-tool failure, refresh that server's catalog once, retry the call once, and name the new tools in the error. Refresh per server, single-flight, rate limited. Honour `notifications/tools/list_changed` where the transport delivers it. Keep prefixing, the OpenAPI path, and result-cache semantics unchanged."

## Context

Fleet operators upgrade MCP servers in place. A remote MCP server can rename, add, or remove tools between two calls without restarting Grafana. The agent currently advertises and calls tool names from a catalog that is read once per server and never cleared.

Observed in dev on 2026-11-04 during the `mcp-grafana` 1.4.0 to 2.2.0 upgrade: `alerting_manage_rules` became `alerting_rules_read`, and the `tempo_*` tools became `get_tempo_trace`, `search_tempo_traces`, and `query_tempo_metrics`. The plugin kept serving the old names. Every call to `alerting_manage_rules` returned:

```
Tool call error: failed to call tool: calling "tools/call": unknown tool "alerting_manage_rules"
```

One `alerting` investigation then produced a wrong verdict. The rule snapshot failed, the model received no rule data, invented a runbook URL, and concluded that the alert was not firing. The same investigation returned the correct verdict after a Grafana restart.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recover from a server tool rename without a restart (Priority: P1)

An operator upgrades an MCP server that renames one or more tools. The agent calls a tool name from the previous catalog. The call fails with an unknown-tool error. The plugin re-lists that server's catalog, retries the call once with the current name, and reports success. If the retry also fails, the error names the tools that the server now provides.

**Why this priority**: This is the reported defect. Without it, every affected investigation fails until a Grafana restart.

**Independent Test**: Point a client at a stub server whose catalog changes between two listings. Call the removed name. Assert that one refresh happens, that one retry happens, and that the current name is used.

**Acceptance Scenarios**:

1. **Given** a server catalog that no longer contains `alerting_manage_rules` and now contains `alerting_rules_read`, **When** the agent calls `mcp-grafana_alerting_manage_rules`, **Then** the plugin re-lists the catalog, retries once, and the call succeeds against the current tool.
2. **Given** the same situation but the current name is unknown to the agent, **When** the retry also fails, **Then** the returned error names the tools that the server now provides for that area.
3. **Given** a tool name that never existed, **When** the agent calls it twice, **Then** the plugin refreshes at most once per 30 seconds and does not loop.

---

### User Story 2 - Concurrent investigations do not stampede the server (Priority: P2)

Several investigations run at the same moment and all hit the same renamed tool. The plugin coalesces them into one catalog refresh per server.

**Why this priority**: A fleet-wide upgrade can hit many runs at once. Unbounded re-listing would add load to the MCP server and Grafana.

**Independent Test**: Start N concurrent calls that all fail with an unknown-tool error. Count the catalog listings on the stub server. Assert that the count is one.

**Acceptance Scenarios**:

1. **Given** 8 concurrent runs that call a removed tool, **When** they all fail, **Then** exactly one catalog refresh reaches the server.
2. **Given** a refresh in progress, **When** a second failure arrives, **Then** the second caller waits for the same refresh and does not start another.

---

### User Story 3 - Notice an announced catalog change before a call fails (Priority: P3)

A server that supports catalog-change notifications announces the change. The plugin marks the catalog stale at once. The next listing returns the new names.

**Why this priority**: This removes the one failed call. It is an improvement, not the primary fix, and only some transports can deliver the notification.

**Independent Test**: Deliver a catalog-change notification on a stream-capable transport. Assert that the next listing re-lists and returns the new names, with no failed call.

**Acceptance Scenarios**:

1. **Given** a server that sends a catalog-change notification, **When** the notification arrives, **Then** the next catalog listing reflects the change.
2. **Given** a transport that cannot deliver notifications, **When** the server changes its catalog, **Then** the unknown-tool recovery in User Story 1 still applies.

---

### Edge Cases

- The server is unreachable during the refresh. The plugin keeps the previous catalog, returns the original call error, and does not change the server's health status.
- The refresh returns an empty catalog. Treat it as a failed refresh. Keep the previous catalog.
- A tool is removed with no replacement. The retry fails. The error names the remaining tools on that server.
- The model repeats the same dead name. The 30-second window limits refreshes to two per minute per server.
- Two servers change their catalogs at once. Each server refreshes independently.
- The failing server is an OpenAPI server. The OpenAPI path does not use this recovery.
- A tool result reports an error in its own text. It does not trigger a refresh, because the tool may already have run.
- A per-user token is in use. The catalog stays per server, as it is today. Per-user catalogs are out of scope.
- A refresh runs during a health probe. The probe serves the previous catalog and stays healthy.
- The run started before the catalog changed. The advertised tool set for that run does not change. A refreshed name is callable, because the call path resolves against the current catalog.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect an unknown-tool failure from either signal: a JSON-RPC error with code `-32602` whose message contains `unknown tool`, or the phrase `unknown tool` in the lowercased text of the wrapped error.
- **FR-002**: On detection, the system MUST mark that server's catalog as stale and re-list the catalog from that server.
- **FR-003**: After a successful re-list, the system MUST retry the failed call exactly once. It MUST NOT retry a second time in the same call.
- **FR-004**: If the re-list fails, the system MUST keep the previous catalog and return the original call error.
- **FR-005**: Re-lists MUST be single-flight per server. Concurrent failures MUST produce at most one re-list.
- **FR-006**: The system MUST allow at most one re-list per server per 30 seconds.
- **FR-007**: The system MUST continue to serve the last known-good catalog while a re-list is in progress. It MUST NOT present an empty catalog to callers.
- **FR-008**: A failed re-list MUST NOT change the server's health status.
- **FR-009**: The system MUST NOT trigger a refresh or retry when a tool result merely reports an error flag. Only the unknown-tool signals in FR-001 qualify.
- **FR-010**: When the retry also fails, the error text shown to the model MUST name the tools that the server now provides.
- **FR-011**: OpenAPI servers MUST keep their current behaviour, with no refresh and no retry.
- **FR-012**: Result-cache semantics MUST stay unchanged. A refreshed name MUST NOT receive a cached result stored under a removed name.
- **FR-013**: Refreshed tool names MUST keep the `<serverID>_<toolName>` prefix.
- **FR-014**: Where the transport delivers a catalog-change notification, the system MUST mark the catalog stale without doing the re-list inside the notification callback.
- **FR-015**: Within one run, the advertised tool set MUST NOT change. Mid-run replacement of the advertised set is out of scope for this version.
- **FR-016**: The plugin MUST NOT enable additional server-initiated streams to receive notifications. Only transports that already deliver them are in scope.

### Key Entities

- **Per-server tool catalog**: The ordered list of tool descriptors for one MCP server, as last listed from that server. Includes name, description, input schema, and annotations.
- **Catalog state**: Whether the catalog is current or stale, the time of the last refresh, and the last known-good catalog.
- **Refresh stamp**: The time of the last successful re-list for a server. Bounds the refresh rate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an MCP server renames a tool, the first call that uses the dead name either succeeds or returns an error that names the replacement. No Grafana restart is needed.
- **SC-002**: A burst of 8 concurrent failures on one server causes exactly 1 catalog listing at that server.
- **SC-003**: Repeated calls to a permanently dead tool produce at most one catalog re-list in any 30-second window per server.
- **SC-004**: The cache-hit path adds no I/O and one atomic load. The normal tool-call latency does not change measurably.
- **SC-005**: The dev `alerting` investigation reaches the correct verdict after an in-place MCP server upgrade, with no Grafana restart.
- **SC-006**: A server that is unreachable during a refresh stays reported as healthy for that refresh cycle.

## Assumptions

- A remote MCP server can change its catalog at any time without restarting Grafana.
- The catalog is per server, not per user. Per-user catalogs are out of scope.
- A 30-second refresh window per server is acceptable. The first failure refreshes immediately.
- Only the JSON-RPC unknown-tool signal and the `unknown tool` phrase are reliable. Other phrasings are out of scope.
- The advertised tool set for an active run is a snapshot. The model can still call a refreshed name that the error text reports.
- New dependencies are not required.

---

## Project Requirements (Ask O11y)

### RBAC Matrix

This feature is role-neutral. It changes catalog freshness only.

| Action | Admin | Editor | Viewer | Enforcement |
|---|---|---|---|---|
| Trigger a catalog refresh by calling a removed tool | yes | yes | yes | `pkg/mcp/client.go` |
| Call a mutating tool after a refresh | yes | yes | no | `pkg/rbac/rbac.go`, `pkg/agent/loop.go` |

The refresh MUST NOT bypass the existing call-time RBAC check or the tool-selection filter.

### Mandatory Edge Cases

| Edge case | Applies | Behaviour |
|---|---|---|
| A Viewer requests a mutating tool | Yes | Refused at listing time and at call time, before and after a refresh |
| The SSE `error` event | No | This feature does not change stream error handling |
| The rate limit is exceeded on share creation | No | Not touched |
| The LLM or an MCP server is down | Yes | Surfaced error, no fallback answer; a failed refresh keeps the old catalog |
| Redis is unavailable | No | Not touched |
| The service-account token meets a non-Org-1 request | No | Not touched |

### Contract Changes

No route changes. `pkg/plugin/openapi/openapi.json` does not change.

The observable contract change is the text of a tool-call error: it now names the tools that the server provides after a catalog change.

### Existing Contracts

- `specs/retro/106-mcp-proxy/spec.md` — the cached catalog and its Known Gap "No cache invalidation on config change. Forward spec: cache invalidation." This feature closes that gap.
- `specs/retro/107-mcp-health/spec.md` — a failed refresh must not change health status.
- `specs/retro/104-tool-dispatch/spec.md` — the unknown-tool error text and the call-time tool resolution.
