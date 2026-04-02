#!/usr/bin/env bash
# Quick check that SLACK_BOT_TOKEN is accepted by Slack (outside Docker).
# Usage from repo root:  set -a && source .env && set +a && ./scripts/verify-slack-bridge-tokens.sh

set -euo pipefail

if [[ -z "${SLACK_BOT_TOKEN:-}" ]]; then
  echo "SLACK_BOT_TOKEN is not set. Example: set -a && source .env && set +a && $0" >&2
  exit 1
fi

# Normalize same way as slack-bridge: strip optional quotes
tok="${SLACK_BOT_TOKEN}"
tok="${tok#\"}"
tok="${tok%\"}"
tok="${tok#\'}"
tok="${tok%\'}"

if [[ -z "${tok}" ]]; then
  echo "SLACK_BOT_TOKEN is empty after trim" >&2
  exit 1
fi

if [[ "${tok}" != xoxb-* ]]; then
  echo "SLACK_BOT_TOKEN must start with xoxb- (got prefix: ${tok:0:8}...)" >&2
  exit 1
fi

resp="$(curl -sS -X POST 'https://slack.com/api/auth.test' --data-urlencode "token=${tok}")"
if command -v jq >/dev/null 2>&1; then
  echo "${resp}" | jq .
  ok="$(echo "${resp}" | jq -r '.ok')"
else
  echo "${resp}"
  ok="$(echo "${resp}" | sed -n 's/.*"ok":\s*\([^,]*\).*/\1/p')"
fi

if [[ "${ok}" != 'true' ]]; then
  echo "auth.test failed — token is wrong, expired, or from a revoked install. Get a new xoxb from OAuth & Permissions." >&2
  exit 1
fi

echo "SLACK_BOT_TOKEN is valid for Slack auth.test."
