# Ask O11y Slack bridge

Minimal [Bolt](https://slack.dev/bolt-js/) worker (Socket Mode) that connects Slack to the Ask O11y plugin: **DM `setup`** opens a one-time Grafana link; **`@Bot`** in a channel runs the same detached agent as the web UI.

## Published container image

GitHub Actions (`.github/workflows/slack-bridge-ghcr.yml`) pushes **`ghcr.io/consensys/ask-o11y-plugin/slack-bridge`** with tags **`latest`** (on `main`) and a **short SHA**, for **linux/amd64** and **linux/arm64**.  
Use **`docker compose pull slack-bridge`** in the full stack, or `docker run` the same reference with your env vars.

**Public pull (no login):** After the first publish, an org/repo admin should open **GitHub → Packages → `slack-bridge` → Package settings → Change package visibility → Public**. Default visibility may be private depending on org policy.

Forks: replace `consensys/ask-o11y-plugin` with your lowercase `owner/repo` in `docker-compose-full.yaml` and in your workflow, or rely on `build:` only.

## Grafana plugin

1. Set **`slackBridgeSecret`** in the app plugin’s **secure JSON** (same random string you use in `.env` here).  
   Example provisioning fragment:

   ```yaml
   jsonData: {}
   secureJsonData:
     slackBridgeSecret: "your-long-random-shared-secret"
   ```

2. Use **Redis** for the plugin if Grafana runs with more than one replica (link state is in-memory otherwise).

3. Rebuild/restart Grafana after changing secure settings.

### Grafana auth for the bridge

The bridge calls Grafana’s HTTP API (`/api/plugins/...`). Two auth methods are supported:

**Option A — Basic auth (recommended for multi-org):**
Set `GRAFANA_USERNAME` and `GRAFANA_PASSWORD` in `.env`. Basic auth works across all orgs — no per-org token management.

**Option B — Service account token (single-org only):**
SA tokens are scoped to a single org ([grafana/grafana#91844](https://github.com/grafana/grafana/issues/91844)). Generate one with:

```bash
./scripts/create-slack-bridge-grafana-token.sh
```

Set the printed token as `GRAFANA_TOKEN` in `.env`. For multi-org, you’d need a separate token per org — use basic auth instead.

## Create your Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps). You need permission to install apps in the workspace.

### 1. Import the manifest

1. Click **Create New App** → **From an app manifest**.
2. Pick your workspace.
3. Paste the contents of [`slack-app-manifest.json`](./slack-app-manifest.json) → **Create**.

This sets up Socket Mode, bot scopes, event subscriptions, and the assistant view automatically.

### 2. Generate an App-Level Token

1. Open **Settings → Basic Information** → scroll to **App-Level Tokens**.
2. Click **Generate Token**, name it `bridge`, add scope **`connections:write`** → **Generate**.
3. Copy the `xapp-…` token → set it as **`SLACK_APP_TOKEN`** in `.env`.

### 3. Install to workspace and get the Bot Token

1. Open **OAuth & Permissions** → click **Install to Workspace** → **Allow**.
2. Copy the **Bot User OAuth Token** (`xoxb-…`) → set it as **`SLACK_BOT_TOKEN`** in `.env`.

> **Note:** Reinstalling the app generates a new bot token. Update `SLACK_BOT_TOKEN` and restart the bridge after any reinstall.

### 4. Invite the bot to channels

In each channel where people should `@mention` the bot, run `/invite @Ask O11y`.

### Environment summary

| Slack dashboard | `.env` variable |
|-----------------|-----------------|
| Bot User OAuth Token (`xoxb-…`) | `SLACK_BOT_TOKEN` |
| App-Level Token (`xapp-…`) | `SLACK_APP_TOKEN` |
| Shared secret (same as plugin `slackBridgeSecret`) | `SLACK_BRIDGE_SECRET` |

### Troubleshooting `invalid_auth`

1. Verify tokens outside Docker:
   ```bash
   set -a && source .env && set +a
   ./scripts/verify-slack-bridge-tokens.sh
   ```
2. `SLACK_BOT_TOKEN` must start with `xoxb-`; `SLACK_APP_TOKEN` must start with `xapp-`. Do not use the Signing Secret or Client Secret.
3. Run Docker Compose from the **repo root** so `.env` is loaded. After changing tokens: `docker compose -f docker-compose-full.yaml up -d --build slack-bridge`.
4. If `auth.test` passes but Socket Mode still fails, regenerate the App-Level Token (`xapp-…`, scope `connections:write`).

## Run the bridge

```bash
cd slack-bridge
nvm use 22
cp .env.example .env
# fill in SLACK_* and GRAFANA_* values (shared secret must match plugin)
npm install
npm start
```

### Docker (multi-org stack)

From the repo root with `server:full` / `docker-compose-full.yaml`, set in `.env`:

`SLACK_BRIDGE_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`. The compose file uses basic auth (`admin/admin`) by default — no token needed. Optionally set `GRAFANA_APP_URL` if Grafana is not at `http://localhost:3000`.

```bash
docker compose -f docker-compose-full.yaml up --build slack-bridge
```

- **`GRAFANA_APP_URL`**: URL users open in the browser (link in DM).
- **`GRAFANA_URL`**: URL the bridge uses for API calls (can match `GRAFANA_APP_URL`).

## Flow

1. User DM `setup` → bridge registers a nonce → user opens `…/a/consensys-asko11y-app?slack_link=…` while logged into Grafana → frontend confirms → plugin stores Slack user ↔ Grafana user/org/role.
2. User `@mentions` the bot → bridge resolves `orgId`, signs a short-lived token, calls **`/api/slack-bridge/agent/run`**, then **`/events`** for SSE text → posts the reply in the thread.

To disconnect your Slack account, call `DELETE /api/slack-link` (authenticated via Grafana session), or use the 'Disconnect Slack' button that appears in the Ask O11y UI after linking.

## Multi-org (single Grafana instance, multiple orgs)

To link your Slack account to a specific Grafana org, use `setup <org-name-or-id>` instead of plain `setup`:

```
setup production
setup 2
```

The bot sends a link with an org hint. Open it while signed into the correct org in Grafana. Re-run `setup` at any time to change your linked org (your previous link is replaced).
