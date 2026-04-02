#!/usr/bin/env bash
# Replace one KEY=value line in a dotenv file, or append if missing.

upsert_env_line() {
  local key="$1"
  local val="$2"
  local env_file="$3"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$env_file" ]]; then
    local line found=0
    : >"$tmp"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^${key}= ]]; then
        printf '%s=%s\n' "$key" "$val" >>"$tmp"
        found=1
      else
        printf '%s\n' "$line" >>"$tmp"
      fi
    done <"$env_file"
    if [[ "$found" -eq 0 ]]; then
      printf '%s=%s\n' "$key" "$val" >>"$tmp"
    fi
    mv "$tmp" "$env_file"
  else
    printf '%s=%s\n' "$key" "$val" >"$env_file"
    rm -f "$tmp"
  fi
}
