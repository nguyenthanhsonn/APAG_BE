// Deploy measured index migrations ONLY to the guarded benchmark clone.
const { spawnSync } = require('node:child_process');
const { data, output } = require('./measure.cjs');
const { fs, path, project, writeJson } = require('../support.cjs');
const before = require(path.join(output, 'before.json'));
const experiments = require(path.join(output, 'index-experiments.json'));
for (const [candidate, test] of [['ordered_semester_listing','evaluations_semester'],['ordered_user_timeline','students_listing']]) {
  const prior = before.cases.find(c => c.name === test).statements[0].executionMs.median;
  const measured = experiments.results.find(r => r.name === candidate).cases.find(c => c.name === test).statements[0].executionMs.median;
  if (measured >= prior * .8) throw Error(`No measured justification for ${candidate}`);
}
const result = spawnSync('pnpm', ['db:deploy'], {
  cwd: project,
  env: { ...process.env, DATABASE_URL: data.databaseUrl, DIRECT_URL: data.databaseUrl },
  encoding: 'utf8', timeout: 120000,
});
fs.writeFileSync(path.join(__dirname, '../.local/dbperf-migrations.log'), `${result.stdout || ''}\n${result.stderr || ''}`, {mode:0o600});
if (result.status !== 0) throw Error('Benchmark migration failed: inspect private .local/dbperf-migrations.log');
writeJson(path.join(output, 'migration-validation.json'), { synthetic: true, databaseName: data.databaseName, successful: true, migrations: ['20261021010000_add_evaluation_listing_index','20261021020000_add_user_listing_index'], execution: 'Prisma migrate deploy; separate concurrent statements' });
console.log('Measured index migrations applied successfully to benchmark clone only');
