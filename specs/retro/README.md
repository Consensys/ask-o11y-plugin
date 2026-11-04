# Retro-Spec Index

Retro-specs describe the contract that exists today. They are living contracts: update the spec and its `Last verified` commit in the same PR that changes the module.

Rules:

- Read one spec per task. Do not load this index plus every spec.
- A spec is authoritative only for the module named in its header.
- `ASSUMED` and `GAP` rows are open review items, not requirements.
- Forward specs must cite the retro-specs they can break.

## Capabilities

| ID | Capability | Module | Wave |
|---|---|---|---|
| [101](101-agent-loop/spec.md) | Agent loop and SSE streaming | `pkg/agent/` | 1 Core |
| [102](102-llm-transport/spec.md) | LLM transport and model selection | `pkg/agent/llm_client.go` | 1 Core |
| [103](103-context-window/spec.md) | Context window and eviction | `pkg/agent/context_window.go` | 1 Core |
| [104](104-tool-dispatch/spec.md) | Tool dispatch, search, index | `pkg/agent/tools.go` | 1 Core |
| [105](105-tool-approval/spec.md) | Tool approval and risk gating | `pkg/plugin/approval_*.go` | 1 Core |
| [106](106-mcp-proxy/spec.md) | Proxy, client, result cache | `pkg/mcp/` | 2 MCP |
| [107](107-mcp-health/spec.md) | Health monitoring | `pkg/mcp/health.go` | 2 MCP |
| [108](108-mcp-selection/spec.md) | Tool selection and filtering | `pkg/mcp/selection.go` | 2 MCP |
| [109](109-mcp-oauth/spec.md) | MCP OAuth and credentials | `pkg/mcp/oauth.go` | 2 MCP |
| [110](110-mcp-provisioning/spec.md) | Provisioning and trace propagation | `pkg/plugin/mcp_provisioner.go` | 2 MCP |
| [111](111-sessions-runs/spec.md) | Sessions and run store | `pkg/plugin/sessionstore*.go` | 3 API |
| [112](112-sharing-ratelimit/spec.md) | Sharing and rate limiting | `pkg/plugin/shares*.go` | 3 API |
| [113](113-prompt-assembly/spec.md) | Prompt assembly and defaults | `pkg/plugin/prompts.go` | 3 API |
| [114](114-settings-multi-org/spec.md) | Settings, config, multi-org | `pkg/plugin/config.go` | 3 API |
| [115](115-rbac/spec.md) | RBAC filtering | `pkg/rbac/` | 3 API |
| [116](116-skills/spec.md) | Skills registry and activation | `pkg/skills/` | 4 Features |
| [117](117-topology/spec.md) | Topology and service graph | `pkg/plugin/topology*.go` | 4 Features |
| [118](118-graphiti/spec.md) | Graphiti memory and discovery | `pkg/plugin/graphiti_memory.go` | 4 Features |
| [119](119-evals-snapshots/spec.md) | Evals, scout, snapshot prefetch | `pkg/plugin/agent_eval.go` | 4 Features |
| [120](120-chat-ui/spec.md) | Chat UI and streaming render | `src/components/Chat/` | 5 Frontend |
| [121](121-visualisations/spec.md) | Inline visualisations | `src/components/Chat/scenes/` | 5 Frontend |
| [122](122-session-ux/spec.md) | Sidebar, stats, session UX | `src/components/Chat/components/` | 5 Frontend |
| [123](123-app-shell/spec.md) | App config UI, shell, services | `src/components/AppConfig/` | 5 Frontend |
| [124](124-telemetry/spec.md) | Telemetry: spans, metrics, dashboards | `pkg/plugin/metrics.go` | 6 Cross |
| [125](125-build-release/spec.md) | Build, CI, release, deployment | `.github/workflows/` | 6 Cross |

## Verification

Run the drift check before every PR:

```bash
node scripts/verify-retro-specs.mjs
```

It checks that every evidence pointer resolves, every required section exists, and every directory appears in this index.
