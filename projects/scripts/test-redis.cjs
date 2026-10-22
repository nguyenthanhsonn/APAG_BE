// Starts two real Nest processes + an isolated durable Redis. Writes only to a NEW test database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn, spawnSync, fork } = require('node:child_process');
const project = path.join(__dirname, '..');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(project, 'tsconfig.json'),
});
require('dotenv').config({ path: path.join(project, '.env'), quiet: true });
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const {
  RedisService,
} = require('../src/infrastructure/cache/redis.service.ts');
const {
  ProfileCacheService,
} = require('../src/infrastructure/cache/profile-cache.service.ts');
const {
  ImportPreviewStore,
} = require('../src/infrastructure/cache/import-preview-store.service.ts');
const {
  AuthTokenStoreService,
} = require('../src/modules/auth/jwt/auth-token-store.ts');
const { resolveDatabaseUrl } = require('../src/config/database-url.helper.ts');
const { cacheKeys } = require('../src/infrastructure/cache/cache.keys.ts');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const instances = [];
let redisProcess;
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (child.connected) child.send('stop');
  else child.kill('SIGTERM');
  await Promise.race([exited, wait(4000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function main() {
  const base = resolveDatabaseUrl(process.env);
  if (!base) throw Error('Local DB config required');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw Error('Only local PostgreSQL allowed for the test');
  const dbName = `apag_redis_test_${randomBytes(5).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apag-redis-test-'));
  const binary =
    process.env.REDIS_SERVER_BIN ||
    path.join(project, '../.local/redis-bin/redis-server');
  assert.equal(
    spawnSync(binary, ['--version'], { encoding: 'utf8' }).status,
    0,
    'Set REDIS_SERVER_BIN to redis-server',
  );
  const port = await freePort(),
    prefix = `test:${randomBytes(8).toString('hex')}:`;
  const redisUrl = `redis://127.0.0.1:${port}`;
  const refreshSecret = randomBytes(32).toString('hex');
  const redisConfig = new ConfigService({
    REDIS_URL: redisUrl,
    REDIS_KEY_PREFIX: prefix,
    REDIS_COMMAND_TIMEOUT_MS: '500',
    app: {
      jwtRefreshSecret: refreshSecret,
      jwtAccessExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d',
    },
  });
  const admin = new Client({
    connectionString: base,
    connectionTimeoutMillis: 5000,
  });
  await admin.connect();
  let db;
  const clients = [];
  const checks = [];
  async function startRedis() {
    const log = fs.openSync(path.join(directory, 'redis.log'), 'a', 0o600);
    redisProcess = spawn(
      binary,
      [
        '--bind',
        '127.0.0.1',
        '--port',
        String(port),
        '--protected-mode',
        'yes',
        '--dir',
        directory,
        '--appendonly',
        'yes',
        '--appendfsync',
        'always',
        '--save',
        '',
        '--maxmemory-policy',
        'noeviction',
      ],
      { stdio: ['ignore', log, log] },
    );
    fs.closeSync(log);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const s = net.connect({ host: '127.0.0.1', port });
        await new Promise((resolve, reject) => {
          s.once('connect', resolve);
          s.once('error', reject);
        });
        s.destroy();
        ready = true;
        break;
      } catch {}
      await wait(50);
    }
    assert(ready, 'Redis readiness');
  }
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    REDIS_URL: redisUrl,
    REDIS_KEY_PREFIX: prefix,
    REDIS_COMMAND_TIMEOUT_MS: '500',
    OTEL_ENABLED: 'false',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: refreshSecret,
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    SWAGGER_ENABLED: 'false',
    SMTP_HOST: '',
    SMTP_FROM: '',
    SMTP_PASS: '',
    METRICS_TOKEN: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'error',
  };
  const queueTest = process.argv.includes('--queue')
    ? await require('./queue-checks.cjs').setup(directory)
    : null;
  if (queueTest) Object.assign(childEnv, queueTest.env);
  const apiProcesses = new Map();
  async function instance() {
    const file = fs.openSync(
      path.join(directory, `api-${instances.length}.log`),
      'w',
      0o600,
    );
    const child = fork(
      path.join(project, 'test/fixtures/redis-instance.ts'),
      [],
      {
        cwd: project,
        execArgv: [
          '-r',
          'ts-node/register/transpile-only',
          '-r',
          'tsconfig-paths/register',
        ],
        env: childEnv,
        stdio: ['ignore', file, file, 'ipc'],
      },
    );
    fs.closeSync(file);
    instances.push(child);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            Error(
              'API instance readiness timeout; inspect private fixture logs',
            ),
          ),
        30000,
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        reject(Error(`Test API exited before readiness (${code})`)),
      );
      child.once('message', (message) => {
        clearTimeout(timeout);
        if (!message.ready) reject(Error('Test API startup failed'));
        else {
          const baseUrl = `http://127.0.0.1:${message.port}/api/v1`;
          apiProcesses.set(baseUrl, child);
          resolve(baseUrl);
        }
      });
    });
  }
  async function request(baseUrl, route, { method = 'GET', token, body } = {}) {
    const r = await fetch(baseUrl + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
    const json = await r.json();
    return { status: r.status, data: json.data };
  }
  const syntheticPassword = randomBytes(14).toString('hex');
  async function login(consumer, username = 'redis_student') {
    return request(consumer, '/auth/login', {
      method: 'POST',
      body: { username, password: syntheticPassword },
    });
  }
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    url.pathname = `/${dbName}`;
    url.search = '?schema=public';
    childEnv.DATABASE_URL = url.toString();
    childEnv.DIRECT_URL = url.toString();
    const schema = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        '--config',
        'prisma.config.ts',
        'db',
        'push',
      ],
      { cwd: project, env: childEnv, encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(schema.status, 0, 'Isolated test schema creation');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    const hash = await require('bcrypt').hash(syntheticPassword, 10),
      studentId = randomUUID(),
      adminId = randomUUID();
    for (const [id, username, role] of [
      [studentId, 'redis_student', 'student'],
      [adminId, 'redis_admin', 'admin'],
    ])
      await db.query(
        'INSERT INTO users(id,username,email,password_hash,role,full_name,updated_at) VALUES($1,$2,$3,$4,$5,$6,now())',
        [
          id,
          username,
          `${username}@benchmark.invalid`,
          hash,
          role,
          'Redis Test User',
        ],
      );
    await startRedis();
    const redisA = new RedisService(redisConfig),
      redisB = new RedisService(redisConfig);
    clients.push(redisA, redisB);
    await Promise.all(clients.map((c) => c.onModuleInit()));
    let [a, b] = await Promise.all([instance(), instance()]);
    const rotateSession = await login(b);
    assert.equal(rotateSession.status, 201);
    const refreshRace = await Promise.all([
      request(a, '/auth/refresh-token', {
        method: 'POST',
        body: { refreshToken: rotateSession.data.refreshToken },
      }),
      request(b, '/auth/refresh-token', {
        method: 'POST',
        body: { refreshToken: rotateSession.data.refreshToken },
      }),
    ]);
    assert.deepEqual(refreshRace.map((r) => r.status).sort(), [201, 401]);
    const refreshWinner = refreshRace.find((r) => r.status === 201);
    assert.notEqual(
      refreshWinner.data.refreshToken,
      rotateSession.data.refreshToken,
    );
    assert.equal(
      (
        await request(a, '/auth/refresh-token', {
          method: 'POST',
          body: { refreshToken: rotateSession.data.refreshToken },
        })
      ).status,
      401,
    );
    checks.push('refresh_rotation_has_one_winner_across_processes');
    const logged = await login(b);
    assert.equal(logged.status, 201);
    const access = logged.data.accessToken;
    assert.equal((await request(a, '/auth/me', { token: access })).status, 200);
    assert.equal(
      (
        await request(a, '/auth/logout', {
          method: 'POST',
          token: access,
          body: { refreshToken: logged.data.refreshToken },
        })
      ).status,
      201,
    );
    assert.equal((await request(b, '/auth/me', { token: access })).status, 401);
    assert.equal(
      (
        await request(b, '/auth/refresh-token', {
          method: 'POST',
          body: { refreshToken: logged.data.refreshToken },
        })
      ).status,
      401,
    );
    checks.push('logout_a_rejected_b_including_refresh');
    const tokenPayload = JSON.parse(
      Buffer.from(access.split('.')[1], 'base64url').toString(),
    );
    const revocationTtl = await redisA.command([
      'TTL',
      redisA.key(cacheKeys.revokedToken(tokenPayload.jti)),
    ]);
    assert(revocationTtl > 0 && revocationTtl <= 900);
    checks.push('revoked_jti_ttl_matches_expiry');
    await stop(instances[0]);
    a = await instance();
    assert.equal((await request(a, '/auth/me', { token: access })).status, 401);
    assert.equal((await request(b, '/auth/me', { token: access })).status, 401);
    checks.push('revocation_survives_api_restart');
    const session = await login(b),
      adminSession = await login(a, 'redis_admin');
    assert.equal(session.status, 201);
    assert.equal(adminSession.status, 201);
    const token = session.data.accessToken,
      adminToken = adminSession.data.accessToken;
    await request(b, '/auth/me', { token });
    await request(b, '/profile', { token });
    assert(await redisA.get(cacheKeys.profile(studentId)));
    const edited = await request(a, `/admin/students/${studentId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { fullName: 'Redis Updated Across Instances', phone: '0900000001' },
    });
    assert.equal(edited.status, 200);
    assert.equal(await redisB.get(cacheKeys.profile(studentId)), null);
    assert.equal(
      (await request(b, '/auth/me', { token })).data.fullName,
      'Redis Updated Across Instances',
    );
    assert.equal(
      (await request(b, '/profile', { token })).data.phone,
      '0900000001',
    );
    checks.push('profile_update_invalidates_all_projections_across_processes');
    const lockRoute = `/admin/users/${studentId}/lock`;
    assert.equal(
      (
        await request(a, lockRoute, {
          method: 'PATCH',
          token: adminToken,
          body: { locked: true },
        })
      ).status,
      200,
    );
    assert.equal((await request(b, '/auth/me', { token })).status, 401);
    assert.equal(
      (
        await request(a, lockRoute, {
          method: 'PATCH',
          token: adminToken,
          body: { locked: false },
        })
      ).status,
      200,
    );
    assert.equal((await request(b, '/auth/me', { token })).status, 401);
    checks.push('unlock_does_not_resurrect_revoked_tokens');
    const newSession = await login(b);
    assert.equal(newSession.status, 201);
    assert.equal(
      (await request(a, '/auth/me', { token: newSession.data.accessToken }))
        .status,
      200,
    );
    const tokens = new AuthTokenStoreService(redisA, redisConfig);
    const beforeStamp = await tokens.getRevocationStamp(studentId);
    await tokens.revokeUserTokensIssuedBefore(studentId);
    const afterStamp = await tokens.getRevocationStamp(studentId);
    assert(Number(afterStamp) > Number(beforeStamp));
    assert.equal(
      (await request(b, '/auth/me', { token: newSession.data.accessToken }))
        .status,
      401,
    );
    checks.push('monotonic_user_revocation_and_fresh_login');
    const userTtl = await redisA.command([
      'TTL',
      redisA.key(cacheKeys.userRevokedAfter(studentId)),
    ]);
    assert(userTtl >= 604790 && userTtl <= 604802);
    const profilesA = new ProfileCacheService(redisA),
      profilesB = new ProfileCacheService(redisB);
    let release;
    let started;
    const signal = new Promise((r) => (started = r)),
      barrier = new Promise((r) => (release = r)),
      profileUser = randomUUID();
    const stale = profilesA.getOrLoad(profileUser, 'auth', async () => {
      started();
      await barrier;
      return { name: 'OLD' };
    });
    await signal;
    await profilesB.invalidate(profileUser);
    release();
    await stale;
    assert.equal(await redisA.get(cacheKeys.profile(profileUser)), null);
    assert.deepEqual(
      await profilesB.getOrLoad(profileUser, 'auth', async () => ({
        name: 'NEW',
      })),
      { name: 'NEW' },
    );
    assert.deepEqual(
      await profilesA.getOrLoad(profileUser, 'auth', async () => {
        throw Error('Should hit shared cache');
      }),
      { name: 'NEW' },
    );
    checks.push('profile_cache_shared_and_stale_refill_fenced');
    const profileTtl = await redisA.command([
      'TTL',
      redisA.key(cacheKeys.profile(profileUser)),
    ]);
    assert(profileTtl > 0 && profileTtl <= 30);
    const importsA = new ImportPreviewStore(redisA, redisConfig),
      importsB = new ImportPreviewStore(redisB, redisConfig),
      importKey = cacheKeys.studentImport(randomUUID());
    await importsA.set(importKey, {
      password: 'SYNTHETIC_PREVIEW_PASSWORD_CANARY',
      rows: 1,
    });
    assert(
      !(await redisA.get(importKey)).includes(
        'SYNTHETIC_PREVIEW_PASSWORD_CANARY',
      ),
    );
    const claims = await Promise.all([
      importsA.get(importKey, true),
      importsB.get(importKey, true),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    checks.push('import_preview_encrypted_and_single_claim_across_clients');
    await tokens.revokeToken('short-ttl-test', Date.now() / 1000 + 1);
    await wait(1100);
    assert.equal(
      await redisB.get(cacheKeys.revokedToken('short-ttl-test')),
      null,
    );
    checks.push('expired_revocation_removed');
    await stop(redisProcess);
    assert.equal(
      (await request(b, '/auth/me', { token: adminToken })).status,
      503,
    );
    assert.equal((await login(a, 'redis_admin')).status, 503);
    checks.push('redis_outage_fails_closed_without_ram_fallback');
    await startRedis();
    let recovered = false;
    for (let i = 0; i < 80; i++) {
      try {
        if (
          (await request(b, '/auth/me', { token: adminToken })).status === 200
        ) {
          recovered = true;
          break;
        }
      } catch {}
      await wait(100);
    }
    assert(recovered, 'Redis reconnection');
    assert.equal((await request(b, '/auth/me', { token: access })).status, 401);
    assert.equal(
      (await request(b, '/auth/me', { token: newSession.data.accessToken }))
        .status,
      401,
    );
    checks.push('revocations_survive_redis_restart_aof');
    const realtimeSession = await login(b);
    checks.push(
      ...(await require('./realtime-checks.cjs')({
        a,
        b,
        token: realtimeSession.data.accessToken,
        adminToken,
        revokedToken: access,
        studentId,
        adminId,
        secret: childEnv.JWT_ACCESS_SECRET,
        emit: (baseUrl, notification, kind = 'notification') =>
          new Promise((resolve, reject) => {
            const child = apiProcesses.get(baseUrl);
            const requestId = randomUUID();
            const listener = (message) => {
              if (message.requestId !== requestId) return;
              clearTimeout(timer);
              child.off('message', listener);
              if (message.failed) reject(Error('Fixture IPC failed'));
              else resolve();
            };
            const timer = setTimeout(() => {
              child.off('message', listener);
              reject(Error('Fixture IPC timeout'));
            }, 5000);
            child.on('message', listener);
            child.send({ requestId, notification, kind });
          }),
      })),
    );
    const finalSession = await login(b);
    assert.equal(finalSession.status, 201);
    await request(b, '/auth/me', { token: finalSession.data.accessToken });
    assert.equal(
      (
        await request(a, `/admin/students/${studentId}`, {
          method: 'DELETE',
          token: adminToken,
        })
      ).status,
      200,
    );
    assert.equal(await redisA.get(cacheKeys.profile(studentId)), null);
    assert.equal(
      (await request(b, '/auth/me', { token: finalSession.data.accessToken }))
        .status,
      401,
    );
    checks.push('delete_invalidates_profile_and_revokes_other_instance');
    if (queueTest)
      checks.push(
        ...(await queueTest.run({
          a,
          b,
          adminToken,
          adminId,
          db,
          childEnv,
          instances,
          stop,
          directory,
        })),
      );
    const privateLogs = fs
      .readdirSync(directory)
      .filter((f) => f.endsWith('.log'))
      .map((f) => fs.readFileSync(path.join(directory, f), 'utf8'))
      .join('\n');
    for (const value of [
      syntheticPassword,
      refreshSecret,
      access,
      logged.data.refreshToken,
    ])
      assert(!privateLogs.includes(value), 'Secret leaked in log');
    console.log(
      JSON.stringify({
        event: 'redis.stateless_checks_passed',
        processes: 2,
        checks: checks.length,
        results: checks,
        privateLogDirectory: directory,
      }),
    );
  } finally {
    await Promise.all(instances.map(stop));
    await queueTest?.close();
    for (const client of clients) client.onModuleDestroy();
    await stop(redisProcess);
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Redis integration failed (${error.code || error.name}); inspect the test's private logs`,
  );
  process.exitCode = 1;
});
