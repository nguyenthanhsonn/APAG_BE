const { spawnSync } = require('node:child_process');
const path = require('node:path');
require('ts-node/register/transpile-only');
require('dotenv').config({
  path: path.join(__dirname, '../.env'),
  quiet: true,
});
const { resolveDatabaseUrl } = require('../src/config/database-url.helper');
const databaseUrl =
  process.env.TEST_DATABASE_URL || resolveDatabaseUrl(process.env);
if (!databaseUrl)
  throw new Error('Set TEST_DATABASE_URL or configure the local database');
const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    '--config',
    './test/jest-e2e.json',
    '--runInBand',
    process.argv[2] || 'evaluation-concurrency.e2e-spec.ts',
  ],
  {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
