const { spawnSync } = require('node:child_process');
const { dirname, resolve } = require('node:path');
const { config } = require('dotenv');

const projectDir = resolve(__dirname, '..');

const operation = process.argv[2];
if (operation !== 'status' && operation !== 'deploy') {
  console.error('Usage: pnpm db:render:status or pnpm db:render:deploy');
  process.exit(1);
}

const localEnv = {};
config({ path: resolve(projectDir, '.env'), processEnv: localEnv, quiet: true });
const renderUrl = process.env.RENDER_DATABASE_URL ?? localEnv.RENDER_DATABASE_URL;
const databaseUrl = URL.parse(renderUrl?.trim() ?? '');
if (
  !databaseUrl ||
  !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
  !databaseUrl.hostname.endsWith('.render.com') ||
  !databaseUrl.username ||
  databaseUrl.pathname.length < 2
) {
  console.error('Set RENDER_DATABASE_URL in projects/.env to the External Database URL from Render.');
  process.exit(1);
}

if (!databaseUrl.searchParams.has('sslmode')) {
  databaseUrl.searchParams.set('sslmode', 'require');
}

const prismaManifest = require.resolve('prisma/package.json');
const prismaCli = resolve(dirname(prismaManifest), require(prismaManifest).bin.prisma);
const result = spawnSync(
  process.execPath,
  [prismaCli, '--config', 'prisma.config.ts', 'migrate', operation],
  {
    cwd: projectDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.href,
      DIRECT_URL: databaseUrl.href,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Could not start Prisma (${result.error.code ?? 'unknown error'}).`);
}
process.exitCode = result.status ?? 1;
