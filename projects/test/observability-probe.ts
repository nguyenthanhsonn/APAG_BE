// Isolated process: tracing must initialize before any Nest, HTTP, pg or generated Prisma import.
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { INestApplication } from '@nestjs/common';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

async function run() {
  const originalEnabled = process.env.OTEL_ENABLED;
  process.env.OTEL_ENABLED = 'false';
  const { initializeTelemetry, shutdownTelemetry } =
    await import('../src/observability/initialize');
  const spans: ReadableSpan[] = [];
  const exporter: SpanExporter = {
    export(batch, done) {
      spans.push(...batch);
      done({ code: 0 });
    },
    shutdown: () => Promise.resolve(),
  };
  initializeTelemetry(exporter);
  process.env.OTEL_ENABLED = 'true';
  process.env.DB_SLOW_QUERY_MS = '20';
  process.env.METRICS_TOKEN =
    'observability-probe-token-not-a-production-secret';
  const [
    { NestFactory },
    nest,
    { ConfigService },
    { PrismaService },
    { resolveDatabaseUrl },
    { ObservabilityModule },
    { StructuredLogger },
    { RequestTelemetryMiddleware },
    { TelemetryContextInterceptor },
    { MetricsController },
    { ResponseInterceptor },
    { HttpExceptionFilter },
    api,
    http,
    net,
    { getMetrics },
    { requestContext, captureJobContext },
    { observeJob },
    { StudentAccountMailService },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@nestjs/common'),
    import('@nestjs/config'),
    import('../src/database/prisma.service'),
    import('../src/config/database-url.helper'),
    import('../src/observability/observability.module'),
    import('../src/observability/structured-logger'),
    import('../src/observability/request-telemetry.middleware'),
    import('../src/observability/telemetry-context.interceptor'),
    import('../src/observability/metrics.controller'),
    import('../src/common/interceptors/response.interceptor'),
    import('../src/common/filters/http-exception.filter'),
    import('@opentelemetry/api'),
    import('node:http'),
    import('node:net'),
    import('../src/observability/metrics'),
    import('../src/observability/request-context'),
    import('../src/observability/job-observability'),
    import('../src/modules/mail/student-account-mail.service'),
  ]);
  void MetricsController;
  const url = process.env.TEST_DATABASE_URL || resolveDatabaseUrl(process.env);
  assert(
    url,
    'Configure TEST_DATABASE_URL or the local database before running observability probe',
  );
  const prisma = new PrismaService(
    new ConfigService({ app: { databaseUrl: url, connectOnInit: true } }),
  );
  let app: INestApplication | undefined;
  const requestId = randomUUID();
  const correlationId = randomUUID();
  let dependencyRequestId: string | undefined;
  let dependencyTraceparent: string | undefined;
  const dependency = http.createServer((req, res) => {
    dependencyRequestId = req.headers['x-request-id'] as string;
    dependencyTraceparent = req.headers.traceparent;
    setTimeout(() => res.end('ok'), 25);
  });
  // SMTP sink only accepts/discards data on loopback. It never delivers email to another person/service.
  const smtp = net.createServer((socket) => {
    socket.write('220 probe.test ready\r\n');
    let buffer = '',
      data = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end >= 0) {
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 queued locally\r\n');
        } else return;
      }
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith('EHLO')) socket.write('250 probe.test\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 send data\r\n');
          break;
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await Promise.all([
    new Promise<void>((resolve) => dependency.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve)),
  ]);
  const depPort = (dependency.address() as import('node:net').AddressInfo).port;
  const smtpPort = (smtp.address() as import('node:net').AddressInfo).port;
  const { SmtpMailService } =
    await import('../src/modules/mail/smtp-mail.service');
  const mail = new StudentAccountMailService(
    new SmtpMailService(
      new ConfigService({
        app: {
          smtp: {
            host: '127.0.0.1',
            port: smtpPort,
            secure: false,
            startTls: false,
            from: 'sender@example.test',
            fromName: 'Probe',
            clientName: 'localhost',
            portalUrl: 'http://example.test/login',
          },
        },
      }),
    ),
  );
  @nest.Controller('probe')
  class ProbeController {
    @nest.Get('work')
    async work() {
      return api.trace
        .getTracer('apag.probe')
        .startActiveSpan('application.probe', async (span) => {
          try {
            await prisma.user.count(); // A genuine Prisma model operation, read-only.
            await prisma.$queryRawUnsafe(
              'SELECT $1::text AS secret FROM pg_sleep(0.04)',
              'PARAMETER_CANARY',
            );
            await prisma.$queryRawUnsafe("SELECT 'SQL_LITERAL_CANARY'::text");
            await fetch(
              `http://127.0.0.1:${depPort}/external?refreshToken=URL_CANARY`,
              { headers: { authorization: 'Bearer JWT_CANARY' } },
            );
            await mail.sendStaffAccount({
              email: 'recipient@example.test',
              fullName: 'Probe',
              username: 'probe',
              password: 'MAIL_PASSWORD_CANARY',
              roleLabel: 'Test',
            });
            const carrier = captureJobContext();
            await observeJob('probe', carrier, async () => {
              assert.equal(requestContext.getStore()?.requestId, requestId);
              await new Promise((resolve) => setTimeout(resolve, 2));
            });
            return { requestId: requestContext.getStore()?.requestId };
          } finally {
            span.end();
          }
        });
    }
    @nest.Get('failure')
    failure() {
      throw new Error('PASSWORD_AND_SQL_ERROR_CANARY');
    }
  }
  @nest.Module({
    imports: [ObservabilityModule],
    controllers: [ProbeController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  })
  class ProbeModule {}
  try {
    app = await NestFactory.create(ProbeModule, { bufferLogs: true });
    app.useLogger(app.get(StructuredLogger));
    const middleware = app.get(RequestTelemetryMiddleware);
    app.use(middleware.use.bind(middleware));
    app.setGlobalPrefix('api/v1', {
      exclude: [{ path: 'metrics', method: nest.RequestMethod.GET }],
    });
    app.useGlobalInterceptors(
      app.get(TelemetryContextInterceptor),
      new ResponseInterceptor(),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as import('node:http').Server
    ).address() as import('node:net').AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(
      `${base}/api/v1/probe/work?password=REQUEST_QUERY_CANARY`,
      {
        headers: {
          'x-request-id': requestId,
          'x-correlation-id': correlationId,
          authorization: 'Bearer JWT_INCOMING_CANARY',
        },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), requestId);
    assert.equal(dependencyRequestId, requestId);
    assert(dependencyTraceparent?.match(/^00-[a-f\d]{32}-[a-f\d]{16}-01$/));
    assert.equal((await fetch(`${base}/api/v1/probe/failure`)).status, 500);
    assert.equal((await fetch(`${base}/metrics`)).status, 403);
    const metricsResponse = await fetch(`${base}/metrics`, {
      headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` },
    });
    const metrics = await metricsResponse.text();
    assert(
      metricsResponse.headers.get('content-type')?.includes('openmetrics'),
    );
    assert(metrics.includes('db_pool_total'));
    assert(metrics.includes('db_pool_idle'));
    assert(metrics.includes('db_pool_waiting'));
    assert(metrics.match(/db_slow_queries_total\{[^\n]+\} [1-9]/));
    assert(metrics.includes('traceId="'));
    assert(!metrics.includes('CANARY'));
    await app.close();
    app = undefined; // flushes batched spans via lifecycle hook
    const scopes = new Set(spans.map((span) => span.instrumentationScope.name));
    for (const part of [
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-nestjs-core',
      'prisma',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-undici',
      'apag.smtp',
      'apag.jobs',
    ]) {
      assert(
        [...scopes].some((scope) => scope.includes(part)),
        `Missing trace scope: ${part}; got ${[...scopes].join(',')}`,
      );
    }
    const application = spans.find((span) => span.name === 'application.probe');
    assert(application);
    const spanById = new Map(
      spans.map((span) => [span.spanContext().spanId, span]),
    );
    const ancestors = (span: ReadableSpan) => {
      const result: ReadableSpan[] = [];
      let parentId = span.parentSpanContext?.spanId;
      while (parentId && spanById.has(parentId)) {
        const parent = spanById.get(parentId)!;
        result.push(parent);
        parentId = parent.parentSpanContext?.spanId;
      }
      return result;
    };
    const pgQueries = spans.filter((span) =>
      span.name.startsWith('PostgreSQL'),
    );
    assert(pgQueries.length >= 3);
    assert(
      pgQueries.some((span) =>
        ancestors(span).some((parent) => parent.name === 'application.probe'),
      ),
      'DB spans must be children of the HTTP application trace',
    );
    assert(
      spans.some(
        (span) =>
          span.name === 'queue.process' &&
          ancestors(span).some((parent) => parent.name === 'application.probe'),
      ),
      'Queue context must preserve causal parent',
    );
    assert(
      !JSON.stringify(spans).includes('CANARY'),
      'No request/query/password/error canary may leave the span exporter',
    );
    process.stdout.write(
      `OBSERVABILITY_PROBE_OK ${JSON.stringify({ spans: spans.length, scopes: [...scopes], querySpans: pgQueries.length, requestId, metricsVerified: true })}\n`,
    );
  } finally {
    if (app) await app.close();
    await shutdownTelemetry();
    getMetrics().destroy();
    await Promise.all([
      new Promise<void>((resolve) => dependency.close(() => resolve())),
      new Promise<void>((resolve) => smtp.close(() => resolve())),
    ]);
    if (originalEnabled === undefined) delete process.env.OTEL_ENABLED;
    else process.env.OTEL_ENABLED = originalEnabled;
  }
}
void run().catch((error: unknown) => {
  // Do not print raw DB/SMTP errors or canaries even if the probe fails.
  const assertion =
    error instanceof assert.AssertionError
      ? error.message
      : error instanceof Error
        ? error.name
        : 'Unknown error';
  process.stderr.write(`OBSERVABILITY_PROBE_FAILED ${assertion}\n`);
  process.exitCode = 1;
});
