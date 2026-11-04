# Retro-Spec: Prompt Assembly and Defaults

**Capability ID**: `113-prompt-assembly`

**Status**: Retrospective

**Last verified**: `18e315b`

**Owner**: Ask O11y maintainers

**Module**: `pkg/plugin/prompts.go`, `pkg/plugin/prompt_defaults.go`

## Purpose

Every agent run receives a system prompt built from a base template, tool instructions, and skill bodies.
Admins can replace the base template and the legacy prompt fields.
The UI reads the shipped defaults from one endpoint.

## Actors and RBAC

| Capability | Admin | Editor | Viewer | Evidence |
|---|---|---|---|---|
| Read `/api/prompt-defaults` | yes | yes | yes | `VERIFIED` — `pkg/plugin/plugin.go:1686` |
| Change the prompt settings | yes | no | no | `ASSUMED` — Grafana app config is Admin-only; no plugin-side check |
| Override a prompt through the Skills tab | yes | no | no | `ASSUMED` — `pkg/plugin/plugin.go:1724` |

## Contract

### HTTP endpoints

| Method | Path | Handler | Evidence |
|---|---|---|---|
| GET | `/api/prompt-defaults` | `handlePromptDefaults` | `pkg/plugin/plugin.go:593` |

### SSE events

| Event | Payload fields | Evidence |
|---|---|---|
| None. The endpoint returns one JSON object. | — | `pkg/plugin/plugin.go:1709` |

### Configuration keys

| Key | Location | Default | Evidence |
|---|---|---|---|
| `defaultSystemPrompt` | jsonData | `DefaultSystemPrompt` | `pkg/plugin/prompt_defaults.go:8` |
| `investigationPrompt` | jsonData | bundled skill user prompt | `pkg/plugin/plugin.go:97` |
| `performancePrompt` | jsonData | bundled skill user prompt | `pkg/plugin/plugin.go:98` |
| `skills` | jsonData | empty registry | `pkg/plugin/plugin.go:102` |

### MCP tool names

| Tool | Read-only | Evidence |
|---|---|---|
| `load_skill` | yes | `pkg/plugin/prompts.go:171` |

## Behaviour Rules

1. The system prompt is the base template, then tool instructions, then active skills, then the catalog. `VERIFIED` — `pkg/plugin/prompts.go:154`
2. Each concatenated part is rendered with `text/template` against one `PromptContext`. `VERIFIED` — `pkg/plugin/prompts.go:146`
3. An empty custom template falls back to the shipped default. `VERIFIED` — `pkg/plugin/prompts.go:126`
4. An invalid custom template falls back to the shipped default and logs a warning. `VERIFIED` — `pkg/plugin/prompts.go:137`
5. A panic during rendering becomes an error, not a crash. `VERIFIED` — `pkg/plugin/prompts.go:217`
6. Active skill bodies are injected under `## Active skills`, one `### <name>` block each. `VERIFIED` — `pkg/plugin/prompts.go:158`
7. Each active skill body comes from `Skill.RenderBody(ctx)`. `VERIFIED` — `pkg/plugin/prompts.go:160`
8. Skill body injection is tested. `VERIFIED` — test `TestBuildSystemPrompt_InvestigationSkillBodyInjected`
9. The catalog renders under `## Available skills` and tells the model to call `load_skill`. `VERIFIED` — `pkg/plugin/prompts.go:171`
10. The catalog lists only the skills the caller placed in `SkillsCatalog`. `VERIFIED` — `pkg/plugin/prompts.go:172`
11. Catalog rendering is tested. `VERIFIED` — test `TestBuildSystemPrompt_CatalogAdvertisesLoadableSkills`
12. The base prompt always contains the anti-hallucination contract. `VERIFIED` — test `TestBuildSystemPrompt_AntiHallucinationContractAlwaysPresent`
13. Optional blocks render only when their field is non-empty: datasource, metric namespaces, alert rule, topology. `VERIFIED` — `pkg/plugin/prompt_defaults.go:53`
14. The datasource block is tested. `VERIFIED` — test `TestBuildSystemPrompt_DatasourceSnapshotSlot`
15. `CurrentTime` is fixed at run start in UTC and rendered into the time section. `VERIFIED` — `pkg/plugin/prompts.go:305`
16. The current-time block is tested. `VERIFIED` — test `TestBuildSystemPrompt_CurrentTimeSlot`
17. `BuildUserPrompt` for `investigation` extracts the alert name and errors when it is absent. `VERIFIED` — `pkg/plugin/prompts.go:187`
18. `BuildUserPrompt` for `performance` falls back to the whole message as the target. `VERIFIED` — `pkg/plugin/prompts.go:194`
19. `BuildUserPrompt` for `chat` or an empty type returns the message unchanged. `VERIFIED` — test `TestBuildUserPrompt_ChatPassesMessageVerbatim`
20. An unknown conversation type returns an error. `VERIFIED` — test `TestBuildUserPrompt_UnknownTypeErrors`
21. When `UserPromptSkill` is set, its rendered template replaces the user message; an empty render falls back to the message. `VERIFIED` — `pkg/plugin/prompts.go:204`
22. The legacy type mapping is tested. `VERIFIED` — test `TestBuildUserPrompt_LegacyTypeRendersSkillTemplate`
23. `GET /api/prompt-defaults` returns a flat JSON object with exactly `defaultSystemPrompt`, `investigationPrompt`, and `performancePrompt`. `VERIFIED` — `pkg/plugin/plugin.go:1691`
24. The response shape is tested. `VERIFIED` — test `TestHandlePromptDefaults`
25. Any other method returns HTTP 405. `VERIFIED` — `pkg/plugin/plugin.go:1687`
26. The 405 case is tested. `VERIFIED` — test `TestHandlePromptDefaults`
27. `investigationPrompt` and `performancePrompt` are always present and non-empty; a disabled skill falls back to the bundled template. `VERIFIED` — test `TestHandlePromptDefaults_DisabledSkillStillReturnsStableKeys`
28. `defaultSystemPrompt` is the Go constant, not the configured value. `VERIFIED` — `pkg/plugin/plugin.go:1692`
29. A legacy prompt field applies only when the matching skill has no Skills-tab entry. `VERIFIED` — `pkg/plugin/plugin.go:1774`
30. Skills-tab precedence is tested. `VERIFIED` — test `TestApplyLegacyPromptOverrides_SkillsTabEntryWins`
31. A legacy override that fails to apply is logged and does not fail startup. `VERIFIED` — `pkg/plugin/plugin.go:1779`
32. A failed prompt registry build falls back to defaults with an empty settings value. `VERIFIED` — `pkg/plugin/plugin.go:303`
33. The endpoint has no role check, so a Viewer reads the same payload as an Admin. `VERIFIED` — test `TestHandlePromptDefaults`
34. No plugin-side check limits who may change the prompt settings; the restriction depends on Grafana app config RBAC. `GAP` — `pkg/plugin/plugin.go:265`

