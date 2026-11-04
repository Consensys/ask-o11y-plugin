# Retro-Spec: Sharing and Rate Limiting

**Capability ID**: `112-sharing-ratelimit`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/shares*.go`, `pkg/plugin/shareutil.go`, `pkg/plugin/ratelimit.go`

## Purpose

A user can publish one session as a read-only link and revoke it later.
Rate limiters cap share creation, agent runs, and direct tool calls per user.
Limits stay correct across replicas when Redis is configured.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Create a share link for own session | yes | yes | yes | `pkg/plugin/plugin.go:2371` |
| Read a share link in the same org | yes | yes | yes | `pkg/plugin/plugin.go:2455` |
| Revoke a share that they created | yes | yes | yes | `pkg/plugin/plugin.go:2540` |
| List shares for own sessions | yes | yes | yes | `pkg/plugin/plugin.go:2774` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| POST | `/api/sessions/share` | `handleCreateShare` | `pkg/plugin/plugin.go:2371` |
| GET | `/api/sessions/shared/{shareId}` | `handleGetSharedSession` | `pkg/plugin/plugin.go:2455` |
| DELETE | `/api/sessions/share/{shareId}` | `handleDeleteShare` | `pkg/plugin/plugin.go:2509` |
| GET | `/api/sessions/{id}/shares` | `handleGetSessionShares` | `pkg/plugin/plugin.go:2757` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| None. Every share route returns JSON. | — | `pkg/plugin/plugin.go:2451` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `redisURL` | secureJsonData | `redis://localhost:6379/0` | `pkg/plugin/plugin.go:70` |
| `shareRateLimitPerHour` | constant | `50` | `pkg/plugin/config.go:13` |
| `shareRateLimitWindow` | constant | `1h` | `pkg/plugin/config.go:14` |
| `defaultShareMaxTTL` | constant | `365d` | `pkg/plugin/config.go:15` |
| `shareIDBytes` | constant | `32` | `pkg/plugin/config.go:16` |
| `agentRunRateLimitPerHour` | constant | `30` | `pkg/plugin/config.go:22` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| None. This module calls no MCP tool. | — | `pkg/plugin/shares.go:28` |

## Behaviour Rules

1. A share link is created only when the body validates and the embedded `id` equals `sessionId`. `VERIFIED` — `pkg/plugin/plugin.go:2405`
2. The body must contain `id` and a non-empty `messages` array. `VERIFIED` — `pkg/plugin/shareutil.go:31`
3. Body validation is tested. `VERIFIED` — test `TestValidateSessionData_MissingID`
4. The share ID is 32 bytes from `crypto/rand`, base64url encoded without padding, so 43 characters and 256 bits of entropy. `VERIFIED` — `pkg/plugin/shareutil.go:20`
5. An ID is accepted only when its length equals `EncodedLen(32)` and it decodes. `VERIFIED` — `pkg/plugin/shareutil.go:11`
6. `expiresInHours` takes precedence over `expiresInDays`; both must be positive. `VERIFIED` — `pkg/plugin/plugin.go:2411`
7. Explicit expiry sets `ExpiresAt` and a matching TTL. `VERIFIED` — `pkg/plugin/shareutil.go:61`
8. With no explicit expiry, in-memory `ExpiresAt` is null, so the share never expires there. `VERIFIED` — test `TestShareStore_CreateShare_NoExpiry`
9. With no explicit expiry, Redis applies `DefaultShareMaxTTL` of 365 days. `VERIFIED` — `pkg/plugin/shareutil.go:68`
10. A share with no explicit expiry expires after `DefaultShareMaxTTL` in both stores. `VERIFIED` — `pkg/plugin/shareutil.go:57`, test `TestShareStore_CreateShare_NoExpiry`
11. A share over the limit returns HTTP 429 `Too many share requests. Please try again later.` `VERIFIED` — `pkg/plugin/plugin.go:2429`
12. The in-memory limiter is a token bucket with burst equal to the limit and one token refilled every `window/limit`. `VERIFIED` — `pkg/plugin/ratelimit.go:78`
13. The in-memory map is bounded at 10 000 users; on overflow the map resets. `VERIFIED` — `pkg/plugin/ratelimit.go:61`
14. The bound is tested. `VERIFIED` — test `TestInMemoryRateLimiterBoundsTrackedUsers`
15. The Redis limiter uses one Lua script: `INCR`, then `PEXPIRE` on first use or on a missing TTL. `VERIFIED` — `pkg/plugin/ratelimit.go:100`
16. The Redis limiter denies when the count exceeds the limit, so request `limit+1` is the first denial. `VERIFIED` — `pkg/plugin/ratelimit.go:147`
17. The Redis limiter fails closed: a Redis error denies the request. `VERIFIED` — `pkg/plugin/ratelimit.go:143`
18. Share keys are `share:{shareID}` with the computed TTL. `VERIFIED` — `pkg/plugin/shares_redis.go:67`
19. A session index `session:{sessionID}:shares` holds the share IDs and keeps the longest TTL. `VERIFIED` — `pkg/plugin/shares_redis.go:94`
20. `GET` on a share returns the stored snapshot, plus `isShared: true` and `sharedBy` set to the owner ID as a string. `VERIFIED` — `pkg/plugin/plugin.go:2502`
21. A share from another org returns HTTP 403. `VERIFIED` — `pkg/plugin/plugin.go:2490`
22. Only the creator may revoke a share; another user gets HTTP 403. `VERIFIED` — `pkg/plugin/plugin.go:2540`
23. The shared payload is the snapshot sent at creation, not a live view of the session. `VERIFIED` — `pkg/plugin/shares.go:79`
24. Agent runs use a separate limiter with 30 per hour; a denial returns HTTP 429. `VERIFIED` — `pkg/plugin/plugin.go:893`
25. Direct tool calls use a separate limiter with 120 per hour; a denial returns HTTP 429. `VERIFIED` — `pkg/plugin/plugin.go:772`
26. Redis is selected only when the client builds and answers `PING`; otherwise every store and limiter falls back to memory. `VERIFIED` — `pkg/plugin/plugin.go:335`
27. Fallback is tested. `VERIFIED` — test `TestNewPlugin_RedisFallback`
28. The handler maps the share limit error with `errors.Is` on `ErrShareRateLimit`. `VERIFIED` — `pkg/plugin/plugin.go:2428`

