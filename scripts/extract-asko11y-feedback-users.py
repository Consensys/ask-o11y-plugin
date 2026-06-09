#!/usr/bin/env python3
"""Extract recent Ask O11y users from Redis and resolve emails via Grafana.

This script intentionally exports only user/activity metadata. It scans Redis
session objects but does not write message content, tool payloads, or summaries
to disk.
"""

from __future__ import annotations

import argparse
import base64
import csv
import datetime as dt
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


DEFAULT_RECENT_SINCE = "2026-03-06T00:00:00Z"
DEFAULT_OUTPUT_DIR = "local/asko11y-feedback"


class RedisError(RuntimeError):
    pass


class RedisClient:
    def __init__(self, redis_url: str, timeout: float = 10.0) -> None:
        parsed = urllib.parse.urlparse(redis_url)
        if parsed.scheme not in {"redis", "rediss"}:
            raise ValueError("redis URL must use redis:// or rediss://")

        self.host = parsed.hostname or "localhost"
        self.port = parsed.port or 6379
        self.timeout = timeout
        self.username = urllib.parse.unquote(parsed.username) if parsed.username else None
        self.password = urllib.parse.unquote(parsed.password) if parsed.password else None
        self.db = int(parsed.path.lstrip("/") or "0")
        self.sock: socket.socket | ssl.SSLSocket | None = None
        self.use_tls = parsed.scheme == "rediss"

    def __enter__(self) -> "RedisClient":
        raw_sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw_sock, server_hostname=self.host) if self.use_tls else raw_sock
        if self.password:
            if self.username:
                self.command("AUTH", self.username, self.password)
            else:
                self.command("AUTH", self.password)
        if self.db:
            self.command("SELECT", str(self.db))
        return self

    def __exit__(self, *_args: object) -> None:
        if self.sock is not None:
            self.sock.close()

    def command(self, *parts: str) -> Any:
        if self.sock is None:
            raise RedisError("Redis socket is not connected")
        payload = self._encode(parts)
        self.sock.sendall(payload)
        return self._read_response()

    def scan(self, match: str, count: int = 1000) -> list[str]:
        cursor = "0"
        keys: list[str] = []
        while True:
            response = self.command("SCAN", cursor, "MATCH", match, "COUNT", str(count))
            if not isinstance(response, list) or len(response) != 2:
                raise RedisError(f"unexpected SCAN response: {response!r}")
            cursor = decode_redis(response[0])
            batch = response[1]
            if not isinstance(batch, list):
                raise RedisError(f"unexpected SCAN key batch: {batch!r}")
            keys.extend(decode_redis(key) for key in batch)
            if cursor == "0":
                return keys

    @staticmethod
    def _encode(parts: tuple[str, ...]) -> bytes:
        chunks = [f"*{len(parts)}\r\n".encode()]
        for part in parts:
            encoded = part.encode()
            chunks.append(f"${len(encoded)}\r\n".encode())
            chunks.append(encoded)
            chunks.append(b"\r\n")
        return b"".join(chunks)

    def _read_line(self) -> bytes:
        if self.sock is None:
            raise RedisError("Redis socket is not connected")
        chunks = []
        while True:
            char = self.sock.recv(1)
            if not char:
                raise RedisError("Redis connection closed")
            chunks.append(char)
            if len(chunks) >= 2 and chunks[-2:] == [b"\r", b"\n"]:
                return b"".join(chunks[:-2])

    def _read_exact(self, length: int) -> bytes:
        if self.sock is None:
            raise RedisError("Redis socket is not connected")
        chunks = []
        remaining = length
        while remaining > 0:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise RedisError("Redis connection closed")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _read_response(self) -> Any:
        prefix = self._read_exact(1)
        if prefix == b"+":
            return self._read_line().decode()
        if prefix == b"-":
            raise RedisError(self._read_line().decode())
        if prefix == b":":
            return int(self._read_line())
        if prefix == b"$":
            length = int(self._read_line())
            if length == -1:
                return None
            data = self._read_exact(length)
            self._read_exact(2)
            return data
        if prefix == b"*":
            length = int(self._read_line())
            if length == -1:
                return None
            return [self._read_response() for _ in range(length)]
        raise RedisError(f"unknown Redis response prefix: {prefix!r}")


