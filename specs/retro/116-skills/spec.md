# Retro-Spec: Skills Registry and Activation

**Capability ID**: `116-skills`

**Status**: Retrospective

**Last verified**: `6c09d13`

**Owner**: Ask O11y maintainers

**Module**: `pkg/skills/`, `/api/skills`

---

## Purpose

An admin ships or authors domain instructions as SKILL.md files.
The agent activates them explicitly, by legacy type, by trigger, or on demand via `load_skill`.
Every activation is reviewable and role-safe.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| List skill metadata | yes | yes | yes | `pkg/plugin/plugin.go:1730` |
| List content (`?include=content`) | yes | no | no | `pkg/plugin/plugin.go:1724` |
| Activate a skill on a run | yes | yes | yes | `pkg/plugin/plugin.go:959` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/skills` | `handleSkills` | `pkg/plugin/plugin.go:594` |
| GET | `/api/prompt-defaults` | `handlePromptDefaults` | `pkg/plugin/plugin.go:1686` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| `run_started` | `skills[] {name, description}` | `pkg/agent/types.go:219` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `skills.entries[].content` | plugin jsonData | empty | `pkg/plugin/plugin.go:102` |
| `skills.entries[].enabled` | plugin jsonData | `true` when absent | `pkg/skills/registry.go:95` |
| `investigationPrompt` | plugin jsonData (legacy) | bundled default | `pkg/plugin/plugin.go:1767` |
| `performancePrompt` | plugin jsonData (legacy) | bundled default | `pkg/plugin/plugin.go:1768` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `load_skill` (internal, never reaches MCP) | yes | `pkg/agent/loop.go:45` |

## Behaviour Rules

Tags: `VERIFIED` (code pointer or test), `ASSUMED` (untested), `GAP` (missing).

1. A SKILL.md must open and close its frontmatter with a `---` line. `VERIFIED` — `pkg/skills/skill.go:194`
2. `name` is required, max 64 chars, lowercase alphanumerics with single hyphens. `VERIFIED` — `pkg/skills/skill.go:107`
3. `description` is required and max 1024 chars. `VERIFIED` — `pkg/skills/skill.go:112`
4. `visibility` defaults to `public`; only `public` or `hidden` parse. `VERIFIED` — `pkg/skills/skill.go:142`
5. `metadata.model` accepts only `base`, `large`, or empty. `VERIFIED` — `pkg/skills/skill.go:145`
6. `metadata.max-iterations` is an integer from 1 to 200. `VERIFIED` — `pkg/skills/skill.go:150`
7. `metadata.triggers` compiles as a case-insensitive regex; a bad regex fails parse. `VERIFIED` — `pkg/skills/skill.go:157`
8. Body and `user-prompt` reject `call`, `template`, `define`, and `block`. `VERIFIED` — `pkg/skills/skill.go:166`
9. Body renders as a Go template per activation; a render panic becomes an error. `VERIFIED` — `pkg/skills/skill.go:230`
10. Without a `user-prompt`, the user message passes through verbatim. `VERIFIED` — `pkg/plugin/prompts.go:204`
11. Bundled skills embed from `pkg/skills/bundled`, one directory each with `SKILL.md` and optional `references/*`. `VERIFIED` — `pkg/skills/registry.go:12`
12. A directory name must equal the frontmatter name, else the skill is skipped and logged. `VERIFIED` — `pkg/skills/registry.go:367`
13. An admin entry whose key differs from the frontmatter name is listed invalid. `VERIFIED` — `pkg/skills/registry.go:124`
14. An entry with content overrides a bundled skill, keeps its references, and sets `customized: true` with `source: "bundled"`. `VERIFIED` — test `TestRegistry_CustomAndOverrideAndDisable`
15. An entry for a new name creates a `source: "custom"` skill. `VERIFIED` — `pkg/skills/registry.go:144`
16. An entry with empty content and `enabled: false` disables the bundled skill. `VERIFIED` — `pkg/skills/registry.go:98`
17. An invalid entry never fails construction; it lists with `invalid` and `invalidReason`. `VERIFIED` — test `TestRegistry_InvalidEntriesSurfaceInInfos`
18. Listings sort by name and include disabled and invalid entries. `VERIFIED` — `pkg/skills/registry.go:269`
19. The default listing excludes hidden skills. `VERIFIED` — test `TestRegistry_PublicInfosExcludesHidden`
20. `?include=content` for a non-Admin returns 403; for Admin it adds hidden skills and `raw`. `VERIFIED` — test `TestHandleSkills_HiddenSkillsOnlyForAdminContentListing`
21. A requested skill that is unknown, disabled, or hidden fails the run with 400. `VERIFIED` — `pkg/skills/selection.go:52`
22. `investigation` maps to `investigating-alerts`; `performance` maps to `analyzing-performance`. `VERIFIED` — `pkg/skills/selection.go:12`
23. A disabled or absent mapped skill is not an error; the run proceeds without it. `VERIFIED` — test `TestResolve_DisabledMappedSkillDoesNotBreakLegacyType`
24. Only the legacy mapping sets `UserPromptSkill` and wraps the message. `VERIFIED` — test `TestResolve_ExplicitTypeAndTrigger`
25. Activation order is explicit requests, then legacy mapping, then trigger matches. `VERIFIED` — `pkg/skills/selection.go:50`
26. Trigger matching scans only enabled public skills and skips names already active. `VERIFIED` — `pkg/skills/selection.go:65`
27. `ModelPreference` returns the first model set by an active skill. `VERIFIED` — `pkg/skills/selection.go:97`
28. `IterationBudget` returns the highest value; zero falls back to `resolveMaxIterations`. `VERIFIED` — `pkg/skills/selection.go:112`
29. `load_skill` is advertised only when the catalog is non-empty and a loader exists. `VERIFIED` — `pkg/agent/loop.go:179`
30. `load_skill` dispatches before the approval gate and bypasses RBAC. `VERIFIED` — `pkg/agent/loop.go:953`
31. `load_skill` requires `skill`, accepts optional `file`, and loads a file raw and untemplated. `VERIFIED` — `pkg/agent/loop.go:1096`
32. `load_skill` on an unknown, hidden, or body-empty skill returns a tool error. `ASSUMED` — `pkg/skills/registry.go:303` (hidden branch untested)
33. A legacy prompt field overrides the user prompt only while no Skills entry exists. `VERIFIED` — test `TestApplyLegacyPromptOverrides_SkillsTabEntryWins`
34. `/api/prompt-defaults` always returns both keys, falling back to the bundled default. `VERIFIED` — test `TestHandlePromptDefaults_DisabledSkillStillReturnsStableKeys`
35. The `?skill=` deep link applies to one message only; a value failing the name pattern is dropped. `VERIFIED` — test `activates a ?skill= deep link without waiting for the skill catalog`

## Invariants

- A hidden skill never enters the catalog or the public listing. `VERIFIED` — `pkg/skills/registry.go:257`
- Activation never mutates a stored skill; overrides clone it. `VERIFIED` — `pkg/skills/registry.go:291`
- An explicit selection error is a 400, never a silent drop. `VERIFIED` — `pkg/plugin/plugin.go:961`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Bad frontmatter | 400 on activation; entry listed invalid | `pkg/skills/skill.go:100` |
| Entry key ≠ frontmatter name | Entry listed invalid with reason | `pkg/skills/registry.go:130` |
| Unknown skill in `skills[]` | HTTP 400 `unknown skill: <name>` | `pkg/skills/selection.go:53` |
| Forbidden template action | Parse error at save time | `pkg/skills/skill.go:166` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| Plugin jsonData | `skills.entries` | none | bundled SKILL.md | `pkg/plugin/plugin.go:102` |
| Plugin binary | embedded `bundled/` FS | build-time | none | `pkg/skills/registry.go:13` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Log | `Invalid custom skill skipped` | plugin backend log | `pkg/skills/registry.go:121` |
| Log field | `skills` (comma-joined active names) | `Agent run request` | `pkg/plugin/plugin.go:1115` |
| Span / metric | none | — | `GAP` — no skill-specific signal |

## Evidence Index

- `pkg/skills/skill.go:92` — parse and validate SKILL.md
- `pkg/skills/registry.go:71` — bundled + admin merge
- `pkg/skills/selection.go:37` — activation resolution
- `pkg/skills/skills_test.go` — `TestBundledSkillsAllParse` — all shipped skills parse

## Known Gaps

- `allowed-tools` is parsed but never read. Forward spec: per-skill tool restriction.
- No test covers the hidden-skill branch of `load_skill`.
- No skill-level metric or span exists; activation is visible only in logs.
