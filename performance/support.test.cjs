const test = require("node:test");
const assert = require("node:assert/strict");
const { localDatabase, benchmarkDatabase } = require("./support.cjs");

test("benchmark connections reject application databases and remote/non-PostgreSQL URLs", () => {
  for (const url of [
    "postgresql://user:synthetic@127.0.0.1/apag",
    "postgresql://user:synthetic@127.0.0.1/postgres",
    "postgresql://user:synthetic@db.example/apag_benchmark_test",
    "https://127.0.0.1/apag_benchmark_test",
  ]) {
    assert.throws(() => benchmarkDatabase(url));
  }
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(
      benchmarkDatabase(
        `postgresql://user:synthetic@${host}/apag_benchmark_test`,
      ).pathname,
      "/apag_benchmark_test",
    );
  }
  assert.equal(
    localDatabase("postgresql://user:synthetic@localhost/apag").pathname,
    "/apag",
  );
});