Coverage: `VERIFIED` = code pointer or test; `ASSUMED` = code suggests, no test; `GAP` = missing or contradictory.

## Invariants

- A share is readable only inside the org that created it. `VERIFIED` — `pkg/plugin/plugin.go:2490`
- A share is revocable only by its creator. `VERIFIED` — `pkg/plugin/plugin.go:2540`
- The Redis limiter never allows traffic when Redis is down. `VERIFIED` — `pkg/plugin/ratelimit.go:143`
- The in-memory limiter map never exceeds 10 000 entries. `VERIFIED` — `pkg/plugin/ratelimit.go:61`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| `id` is missing or does not match `sessionId` | 400 `Session ID mismatch` | `pkg/plugin/plugin.go:2406` |
| Share limit reached | 429 `Too many share requests. Please try again later.` | `pkg/plugin/plugin.go:2429` |
| Share ID is unknown or expired | 404 `Share link not found` | `pkg/plugin/plugin.go:2478` |
| Share belongs to another org | 403 `You don't have access to this shared session` | `pkg/plugin/plugin.go:2491` |
| Another user tries to revoke | 403 `You don't have permission to revoke this share` | `pkg/plugin/plugin.go:2541` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Redis | `share:{shareID}` | explicit hours, else 365 days | `ShareStore.shares` map | `pkg/plugin/shares_redis.go:64` |
| Redis | `session:{sessionID}:shares` | longest share TTL | map scan by `SessionID` | `pkg/plugin/shares_redis.go:72` |
| Redis | `ratelimit:{userID}` | 1 hour | token bucket per user | `pkg/plugin/ratelimit.go:129` |
| Redis | `ratelimit:toolcall:{userID}` | 1 hour | token bucket per user | `pkg/plugin/plugin.go:341` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log field | `shareId`, `sessionId`, `orgId`, `userId` | Plugin logger on create | `pkg/plugin/shares.go:83` |
| Log field | `shareId` | Plugin logger on delete | `pkg/plugin/shares.go:116` |

## Evidence Index

- `pkg/plugin/shareutil.go:20` — token generation
- `pkg/plugin/ratelimit.go:15` — limiter interface
- `pkg/plugin/ratelimit.go:100` — Lua counter script
- `pkg/plugin/plugin.go:335` — Redis selection gate

## Known Gaps

- The no-expiry path differs between stores. A forward spec should make "no expiry" mean one thing, or require an explicit expiry on every share.
- The 429 mapping depends on an error string. A typed limit error would remove the coupling.
- A share exposes the owner's numeric user ID through `sharedBy`. A forward spec should state whether that is intended.
- The in-memory limiter resets all buckets on overflow, which temporarily widens limits for active users.
