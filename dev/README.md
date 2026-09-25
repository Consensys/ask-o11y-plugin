# Local dev stack

A fast loop for running local plugin code against data that looks like prod.
Build, restart and run an investigation, all in about 2–3 minutes.

```bash
npm run dev:stack -- up            # build linux backend (+ frontend if missing), start stack
npm run dev:stack -- reload        # rebuild backend, restart grafana (~20s)
npm run dev:stack -- frontend      # rebuild frontend
npm run dev:stack -- check         # health of provisioned datasources
npm run dev:stack -- investigate "alertname:<name> ... perform root cause analysis" investigation
npm run dev:stack -- run <runId>   # summary of a stored run (iterations, tokens, stalls, validation)
npm run dev:stack -- logs | ps | down
```

Grafana runs at http://localhost:3000 with anonymous Admin, or admin/admin.

## Services (`docker-compose.dev.yaml`)

| Service | Purpose |
|---|---|
| grafana | Local `dist/` plugin build, grafana-llm-app, and OTel traces sent to local tempo |
| mcp-grafana | Same image and flags as prod (1.4.0), pointed at local grafana |
| redis | Session and run-trace storage |
| tempo | Local traces for grafana and the plugin (`agent_run`, `llm_call`, `mcp_tool_call`) |

The CI e2e stack stays in `docker-compose.yaml` and this setup does not touch it.

## Configuration

`scripts/dev.sh` loads `.env` and `.env.prod`. Both files are gitignored or untracked, so never commit them.

| Variable | Default | Use |
|---|---|---|
| `LITELLM_KEY` | — | LLM key for grafana-llm-app (custom provider via LiteLLM) |
| `LITELLM_URL` | `https://litellm.consensys.info` | LiteLLM endpoint |
| `LLM_MODEL_BASE` / `LLM_MODEL_LARGE` | `gemini/gemini-3.8-flash` | Model mapping (mirror prod) |
| `GRAFANA_ADMIN` / `GRAFANA_PWD` | — | Prod Grafana creds, which feed the proxied datasources |
| `PROD_GRAFANA_URL` | prod Grafana | Proxy target |
| `PROD_ORG_ID` | `24` | Org whose datasources are proxied |
| `PROD_METRICS_UID` / `PROD_LOKI_UID` / `PROD_TEMPO_UID` | `central-metrics` / `sS52nlJVz` / `central-tempo` | Proxied datasource uids |
| `DEV_CA_BUNDLE` | `~/.ssl/combined-ca.pem` if present | CA bundle mounted into grafana, for corporate TLS interception |

The datasources `prod-metrics`, `prod-logs` and `prod-traces` send queries through
`$PROD_GRAFANA_URL/api/datasources/proxy/uid/<uid>` with the `X-Grafana-Org-Id` header.
Tool calls from the agent therefore hit real prod data, read-only.

Plugin settings live in `dev/provisioning/plugins/app.yaml`, and datasources in
`dev/provisioning/datasources/datasources.yaml`.
