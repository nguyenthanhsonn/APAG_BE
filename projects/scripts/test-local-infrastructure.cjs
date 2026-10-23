// Real API + local SMTP, fresh disposable PostgreSQL DB; no Redis process or client.
const { fork, spawnSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
require('ts-node/register/transpile-only');
require('dotenv').config({
  path: path.join(__dirname, '../.env'),
  quiet: true,
});
const { resolveDatabaseUrl } = require('../src/config/database-url.helper.ts');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { io } = require('socket.io-client');
const project = path.join(__dirname, '..');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const databaseName = `apag_infra_rollback_test_${randomBytes(8).toString('hex')}`;
const source = new URL(resolveDatabaseUrl(process.env));
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname),
  'tests require local PostgreSQL',
);
const testUrl = new URL(source);
testUrl.pathname = `/${databaseName}`;
const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'apag-local-infra-test-'),
);
const password = randomBytes(20).toString('hex'),
  adminId = randomUUID();
const smtpConnections = new Set(),
  sockets = [];
let messages = 0,
  child,
  ownsDatabase = false,
  db;
const results = [];
const smtp = net.createServer((socket) => {
  smtpConnections.add(socket);
  socket.on('close', () => smtpConnections.delete(socket));
  socket.write('220 local.test ESMTP\r\n');
  let buffer = '',
    data = false;
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line === '.') {
          data = false;
          messages++;
          socket.write('250 accepted\r\n');
        }
        continue;
      }
      if (/^EHLO|^HELO/.test(line))
        socket.write('250-local.test\r\n250 8BITMIME\r\n');
      else if (line === 'DATA') {
        data = true;
        socket.write('354 send data\r\n');
      } else if (line === 'QUIT') {
        socket.end('221 bye\r\n');
      } else socket.write('250 OK\r\n');
    }
  });
});
function event(emitter, name, ms = 5000) {
  return new Promise((resolve, reject) => {
    const handler = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      emitter.off(name, handler);
      reject(Error(`Timeout: ${name}`));
    }, ms);
    emitter.once(name, handler);
  });
}
async function main() {
  const admin = new Client({
    connectionString: source.toString(),
    connectionTimeoutMillis: 2000,
  });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    ownsDatabase = true;
    const deployed = spawnSync('pnpm', ['db:deploy'], {
      cwd: project,
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        DIRECT_URL: testUrl.toString(),
      },
      encoding: 'utf8',
      timeout: 120000,
    });
    fs.writeFileSync(
      path.join(directory, 'migrations.log'),
      `${deployed.stdout || ''}\n${deployed.stderr || ''}`,
      { mode: 0o600 },
    );
    assert.equal(deployed.status, 0, 'test migrations');
    db = new Client({ connectionString: testUrl.toString() });
    await db.connect();
    await db.query(
      "INSERT INTO users(id,username,email,password_hash,role,full_name,updated_at) VALUES($1,'local_admin','local-admin@test.invalid',$2,'admin','Local Test Admin',now())",
      [adminId, await bcrypt.hash(password, 8)],
    );
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const log = fs.openSync(path.join(directory, 'api.log'), 'w', 0o600);
    child = fork(path.join(project, 'test/fixtures/local-instance.ts'), [], {
      cwd: project,
      execArgv: [
        '-r',
        'ts-node/register/transpile-only',
        '-r',
        'tsconfig-paths/register',
      ],
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        DIRECT_URL: testUrl.toString(),
        NODE_ENV: 'test',
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        METRICS_ENABLED: 'true',
        METRICS_TOKEN: '',
        OTEL_ENABLED: 'false',
        SWAGGER_ENABLED: 'false',
        LOG_LEVEL: 'warn',
        FRONTEND_URL: 'http://localhost:3000',
        REDIS_URL: 'redis://127.0.0.1:1',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.address().port),
        SMTP_FROM: 'sender@test.invalid',
        SMTP_SECURE: 'false',
        SMTP_STARTTLS: 'false',
        SMTP_USER: '',
        SMTP_PASS: '',
        REPORT_EXPORT_DIR: path.join(directory, 'exports'),
      },
      stdio: ['ignore', log, log, 'ipc'],
    });
    fs.closeSync(log);
    const ready = await event(child, 'message', 20000);
    assert(ready.ready);
    const base = `http://127.0.0.1:${ready.port}`;
    results.push('api_boots_without_redis');
    async function request(route, options = {}) {
      const response = await fetch(base + '/api/v1' + route, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, data: body.data ?? body };
    }
    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'local_admin', password }),
    });
    assert(login.status < 300, 'login');
    const session = login.data;
    assert(session.accessToken && session.refreshToken);
    const headers = { authorization: `Bearer ${session.accessToken}` };
    assert.equal((await request('/profile', { headers })).status, 200);
    results.push('login_profile_without_redis');
    const socket = io(base + '/notifications', {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: session.accessToken },
      autoConnect: false,
    });
    sockets.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    const denied = event(socket, 'notifications:error');
    socket.emit('notifications:join', { userId: randomUUID() });
    assert.equal((await denied).status, 403);
    results.push('jwt_socket_and_arbitrary_room_denied');
    const notification = {
      id: randomUUID(),
      userId: adminId,
      type: 'test',
      title: 'test',
      content: 'local',
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    const delivered = event(socket, 'notifications:new');
    child.send({ requestId: randomUUID(), kind: 'notification', notification });
    assert.equal((await delivered).id, notification.id);
    results.push('notification_delivered_locally');
    const invalid = io(base + '/notifications', {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: 'invalid' },
      autoConnect: false,
    });
    sockets.push(invalid);
    const invalidEvent = event(invalid, 'connect_error');
    invalid.connect();
    assert.equal((await invalidEvent).data.status, 401);
    results.push('invalid_socket_jwt_rejected');
    const staff = await request('/admin/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: 'local_staff',
        email: 'local-staff@test.invalid',
        fullName: 'Local Staff',
        password,
        role: 'training_department',
      }),
    });
    assert.equal(staff.status, 201);
    assert.equal(staff.data.accountEmailSent, true);
    assert.equal(staff.data.accountEmailQueued, false);
    assert.equal(messages, 1);
    results.push('db_commit_and_direct_smtp_delivery');
    for (const format of ['pdf', 'xlsx', 'docx']) {
      const key = `local-export-${format}`;
      const created = await request('/reports/exports', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': key },
        body: JSON.stringify({ format }),
      });
      assert.equal(created.status, 202);
      const jobId = created.data.jobId;
      const duplicate = await request('/reports/exports', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': key },
        body: JSON.stringify({ format }),
      });
      assert.equal(duplicate.data.jobId, jobId);
      const status = await request(`/reports/exports/${jobId}`, { headers });
      assert.equal(status.data.status, 'completed');
      const file = await fetch(
        `${base}/api/v1/reports/exports/${jobId}/download`,
        { headers },
      );
      assert.equal(file.status, 200);
      assert((await file.arrayBuffer()).byteLength > 100);
    }
    results.push('pdf_xlsx_docx_status_download_idempotency_without_queue');
    const refreshed = await request('/auth/refresh-token', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assert(refreshed.status < 300);
    const fresh = refreshed.data;
    const freshHeaders = { authorization: `Bearer ${fresh.accessToken}` };
    const loggedOut = await request('/auth/logout', {
      method: 'POST',
      headers: freshHeaders,
      body: JSON.stringify({ refreshToken: fresh.refreshToken }),
    });
    assert(loggedOut.status < 300);
    assert.equal(
      (await request('/profile', { headers: freshHeaders })).status,
      401,
    );
    assert.equal(
      (
        await request('/auth/refresh-token', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: fresh.refreshToken }),
        })
      ).status,
      401,
    );
    results.push('refresh_rotation_logout_revocation');
    const metrics = await fetch(base + '/metrics');
    assert.equal(metrics.status, 200);
    assert(
      /queue_enabled\{[^}]*queue="none"[^}]*\} 0/.test(await metrics.text()),
    );
    results.push('observability_kept_queue_disabled');
    console.log(
      JSON.stringify({
        event: 'local_infrastructure_checks_passed',
        checks: results.length,
        results,
      }),
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (child && child.exitCode === null) {
      child.send('stop');
      await Promise.race([event(child, 'exit').catch(() => {}), pause(6000)]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await pause(200);
      }
    }
    for (const connection of smtpConnections) connection.destroy();
    if (smtp.listening) await new Promise((resolve) => smtp.close(resolve));
    if (db) await db.end().catch(() => {});
    // Only this freshly created, randomly named test DB can be dropped.
    if (ownsDatabase)
      await admin.query(`DROP DATABASE "${databaseName}"`).catch(() => {});
    await admin.end().catch(() => {});
  }
}
main().catch((error) => {
  console.error(
    `Local infrastructure test failed (${error.code || error.name}): ${error.message}; private logs: ${directory}`,
  );
  process.exitCode = 1;
});
