const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const {
  QueueService,
} = require('../src/infrastructure/queue/queue.service.ts');
const {
  QueueCrypto,
} = require('../src/infrastructure/queue/queue-crypto.service.ts');
const {
  StudentAccountMailService,
} = require('../src/modules/mail/student-account-mail.service.ts');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(work, description, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await work();
    if (result) return result;
    await wait(50);
  }
  throw Error(`Queue test timeout: ${description}`);
}
exports.setup = async function setup(directory) {
  let held,
    releaseHeld,
    delivered = 0,
    transientAttempts = 0,
    failedAttempts = 0;
  const sockets = new Set();
  const smtp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 test.invalid SMTP fixture\r\n');
    let buffer = '',
      data = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        data = false;
        buffer = buffer.slice(end + 5);
        const accept = () => {
          delivered++;
          socket.write('250 accepted\r\n');
        };
        if (!held) {
          held = true;
          releaseHeld = accept;
          return;
        }
        accept();
      }
      while (!data && buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO/.test(line)) socket.write('250-test.invalid\r\n250 OK\r\n');
        else if (
          /^RCPT TO:.*transient@/i.test(line) &&
          transientAttempts++ === 0
        )
          socket.write('451 temporary failure\r\n');
        else if (/^RCPT TO:.*permanent@/i.test(line)) {
          failedAttempts++;
          socket.write('550 fixture rejected recipient\r\n');
        } else if (line === 'DATA') {
          data = true;
          socket.write('354 send data\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const env = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp.address().port),
    SMTP_FROM: 'queue@test.invalid',
    SMTP_STARTTLS: 'false',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASS: '',
    REPORT_EXPORT_DIR: path.join(directory, 'exports'),
    QUEUE_BACKOFF_MS: '100',
    EMAIL_WORKER_CONCURRENCY: '1',
    LOG_LEVEL: 'info',
  };
  return {
    env,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => smtp.close(resolve));
    },
    run: async ({
      a,
      b,
      adminToken,
      adminId,
      db,
      childEnv,
      instances,
      stop,
      directory,
    }) => {
      const contextId = randomUUID();
      const results = [],
        password = randomBytes(12).toString('hex');
      const project = path.join(__dirname, '..');
      const config = new ConfigService({
        ...childEnv,
        app: {
          jwtRefreshSecret: childEnv.JWT_REFRESH_SECRET,
          smtp: { host: childEnv.SMTP_HOST, from: childEnv.SMTP_FROM },
        },
      });
      const queues = new QueueService(config, new QueueCrypto(config));
      const request = async (
        base,
        route,
        { token = adminToken, method = 'GET', body, key } = {},
      ) => {
        const response = await fetch(base + route, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Request-ID': contextId,
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10000),
        });
        return { status: response.status, json: await response.json() };
      };
      async function worker() {
        const log = fs.openSync(
          path.join(directory, `worker-${instances.length}.log`),
          'w',
          0o600,
        );
        const child = fork(
          path.join(project, 'test/fixtures/queue-worker.ts'),
          [],
          {
            cwd: project,
            env: childEnv,
            execArgv: [
              '-r',
              'ts-node/register/transpile-only',
              '-r',
              'tsconfig-paths/register',
            ],
            stdio: ['ignore', log, log, 'ipc'],
          },
        );
        fs.closeSync(log);
        instances.push(child);
        const port = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error('Worker startup timeout; inspect private logs')),
            30000,
          );
          child.once('message', (message) => {
            clearTimeout(timer);
            message.ready
              ? resolve(message.port)
              : reject(Error('Worker startup failed'));
          });
          child.once('error', reject);
        });
        return { child, url: `http://127.0.0.1:${port}` };
      }
      await queues.onModuleInit();
      try {
        const account = await request(a, '/admin/students', {
          method: 'POST',
          body: {
            username: 'queued_student',
            email: 'queued@test.invalid',
            password,
            fullName: 'Nguyễn Thanh Sơn',
          },
        });
        assert.equal(account.status, 201);
        assert.equal(account.json.data.accountEmailQueued, true);
        assert.equal(account.json.data.accountEmailSent, false);
        const studentId = account.json.data.id;
        assert.equal(
          (await db.query('SELECT id FROM users WHERE id=$1', [studentId]))
            .rowCount,
          1,
        );
        assert.equal(delivered, 0);
        results.push(
          'account_db_committed_and_email_queued_without_smtp_or_worker',
        );
        const waiting = await queues.get('email').getJobs(['waiting']);
        assert.equal(waiting.length, 1);
        assert(!JSON.stringify(waiting[0].data).includes(password));
        assert(
          !JSON.stringify(waiting[0].data).includes('queued@test.invalid'),
        );
        results.push('email_payload_encrypted_in_redis');
        assert.equal(waiting[0].data.context.requestId, contextId);
        results.push('request_context_propagates_into_queue');
        const faculty = randomUUID(),
          major = randomUUID(),
          klass = randomUUID(),
          semester = randomUUID();
        await db.query('INSERT INTO faculties(id,code,name) VALUES($1,$2,$3)', [
          faculty,
          'QT',
          'Khoa kiểm thử',
        ]);
        await db.query(
          'INSERT INTO majors(id,code,name,faculty_id) VALUES($1,$2,$3,$4)',
          [major, 'QT', 'Ngành kiểm thử', faculty],
        );
        await db.query(
          'INSERT INTO classes(id,code,name,major_id,enrollment_year) VALUES($1,$2,$3,$4,2025)',
          [klass, 'QT', 'Lớp kiểm thử', major],
        );
        await db.query(
          "INSERT INTO semesters(id,year,semester,start_date,end_date) VALUES($1,2025,'1','2025-09-01','2026-01-01')",
          [semester],
        );
        await db.query(
          'INSERT INTO evaluation_forms(student_id,class_id,semester_id,updated_at) VALUES($1,$2,$3,now())',
          [studentId, klass, semester],
        );
        const exports = [];
        for (const format of ['pdf', 'xlsx', 'docx']) {
          const result = await request(a, '/reports/exports', {
            method: 'POST',
            body: { format },
            key: `report-${format}-fixture`,
          });
          assert.equal(result.status, 202);
          exports.push({ format, id: result.json.data.jobId });
          assert.equal(
            (await request(b, `/reports/exports/${result.json.data.jobId}`))
              .json.data.status,
            'pending',
          );
        }
        results.push('exports_return_202_and_pending_before_worker_starts');
        const duplicate = await request(b, '/reports/exports', {
          method: 'POST',
          body: { format: 'pdf' },
          key: 'report-pdf-fixture',
        });
        assert.equal(duplicate.json.data.jobId, exports[0].id);
        assert.equal(
          (
            await request(a, '/reports/exports', {
              method: 'POST',
              body: { format: 'docx' },
              key: 'report-pdf-fixture',
            })
          ).status,
          409,
        );
        results.push(
          'report_idempotency_key_reuses_job_and_rejects_different_intent',
        );
        assert.equal(
          (await request(a, `/reports/exports/${exports[0].id}/download`))
            .status,
          409,
        );
        results.push('pending_export_download_rejected');
        const studentLogin = await request(a, '/auth/login', {
          method: 'POST',
          body: { username: 'queued_student', password },
        });
        assert.equal(studentLogin.status, 201);
        assert.equal(
          (
            await request(a, '/reports/exports', {
              method: 'POST',
              token: studentLogin.json.data.accessToken,
              body: { format: 'pdf' },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(a, '/reports/exports', {
              method: 'POST',
              body: { format: 'csv' },
            })
          ).status,
          400,
        );
        results.push('report_request_validates_format_and_current_role');
        const otherId = randomUUID();
        await db.query(
          "INSERT INTO users(id,username,email,password_hash,role,full_name,updated_at) SELECT $1,'other_queue_admin','other@test.invalid',password_hash,'admin','Other test admin',now() FROM users WHERE id=$2",
          [otherId, adminId],
        );
        const otherToken = new JwtService({
          secret: childEnv.JWT_ACCESS_SECRET,
        }).sign({ sub: otherId, jti: randomUUID() }, { expiresIn: '15m' });
        assert.equal(
          (
            await request(b, `/reports/exports/${exports[0].id}`, {
              token: otherToken,
            })
          ).status,
          404,
        );
        results.push('other_admin_cannot_read_export_job');
        let runner = await worker();
        await until(() => held, 'SMTP entered DATA');
        const before = Date.now();
        assert.equal((await request(a, '/reports/overview')).status, 200);
        assert.equal(delivered, 0);
        assert(Date.now() - before < 1500);
        releaseHeld();
        results.push('smtp_blocked_in_worker_does_not_block_api');
        await until(
          async () =>
            (await (
              await queues.get('email').getJob(waiting[0].id)
            ).getState()) === 'completed',
          'email delivery',
        );
        const mail = new StudentAccountMailService(queues, config);
        const repeated = await mail.sendStudentAccount({
          email: 'queued@test.invalid',
          fullName: 'Nguyễn Thanh Sơn',
          username: 'queued_student',
          password,
          studentCode: 'Chưa gán',
        });
        assert.equal(repeated, waiting[0].id);
        results.push('duplicate_account_email_enqueue_reuses_business_job');
        const transient = await mail.sendStudentAccount({
          email: 'transient@test.invalid',
          username: 'retry',
          password,
          fullName: 'Retry',
          studentCode: 'T',
        });
        const failed = await mail.sendStudentAccount({
          email: 'permanent@test.invalid',
          username: 'failure',
          password,
          fullName: 'Failure',
          studentCode: 'F',
        });
        await until(
          async () =>
            (await (await queues.get('email').getJob(transient)).getState()) ===
            'completed',
          'transient retry',
        );
        assert(transientAttempts >= 2);
        results.push('email_transient_smtp_failure_retries_with_backoff');
        await until(
          async () =>
            (await (await queues.get('email').getJob(failed)).getState()) ===
            'failed',
          'bounded permanent failure',
        );
        const failureJob = await queues.get('email').getJob(failed);
        assert.equal(failureJob.attemptsMade, 4);
        assert.equal(failedAttempts, 4);
        assert.equal(failureJob.failedReason, 'email job failed');
        results.push(
          'email_retry_bounded_and_failed_job_retained_without_secrets',
        );
        for (const item of exports) {
          await until(
            async () =>
              (await request(b, `/reports/exports/${item.id}`)).json.data
                ?.status === 'completed',
            item.format + ' export',
          );
          const response = await fetch(
            `${b}/reports/exports/${item.id}/download`,
            { headers: { Authorization: `Bearer ${adminToken}` } },
          );
          assert.equal(response.status, 200);
          const buffer = Buffer.from(await response.arrayBuffer());
          assert(buffer.length > 100);
          if (item.format === 'pdf')
            assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
          else {
            const zip = new (require('pizzip'))(buffer);
            const text = zip
              .file(
                item.format === 'docx'
                  ? 'word/document.xml'
                  : 'xl/sharedStrings.xml',
              )
              .asText();
            assert(text.includes('Nguyễn Thanh Sơn'));
          }
        }
        results.push(
          'worker_generates_pdf_xlsx_docx_downloadable_from_other_api',
        );
        assert.equal(
          (
            await request(b, `/reports/exports/${exports[0].id}/download`, {
              token: otherToken,
            })
          ).status,
          404,
        );
        results.push('other_admin_cannot_download_export_file');
        const metrics = await (
          await fetch(`${runner.url}/metrics`, {
            headers: { Authorization: `Bearer ${childEnv.METRICS_TOKEN}` },
          })
        ).text();
        assert(/queue_jobs_failed\{[^}]*queue="email"[^}]*\} 1/.test(metrics));
        assert(
          metrics.includes('queue_job_duration_bucket') &&
            metrics.includes('queue="report"'),
        );
        results.push(
          'worker_metrics_show_failed_email_queue_and_report_job_duration',
        );
        await stop(runner.child);
        const later = await request(a, '/reports/exports', {
          method: 'POST',
          body: { format: 'xlsx' },
        });
        assert.equal(later.status, 202);
        runner = await worker();
        await until(
          async () =>
            (await request(b, `/reports/exports/${later.json.data.jobId}`)).json
              .data.status === 'completed',
          'worker restart queued work',
        );
        results.push('queued_export_survives_worker_stop_and_restart');
        await stop(runner.child);
        await request(a, '/auth/forgot-password', {
          method: 'POST',
          body: { identifier: 'queued_student' },
        });
        await request(a, '/auth/forgot-password', {
          method: 'POST',
          body: { identifier: 'queued_student' },
        });
        const resets = [];
        for (const job of await queues.get('email').getJobs(['waiting'])) {
          const payload = queues.crypto.open(
            job.data.encrypted,
            queues.aad('email', job.id),
          );
          if (payload.kind === 'password-reset') resets.push(job);
        }
        assert.equal(resets.length, 2);
        runner = await worker();
        await until(
          async () =>
            (
              await Promise.all(
                resets.map(
                  async (job) =>
                    await (await queues.get('email').getJob(job.id)).getState(),
                ),
              )
            ).every((state) => ['failed', 'completed'].includes(state)),
          'reset mail validation',
        );
        const resetStates = await Promise.all(
          resets.map(
            async (job) =>
              await (await queues.get('email').getJob(job.id)).getState(),
          ),
        );
        assert.deepEqual(resetStates.sort(), ['completed', 'failed']);
        results.push(
          'password_reset_worker_skips_superseded_link_and_delivers_current_link',
        );

        const expired = await queues.enqueue(
          'email',
          {
            kind: 'student',
            email: 'expire@test.invalid',
            username: 'exp',
            password,
            fullName: 'Expired',
            studentCode: 'E',
          },
          { ttl: -1 },
        );
        await until(
          async () =>
            (await (await queues.get('email').getJob(expired)).getState()) ===
            'failed',
          'expired email',
        );
        assert.equal(
          (await queues.get('email').getJob(expired)).attemptsMade,
          1,
        );
        results.push('expired_email_is_not_sent_or_retried');
        assert.equal(
          (await fetch(`${runner.url}/api/v1/auth/login`, { method: 'POST' }))
            .status,
          404,
        );
        results.push('worker_exposes_metrics_without_business_routes');
        const logs = fs
          .readdirSync(directory)
          .filter((file) => file.endsWith('.log'))
          .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
          .join('\n');
        assert(!logs.includes(password));
        assert(!logs.includes(childEnv.JWT_REFRESH_SECRET));
        results.push('queue_worker_logs_do_not_expose_credentials');
        return results;
      } finally {
        await queues.onModuleDestroy();
      }
    },
  };
};