Coverage: `VERIFIED` = code pointer or test; `ASSUMED` = code suggests, no test; `GAP` = missing or contradictory.

## Invariants

- The three response keys never disappear, even when a skill is disabled. `VERIFIED` — `pkg/plugin/plugin.go:1698`
- Skill bodies are rendered per request; no rendered prompt is cached. `VERIFIED` — `pkg/plugin/prompts.go:156`
- A template error reaches the caller; it is never replaced by an empty prompt. `VERIFIED` — `pkg/plugin/prompts.go:147`

## Failure Modes

| Condition | User-visible result | Evidence |
|---|---|---|
| Method is not GET | 405 `Method not allowed` | `pkg/plugin/plugin.go:1688` |
| Base template fails to render | Run fails with `failed to render system prompt` | `pkg/plugin/prompts.go:147` |
| Active skill body fails to render | Run fails with `failed to render active skill` | `pkg/plugin/prompts.go:162` |
| Investigation message has no alert name | Run fails with `investigation type requires alertName` | `pkg/plugin/prompts.go:189` |
| Conversation type is unknown | Run fails with `unknown conversation type` | `pkg/plugin/prompts.go:201` |
| Custom template is invalid | Warning; the shipped default is used | `pkg/plugin/prompts.go:137` |
| Custom registry build fails | Error logged; defaults used | `pkg/plugin/plugin.go:305` |

## Data and Persistence

| Store | Key or table | TTL | Fallback | Evidence |
|---|---|---|---|---|
| None. Prompts are computed per request. | — | — | Shipped constants | `pkg/plugin/prompts.go:107` |

## Observability

| Signal | Name | Where | Evidence |
|---|---|---|---|
| Span | None. Prompt assembly emits no span. | — | `pkg/plugin/prompts.go:145` |
| Metric | None. No prompt metric exists. | — | `pkg/plugin/prompts.go:107` |
| Log field | `skill`, `error` | Standard logger on legacy override | `pkg/plugin/plugin.go:1779` |
| Log field | `[WARN] Invalid <name> template` | Standard logger on parse failure | `pkg/plugin/prompts.go:137` |

## Evidence Index

- `pkg/plugin/prompts.go:145` — `BuildSystemPrompt`
- `pkg/plugin/prompts.go:184` — `BuildUserPrompt`
- `pkg/plugin/plugin.go:1686` — defaults handler
- `pkg/plugin/plugin.go:1765` — legacy override application
- `pkg/plugin/prompts_test.go` — `TestApplyLegacyPromptOverrides_SkillsTabEntryWins` — precedence
- `pkg/plugin/plugin_test.go` — `TestHandlePromptDefaults` — response shape

## Known Gaps

- `handlePromptDefaults` returns the shipped constant for `defaultSystemPrompt`, not the configured value, so the UI cannot show a live override. A forward spec should decide whether that is intended.
- Rule 33 relies on a test that sets no identity; no test sets an explicit Viewer identity for this route.
