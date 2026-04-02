#!/usr/bin/env bash
# Create a Grafana service account + token for the Slack bridge (local / docker-compose).
# Grafana does not support declaring a static token in provisioning YAML—tokens are
# random at creation time. This script uses the admin HTTP API.
#
# Usage:
#   ./scripts/create-slack-bridge-grafana-token.sh
#   ./scripts/create-slack-bridge-grafana-token.sh --write-env   # upsert GRAFANA_SERVICE_ACCOUNT_TOKEN in repo .env
#   GRAFANA_URL=http://localhost:3000 GRAFANA_ORG_ID=2 ./scripts/create-slack-bridge-grafana-token.sh
#
# Requires: curl, jq

set -euo pipefail

WRITE_ENV=false
for arg in "$@"; do
  [[ "$arg" == "--write-env" ]] && WRITE_ENV=true
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
# shellcheck source=scripts/lib/upsert-env.sh
source "$SCRIPT_DIR/lib/upsert-env.sh"

write_env_token() {
  upsert_env_line GRAFANA_SERVICE_ACCOUNT_TOKEN "$1" "$ENV_FILE"
  echo "Updated ${ENV_FILE} (GRAFANA_SERVICE_ACCOUNT_TOKEN=…)"
}

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (e.g. brew install jq)" >&2
  exit 1
fi

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_ORG_ID="${GRAFANA_ORG_ID:-1}"
ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"
SA_NAME="${SLACK_BRIDGE_SA_NAME:-slack-bridge-local}"

GRAFANA_URL="${GRAFANA_URL%/}"
userpass="${ADMIN_USER}:${ADMIN_PASSWORD}"

echo "Waiting for Grafana at ${GRAFANA_URL} ..."
for _ in $(seq 1 60); do
  if curl -sf -u "$userpass" "${GRAFANA_URL}/api/health" >/dev/null; then
    break
  fi
  sleep 2
done

if ! curl -sf -u "$userpass" "${GRAFANA_URL}/api/health" >/dev/null; then
  echo "Grafana did not become ready in time." >&2
  exit 1
fi

hdr=(-u "$userpass" -H "Content-Type: application/json" -H "X-Grafana-Org-Id: ${GRAFANA_ORG_ID}")

search_url="${GRAFANA_URL}/api/serviceaccounts/search?query=$(printf %s "$SA_NAME" | jq -sRr @uri)&perpage=50"
sa_id="$(curl -sf "${hdr[@]}" "${search_url}" | jq -r --arg n "$SA_NAME" '.serviceAccounts[]? | select(.name == $n) | .id' | head -n1)"

if [[ -z "${sa_id}" || "${sa_id}" == "null" ]]; then
  code="$(curl -sS -w "%{http_code}" -o /tmp/asko11y_sa_body.json "${hdr[@]}" -X POST "${GRAFANA_URL}/api/serviceaccounts" \
    -d "{\"name\":\"${SA_NAME}\",\"role\":\"Admin\",\"isDisabled\":false}")"
  body="$(cat /tmp/asko11y_sa_body.json)"
  rm -f /tmp/asko11y_sa_body.json
  if [[ "$code" != "201" ]]; then
    echo "Failed to create service account (HTTP $code): $body" >&2
    exit 1
  fi
  sa_id="$(echo "$body" | jq -r .id)"
fi

if [[ -z "${sa_id}" || "${sa_id}" == "null" ]]; then
  echo "Could not determine service account id." >&2
  exit 1
fi

tok_resp="$(curl -sS "${hdr[@]}" -X POST "${GRAFANA_URL}/api/serviceaccounts/${sa_id}/tokens" \
  -d '{"name":"bridge","secondsToLive":0}')"
token="$(echo "$tok_resp" | jq -r .key)"

if [[ -z "${token}" || "${token}" == "null" ]]; then
  echo "Failed to create token: $tok_resp" >&2
  exit 1
fi

if [[ "$WRITE_ENV" == true ]]; then
  write_env_token "$token"
fi

echo ""
if [[ "$WRITE_ENV" != true ]]; then
  echo "Add to your .env:"
  echo "GRAFANA_SERVICE_ACCOUNT_TOKEN=${token}"
  echo ""
fi
echo "(org ${GRAFANA_ORG_ID}, service account id ${sa_id}, name ${SA_NAME})"
echo ""
echo "Note: service accounts are scoped to one org. For docker-compose-full with two orgs,"
echo "run this script again with GRAFANA_ORG_ID=2 if Slack users link in org 2."
