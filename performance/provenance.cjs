const { createHash } = require("node:crypto");
const { fs, path, project } = require("./support.cjs");
function hashFiles(base, select) {
  const hash = createHash("sha256");
  let count = 0;
  function visit(dir) {
    for (const item of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (select(file)) {
        hash.update(path.relative(base, file));
        hash.update(fs.readFileSync(file));
        count++;
      }
    }
  }
  visit(base);
  return { sha256: hash.digest("hex"), files: count };
}
function provenance() {
  return {
    capturedAt: new Date().toISOString(),
    compiledBackend: hashFiles(path.join(project, "dist"), (file) =>
      file.endsWith(".js"),
    ),
    k6Scripts: hashFiles(
      __dirname,
      (file) => path.dirname(file) === __dirname && file.endsWith(".js"),
    ),
    dependencies: Object.fromEntries(
      [
        "@nestjs/core",
        "@prisma/client",
        "@prisma/adapter-pg",
        "pg",
        "bcrypt",
        "pino",
        "@prometheus-io/client",
      ].map((name) => [
        name,
        JSON.parse(
          fs.readFileSync(
            path.join(project, "node_modules", name, "package.json"),
            "utf8",
          ),
        ).version,
      ]),
    ),
  };
}
module.exports = { provenance };
