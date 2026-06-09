#!/usr/bin/env bash
set -euo pipefail

# Restores an Ask O11y Redis persistence archive into a disposable local Redis
# container. The archive should be produced by scripts/dump-redis-sessions.sh.

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s /path/to/ask-o11y-redis-sessions.tar [port]\n' "$0" >&2
  exit 2
fi

DUMP_ARCHIVE="$1"
REDIS_PORT="${2:-6380}"
CONTAINER_NAME="${CONTAINER_NAME:-asko11y-feedback-redis}"
WORK_DIR="${WORK_DIR:-local/asko11y-feedback/redis-restore}"

if [[ ! -f "${DUMP_ARCHIVE}" ]]; then
  printf 'Dump archive not found: %s\n' "${DUMP_ARCHIVE}" >&2
  exit 1
fi

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
tar -xf "${DUMP_ARCHIVE}" -C "${WORK_DIR}"

case "${WORK_DIR}" in
  /*) ABS_WORK_DIR="${WORK_DIR}" ;;
  *) ABS_WORK_DIR="$(pwd)/${WORK_DIR}" ;;
esac

redis_args=()
if [[ -d "${WORK_DIR}/appendonlydir" ]] || compgen -G "${WORK_DIR}/*.aof" >/dev/null; then
  redis_args=(--appendonly yes)
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "127.0.0.1:${REDIS_PORT}:6379" \
  -v "${ABS_WORK_DIR}:/data" \
  redis:7-alpine \
  redis-server "${redis_args[@]}" >/dev/null

printf 'Restored Redis dump into container %s\n' "${CONTAINER_NAME}"
printf 'Redis URL: redis://127.0.0.1:%s/0\n' "${REDIS_PORT}"
