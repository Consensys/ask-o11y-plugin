# Slack integration — work summary

This document records the main findings, fixes, and operational notes from implementing and hardening the Ask O11y **Slack bridge** (workspace bot, account linking, channel mentions) and the **full Docker stack** workflow.

---

## What was built

### Grafana plugin (Go)

- **Slack bridge HTTP API** under `/api/slack-bridge/*`: register pending link nonces, resolve org by Slack user, start detached agent runs, stream SSE events.
- **`/api/slack-link/confirm`**: browser confirmation after the user opens the one-time Grafana URL with `?slack_link=…`.
- **HMAC-signed** short-lived **`X-Slack-Bridge-Token`** for bridge-authenticated agent calls.
- **Shared agent execution** (e.g. `executeDetachedAgentRun`) so web and Slack paths reuse the same logic.
- **Redis / in-memory** store for pending links and Slack ↔ Grafana user bindings (`slacklink_store.go`).
- **`slackBridgeSecret`** from plugin secure JSON; must match **`SLACK_BRIDGE_SECRET`** on the bridge and in provisioning (`$SLACK_BRIDGE_SECRET`).
- **OpenAPI** and tests updated for the new routes.

### Slack bridge (Node, Bolt, Socket Mode)

- **`slack-bridge/`** service: DM **`setup`** (and assistant Chat) + channel **`@mentions`** → Grafana plugin APIs.
- **`Assistant`** middleware for **Agents & AI Apps** (threaded IMs); classic **root DMs** still handled via `app.message`.
- Startup checks: **`xoxb` / `xapp` prefixes**, optional quote stripping, **`auth.test`** for the bot token, clearer errors if Socket Mode fails (`invalid_auth` on **`xapp`**).
- **`registerPending` / lookup** call Grafana with **`Authorization: Bearer`** + **`X-Slack-Bridge-Secret`**; user-facing hints distinguish **401** (Grafana token vs bridge secret) and **404** (bridge not configured).

### Frontend

- **`?slack_link=`** handling on the app home page and **`src/services/slackLink.ts`** to call the confirm API.

### Docker & local dev

- **`docker-compose-full.yaml`**: **`slack-bridge`** service; **`GRAFANA_TOKEN`** inside the container is filled from **`GRAFANA_SERVICE_ACCOUNT_TOKEN`** or **`GRAFANA_TOKEN`** on the host.
- **`scripts/create-slack-bridge-grafana-token.sh`**: creates a Grafana service account + token via admin API; **`--write-env`** upserts **`GRAFANA_SERVICE_ACCOUNT_TOKEN`** in `.env`.
- **`scripts/server-full.sh`** (via **`npm run server:full`**): provisioning swap, optional **`npm run build`**, auto **`SLACK_BRIDGE_SECRET`**, **two-phase Compose** (core stack first, then token, then **`slack-bridge`**), **`/api/user`** bearer check, **`--force-recreate slack-bridge`**, then **`compose logs -f`** (no `exec`, so **EXIT trap** restores provisioning files).
- **`scripts/lib/upsert-env.sh`**: shared **`.env` line upsert** for server script and token script.
- **`scripts/verify-slack-bridge-tokens.sh`**: validates **`SLACK_BOT_TOKEN`** with **`auth.test`** outside Docker.
- **`npm run server:full:clean`**: **`compose down --remove-orphans`** + **`docker network prune -f`** for stale network errors.

### Provisioning layout (multi-org full stack)

- Repo may ship **`full.yaml` + `app.yaml_`**; **`server:full`** can swap to **`app.yaml` + `full.yaml_`** on exit via trap, depending on starting state.

---

## Findings & fixes

### Slack `invalid_auth`

- **Cause**: Wrong or swapped **`SLACK_BOT_TOKEN` (`xoxb`)** / **`SLACK_APP_TOKEN` (`xapp`)**, revoked token after reinstall, or Compose not loading the intended **`.env`**.
- **Mitigations**: Prefix checks, **`auth.test`**, README troubleshooting, **`verify-slack-bridge-tokens.sh`**.

