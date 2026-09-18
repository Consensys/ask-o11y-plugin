---
name: writing-k6-tests
license: Apache-2.0
description: Author k6 load-test scripts and Grafana Synthetic Monitoring checks — HTTP/WebSocket/gRPC/browser scripts, executor selection, thresholds, checks vs expect(), smoke/stress/spike/soak patterns, and SM scripted-check semantics. Use when the user says "load test this API", "stress test", "smoke test", "soak test", "spike test", "write a k6 script", "synthetic monitoring check", or asks about ramping/arrival-rate executors or probe uptime checks.
metadata:
  version: "1.0"
  triggers: 'load test|k6|stress test|smoke test|soak test|spike test|synthetic monitoring|breakpoint test'
---

Write complete, runnable k6 scripts for load testing or Grafana Synthetic Monitoring (SM) checks. You have no k6 execution tools — authoring is the deliverable; give the user the exact run command.

## Decide the goal first

- **Load/perf test** (throughput, latency under load, breaking point): full k6 script with load profile. This is the default reading of "load test".
- **Synthetic Monitoring check** (uptime, "does the user journey work right now"): one iteration, one VU, fixed schedule. **No load idioms** — `vus`, `stages`, `iterations` are ignored by SM and `thresholds` are not supported. Say "check", "probe", "execution" — never "VUs" or "ramp".

A script can serve both, but the options shape differs. Ask only if the goal is genuinely unclear.

## Load-test skeleton (start here, adapt endpoints and profile)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const latency = new Trend('checkout_latency');
const errors = new Rate('checkout_errors');

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-arrival-rate', // open model: pace stays honest as latency degrades
      startRate: 10, timeUnit: '1s',
      preAllocatedVUs: 50, maxVUs: 200,
      stages: [
        { target: 50, duration: '2m' },
        { target: 50, duration: '5m' },
        { target: 0, duration: '1m' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('https://example.com/api/checkout');
  check(res, { 'status 200': (r) => r.status === 200 });
  latency.add(res.timings.duration);
  errors.add(res.status >= 500);
  sleep(1); // user think time — required in VU-based (closed-model) tests
}
```

## Executor cheat sheet

| Goal | Executor |
|---|---|
| Realistic traffic curve / breakpoint test | `ramping-arrival-rate` (ramp *offered load*, not VUs — closed models throttle themselves and mask the breaking point) |
| Constant RPS over time | `constant-arrival-rate` |
| Simulate N concurrent users | `ramping-vus` |
| Many short, independent operations | `constant-vus` with `per-vu-iterations`, or `shared-iterations` |
| Smoke: 1 VU, 1 iteration | plain run with `--vus 1 --iterations 1` |

## Best-practice checklist (apply to every script)

- `export const options` with realistic VUs/durations — no toy defaults.
- **Thresholds on every load test** — at minimum `http_req_duration` and `http_req_failed` (or protocol equivalent). Without them CI can't fail on regression.
- `sleep()` in VU-based tests; arrival-rate executors pace themselves, so skip it there.
- Assert every response with `check()` or `expect()`; name every assertion — the name is what you grep at 3am.
- No `let`/`var` at top level (module scope is shared across VUs) — use `const`.
- No deprecated imports: `k6/websockets`, not `k6/ws`.
- Track SLO-relevant custom metrics (`Trend` for latency, `Rate` for errors) plus a `handleSummary` for p95/p99 + throughput.
- Browser scripts: `expect()` from k6-testing, wrap in `try/finally` with `page.close()`; gRPC: `client.close()` in `finally`; WebSocket: `try/catch` around `JSON.parse` of incoming frames.

## Synthetic Monitoring specifics

Check-type ladder — stop at the simplest sufficient type:

1. **Protocol checks** (HTTP/ping/DNS/TCP/gRPC) — single endpoint uptime, no script.
2. **MultiHTTP** — HTTP sequence with `${variable}` capture; caution: it does not auto-validate status codes, define assertions per request.
3. **k6 scripted** — real logic: signing, branching, generated data, WebSockets.
4. **k6 browser** — only for JS-rendered journeys/forms/Core Web Vitals (billed at the expensive tier; 1GB memory per browser on public probes).

Failure semantics (this is what most scripts get wrong): SM runs with `--throw` and one VU/iteration. `probe_success` fails when the script **throws** or calls `fail()` — a bare failed `check()` only records metrics and does **not** fail the execution. Preferred assertion patterns:

```javascript
import { expect } from 'https://jslib.k6.io/k6-testing/0.6.1/index.js';
import { check, fail } from 'k6';

expect(res.status, 'login should succeed').toEqual(200); // throws → execution fails

check(res, { 'status 200': (r) => r.status === 200 }) ||
  fail(`login failed with status ${res.status}`); // check + fail pairing
```

SM constraints to respect: frequency 60–3600s for k6-class checks, timeout ≤ frequency, no `open()`/`fs` (bundle everything or import from `https://jslib.k6.io/`), frequency choice sets cost (`probes × 43200 / frequency_minutes` executions per month).

## Deliverable

Present: the full script, the exact run command (`k6 run --vus 10 --duration 30s script.js`, or SM setup steps: UI → new check → type → paste script → pick 2-3 probes near users), and any best-practice issues you corrected. Never end with the script only in chat — if you can write files, save it as `k6/scripts/<kebab-case-name>.js`.
