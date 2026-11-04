# Retro-Spec: MCP OAuth and Credential Store

**Capability ID**: `109-mcp-oauth`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/mcp/oauth.go`, `pkg/plugin/oauth/`

---

## Purpose

A user connects their account to an OAuth-gated MCP server. The plugin stores the
token per user, injects it on each outbound request, and refreshes it.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Connect or disconnect own account | yes | yes | yes | `pkg/plugin/oauth/handlers.go:63` |
| Add or delete an OAuth server | yes | no | no | `pkg/plugin/mcp_provisioner.go:108` |
| Read another user's token | no | no | no | `pkg/plugin/oauth/keys.go:20` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/oauth/{serverId}/start` | `handleStart` | `pkg/plugin/oauth/handlers.go:36` |
| GET | `/api/oauth/{serverId}/callback` | `handleCallback` | `pkg/plugin/oauth/handlers.go:38` |
| GET | `/api/oauth/{serverId}/status` | `handleStatus` | `pkg/plugin/oauth/handlers.go:40` |
| POST | `/api/oauth/{serverId}/disconnect` | `handleDisconnect` | `pkg/plugin/oauth/handlers.go:42` |

Routes mount from `pkg/plugin/plugin.go:608`. Paths are published in
`pkg/plugin/openapi/openapi.json:1989`.

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| `message` (window) | `source`, `serverID`, `success`, `reason` | `pkg/plugin/oauth/handlers.go:245` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `oauth.authorizationURL`, `oauth.tokenURL` | `jsonData` | required | `pkg/mcp/types.go:123` |
| `oauth.clientID`, `oauth.clientSecret` | `jsonData` | client ID from DCR if empty | `pkg/mcp/types.go:125` |
| `oauth.pkce`, `oauth.redirectURI` | `jsonData` | `false` / derived | `pkg/mcp/types.go:130` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| none — OAuth gates every tool of the server | n/a | `pkg/mcp/oauth.go:77` |

## Behaviour Rules

