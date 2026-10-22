import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

export const fixture = JSON.parse(
  open(__ENV.BENCH_K6_FIXTURE || "./.local/k6.json"),
);
export const base = __ENV.BASE_URL || "http://127.0.0.1:5058/api/v1";
if (!fixture.synthetic || !/^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/.test(base))
  throw new Error("Only the isolated loopback benchmark backend is supported");
export const latency = new Trend("api_latency", true);
export const window = new Trend("benchmark_window_ms");
export const failures = new Rate("unexpected_errors");
export const requests = new Counter("benchmark_requests");
export const conflicts = new Counter("expected_conflicts");
export const invariants = new Rate("concurrency_invariant_failed");
export const mode = __ENV.CASE || "evaluations_semester";
export const vus = Number(__ENV.VUS || 20);
export const options = {
  scenarios: {
    benchmark: {
      executor: "constant-vus",
      vus,
      duration: __ENV.DURATION || "30s",
      gracefulStop: "15s",
    },
  },
  setupTimeout: "60s",
  summaryTrendStats: [
    "avg",
    "min",
    "med",
    "p(50)",
    "p(95)",
    "p(99)",
    "max",
    "count",
  ],
  systemTags: ["status", "method", "name", "scenario", "expected_response"],
  thresholds: {
    unexpected_errors: ["rate<0.01"],
    checks: ["rate>0.99"],
    ...(mode.startsWith("evaluations_") || mode.startsWith("reports_")
      ? { "api_latency{kind:read}": ["p(95)<300"] }
      : {}),
    ...(mode === "write" ? { "api_latency{kind:write}": ["p(95)<500"] } : {}),
    ...(mode === "conflict"
      ? { concurrency_invariant_failed: ["rate==0"] }
      : {}),
  },
};
export function body(response) {
  try {
    return response.json().data;
  } catch {
    return null;
  }
}
export function params(token, name, extra = {}) {
  return {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { name },
    timeout: "30s",
    ...extra,
  };
}
export function record(response, kind, valid) {
  const now = Date.now();
  window.add(now - response.timings.duration - response.timings.blocked);
  window.add(now);
  latency.add(response.timings.duration, { kind });
  requests.add(1);
  failures.add(!valid);
  check(response, {
    "status and response contract valid": () => Boolean(valid),
  });
  return valid;
}
export function pause() {
  sleep(Number(__ENV.THINK_TIME || 0.1));
}
export function query(object) {
  return Object.entries(object)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
export function loginSetup() {
  if (mode === "login") return {};
  const users =
    mode === "write" || mode === "conflict"
      ? fixture.students.slice(0, vus)
      : [fixture.admin];
  const responses = http.batch(
    users.map((u) => [
      "POST",
      `${base}/auth/login`,
      JSON.stringify({ username: u.username, password: fixture.password }),
      params(undefined, "setup_login"),
    ]),
  );
  const tokens = responses.map((r) => body(r)?.accessToken);
  if (tokens.some((t) => !t))
    fail(
      "Benchmark authentication setup failed (tokens intentionally omitted)",
    );
  return { tokens };
}
export function summary(data) {
  return {
    [__ENV.SUMMARY_FILE || "summary.json"]: JSON.stringify(data, null, 2),
  };
}
