# Retro-Spec: Sidebar, Stats, and Session UX
**Capability ID**: `122-session-ux`
**Status**: Retrospective
**Last verified**: `6c09d13`
**Owner**: Ask O11y maintainers
**Module**: `src/components/Chat/components/SessionSidebar/`, `src/services/backendSessionClient.ts`
---
## Purpose
A user finds earlier conversations, reads their cost, shares one by link, and opens a session from a URL.
## Actors and RBAC
| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| List own sessions | yes | yes | yes | `src/services/backendSessionClient.ts:61` |
| Create and delete a session | yes | yes | yes | `src/services/backendSessionClient.ts:46` |
| Create a share link | yes | yes | yes | `src/services/sessionShare.ts:52` |
| Read a shared session | yes | yes | yes | `src/pages/SharedSession.tsx:27` |

Sessions are scoped by the `X-Grafana-Org-Id` header. No role check exists in this path.
## Contract
### HTTP endpoints
| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET, POST | `/api/plugins/consensys-asko11y-app/resources/api/sessions` | `listSessions`, `createSession` | `src/services/backendSessionClient.ts:61` |
| GET, PUT, DELETE | `…/api/sessions/{sessionId}` | `getSession`, `updateSession`, `deleteSession` | `src/services/backendSessionClient.ts:71` |
| GET | `…/api/sessions/{sessionId}/stats` | `getSessionStats` | `src/services/backendSessionClient.ts:81` |
| DELETE | `…/api/sessions` | `deleteAllSessions` | `src/services/backendSessionClient.ts:112` |
| GET, PUT | `…/api/sessions/current` | `getCurrentSessionId`, `setCurrentSessionId` | `src/services/backendSessionClient.ts:133` |
| POST | `…/api/sessions/share` | `sessionShareService.createShare` | `src/services/sessionShare.ts:72` |
| GET | `…/api/sessions/shared/{shareId}` | `getSharedSession` | `src/services/sessionShare.ts:92` |
| GET | `…/api/sessions/{sessionId}/shares` | `getSessionShares` | `src/services/sessionShare.ts:145` |
| DELETE | `…/api/sessions/share/{shareId}` | `revokeShare` | `src/services/sessionShare.ts:130` |
### SSE events
| Event | Payload fields | Evidence |
|---|---|---|
| — | no session UI consumes an SSE event | `src/services/backendSessionClient.ts:1` |
### Configuration keys
| Key | Location | Default | Evidence |
|---|---|---|---|
| `sessionTTLDays` | `jsonData` | `90` | `src/components/AppConfig/AppConfig.tsx:140` |
### MCP tool names
| Tool | Read-only | Evidence |
|---|---|---|
| — | session UX calls no MCP tool | `src/services/backendSessionClient.ts:1` |
## Behaviour Rules
1. The session list loads when the org changes, and no last session is restored. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:62`
2. A failed list refresh keeps the displayed list. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:51`
3. New chat clears history, the current id, the URL, and the backend current session. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:91`
4. Load sets the messages, the list metadata, the URL, and the backend current session. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:102`
5. A 404 on load clears the session and the history. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:125`
6. Delete refreshes the list and starts a new chat when the deleted session is current. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:136`
7. Delete all refreshes the list and starts a new chat. `ASSUMED` — `src/components/Chat/hooks/useSessionManager.ts:152`
8. Every session request sends `X-Grafana-Org-Id`. `VERIFIED` — test `fetches usage stats for a session`
9. Create sends a title and a message array. An absent title becomes `''`. `ASSUMED` — `src/services/backendSessionClient.ts:53`
10. `updateSession` exists but no UI calls it. `GAP` — `src/services/backendSessionClient.ts:91` is unreferenced
11. The sidebar has no rename control. `GAP` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:406` renders the title read-only
12. The sidebar unit test does not import the component; it tests local copies of the helpers. `GAP` — `src/components/Chat/components/SessionSidebar/SessionSidebar.test.tsx:1`
13. An empty list shows "No saved conversations yet" and "Start a new chat to begin". `VERIFIED` — test `should show empty state or sessions list`
14. Each item shows a relative date and the message count. `VERIFIED` — test `should display session info with date and message count`
15. The stats row appears only when `runCount` is above zero. `VERIFIED` — test `should display token/turn/tool-call stats after a completed run`
16. Token counts abbreviate to `k` and `M`, and `999.6k` promotes to `1.0M`. `VERIFIED` — test `should promote to the "M" suffix when rounding would otherwise reach "1000k"`
17. Turns and tool calls use singular wording for a count of one. `VERIFIED` — test `should use singular turn and tool call for a count of one`
18. Delete needs an inline confirmation before the request. `VERIFIED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:362`
19. Clear All History asks with a browser `confirm`. `ASSUMED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:233`
20. Shares and stats load when the sidebar opens and when any `updatedAt` changes. `ASSUMED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:36`
21. The share button title is "View shares" when shares exist, else "Share". `ASSUMED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:442`
22. The sidebar is docked and open by default in the interactive chat. `VERIFIED` — test `should create a new chat session from sidebar`
23. A click loads the session, and closes the overlay only when it is not docked. `ASSUMED` — `src/components/Chat/components/SessionSidebar/SessionSidebar.tsx:99`
24. Test ids are `session-item`, `session-share-button`, `session-delete-button`, and `session-stats`. `VERIFIED` — test `should create a share link for a session`
25. `sessionId` must match `/^[a-zA-Z0-9\-_]{1,128}$/`, or it is removed from the URL. `ASSUMED` — `src/hooks/useSessionUrl.ts:11`
26. A valid `sessionId` is checked with `getSession` before use, and a failure removes it. `ASSUMED` — `src/hooks/useSessionUrl.ts:47`
27. Writing the session id uses `replaceState`, so it adds no history entry. `ASSUMED` — `src/hooks/useSessionUrl.ts:58`
28. Home shows a spinner until URL validation finishes. `ASSUMED` — `src/pages/Home.tsx:37`
29. Create share posts `sessionId` and `sessionData` to `/api/sessions/share`. `ASSUMED` — `src/services/sessionShare.ts:58`
30. `expiresInHours` wins over `expiresInDays` when both are given. `ASSUMED` — `src/services/sessionShare.ts:63`
31. Reading a share rejects a payload without a `messages` array. `ASSUMED` — `src/services/sessionShare.ts:104`
32. Revoke deletes `/api/sessions/share/{shareId}`. `VERIFIED` — test `should revoke a share link`
33. A failed share list degrades to an empty array. `ASSUMED` — `src/services/sessionShare.ts:141`
34. A share URL keeps a backend `/a/` path, and honours the Grafana sub-path. `VERIFIED` — test `prefixes the share URL with Grafana appSubUrl under a subpath deployment`
35. A bare share id becomes `/a/<plugin>/shared/<id>?orgId=<org>`. `VERIFIED` — test `falls back to building the path from a bare shareId at root`
36. The dialog shows a URL input and "Share link created successfully!". `VERIFIED` — test `should create a share link for a session`
37. The share URL contains `/shared/` and `?orgId=`. `VERIFIED` — test `should create a share link for a session`
38. `/a/<plugin>/shared/:shareId` renders the read-only page, and the chat input is hidden. `VERIFIED` — test `should view a shared session in read-only mode`
39. An unknown share shows "not found or has expired" and a Go to Home button. `VERIFIED` — test `should show error for invalid share ID`
40. Import creates a new session and returns to the plugin root with `?sessionId=`. `VERIFIED` — test `should import a shared session`
41. `type=investigation` plus `alertName` produces `alertName:<name>` with type `investigation`. `VERIFIED` — test `should return alertName for backend prompt rendering`
42. An `alertName` over 256 characters, or one matching `/<script|javascript:|data:/i`, gives "Invalid alert name format". `VERIFIED` — test `should validate alertName and reject script injection`
43. `?skill=` alone enters no investigation mode and sends no message. `VERIFIED` — test `returns a validated skill without entering investigation mode`
44. A skill outside `/^[a-z0-9]+(-[a-z0-9]+)*$/`, or over 64 characters, is dropped. `VERIFIED` — test `ignores an invalid skill name`
45. A valid skill combines with the investigation deep link. `VERIFIED` — test `combines the skill param with the legacy investigation deep link`
46. The investigation error screen offers Start Normal Chat. `ASSUMED` — `src/pages/Home.tsx:53`
Coverage tags:

| Tag | Meaning | Review action |
|---|---|---|
| `VERIFIED` | A code pointer or a test proves the rule | Accept without reading |
| `ASSUMED` | Code suggests it, no test proves it | Human must confirm or veto |
| `GAP` | Behaviour is absent, unclear, or contradictory | Becomes a candidate forward spec |
## Invariants
- Every session and share call carries the org header. `VERIFIED` — `src/services/backendSessionClient.ts:8`
- A deleted session never stays in the list. `VERIFIED` — `src/components/Chat/hooks/useSessionManager.ts:140`
- A share URL always resolves under the plugin route, never at the host root. `VERIFIED` — `src/services/sessionShare.ts:172`
## Failure Modes
| Condition | User-visible result | Evidence |
|---|---|---|
| Session list fetch fails | Stale list stays, no error shown | `src/components/Chat/hooks/useSessionManager.ts:51` |
| Session load returns 404 | History clears, URL clears | `src/components/Chat/hooks/useSessionManager.ts:126` |
| Delete fails | Nothing changes, no error shown | `src/components/Chat/hooks/useSessionManager.ts:145` |
| Share create fails | Error text in the dialog | `src/components/Chat/components/ShareDialog/ShareDialog.tsx:123` |
| Share id unknown or expired | "This share link is not found or has expired." | `src/pages/SharedSession.tsx:26` |
| Share import fails | "Failed to import session. Please try again." | `src/pages/SharedSession.tsx:91` |
| Invalid alert name | Alert "Investigation Error" plus Start Normal Chat | `src/pages/Home.tsx:45` |
## Data and Persistence
| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Backend session store | session id, messages, title, model | `sessionTTLDays` | none | `src/services/backendSessionClient.ts:13` |
| Backend share store | share id | request expiry | none | `src/services/sessionShare.ts:8` |
| Browser URL | `sessionId` query parameter | tab lifetime | removed on failure | `src/hooks/useSessionUrl.ts:58` |
## Observability
| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | none | — | `GAP` |
| Log field | none; failures stay silent in the sidebar | — | `GAP` |
## Evidence Index
- `src/components/Chat/hooks/useSessionManager.ts:25` — session manager contract
- `src/services/backendSessionClient.ts:8` — org header helper
- `src/services/sessionShare.ts:46` — share service
- `src/hooks/useSessionUrl.ts:23` — URL contract
- `src/hooks/useAlertInvestigation.ts:27` — deep-link parsing
- `tests/sessionManagement.spec.ts` — `should display token/turn/tool-call stats after a completed run` — stats contract
- `tests/sessionSharing.spec.ts` — `should view a shared session in read-only mode` — read-only contract
## Known Gaps
- No rename path exists, and `updateSession` is unused. Forward spec: session rename.
- The sidebar component has no unit test. Forward spec: sidebar component tests.
- List, delete, and delete-all failures are silent. Forward spec: session error surfacing.
- Session and share calls emit no spans or metrics. Forward spec: session observability.
