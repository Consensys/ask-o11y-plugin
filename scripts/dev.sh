#!/usr/bin/env bash
# Local dev loop for Ask O11y: local plugin code against prod-like data.
#
#   npm run dev:stack -- up            build backend+frontend, start the stack
#   npm run dev:stack -- reload        rebuild backend, restart grafana (~20s)
#   npm run dev:stack -- frontend      rebuild frontend only (browser refresh)
#   npm run dev:stack -- investigate "<message>" [type]
#                                      start an agent run, wait, print metrics
#   npm run dev:stack -- run <runId>   print metrics for an existing run
#   npm run dev:stack -- model <litellm-model>
#                                      switch base+large model (recreates grafana)
#   npm run dev:stack -- check         verify datasources reach prod
#   npm run dev:stack -- logs|ps|down
#
# Config comes from the environment, .env and .env.prod (all optional):
#   LITELLM_KEY                         LLM key (grafana-llm-app -> LiteLLM)
#   PROD_GRAFANA_URL                    prod Grafana used as datasource proxy
#   PROD_GRAFANA_USER / _PASSWORD       or GRAFANA_ADMIN / GRAFANA_PWD
#   PROD_ORG_ID (24), PROD_{METRICS,LOKI,TEMPO}_UID, LLM_MODEL_{BASE,LARGE}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

load_env() {
  local f
  for f in .env .env.prod; do
    if [[ -f "$f" ]]; then
      set -a
      # shellcheck disable=SC1090
      . "./$f"
      set +a
    fi
  done
  export PROD_GRAFANA_USER="${PROD_GRAFANA_USER:-${GRAFANA_ADMIN:-}}"
  export PROD_GRAFANA_PASSWORD="${PROD_GRAFANA_PASSWORD:-${GRAFANA_PWD:-}}"
  if [[ -n "$PROD_GRAFANA_USER" ]]; then
    export PROD_GRAFANA_URL="${PROD_GRAFANA_URL:-https://grafana.o11y.web3factory.consensys.net}"
  fi
  export LITELLM_KEY="${LITELLM_KEY:-${LITELLM_API_KEY:-}}"
  if [[ -z "${DEV_CA_BUNDLE:-}" && -f "$HOME/.ssl/combined-ca.pem" ]]; then
    export DEV_CA_BUNDLE="$HOME/.ssl/combined-ca.pem"
  fi
  if [[ -z "${NODE_EXTRA_CA_CERTS:-}" && -f "$HOME/.ssl/cloudflare-gateway-ca.pem" ]]; then
    export NODE_EXTRA_CA_CERTS="$HOME/.ssl/cloudflare-gateway-ca.pem"
  fi
  GRAFANA="${DEV_GRAFANA_URL:-http://localhost:3000}"
}

compose() { docker compose -f docker-compose.dev.yaml "$@"; }

backend_target() {
  case "$(docker version --format '{{.Server.Arch}}' 2>/dev/null || uname -m)" in
    arm64 | aarch64) echo "build:linuxARM64" ;;
    *) echo "build:linux" ;;
  esac
}

build_backend() {
  echo "==> backend ($(backend_target))"
  go run github.com/magefile/mage@latest "$(backend_target)"
}

build_frontend() {
  echo "==> frontend"
  npm run build:frontend:prod --silent
}

api() {
  # api METHOD PATH [curl args...]
  local method="$1" path="$2"
  shift 2
  curl -sS -u admin:admin -H "X-Grafana-Org-Id: 1" -H "Content-Type: application/json" \
    -X "$method" "$GRAFANA/api/plugins/consensys-asko11y-app/resources$path" "$@"
}

