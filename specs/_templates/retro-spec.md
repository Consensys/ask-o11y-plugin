# Retro-Spec: [CAPABILITY NAME]

**Capability ID**: `[NNN-slug]`

**Status**: Retrospective

**Last verified**: `[commit-sha]`

**Owner**: [team or person]

**Module**: [primary package or directory]

---

## Purpose

[Three lines maximum. What the user can do because this capability exists.]

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| [action] | yes | yes | no | `path:line` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/...` | `handleX` | `pkg/plugin/plugin.go:NNN` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|

## Behaviour Rules

Numbered and testable. One rule per line. Every rule ends with a coverage tag.

1. [Rule.] `VERIFIED` — `path:line`
2. [Rule.] `VERIFIED` — test `TestName`
3. [Rule.] `ASSUMED` — `path:line` (no test found)
4. [Rule.] `GAP` — [what is missing or contradictory]

Coverage tags:

| Tag | Meaning | Review action |
|---|---|---|
| `VERIFIED` | A code pointer or a test proves the rule | Accept without reading |
| `ASSUMED` | Code suggests it, no test proves it | Human must confirm or veto |
| `GAP` | Behaviour is absent, unclear, or contradictory | Becomes a candidate forward spec |

## Invariants

- [Constraint that must never break.] `VERIFIED` — `path:line`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| [failure] | [message, status code, or SSE event] | `path:line` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | [name] | [exporter] | `path:line` |
| Metric | [name] | [dashboard or scrape] | `path:line` |
| Log field | [field] | [logger] | `path:line` |

## Evidence Index

- `path/to/file.go:NNN` — [what it proves]
- `path/to/file.test.ts` — `test name` — [what it proves]

## Known Gaps

[Non-normative list. Each item names the missing behaviour and the forward spec that would cover it. Write "None." when empty.]