@dataclass
class UsageAggregate:
    asko11y_user_id: int
    org_id: int
    first_seen_at: dt.datetime
    last_activity_at: dt.datetime
    session_count: int = 0
    total_messages: int = 0
    model_set: set[str] = field(default_factory=set)

    def add_session(self, session: dict[str, Any]) -> None:
        created_at = parse_datetime(session.get("createdAt")) or self.first_seen_at
        updated_at = parse_datetime(session.get("updatedAt")) or created_at
        self.first_seen_at = min(self.first_seen_at, created_at)
        self.last_activity_at = max(self.last_activity_at, updated_at)
        self.session_count += 1
        self.total_messages += int_or_zero(session.get("messageCount")) or len(session.get("messages") or [])
        model = str(session.get("model") or "").strip()
        if model:
            self.model_set.add(model)


@dataclass
class GrafanaUser:
    grafana_user_id: int | None = None
    login: str = ""
    email: str = ""
    name: str = ""
    org_id: int | None = None
    org_name: str = ""


def decode_redis(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode()
    return str(value)


def parse_datetime(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def isoformat_z(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def int_or_zero(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def fnv1a_login_hash(login: str) -> int:
    h = 14695981039346656037
    for byte in login.encode():
        h ^= byte
        h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return h & 0x7FFFFFFFFFFFFFFF


def collect_recent_usage(redis_url: str, recent_since: dt.datetime) -> tuple[dict[tuple[int, int], UsageAggregate], dict[str, int]]:
    stats = {
        "session_keys_seen": 0,
        "session_json_seen": 0,
        "recent_session_json_seen": 0,
        "malformed_sessions": 0,
    }
    usage: dict[tuple[int, int], UsageAggregate] = {}

    with RedisClient(redis_url) as client:
        for key in sorted(client.scan("session:*")):
            if key.endswith(":shares"):
                continue
            stats["session_keys_seen"] += 1
            raw = client.command("GET", key)
            if raw is None:
                continue
            try:
                session = json.loads(decode_redis(raw))
            except json.JSONDecodeError:
                stats["malformed_sessions"] += 1
                continue
            if not isinstance(session, dict):
                stats["malformed_sessions"] += 1
                continue

            user_id = int_or_zero(session.get("userId"))
            org_id = int_or_zero(session.get("orgId"))
            updated_at = parse_datetime(session.get("updatedAt"))
            created_at = parse_datetime(session.get("createdAt")) or updated_at
            if user_id <= 0 or org_id <= 0 or updated_at is None or created_at is None:
                stats["malformed_sessions"] += 1
                continue

            stats["session_json_seen"] += 1
            if updated_at < recent_since:
                continue

            stats["recent_session_json_seen"] += 1
            aggregate_key = (user_id, org_id)
            if aggregate_key not in usage:
                usage[aggregate_key] = UsageAggregate(
                    asko11y_user_id=user_id,
                    org_id=org_id,
                    first_seen_at=created_at,
                    last_activity_at=updated_at,
                )
            usage[aggregate_key].add_session(session)

    return usage, stats


class GrafanaClient:
    def __init__(self, base_url: str, token: str | None, basic_auth: str | None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.basic_auth = basic_auth

    def get_json(self, path: str) -> Any:
        request = urllib.request.Request(f"{self.base_url}{path}")
        request.add_header("Accept", "application/json")
        if self.token:
            request.add_header("Authorization", f"Bearer {self.token}")
        elif self.basic_auth:
            encoded = base64.b64encode(self.basic_auth.encode()).decode()
            request.add_header("Authorization", f"Basic {encoded}")
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())

    def try_get_json(self, path: str) -> Any | None:
        try:
            return self.get_json(path)
        except urllib.error.HTTPError as exc:
            print(f"warning: Grafana API {path} returned HTTP {exc.code}", file=sys.stderr)
            return None
        except urllib.error.URLError as exc:
            print(f"warning: Grafana API {path} failed: {exc}", file=sys.stderr)
            return None


def normalize_user(payload: dict[str, Any], org_id: int | None = None, org_name: str = "") -> GrafanaUser | None:
    login = str(payload.get("login") or "").strip()
    email = str(payload.get("email") or "").strip()
    user_id = int_or_zero(payload.get("id") or payload.get("userId"))
    if not login and not email and user_id <= 0:
        return None
    return GrafanaUser(
        grafana_user_id=user_id if user_id > 0 else None,
        login=login,
        email=email,
        name=str(payload.get("name") or "").strip(),
        org_id=org_id,
        org_name=org_name,
    )


def list_from_grafana_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("users", "items", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def fetch_grafana_users(grafana_url: str, token: str | None, basic_auth: str | None, org_ids: set[int]) -> tuple[list[GrafanaUser], dict[int, str]]:
    client = GrafanaClient(grafana_url, token, basic_auth)
    users: list[GrafanaUser] = []
    org_names: dict[int, str] = {}

    page = 1
    while True:
        payload = client.try_get_json(f"/api/users/search?perpage=1000&page={page}")
        if payload is None:
            break
        page_users = list_from_grafana_payload(payload)
        users.extend(user for item in page_users if (user := normalize_user(item)) is not None)
        total_count = int_or_zero(payload.get("totalCount") if isinstance(payload, dict) else None)
        if not page_users or total_count <= page * 1000:
            break
        page += 1

    org_payload = client.try_get_json("/api/orgs")
    for item in list_from_grafana_payload(org_payload):
        org_id = int_or_zero(item.get("id"))
        if org_id > 0:
            org_names[org_id] = str(item.get("name") or "").strip()

    for org_id in sorted(org_ids):
        org_name = org_names.get(org_id, "")
        org_user_payload = client.try_get_json(f"/api/orgs/{org_id}/users")
        if org_user_payload is None and org_id == 1:
            org_user_payload = client.try_get_json("/api/org/users")
        for item in list_from_grafana_payload(org_user_payload):
            if user := normalize_user(item, org_id=org_id, org_name=org_name):
                users.append(user)

    return users, org_names


def load_grafana_users_csv(path: str) -> tuple[list[GrafanaUser], dict[int, str]]:
    users: list[GrafanaUser] = []
    org_names: dict[int, str] = {}
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            org_id = int_or_zero(row.get("org_id"))
            org_name = str(row.get("org_name") or "").strip()
            if org_id > 0 and org_name:
                org_names[org_id] = org_name
            users.append(
                GrafanaUser(
                    grafana_user_id=int_or_zero(row.get("grafana_user_id")) or None,
                    login=str(row.get("login") or "").strip(),
                    email=str(row.get("email") or "").strip(),
                    org_id=org_id if org_id > 0 else None,
                    org_name=org_name,
                )
            )
    return users, org_names


def resolve_user(aggregate: UsageAggregate, users: list[GrafanaUser], org_names: dict[int, str]) -> tuple[GrafanaUser | None, str]:
    org_users = [user for user in users if user.org_id == aggregate.org_id]
    global_users = [user for user in users if user.org_id is None]

    for scope_users, prefix in ((org_users, "org"), (global_users, "global")):
        for user in scope_users:
            if user.login and fnv1a_login_hash(user.login) == aggregate.asko11y_user_id:
                if not user.org_name:
                    user.org_name = org_names.get(aggregate.org_id, "")
                return user, f"{prefix}_fnv_login_hash"

    for scope_users, prefix in ((org_users, "org"), (global_users, "global")):
        for user in scope_users:
            if user.grafana_user_id == aggregate.asko11y_user_id:
                if not user.org_name:
                    user.org_name = org_names.get(aggregate.org_id, "")
                return user, f"{prefix}_numeric_user_id"

    return None, "unresolved"


def write_outputs(
    output_dir: str,
    usage: dict[tuple[int, int], UsageAggregate],
    users: list[GrafanaUser],
    org_names: dict[int, str],
    stats: dict[str, int],
) -> tuple[str, str, str]:
    os.makedirs(output_dir, exist_ok=True)
    recipients_path = os.path.join(output_dir, "asko11y-feedback-recipients.csv")
    unresolved_path = os.path.join(output_dir, "asko11y-feedback-unresolved-users.csv")
    stats_path = os.path.join(output_dir, "asko11y-feedback-extraction-summary.json")

    resolved_rows: dict[tuple[str, int], dict[str, str]] = {}
    unresolved_rows: list[dict[str, str]] = []

    for aggregate in sorted(usage.values(), key=lambda item: item.last_activity_at, reverse=True):
        resolved_user, method = resolve_user(aggregate, users, org_names)
        model_set = ";".join(sorted(aggregate.model_set))
        base = {
            "asko11y_user_id": str(aggregate.asko11y_user_id),
            "org_id": str(aggregate.org_id),
            "org_name": (resolved_user.org_name if resolved_user else org_names.get(aggregate.org_id, "")) or "",
            "first_seen_at": isoformat_z(aggregate.first_seen_at),
            "last_activity_at": isoformat_z(aggregate.last_activity_at),
            "session_count": str(aggregate.session_count),
            "total_messages": str(aggregate.total_messages),
            "model_set": model_set,
        }
        if resolved_user and resolved_user.email:
            dedupe_key = (resolved_user.email.lower(), aggregate.org_id)
            row = {
                "email": resolved_user.email,
                "login": resolved_user.login,
                "grafana_user_id": str(resolved_user.grafana_user_id or ""),
                **base,
                "resolution_method": method,
            }
            if dedupe_key in resolved_rows:
                row = merge_recipient_rows(resolved_rows[dedupe_key], row)
            resolved_rows[dedupe_key] = row
        else:
            unresolved_rows.append({**base, "resolution_method": method})

    recipient_fields = [
        "email",
        "login",
        "grafana_user_id",
        "asko11y_user_id",
        "org_id",
        "org_name",
        "first_seen_at",
        "last_activity_at",
        "session_count",
        "total_messages",
        "model_set",
        "resolution_method",
    ]
    with open(recipients_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=recipient_fields)
        writer.writeheader()
        writer.writerows(sorted(resolved_rows.values(), key=lambda row: row["last_activity_at"], reverse=True))

    unresolved_fields = [
        "asko11y_user_id",
        "org_id",
        "org_name",
        "first_seen_at",
        "last_activity_at",
        "session_count",
        "total_messages",
        "model_set",
        "resolution_method",
    ]
    with open(unresolved_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=unresolved_fields)
        writer.writeheader()
        writer.writerows(unresolved_rows)

    summary = {
        **stats,
        "recent_user_org_pairs": len(usage),
        "resolved_recipients": len(resolved_rows),
        "unresolved_user_org_pairs": len(unresolved_rows),
        "unresolved_rate": (len(unresolved_rows) / len(usage)) if usage else 0,
    }
    with open(stats_path, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, sort_keys=True)
        handle.write("\n")

    return recipients_path, unresolved_path, stats_path


def merge_recipient_rows(existing: dict[str, str], new: dict[str, str]) -> dict[str, str]:
    merged = dict(existing)
    merged["asko11y_user_id"] = ";".join(sorted(set(filter(None, [*existing["asko11y_user_id"].split(";"), *new["asko11y_user_id"].split(";")]))))
    merged["first_seen_at"] = min(existing["first_seen_at"], new["first_seen_at"])
    merged["last_activity_at"] = max(existing["last_activity_at"], new["last_activity_at"])
    merged["session_count"] = str(int_or_zero(existing["session_count"]) + int_or_zero(new["session_count"]))
    merged["total_messages"] = str(int_or_zero(existing["total_messages"]) + int_or_zero(new["total_messages"]))
    merged["model_set"] = ";".join(sorted(set(filter(None, [*existing["model_set"].split(";"), *new["model_set"].split(";")]))))
    merged["resolution_method"] = ";".join(sorted(set(filter(None, [*existing["resolution_method"].split(";"), new["resolution_method"]]))))
    return merged


def write_form_draft(output_dir: str) -> str:
    path = os.path.join(output_dir, "asko11y-feedback-google-form.md")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(FORM_DRAFT)
    return path


FORM_DRAFT = """# Ask O11y Feedback Form

## Form Settings
- Collect email addresses, or make the first question required if automatic collection is unavailable.
- Keep responses editable after submission.
- Do not collect chat transcript content in this form.

## Questions
1. Email
   - Type: Short answer
   - Required: Yes

2. How often have you used Ask O11y?
   - Type: Multiple choice
   - Options: Once, A few times, Weekly, Daily or almost daily
   - Required: Yes

3. What were you mainly trying to do with Ask O11y?
   - Type: Multiple choice
   - Options: Investigate an incident, Debug a service or query, Understand metrics/logs/traces, Build or improve a dashboard, Investigate an alert, Learn observability concepts, Explore the product, Other
   - Required: Yes

4. Did Ask O11y help you complete that task?
   - Type: Multiple choice
   - Options: Yes, Partially, No, I was just exploring
   - Required: Yes

5. What would you have used instead of Ask O11y?
   - Type: Multiple choice
   - Options: Grafana manually, PromQL/LogQL directly, A teammate or Slack channel, Documentation or a runbook, Another AI tool, I would not have done the task, Other
   - Required: No

6. Accuracy rating
   - Type: Linear scale
   - Scale: 1 to 5
   - Labels: 1 = Often incorrect, 5 = Consistently accurate
   - Required: Yes

7. Where was Ask O11y correct or incorrect?
   - Type: Paragraph
   - Required: No

8. When Ask O11y was not helpful, what went wrong?
   - Type: Checkboxes
   - Options: Wrong answer, Missing data access, Tool or permission error, Did not understand my request, Response was unclear, Too slow, Too much back-and-forth, I did not know what to ask, Other
   - Required: No

9. How often did you verify Ask O11y's answer somewhere else?
   - Type: Multiple choice
   - Options: Always, Often, Sometimes, Rarely, Never, Not applicable
   - Required: Yes

10. Usability rating
   - Type: Linear scale
   - Scale: 1 to 5
   - Labels: 1 = Hard to use, 5 = Easy to use
   - Required: Yes

11. What felt confusing, missing, or smooth?
   - Type: Paragraph
   - Required: No

12. Performance rating
   - Type: Linear scale
   - Scale: 1 to 5
   - Labels: 1 = Too slow, 5 = Fast enough
   - Required: Yes

13. Where did it feel slow or responsive?
   - Type: Paragraph
   - Required: No

14. Which workflows have been most useful?
   - Type: Checkboxes
   - Options: Metrics queries, Logs investigation, Trace investigation, Dashboard help, Alert investigation, Incident/root cause analysis, Learning observability concepts, Other
   - Required: No

15. What workflows or capabilities are missing?
    - Type: Paragraph
    - Required: No

16. Would you keep using Ask O11y if it were available by default?
    - Type: Multiple choice
    - Options: Yes, Probably, Not sure, Probably not, No
    - Required: Yes

17. What should we improve first?
    - Type: Paragraph
    - Required: Yes

18. Can we review your Ask O11y usage metadata to understand your feedback?
    - Type: Multiple choice
    - Options: Yes, No
    - Required: Yes

19. Can we follow up with you about your feedback?
    - Type: Multiple choice
    - Options: Yes, No
    - Required: Yes
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redis-url", required=True, help="Redis URL for the restored Ask O11y dump, for example redis://localhost:6380/0")
    parser.add_argument("--grafana-url", help="Grafana base URL, for example https://grafana.example.com")
    parser.add_argument("--grafana-token", default=os.getenv("GRAFANA_SERVICE_ACCOUNT_TOKEN") or os.getenv("GRAFANA_TOKEN"))
    parser.add_argument("--grafana-basic-auth", default=os.getenv("GRAFANA_BASIC_AUTH"), help="Basic auth as user:password; used only when no token is provided")
    parser.add_argument("--grafana-users-csv", help="CSV with grafana_user_id,login,email,org_id,org_name; skips Grafana API calls")
    parser.add_argument("--recent-since", default=DEFAULT_RECENT_SINCE, help=f"UTC cutoff for recent users; default {DEFAULT_RECENT_SINCE}")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--write-form-draft", action="store_true", help="Also write the Google Form draft into the output directory")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    recent_since = parse_datetime(args.recent_since)
    if recent_since is None:
        print(f"error: invalid --recent-since value: {args.recent_since}", file=sys.stderr)
        return 2
    if not args.grafana_users_csv and not args.grafana_url:
        print("error: set --grafana-users-csv or --grafana-url", file=sys.stderr)
        return 2

    usage, stats = collect_recent_usage(args.redis_url, recent_since)
    if args.grafana_users_csv:
        users, org_names = load_grafana_users_csv(args.grafana_users_csv)
    else:
        if not args.grafana_token and not args.grafana_basic_auth:
            print("error: set --grafana-token, GRAFANA_TOKEN, GRAFANA_SERVICE_ACCOUNT_TOKEN, or GRAFANA_BASIC_AUTH", file=sys.stderr)
            return 2
        users, org_names = fetch_grafana_users(args.grafana_url, args.grafana_token, args.grafana_basic_auth, {org_id for _, org_id in usage})
    recipients_path, unresolved_path, stats_path = write_outputs(args.output_dir, usage, users, org_names, stats)
    form_path = write_form_draft(args.output_dir) if args.write_form_draft else ""

    print(f"Recipients CSV: {recipients_path}")
    print(f"Unresolved CSV: {unresolved_path}")
    print(f"Summary JSON: {stats_path}")
    if form_path:
        print(f"Google Form draft: {form_path}")
    with open(stats_path, encoding="utf-8") as handle:
        resolved_recipients = json.load(handle)["resolved_recipients"]
    print(f"Resolved {resolved_recipients} recipients from {len(usage)} recent user/org pairs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
