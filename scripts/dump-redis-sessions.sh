#!/usr/bin/env bash
set -euo pipefail

# Archives Redis persistence files from the Kubernetes Redis pod into /tmp and
# copies the archive locally. Set FRESH_BGSAVE=true only when you explicitly
# want Redis to write a fresh snapshot before copying.

KUBECTL_CONTEXT="${KUBECTL_CONTEXT:-w3f-o11y-prod-us}"
NAMESPACE="${NAMESPACE:-monitoring}"
REDIS_SELECTOR="${REDIS_SELECTOR:-app.kubernetes.io/name=redis}"
REDIS_POD="${REDIS_POD:-}"
REDIS_CONTAINER="${REDIS_CONTAINER:-}"
LOCAL_OUTPUT_DIR="${LOCAL_OUTPUT_DIR:-/tmp}"
FRESH_BGSAVE="${FRESH_BGSAVE:-false}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE_FILE="${REMOTE_FILE:-/tmp/ask-o11y-redis-sessions-${timestamp}.tar}"
LOCAL_FILE="${LOCAL_FILE:-${LOCAL_OUTPUT_DIR}/$(basename "${REMOTE_FILE}")}"

kubectl_base=(kubectl --context "${KUBECTL_CONTEXT}" -n "${NAMESPACE}")
container_args=()
if [[ -n "${REDIS_CONTAINER}" ]]; then
  container_args=(-c "${REDIS_CONTAINER}")
fi

remote_env=(
  "DUMP_FILE=${REMOTE_FILE}"
  "FRESH_BGSAVE=${FRESH_BGSAVE}"
  "REDIS_CLI_ARGS=${REDIS_CLI_ARGS:-}"
)
if [[ -n "${REDISCLI_AUTH:-}" ]]; then
  remote_env+=("REDISCLI_AUTH=${REDISCLI_AUTH}")
fi

if [[ -z "${REDIS_POD}" ]]; then
  mapfile -t redis_pods < <("${kubectl_base[@]}" get pods \
    -l "${REDIS_SELECTOR}" \
    --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')

  if [[ "${#redis_pods[@]}" -ne 1 ]]; then
    printf 'Expected exactly one Redis pod in namespace %s using selector %s, found %d.\n' \
      "${NAMESPACE}" "${REDIS_SELECTOR}" "${#redis_pods[@]}" >&2
    printf 'Set REDIS_POD explicitly, for example:\n' >&2
    printf '  REDIS_POD=redis-... %s\n' "$0" >&2
    exit 1
  fi

  REDIS_POD="${redis_pods[0]}"
fi

mkdir -p "${LOCAL_OUTPUT_DIR}"

printf 'Archiving Redis persistence files from %s/%s using context %s\n' \
  "${NAMESPACE}" "${REDIS_POD}" "${KUBECTL_CONTEXT}"
printf 'Remote file: %s\n' "${REMOTE_FILE}"
printf 'Local file:  %s\n' "${LOCAL_FILE}"

"${kubectl_base[@]}" exec -i "${REDIS_POD}" "${container_args[@]}" -- \
  env "${remote_env[@]}" sh -s <<'REMOTE_SCRIPT'
set -eu

redis() {
  # REDIS_CLI_ARGS intentionally allows operators to pass options like:
  #   REDIS_CLI_ARGS="-h redis -p 6379 -n 0"
  # shellcheck disable=SC2086
  redis-cli --no-auth-warning ${REDIS_CLI_ARGS:-} "$@"
}

config_value() {
  redis --raw CONFIG GET "$1" | tail -n 1
}

if [ "${FRESH_BGSAVE}" = "true" ]; then
  before="$(redis --raw LASTSAVE)"
  redis --raw BGSAVE >/dev/null

  while :; do
    in_progress="$(redis --raw INFO persistence | awk -F: '/^rdb_bgsave_in_progress:/ { gsub("\r", "", $2); print $2 }')"
    lastsave="$(redis --raw LASTSAVE)"
    if [ "${in_progress}" = "0" ] && [ "${lastsave}" != "${before}" ]; then
      break
    fi
    sleep 1
  done
fi

redis_dir="$(config_value dir)"
dbfilename="$(config_value dbfilename)"
appendonly="$(config_value appendonly || printf 'no')"
appendfilename="$(config_value appendfilename || true)"
appenddirname="$(config_value appenddirname || true)"
manifest="${DUMP_FILE}.manifest"

cd "${redis_dir}"

set --
if [ -n "${dbfilename}" ] && [ -f "${dbfilename}" ]; then
  set -- "$@" "${dbfilename}"
fi

if [ "${appendonly}" = "yes" ]; then
  if [ -n "${appenddirname}" ] && [ -e "${appenddirname}" ]; then
    set -- "$@" "${appenddirname}"
  elif [ -n "${appendfilename}" ] && [ -f "${appendfilename}" ]; then
    set -- "$@" "${appendfilename}"
  fi
fi

if [ "$#" -eq 0 ]; then
  printf 'No Redis persistence files found in %s\n' "${redis_dir}" >&2
  exit 1
fi

{
  printf 'exported_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'redis_dir=%s\n' "${redis_dir}"
  printf 'fresh_bgsave=%s\n' "${FRESH_BGSAVE}"
  printf 'appendonly=%s\n' "${appendonly}"
  printf 'dbsize=%s\n' "$(redis --raw DBSIZE)"
  printf 'files='
  printf '%s ' "$@"
  printf '\n'
} > "${manifest}"

rm -f "${DUMP_FILE}"
tar -cf "${DUMP_FILE}" "$@" -C "$(dirname "${manifest}")" "$(basename "${manifest}")"
rm -f "${manifest}"

printf 'Archived Redis persistence files to %s\n' "${DUMP_FILE}"
REMOTE_SCRIPT

"${kubectl_base[@]}" cp "${REDIS_POD}:${REMOTE_FILE}" "${LOCAL_FILE}" "${container_args[@]}"

printf 'Copied Redis session dump to %s\n' "${LOCAL_FILE}"
