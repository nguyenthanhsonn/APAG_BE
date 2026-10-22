// Clone only the explicitly marked synthetic database; never mutate application records.
const { randomBytes } = require('node:crypto');
const { fixture, dependency, path, writeJson, localDatabase, resolveDatabaseUrl } = require('../support.cjs');
const { Client } = dependency('pg');
async function main() {
  const source = fixture();
  const databaseName = `apag_benchmark_dbperf_${Date.now()}_${randomBytes(2).toString('hex')}`;
  const admin = new Client({ connectionString: resolveDatabaseUrl(process.env), connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    const active = (await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [source.databaseName])).rows[0].n;
    if (active) throw Error('Source benchmark DB is in use; do not terminate other sessions');
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE "${source.databaseName}"`);
  } finally { await admin.end(); }
  const url = localDatabase(source.databaseUrl); url.pathname = `/${databaseName}`;
  // Recreate a pre-tuning baseline even when the source was seeded with current migrations.
  // These two non-unique indexes and their migration records are reset only in this NEW clone.
  const clone = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  await clone.connect();
  try {
    await clone.query('BEGIN');
    await clone.query('DROP INDEX IF EXISTS evaluation_forms_semester_listing_idx');
    await clone.query('DROP INDEX IF EXISTS users_created_at_id_idx');
    await clone.query('DELETE FROM _prisma_migrations WHERE migration_name = ANY($1::text[])', [[
      '20261021010000_add_evaluation_listing_index', '20261021020000_add_user_listing_index',
    ]]);
    await clone.query('COMMIT');
  } catch (error) { await clone.query('ROLLBACK'); throw error; } finally { await clone.end(); }
  const data = { ...source, databaseName, databaseUrl: url.toString(), sourceDatabase: source.databaseName, performanceIndexesResetInClone: true };
  writeJson(process.env.DBPERF_FIXTURE || path.join(__dirname, '../.local/dbperf-fixture.json'), data, true);
  console.log(JSON.stringify({ event: 'dbperf.clone_created', databaseName, sourceDatabase: source.databaseName }));
}
main().catch((error) => { console.error(`DB perf setup failed (${error.code || error.name}): ${error.message.includes('benchmark') ? error.message : 'inspect local configuration'}`); process.exitCode = 1; });
