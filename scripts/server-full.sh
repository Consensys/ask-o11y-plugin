#!/usr/bin/env bash
# Start docker-compose-full (multi-org stack): swap provisioning files, ensure plugin build,
# compose up with basic auth (no SA token needed), recreate slack-bridge, tail logs.
#
# On exit (including after Ctrl+C ends log tail), provisioning files are restored for single-org defaults.
#
# If Docker errors with "network … not found", Docker's state is stale (daemon restart, partial rm, etc.).
# Run:  npm run server:full:clean   then   npm run server:full
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROV="$ROOT/provisioning/plugins"
# shellcheck source=scripts/lib/upsert-env.sh
source "$ROOT/scripts/lib/upsert-env.sh"

cleanup() {
  if [[ -f "$PROV/full.yaml" && -f "$PROV/app.yaml_" ]]; then
    mv "$PROV/full.yaml" "$PROV/full.yaml_"
    mv "$PROV/app.yaml_" "$PROV/app.yaml"
  fi
}
trap cleanup EXIT

compose() {
  docker compose -f docker-compose-full.yaml "$@"
}

require_cmds() {
  local missing=()
  for c in docker curl; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  compose version >/dev/null 2>&1 || missing+=("docker compose")
  command -v jq >/dev/null 2>&1 || missing+=("jq")
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Missing required command(s): ${missing[*]}" >&2
    echo "Install jq (e.g. brew install jq) and use Docker Compose v2." >&2
    exit 1
  fi
}

use_node_from_nvmrc() {
  [[ -f .nvmrc ]] || return 0
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$nvm_dir/nvm.sh" ]] || return 0
  # shellcheck disable=SC1090
  source "$nvm_dir/nvm.sh"
  nvm use 2>/dev/null || nvm use "$(tr -d '\r\n' <.nvmrc)" 2>/dev/null || true
}

dist_ready() {
  [[ -f "$ROOT/dist/module.js" ]] || return 1
  local bins
  shopt -s nullglob
  bins=("$ROOT"/dist/gpx_*)
  shopt -u nullglob
  [[ ${#bins[@]} -gt 0 ]]
}

ensure_build() {
  dist_ready && return 0
  echo "dist/ is missing or incomplete (need frontend + backend binary). Running npm run build…"
  use_node_from_nvmrc
  if [[ "$(node -v 2>/dev/null | tr -d 'v' | cut -d. -f1)" != "22" ]] && [[ -z "${SKIP_NODE_VERSION_CHECK:-}" ]]; then
    echo "Warning: Node 22 is required (see .nvmrc). Current: $(node -v 2>/dev/null || echo none)" >&2
  fi
  npm run build
  dist_ready || {
    echo "npm run build did not produce dist/module.js and dist/gpx_*" >&2
    exit 1
  }
}

ensure_slack_bridge_secret() {
  [[ -f .env ]] && grep -qE '^SLACK_BRIDGE_SECRET=[^[:space:]]' .env 2>/dev/null && return 0
  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required to generate SLACK_BRIDGE_SECRET" >&2
    exit 1
  }
  upsert_env_line SLACK_BRIDGE_SECRET "$(openssl rand -hex 24)" "$ROOT/.env"
  echo "Generated SLACK_BRIDGE_SECRET in .env (for slack-bridge + plugin provisioning)."
}

activate_full_provisioning() {
  if [[ -f "$PROV/full.yaml_" && -f "$PROV/app.yaml" ]]; then
    mv "$PROV/app.yaml" "$PROV/app.yaml_"
    mv "$PROV/full.yaml_" "$PROV/full.yaml"
    echo "Activated multi-org provisioning (full.yaml)."
  elif [[ -f "$PROV/full.yaml" && -f "$PROV/app.yaml_" ]]; then
    echo "Multi-org provisioning already active (full.yaml + app.yaml_)."
  elif [[ -f "$PROV/full.yaml" && -f "$PROV/app.yaml" ]]; then
    mv "$PROV/app.yaml" "$PROV/app.yaml_"
    echo "Stashed app.yaml → app.yaml_ (multi-org full.yaml only)."
  else
    echo "ERROR: Expected provisioning/plugins in one of these layouts:" >&2
    echo "  • app.yaml + full.yaml_ (swap in), or" >&2
    echo "  • app.yaml_ + full.yaml (already swapped)" >&2
    echo "  • app.yaml + full.yaml (will stash app.yaml)" >&2
    exit 1
  fi
}

wait_for_grafana() {
  echo "Waiting for Grafana to be ready…"
  local i
  for i in $(seq 1 30); do
    curl -sf -u admin:admin "http://localhost:3000/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "ERROR: Grafana not reachable at http://localhost:3000 after 60s." >&2
  exit 1
}

require_cmds
ensure_build
ensure_slack_bridge_secret
activate_full_provisioning

# Bridge uses basic auth (admin/admin) set in docker-compose-full.yaml — no SA token needed.
compose up -d --build redis grafana mcp-grafana mcpo

wait_for_grafana

compose up -d --build --force-recreate slack-bridge

echo ""
echo "Stack is up. Tailing logs (Ctrl+C stops following; containers keep running)."
echo "Stop stack: docker compose -f docker-compose-full.yaml down"
echo ""

compose logs -f
