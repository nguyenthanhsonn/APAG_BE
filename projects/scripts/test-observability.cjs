const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: 60000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run([
  require.resolve('jest/bin/jest'),
  '--config',
  './test/jest-e2e.json',
  '--runInBand',
  'request-observability.e2e-spec.ts',
]);
run([
  '-r',
  'ts-node/register/transpile-only',
  '-r',
  'tsconfig-paths/register',
  'test/observability-probe.ts',
]);
