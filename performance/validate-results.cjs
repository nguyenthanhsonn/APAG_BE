const assert = require("node:assert/strict");
const { fs, path } = require("./support.cjs");
const output =
  process.argv[2] ||
  JSON.parse(
    fs.readFileSync(path.join(__dirname, ".local/latest-result.json"), "utf8"),
  ).output;
const data = JSON.parse(
  fs.readFileSync(path.join(output, "results.json"), "utf8"),
);
assert.equal(data.metadata.complete, true, "Run must complete");
assert.equal(
  new Set(data.results.map((r) => r.case)).size,
  data.results.length,
  "Case names must be unique",
);
const samples = JSON.parse(
  fs.readFileSync(path.join(output, "resources.json"), "utf8"),
);
for (const result of data.results) {
  const summary = JSON.parse(
    fs.readFileSync(path.join(output, `${result.case}-measured.json`), "utf8"),
  );
  assert.equal(
    summary.metrics.benchmark_requests.values.count,
    result.requests,
    result.case,
  );
  assert.equal(
    summary.metrics.api_latency.values.count,
    result.requests,
    result.case,
  );
  assert(Number.isFinite(result.rps) && result.rps > 0, result.case);
  assert(
    result.p50Ms <= result.p95Ms && result.p95Ms <= result.p99Ms,
    result.case,
  );
  assert(result.errorRate >= 0 && result.errorRate <= 1, result.case);
  const resource = samples.filter(
    (s) => s.phase === `${result.case}:measured` && !s.scrapeFailed,
  );
  assert.equal(resource.length, result.resources.samples, result.case);
  assert(
    resource.length >= Math.floor(data.metadata.settings.durationSeconds / 2),
    `Insufficient resource samples: ${result.case}`,
  );
  for (const sample of resource)
    for (const key of [
      "cpuCores",
      "rssBytes",
      "eventLoopLagSeconds",
      "dbPoolTotal",
      "dbPoolIdle",
      "dbPoolWaiting",
      "dbConnections",
      "dbActive",
    ])
      assert(
        Number.isFinite(sample[key]) && sample[key] >= 0,
        `${result.case}/${key}`,
      );
  if (result.case === "conflict") {
    assert.equal(
      result.expectedConflicts,
      result.requests / 4,
      "One expected 409 per race iteration",
    );
    assert.equal(result.concurrencyInvariantFailureRate, 0, "No lost update");
  }
  if (result.case === "write")
    assert.equal(
      summary.metrics["api_latency{kind:write}"].values.count,
      result.requests / 2,
      "PATCH latency excludes GET",
    );
}
assert(/^apag_benchmark_[a-z0-9_]+$/.test(data.metadata.databaseName));
const archivedFixture = path.join(
  __dirname,
  ".local",
  `${data.metadata.databaseName}.json`,
);
const secrets = JSON.parse(
  fs.readFileSync(
    fs.existsSync(archivedFixture)
      ? archivedFixture
      : path.join(__dirname, ".local/fixture.json"),
    "utf8",
  ),
);
assert.equal(
  secrets.databaseName,
  data.metadata.databaseName,
  "Matching private fixture required for privacy validation",
);
for (const file of fs
  .readdirSync(output)
  .filter((name) => name.endsWith(".json"))) {
  const raw = fs.readFileSync(path.join(output, file), "utf8");
  assert(
    !raw.includes(secrets.password) && !raw.includes(secrets.databaseUrl),
    `Secret leaked in ${file}`,
  );
  assert(
    !/postgres(?:ql)?:\/\//i.test(raw),
    `Connection URL leaked in ${file}`,
  );
}
console.log(
  JSON.stringify({
    event: "benchmark.results_validated",
    cases: data.results.length,
    samples: samples.length,
    privacy: true,
  }),
);
