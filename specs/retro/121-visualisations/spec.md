# Retro-Spec: Inline Visualisations
**Capability ID**: `121-visualisations`
**Status**: Retrospective
**Last verified**: `18e315b`
**Owner**: Ask O11y maintainers
**Module**: `src/components/Chat/utils/`, `src/components/Chat/scenes/`
---
## Purpose
An assistant answer can embed a query block that renders as a live Grafana panel. The user reads the data without leaving the chat.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| See an inline panel | yes | yes | yes | `src/components/Chat/components/ChatMessage/ChatMessage.tsx:72` |
| Change the panel type | yes | yes | yes | `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:50` |
| Query a datasource | datasource permission applies | datasource permission applies | datasource permission applies | `src/components/Chat/utils/resolveVisualizationDatasource.ts:14` |

Datasource access is Grafana's own permission model. This code adds no role check.
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/datasources/proxy/uid/{uid}/api/search` | inline `loadTraces` | `src/components/Chat/components/TracesRenderer/TracesRenderer.tsx:104` |
| — | no other network call; panels use the scenes query runner | — | `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:99` |
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| — | visualisation consumes no SSE event; it reads `content` text | `src/components/Chat/hooks/useChat.ts:237` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| — | none; the block attributes `title`, `from`, `to`, `viz`, `ds` carry the settings | `src/components/Chat/utils/promqlParser.ts:45` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| — | visualisation is client-side; no tool renders it | `src/components/Chat/components/ChatMessage/ChatMessage.tsx:64` |
## Behaviour Rules
1. A query block is recognised only with the tag `promql`, `prometheus`, `logql`, `loki`, `traceql`, or `tempo`. `VERIFIED` — test `should ignore non-query code blocks`
2. The language maps to a type: `logql`/`loki` to logs, `traceql`/`tempo` to traces, everything else to metrics. `VERIFIED` — test `should extract a LogQL query`
3. Fence attributes `title`, `from`, `to`, `viz`, and `ds` parse in any order. `VERIFIED` — test `should extract query with multiple attributes`
4. `viz` accepts exactly 8 names. Any other value is discarded. `VERIFIED` — test `should ignore invalid visualization types`
5. The accepted names are `timeseries`, `stat`, `gauge`, `table`, `piechart`, `barchart`, `heatmap`, `histogram`. `VERIFIED` — test `should accept all valid visualization types`
6. An empty or whitespace `ds` is dropped. `ASSUMED` — `src/components/Chat/utils/promqlParser.ts:86`
7. The section type selects the renderer: `promql` to `GraphRenderer`, `logql` to `LogsRenderer`, `traceql` to `TracesRenderer`. `VERIFIED` — `src/components/Chat/components/ChatMessage/ChatMessage.tsx:72`
8. Content without a recognised block is one text section. `VERIFIED` — test `should return text content when no queries present`
9. Empty content yields no sections. `VERIFIED` — test `should return empty array for empty content`
10. Several blocks yield alternating text and query sections. `VERIFIED` — test `should handle multiple query sections`
11. `to` defaults to `now` when `from` is present. `ASSUMED` — `src/components/Chat/components/ChatMessage/ChatMessage.tsx:28`
12. The panel type defaults to `timeseries`. `VERIFIED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:39`
13. The user can override the panel type from an 8-option control. `VERIFIED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:50`
14. A panel builder exists for each of the 8 types. `VERIFIED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:113`
15. Prometheus runs as a range query with `format: 'time_series'`. `ASSUMED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:105`
16. An explicit `ds` that does not exist returns "Datasource UID … was not found.". `VERIFIED` — test `returns error when UID is unknown`
17. An explicit `ds` of the wrong plugin type returns a type error. `VERIFIED` — test `returns error when UID type mismatches`
18. Without `ds`, the default instance of the plugin type is used. `VERIFIED` — test `picks default datasource when UID omitted`
19. Without a default, the first instance of the plugin type is used. `VERIFIED` — test `falls back to first instance when none marked default`
20. With no instance of the type, the error tells the user to add one. `VERIFIED` — test `returns error when no datasource of type exists`
21. A datasource failure shows the error and clears the scene. `ASSUMED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:83`
22. A thrown render error shows the boundary titled "Graph Rendering Error". `VERIFIED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:351`
23. Dashboard links match `/d/{uid}` with an optional slug and query string. `VERIFIED` — test `should detect dashboard with slug`
24. Explore links match `/explore` only as a complete path segment. `VERIFIED` — test `should not match /explorer as an explore link`
25. Markdown link text becomes the page-ref title. `VERIFIED` — test `should detect markdown link with title`
26. Links deduplicate by path, so an absolute and a relative URL collapse. `VERIFIED` — test `should deduplicate identical URLs`
27. Trailing punctuation is trimmed from a captured URL. `VERIFIED` — test `should trim trailing punctuation from URLs`
28. Absolute and relative URLs both parse. `VERIFIED` — test `should detect full HTTPS URL with slug and query params`
29. Empty content yields no page refs. `VERIFIED` — test `should return empty array for empty content`
30. LogQL `rate({…})` counts as an aggregation. `VERIFIED` — test `still detects LogQL rate aggregations`
31. LogQL `sum(count_over_time(…))` counts as `sum`. `ASSUMED` — `src/components/Chat/utils/queryAnalyzer.ts:18`
32. TraceQL counts an aggregation only after a pipe. `VERIFIED` — test `does not classify span duration filters as aggregations`
33. TraceQL `span:status` is not an aggregation. `VERIFIED` — test `does not classify span status filters as aggregations`
34. TraceQL `count`, `avg`, and `rate` pipeline functions are detected. `VERIFIED` — test `detects count aggregation in TraceQL pipelines`
35. `useChatScene` builds a `SplitLayout` of `ChatInterfaceScene` and `GrafanaPageScene`. `VERIFIED` — `src/components/Chat/hooks/useChatScene.ts:30`
36. `chatPanelPosition` `right` makes the Grafana page the primary pane at 0.4. `ASSUMED` — `src/components/Chat/hooks/useChatScene.ts:26`
37. Scene state changes are pushed into the live scene objects. `ASSUMED` — `src/components/Chat/hooks/useChatScene.ts:103`
38. A scene build failure is captured and returned to the caller; it is not swallowed. `VERIFIED` — `src/components/Chat/hooks/useChatScene.ts:57`
39. Tempo traces come from the datasource proxy with `limit` 20 and `spss` 3. `ASSUMED` — `src/components/Chat/components/TracesRenderer/TracesRenderer.tsx:106`
40. A Tempo failure shows "Failed to fetch traces from Tempo". `ASSUMED` — `src/components/Chat/components/TracesRenderer/TracesRenderer.tsx:116`
41. Logs use a Loki datasource and a logs panel. `VERIFIED` — `src/components/Chat/components/LogsRenderer/LogsRenderer.tsx:50`
42. Rendered markdown is sanitized, with `iframe`, `object`, `embed`, `form`, `base`, `link`, and `meta` forbidden. `ASSUMED` — `src/components/Chat/components/ChatMessage/ChatMessage.tsx:51`
43. No test renders `GraphRenderer`, `LogsRenderer`, or `TracesRenderer`. `GAP` — only the utils have unit tests
Coverage tags:

| Tag | Meaning | Review action |
|---|---|---|
| `VERIFIED` | A code pointer or a test proves the rule | Accept without reading |
| `ASSUMED` | Code suggests it, no test proves it | Human must confirm or veto |
| `GAP` | Behaviour is absent, unclear, or contradictory | Becomes a candidate forward spec |
## Invariants
- `viz` never widens beyond the 8 accepted names. `VERIFIED` — `src/components/Chat/utils/promqlParser.ts:81`
- A datasource is resolved at render time, never cached across orgs. `ASSUMED` — `src/components/Chat/utils/resolveVisualizationDatasource.ts:14`
- Every renderer is wrapped in an error boundary or sets an error string. `VERIFIED` — `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:351`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| `ds` UID unknown | Error text "Datasource UID … was not found." | `src/components/Chat/utils/resolveVisualizationDatasource.ts:20` |
| `ds` type mismatch | Error text naming both types | `src/components/Chat/utils/resolveVisualizationDatasource.ts:25` |
| No datasource of the type | "No … datasource found. Add one under Connections, or set a default." | `src/components/Chat/utils/resolveVisualizationDatasource.ts:36` |
| Panel construction throws | Error boundary "Graph Rendering Error" | `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:351` |
| Tempo search fails | "Failed to fetch traces from Tempo" | `src/components/Chat/components/TracesRenderer/TracesRenderer.tsx:116` |
| Scene bootstrap throws | Error Alert names the failure | `src/components/Chat/Chat.tsx:284` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Grafana datasource registry | instance settings by UID | registry lifetime | default then first instance | `src/components/Chat/utils/resolveVisualizationDatasource.ts:18` |
| Scene object | `EmbeddedScene` per panel | component lifetime | none | `src/components/Chat/components/GraphRenderer/GraphRenderer.tsx:43` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | none | — | `GAP` |
| Log field | none; datasource errors render in the panel | — | `GAP` |
## Evidence Index
- `src/components/Chat/utils/promqlParser.ts:103` — block regex
- `src/components/Chat/utils/promqlParser.ts:47` — attribute parser
- `src/components/Chat/utils/grafanaLinkParser.ts:111` — link extraction
- `src/components/Chat/utils/resolveVisualizationDatasource.ts:10` — datasource resolver
- `src/components/Chat/utils/queryAnalyzer.ts:8` — aggregation detector
- `src/components/Chat/scenes/ChatInterfaceScene.tsx:40` — scene wrapper for the chat
## Known Gaps
- No unit test renders a panel component. Forward spec: renderer component tests.
- The scene bootstrap failure is silent. Forward spec: scene bootstrap failure.
- The datasource choice is not shown to the user when `ds` is omitted. Forward spec: datasource transparency.
- Visualisations emit no spans or metrics. Forward spec: render observability.