1. Only the OAuth2 authorization-code flow is supported. `VERIFIED` — `pkg/plugin/oauth/exchange.go:28`
2. PKCE uses an S256 challenge when `oauth.pkce` is true. `VERIFIED` — `pkg/plugin/oauth/handlers.go:89`
3. A client secret is sent as HTTP Basic with form-urlencoded credentials. `VERIFIED` — `pkg/plugin/oauth/exchange.go:57`
4. Renewal uses `grant_type=refresh_token`. `VERIFIED` — `pkg/plugin/oauth/exchange.go:42`
5. Discovery tries the RFC 8414 well-known path first, then the RFC 9728 challenge. `VERIFIED` — `pkg/plugin/oauth/discovery.go:43`
6. Dynamic client registration runs when `clientId` is empty and the preset is DCR-capable. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:140`
7. Presets are `github-read`, `github-write`, and `atlassian`. `VERIFIED` — `pkg/plugin/oauth/presets.go:38`
8. GitHub presets are not DCR-capable, so the admin must supply a client ID. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:152`
9. A token is stored per `(serverID, userID)` under `mcp_oauth:{serverID}:{userID}`, with `:` escaped to `_`. `VERIFIED` — `pkg/plugin/oauth/keys.go:21`
10. Tokens are stored as plain JSON. They are not encrypted at rest. `GAP` — `pkg/plugin/oauth/store_redis.go:41`
11. The Redis TTL is token expiry plus 30 days. A non-expiring token gets no TTL. `VERIFIED` — `pkg/plugin/oauth/store_redis.go:52`
12. Without Redis the store is process-local, and tokens are lost on restart. `VERIFIED` — `pkg/plugin/plugin.go:389`
13. A token expires 5 seconds early, and refreshes inside a 60-second window. `VERIFIED` — test `TestTokenExpiryHelpers`
14. Refresh is serialized per `(serverID, userID)` and the token is re-read under that lock. `VERIFIED` — `pkg/plugin/oauth/manager.go:122`
15. A refresh response without a refresh token keeps the stored one. `VERIFIED` — test `TestRefreshPreservesRefreshToken`
16. A failed refresh returns the current token when it is still valid, and the error when it is expired. `VERIFIED` — `pkg/plugin/oauth/manager.go:145`, `pkg/plugin/oauth/manager.go:140`
17. A missing token maps to `ErrPerUserTokenUnavailable`. `VERIFIED` — `pkg/plugin/oauth/manager.go:99`
18. The callback path must be exactly `/api/oauth/{id}/{action}`. `VERIFIED` — `pkg/plugin/oauth/handlers.go:57`
19. An unknown server returns 404 `server has no oauth configured`. `VERIFIED` — test `TestUnknownServer404s`
20. `start` returns 401 for a zero user ID. `VERIFIED` — `pkg/plugin/oauth/handlers.go:65`
21. `start` stores state for 5 minutes, then redirects with 302. `VERIFIED` — `pkg/plugin/oauth/handlers.go:112`, `pkg/plugin/oauth/state.go:21`
22. State is one-shot: a replay returns `ErrStateInvalid`, and Redis consumes it with `GETDEL`. `VERIFIED` — `pkg/plugin/oauth/state.go:105`
23. The callback rejects a state minted for a different server. `VERIFIED` — `pkg/plugin/oauth/handlers.go:135`
24. The callback posts a window message and closes after 500ms. `VERIFIED` — `pkg/plugin/oauth/handlers.go:269`
25. Provider error text is escaped for HTML and script contexts. `VERIFIED` — test `TestCallbackEscapesProviderError`
26. Redirect URI preference is config value, then AppURL, then forwarded headers. `VERIFIED` — `pkg/plugin/oauth/handlers.go:207`
27. The derived callback URL is `{base}/api/plugins/consensys-asko11y-app/resources/api/oauth/{serverID}/callback`. `VERIFIED` — `pkg/plugin/oauth/handlers.go:217`
28. A request without a user passes through with no Authorization header, and a static Authorization header is ignored for OAuth servers. `VERIFIED` — test `TestUserTokenRoundTripperPassesThroughWithoutUser`, test `TestConfigHeaderRoundTripperSkipsAuthorizationForOAuth`
29. A missing token produces a message that tells the user to click Connect. `VERIFIED` — test `TestUserTokenRoundTripperNotConnected`
30. `/api/mcp/servers` adds an `oauth` map where `connected` means unexpired or refreshable. `VERIFIED` — `pkg/plugin/plugin.go:867`
31. Deleting a dynamic server purges every user's token for it. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:365`
32. One MCP session per server is shared across users; only the header is swapped. `GAP` — `pkg/mcp/types.go:113`
33. No device-code flow and no client-credentials flow exist. `GAP` — only two grant types are sent (`pkg/plugin/oauth/exchange.go:42`)
34. Disconnect does not revoke the token at the provider. `GAP` — `pkg/plugin/oauth/handlers.go:194` deletes locally only
35. The callback `postMessage` uses `targetOrigin: '*'`. `ASSUMED` — `pkg/plugin/oauth/handlers.go:269`

## Invariants

- A token is only ever read for the calling user's ID. `VERIFIED` — `pkg/plugin/oauth/manager.go:94`
- The client secret never leaves the backend. `VERIFIED` — `pkg/plugin/mcp_provisioner.go:59`
- State is consumed atomically, so a callback cannot replay. `VERIFIED` — `pkg/plugin/oauth/state.go:37`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Anonymous `start` | 401 with a sign-in message | `pkg/plugin/oauth/handlers.go:66` |
| Provider returns `error` | Page shows `failed: <code>: <detail>` | `pkg/plugin/oauth/handlers.go:120` |
| Bad or replayed state | Page shows `invalid state` | `pkg/plugin/oauth/handlers.go:132` |
| Token exchange fails | Page shows `token exchange failed` | `pkg/plugin/oauth/handlers.go:144` |
| User never connected | `requires you to connect your account first` | `pkg/mcp/oauth.go:83` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Redis token | `mcp_oauth:{serverID}:{userID}` | expiry + 30d, else none | in-memory store | `pkg/plugin/oauth/store_redis.go:52` |
| Redis state | `mcp_oauth_state:{state}` | 5min | in-memory store | `pkg/plugin/oauth/state.go:21` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log field | `server`, `userID`, `err` | callback failure log | `pkg/plugin/oauth/handlers.go:149` |

## Evidence Index

- `pkg/mcp/oauth.go:71` — per-user bearer round tripper
- `pkg/plugin/oauth/handlers.go:23` — route registration
- `pkg/plugin/oauth/handlers_test.go` — `TestHandlersFullFlow` — end-to-end handshake

## Known Gaps

- Tokens are stored in plaintext. Forward spec: credential encryption.
- One shared session per server weakens per-user isolation. Forward spec: per-user sessions.
- No revocation on disconnect, and no device-code flow.