### “Sending messages to this app has been turned off” / DMs

- **Cause**: Slack only allows typing where the app is configured: **classic App Home Messages tab** (Agents off) vs **Chat** (Agents & AI Apps on). Messages tab must be enabled and **not** read-only; manifest must match (`messages_tab_enabled`, `messages_tab_read_only_enabled`).
- **Mitigation**: Bolt **`Assistant`** path for threaded / AI UI + docs in **`slack-bridge/README.md`**.

### `Could not start link` / Grafana **401** on `/…/slack-bridge/pending`

- **Observed in logs**: `invalid API key` — Grafana rejects **`Authorization: Bearer`** before the plugin runs.
- **Cause**: **`slack-bridge` started with the full stack before** **`GRAFANA_SERVICE_ACCOUNT_TOKEN`** existed in `.env`, or container not recreated after `.env` update.
- **Fix**: **Do not** start **`slack-bridge`** until after token creation; **`docker compose … up -d --build --force-recreate slack-bridge`** after writing `.env`; verify token with **`GET /api/user`**.

### `slackBridgeSecret` vs 401

- Plugin returns **401** for a bad **`X-Slack-Bridge-Secret`** as well; Grafana also returns **401** for a bad API key. Use **Grafana log text** (`invalid API key` vs plugin **“invalid secret”**) to tell them apart.

### Docker **network … not found**

- **Cause**: Stale Compose/network state (daemon restart, partial cleanup).
- **Fix**: **`npm run server:full:clean`** then **`npm run server:full`**.

### Grafana plugin not installed / provisioning errors

- **`dist/`** must contain the built plugin (e.g. **`module.js`** + **`gpx_*`**). **`server:full`** runs **`npm run build`** when **`dist/`** is incomplete.

---

## PR and Git hygiene

- **PR #103** title aligned with **semantic PR checks**:  
  `feat(chat): add slack bridge with account linking and compose stack`
- **Branch squashed** to **one commit** with the same subject; validated against **`commitlint.config.js`** (conventional types; **`chat`** scope allowed as warning-only enum mismatch is non-blocking).
- **Amend without hook-appended footers**: if a global hook adds extra lines (e.g. “Made-with”), use  
  `git -c core.hooksPath=/dev/null commit --amend -F <file>`  
  for a clean message.

---

## Quick reference commands

```bash
# Full multi-org stack + token + bridge (from repo root, Node 22)
nvm use 22 && npm run server:full

# Reset Docker networks + stack
nvm use 22 && npm run server:full:clean && npm run server:full

# Regenerate Grafana SA token in .env
./scripts/create-slack-bridge-grafana-token.sh --write-env
docker compose -f docker-compose-full.yaml up -d --force-recreate slack-bridge

# Verify Slack bot token on host
set -a && source .env && set +a && ./scripts/verify-slack-bridge-tokens.sh
```

---

## Code readability refactors

- **`scripts/lib/upsert-env.sh`**: single implementation of **`.env` upsert**.
- **`scripts/server-full.sh`**: **`compose()`** helper, **`ensure_grafana_sa_token()`**, removed duplicate token branches.
- **`slack-bridge/src/index.ts`**: **`BRIDGE`** path constant, **`slackBridgeJsonHeaders`**, **`grafanaErrorMessage`**, **`pendingFailureHint`**, **`stripOuterQuotes`** for env values.

---

## Files to read first

| Area | Location |
|------|-----------|
| Bridge behavior & Slack app setup | `slack-bridge/README.md` |
| Full stack script | `scripts/server-full.sh` |
| Token automation | `scripts/create-slack-bridge-grafana-token.sh` |
| Plugin bridge handlers | `pkg/plugin/slacklink_handlers.go` |
| Compose | `docker-compose-full.yaml` |
| Repo agent / dev notes | `CLAUDE.md` (multi-org / `server:full` section) |

---

*This summary reflects implementation and debugging work through the Slack integration PR; keep it updated if flows or env names change.*
