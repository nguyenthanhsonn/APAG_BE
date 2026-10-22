const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.join(__dirname, "..");
const project = path.join(root, "projects");
const dependency = createRequire(path.join(project, "package.json"));
dependency("ts-node").register({
  transpileOnly: true,
  project: path.join(project, "tsconfig.json"),
});
dependency("dotenv").config({ path: path.join(project, ".env"), quiet: true });
const {
  resolveDatabaseUrl,
} = require("../projects/src/config/database-url.helper.ts");
function localDatabase(url) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("A PostgreSQL connection URL is required");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    throw new Error("Benchmark requires a local PostgreSQL host");
  return parsed;
}
function benchmarkDatabase(url) {
  const parsed = localDatabase(url);
  if (!/^\/apag_benchmark_[a-z0-9_]+$/.test(parsed.pathname))
    throw new Error("Refusing a non-benchmark database");
  return parsed;
}
function writeJson(file, data, privateFile = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", {
    mode: privateFile ? 0o600 : 0o644,
  });
}
function fixture() {
  const file =
    process.env.BENCH_FIXTURE || path.join(__dirname, ".local/fixture.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  benchmarkDatabase(data.databaseUrl);
  if (data.synthetic !== true)
    throw new Error("Synthetic benchmark marker required");
  return data;
}
module.exports = {
  fs,
  path,
  root,
  project,
  dependency,
  resolveDatabaseUrl,
  localDatabase,
  benchmarkDatabase,
  writeJson,
  fixture,
};
