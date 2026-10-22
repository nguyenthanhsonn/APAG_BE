// Owns a dedicated backend process and runs ONLY against the marked, local benchmark database.
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const os = require("node:os");
const net = require("node:net");
const {
  fs,
  path,
  project,
  dependency,
  fixture,
  writeJson,
} = require("./support.cjs");
const { Client } = dependency("pg");
const { provenance } = require("./provenance.cjs");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cases = [
  ...["50", "100", "200"].map((n) => ({
    name: `login_${n}`,
    mode: "login",
    vus: Number(n),
  })),
  ...["semester", "class", "faculty", "status", "keyword", "combined"].map(
    (s) => ({ name: `evaluations_${s}`, mode: `evaluations_${s}`, vus: 50 }),
  ),
  { name: "write", mode: "write", vus: 50 },
  { name: "conflict", mode: "conflict", vus: 20 },
  ...["overview", "training_results", "by_class", "by_faculty"].map((s) => ({
    name: `reports_${s}`,
    mode: `reports_${s}`,
    vus: 20,
  })),
  { name: "export", mode: "export", vus: 5 },
];
function seconds(value, fallback) {
  const n = Number(value || fallback);
  if (!Number.isInteger(n) || n < 1 || n > 600)
    throw Error("Duration must be 1..600 seconds");
  return n;
}
async function command(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { timeout: 180000, ...options });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}
function fingerprint() {
  const hash = createHash("sha256");
  function visit(dir) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else {
        hash.update(path.relative(project, file));
        hash.update(fs.readFileSync(file));
      }
    }
  }
  visit(path.join(project, "src"));
  visit(path.join(project, "prisma/schema"));
  for (const file of ["package.json", "pnpm-lock.yaml"])
    hash.update(fs.readFileSync(path.join(project, file)));
  return hash.digest("hex");
}
function gauge(text, name) {
  return text
    .split("\n")
    .filter(
      (line) => line.startsWith(name + "{") || line.startsWith(name + " "),
    )
    .reduce(
      (sum, line) => sum + Number(line.split("} ").at(-1).split(" ").at(-1)),
      0,
    );
}
async function main() {
  const data = fixture();
  const duration = seconds(process.env.DURATION_SECONDS, 30),
    warmup = seconds(process.env.WARMUP_SECONDS, 5);
  const selected = process.env.BENCH_CASES
    ? process.env.BENCH_CASES.split(",").map((name) => {
        const c = cases.find((c) => c.name === name);
        if (!c) throw Error("Unknown benchmark case");
        return c;
      })
    : cases;
  const k6 = process.env.K6_BIN || "k6";
  const version = spawnSync(k6, ["version"], { encoding: "utf8" });
  if (version.status !== 0) throw Error("k6 binary required; set K6_BIN");
  if (process.env.BENCH_SKIP_BUILD !== "true") {
    const build = await command("pnpm", ["build"], {
      cwd: project,
      stdio: "inherit",
    });
    if (build !== 0) throw Error("Backend build failed");
  }
  const runId = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "");
  const output = path.join(__dirname, "results", data.databaseName, runId);
  fs.mkdirSync(output, { recursive: true });
  const k6Fixture = path.join(__dirname, ".local/k6.json");
  writeJson(
    k6Fixture,
    {
      synthetic: true,
      password: data.password,
      classes: data.classes,
      semesters: data.semesters,
      admin: data.admin,
      students: data.students,
    },
    true,
  );
  const portServer = net.createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const metricsToken = randomBytes(32).toString("hex");
  const log = fs.openSync(path.join(output, "backend.log"), "w", 0o600);
  const backend = spawn(process.execPath, ["dist/main.js"], {
    cwd: project,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: data.databaseUrl,
      DIRECT_URL: data.databaseUrl,
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: String(port),
      OTEL_ENABLED: "false",
      REDIS_KEY_PREFIX: `benchmark:${data.databaseName}:`,
      METRICS_ENABLED: "true",
      METRICS_TOKEN: metricsToken,
      SWAGGER_ENABLED: "false",
      LOG_LEVEL: "info",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
      JWT_ACCESS_EXPIRES_IN: "1h",
      SMTP_HOST: "",
      SMTP_FROM: "",
      SMTP_USER: "",
      SMTP_PASS: "",
    },
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  const db = new Client({
    connectionString: data.databaseUrl,
    application_name: "benchmark-resource-observer",
    connectionTimeoutMillis: 5000,
  });
  const samples = [];
  const results = [];
  let phase = "startup",
    active = true;
  const base = `http://127.0.0.1:${port}`;
  const metadata = {
    runId,
    startedAt: new Date().toISOString(),
    synthetic: true,
    databaseName: data.databaseName,
    sourceSha256: fingerprint(),
    gitHead: spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: project,
      encoding: "utf8",
    }).stdout.trim(),
    dirtyWorktree:
      spawnSync("git", ["status", "--porcelain"], {
        cwd: project,
        encoding: "utf8",
      }).stdout.length > 0,
    node: process.version,
    k6: version.stdout.trim(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    loadAverageAtStart: os.loadavg(),
    dataset: data.counts,
    postgres: data.environment,
    settings: {
      durationSeconds: duration,
      warmupSeconds: warmup,
      thinkTimeSeconds: 0.1,
      model: "closed constant-vus",
      tracing: false,
      redis: "shared Redis service; isolated benchmark namespace",
      logging: "info JSON to file",
      poolMax: "pg default 10",
      uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE || "default 4",
      backendPort: port,
      resourceIntervalSeconds: 1,
    },
    cases: selected,
  };
  writeJson(path.join(output, "environment.json"), metadata);
  writeJson(path.join(output, "provenance.json"), {
    ...provenance(),
    timing: "before benchmark requests",
  });
  const stop = () => {
    active = false;
    backend.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let sampling;
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (backend.exitCode !== null)
        throw Error("Benchmark backend exited; check its private log");
      try {
        if (
          (
            await fetch(base + "/api/v1/health", {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await wait(100);
    }
    if (!ready) throw Error("Benchmark backend readiness timeout");
    await db.connect();
    // Check the actual selected DB before launching any write requests.
    const identity = (
      await db.query(
        "SELECT current_database() AS name,(SELECT count(*)::int FROM evaluation_forms) AS forms",
      )
    ).rows[0];
    if (identity.name !== data.databaseName || identity.forms !== 30000)
      throw Error("Benchmark database identity/count mismatch");
    sampling = (async () => {
      while (active) {
        try {
          const response = await fetch(base + "/metrics", {
            headers: { Authorization: `Bearer ${metricsToken}` },
            signal: AbortSignal.timeout(3000),
          });
          if (!response.ok) throw Error("Metrics scrape failed");
          const text = await response.text();
          const connections = (
            await db.query(
              "SELECT count(*)::int AS total, count(*) FILTER (WHERE state='active' AND pid<>pg_backend_pid())::int AS active FROM pg_stat_activity WHERE datname=current_database()",
            )
          ).rows[0];
          samples.push({
            time: new Date().toISOString(),
            phase,
            cpuCores: gauge(text, "process_cpu_usage"),
            rssBytes: gauge(text, "process_memory_usage"),
            eventLoopLagSeconds: gauge(text, "event_loop_lag"),
            dbPoolTotal: gauge(text, "db_pool_total"),
            dbPoolIdle: gauge(text, "db_pool_idle"),
            dbPoolWaiting: gauge(text, "db_pool_waiting"),
            dbConnections: connections.total,
            dbActive: connections.active,
          });
        } catch {
          samples.push({
            time: new Date().toISOString(),
            phase,
            scrapeFailed: true,
          });
        }
        await wait(1000);
      }
    })();
    async function execute(test, stage, seconds) {
      phase = `${test.name}:${stage}`;
      const summaryFile = path.join(output, `${test.name}-${stage}.json`);
      const fd = fs.openSync(
        path.join(output, `${test.name}-${stage}.log`),
        "w",
        0o600,
      );
      let exit;
      try {
        exit = await command(
          k6,
          [
            "run",
            "--quiet",
            "--address",
            "127.0.0.1:0",
            path.join(__dirname, "scenarios.js"),
          ],
          {
            cwd: __dirname,
            timeout: (seconds + 90) * 1000,
            env: {
              ...process.env,
              K6_NO_USAGE_REPORT: "true",
              K6_WEB_DASHBOARD: "false",
              BASE_URL: base + "/api/v1",
              BENCH_K6_FIXTURE: k6Fixture,
              CASE: test.mode,
              VUS: String(test.vus),
              DURATION: `${seconds}s`,
              SUMMARY_FILE: summaryFile,
            },
            stdio: ["ignore", fd, fd],
          },
        );
      } finally {
        fs.closeSync(fd);
      }
      if (exit !== 0 && exit !== 99)
        throw Error(
          `k6 execution failed for ${test.name} (${exit}); inspect its private log`,
        );
      const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      if (!summary.metrics?.benchmark_requests?.values?.count)
        throw Error(`No measured requests for ${test.name}`);
      return { exit, summary };
    }
    for (const test of selected) {
      if (!active) break;
      console.log(
        JSON.stringify({
          event: "benchmark.start",
          case: test.name,
          vus: test.vus,
          warmupSeconds: warmup,
          durationSeconds: duration,
        }),
      );
      await execute(test, "warmup", warmup);
      await wait(1500);
      const startedAt = new Date().toISOString();
      const { exit, summary } = await execute(test, "measured", duration);
      const finishedAt = new Date().toISOString();
      const m = summary.metrics,
        t = (
          test.mode === "write" ? m["api_latency{kind:write}"] : m.api_latency
        ).values,
        count = m.benchmark_requests.values.count,
        window = m.benchmark_window_ms.values;
      const resource = samples.filter(
        (s) => s.phase === `${test.name}:measured` && !s.scrapeFailed,
      );
      const max = (key) =>
        resource.length ? Math.max(...resource.map((s) => s[key])) : null;
      const mean = (key) =>
        resource.length
          ? resource.reduce((n, s) => n + s[key], 0) / resource.length
          : null;
      const result = {
        case: test.name,
        vus: test.vus,
        startedAt,
        finishedAt,
        requests: count,
        activeWindowSeconds: (window.max - window.min) / 1000,
        rps: count / ((window.max - window.min) / 1000),
        p50Ms: t["p(50)"],
        p95Ms: t["p(95)"],
        p99Ms: t["p(99)"],
        errorRate: m.unexpected_errors.values.rate,
        checksRate: m.checks.values.rate,
        expectedConflicts: m.expected_conflicts?.values?.count || 0,
        concurrencyInvariantFailureRate:
          m.concurrency_invariant_failed?.values?.rate || 0,
        thresholdsPassed: exit === 0,
        resources: {
          samples: resource.length,
          cpuMeanCores: mean("cpuCores"),
          cpuMaxCores: max("cpuCores"),
          rssMaxBytes: max("rssBytes"),
          dbPoolTotalMax: max("dbPoolTotal"),
          dbPoolWaitingMax: max("dbPoolWaiting"),
          dbConnectionsMax: max("dbConnections"),
          eventLoopLagMaxSeconds: max("eventLoopLagSeconds"),
        },
        operationLatency:
          test.mode === "write"
            ? m["api_latency{kind:write}"]?.values
            : undefined,
      };
      results.push(result);
      writeJson(path.join(output, "results.json"), { metadata, results });
      writeJson(path.join(output, "resources.json"), samples);
      console.log(JSON.stringify({ event: "benchmark.result", ...result }));
      phase = "cooldown";
      await wait(2000);
    }
    writeJson(path.join(output, "results.json"), {
      metadata: {
        ...metadata,
        finishedAt: new Date().toISOString(),
        complete: results.length === selected.length,
      },
      results,
    });
    writeJson(
      path.join(__dirname, ".local/latest-result.json"),
      { output },
      true,
    );
    console.log(
      JSON.stringify({
        event: "benchmark.finished",
        output,
        cases: results.length,
      }),
    );
  } finally {
    active = false;
    await sampling;
    await db.end().catch(() => {});
    backend.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => backend.once("exit", resolve)),
      wait(3000),
    ]);
    if (backend.exitCode === null) backend.kill("SIGKILL");
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    writeJson(path.join(output, "resources.json"), samples);
  }
}
main().catch((error) => {
  console.error(
    error.message && !/postgres|password|token|@/.test(error.message)
      ? error.message
      : `Benchmark runner failed (${error.code || error.name})`,
  );
  process.exitCode = 1;
});