run_summary() {
  local id="$1" out
  out="$(mktemp)"
  api GET "/api/agent/runs/$id" -o "$out"
  python3 - "$out" <<'PY'
import json, sys
run = json.load(open(sys.argv[1]))
ev = run.get("events") or []
done = next((e for e in reversed(ev) if e.get("type") == "done"), {}) or {}
d = done.get("data", done)
tr = run.get("trace") or {}
fr = tr.get("finalReport") or {}
errs = [e for e in ev if e.get("type") == "tool_call_result" and (e.get("data", e).get("isError"))]
print(f"run {run.get('runId')}  status={run.get('status')}")
for k in ("totalIterations", "toolCallCount", "promptTokens", "completionTokens", "totalTokens", "stallNudges", "forcedFinal"):
    if k in d:
        print(f"  {k:18} {d[k]}")
print(f"  toolErrors         {len(errs)}")
print(f"  stalls             {[s.get('kind') for s in tr.get('stalls') or []]}")
if fr:
    print(f"  confidence         {fr.get('confidence')}")
    print(f"  hypotheses         {len(fr.get('hypotheses') or [])}")
    print(f"  validation         {json.dumps(fr.get('validation'))}")
    print(f"  verdict            {fr.get('verdict')}")
content = next((e.get("data", e).get("content") for e in reversed(ev) if e.get("type") == "content"), "")
print(f"  finalContentChars  {len(content or '')}")
print(f"  trace json         {sys.argv[1]}")
PY
}

cmd_investigate() {
  local message="${1:?usage: investigate \"<message>\" [type]}" type="${2:-investigation}"
  local payload started id status
  payload="$(python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1], "type": sys.argv[2]}))' "$message" "$type")"
  # The endpoint streams SSE; the first frame carries the runId and the run
  # keeps going server-side after we disconnect.
  started="$(api POST /api/agent/run -d "$payload" --max-time 5 2>/dev/null || true)"
  id="$(grep -oE '"runId":"[^"]+"' <<<"$started" | head -1 | cut -d'"' -f4)"
  if [[ -z "$id" ]]; then
    echo "failed to start run: $started" >&2
    exit 1
  fi
  echo "==> run $id"
  local t0=$SECONDS
  while :; do
    status="$(api GET "/api/agent/runs/$id" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
    [[ "$status" == "running" || -z "$status" ]] || break
    sleep 5
  done
  echo "    wall $((SECONDS - t0))s"
  run_summary "$id"
}

cmd_check() {
  local uid
  for uid in prod-metrics prod-logs prod-traces local-tempo; do
    printf '%-14s ' "$uid"
    curl -sS -u admin:admin "$GRAFANA/api/datasources/uid/$uid/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status"), "-", d.get("message","")[:100])'
  done
}

load_env
case "${1:-help}" in
  up)
    shift
    [[ -n "$LITELLM_KEY" ]] || echo "warning: LITELLM_KEY is empty; the agent cannot call the LLM" >&2
    [[ -n "$PROD_GRAFANA_USER" ]] || echo "warning: no prod credentials; prod-* datasources will fail" >&2
    build_backend
    [[ -f dist/module.js ]] || build_frontend
    compose up -d --build "$@"
    compose ps
    echo "Grafana: $GRAFANA (admin/admin)"
    ;;
  reload)
    build_backend
    compose restart grafana
    ;;
  frontend) build_frontend ;;
  model)
    # Switch the LiteLLM model for base+large; recreates grafana so
    # provisioning re-applies grafana-llm-app settings.
    shift
    export LLM_MODEL_BASE="${1:?usage: model <litellm-model>}" LLM_MODEL_LARGE="$1"
    compose up -d --no-deps --force-recreate grafana
    for _ in $(seq 1 30); do curl -sf "$GRAFANA/api/health" >/dev/null 2>&1 \
      && curl -sf -u admin:admin "$GRAFANA/api/plugins/consensys-asko11y-app/settings" >/dev/null 2>&1 && break; sleep 2; done
    echo "model: $1"
    ;;
  investigate)
    shift
    cmd_investigate "$@"
    ;;
  run)
    shift
    run_summary "${1:?usage: run <runId>}"
    ;;
  check) cmd_check ;;
  logs)
    shift
    compose logs -f "${@:-grafana}"
    ;;
  ps) compose ps ;;
  down)
    shift
    compose down "$@"
    ;;
  *)
    sed -n '2,17p' "$0"
    ;;
esac
