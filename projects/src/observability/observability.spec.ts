import { Writable } from 'node:stream';
import { createStructuredLogger } from './structured-logger';
import { safeSpan } from './safe-span-exporter';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { TelemetryMetrics } from './metrics';
import {
  correlationContext,
  requestContext,
  captureJobContext,
} from './request-context';
import { canScrapeMetrics } from './metrics.controller';
import type { Request } from 'express';
import { databaseOperation } from './database-observer';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
describe('observability security and metrics', () => {
  const previousToken = process.env.METRICS_TOKEN;
  afterEach(() => {
    if (previousToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previousToken;
  });
  it('preserves validated IDs and rejects unbounded or secret-looking request headers', () => {
    expect(correlationContext(idA, idB)).toEqual({
      requestId: idA,
      correlationId: idB,
    });
    const invalid = correlationContext(
      'Bearer secret.jwt.token',
      'x'.repeat(1000),
    );
    expect(invalid.requestId).toMatch(/^[a-f\d-]{36}$/);
    expect(invalid.correlationId).toBe(invalid.requestId);
  });
  it('isolates overlapping async request contexts and carries only safe metadata to jobs', async () => {
    await Promise.all(
      [idA, idB].map((requestId) =>
        requestContext.run(
          {
            requestId,
            correlationId: requestId,
            userId: 'private-user',
            role: 'student',
          },
          async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, requestId === idA ? 5 : 1),
            );
            expect(requestContext.getStore()?.requestId).toBe(requestId);
            expect(captureJobContext()).toMatchObject({ requestId });
            expect(captureJobContext()).not.toHaveProperty('userId');
          },
        ),
      ),
    );
  });
  it('redacts nested secrets, bearer/JWT, query/header/body objects and error messages before JSON output', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createStructuredLogger(sink);
    requestContext.run({ requestId: idA, correlationId: idA }, () =>
      logger.info(
        {
          password: 'PASS_CANARY',
          nested: { refreshToken: 'REFRESH_CANARY', SMTP_PASS: 'SMTP_CANARY' },
          body: { arbitrary: 'BODY_CANARY' },
          error: new Error('DRIVER_CANARY'),
          headers: { authorization: 'AUTH_CANARY' },
        },
        'operation',
      ),
    );
    logger.warn(
      'Bearer BEARER_CANARY eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoxfQ.signature password=TEXT_CANARY postgresql://app:URL_CANARY@db/test redis://app:REDIS_URL_CANARY@redis:6379',
    );
    const output = lines.join('');
    for (const secret of [
      'PASS_CANARY',
      'REFRESH_CANARY',
      'SMTP_CANARY',
      'BODY_CANARY',
      'DRIVER_CANARY',
      'AUTH_CANARY',
      'BEARER_CANARY',
      'TEXT_CANARY',
      'URL_CANARY',
      'REDIS_URL_CANARY',
      'eyJhbGci',
    ])
      expect(output).not.toContain(secret);
    expect(JSON.parse(lines[0]!).requestId).toBe(idA);
  });
  it('exports only safe span attributes, omitting SQL/parameters/URLs/error messages', () => {
    const span = {
      name: 'pg.query:SELECT',
      instrumentationScope: { name: '@opentelemetry/instrumentation-pg' },
      attributes: {
        'db.statement': "SELECT 'SQL_CANARY'",
        'db.operation.name': 'SELECT',
        'db.parameters': ['PARAM_CANARY'],
        'url.full': 'https://example.test/?token=URL_CANARY',
      },
      status: { code: 2, message: 'ERROR_CANARY' },
      events: [
        {
          name: 'exception',
          attributes: { 'exception.message': 'EXCEPTION_CANARY' },
        },
      ],
      links: [],
      spanContext: () => ({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
      }),
    } as unknown as ReadableSpan;
    const result = safeSpan(span);
    expect(result.name).toBe('PostgreSQL SELECT');
    expect(result.attributes).toEqual({ 'db.operation.name': 'SELECT' });
    expect(JSON.stringify(result)).not.toMatch(/CANARY/);
  });
  it('requires a dedicated bearer for remote metrics and never trusts forwarded client IPs', () => {
    const request = (address: string, authorization?: string) =>
      ({
        socket: { remoteAddress: address },
        headers: { authorization, 'x-forwarded-for': '127.0.0.1' },
      }) as unknown as Pick<Request, 'socket' | 'headers'>;
    delete process.env.METRICS_TOKEN;
    expect(canScrapeMetrics(request('127.0.0.1'))).toBe(true);
    expect(canScrapeMetrics(request('203.0.113.5'))).toBe(false);
    process.env.METRICS_TOKEN = 'a'.repeat(40);
    expect(
      canScrapeMetrics(request('203.0.113.5', `Bearer ${'a'.repeat(40)}`)),
    ).toBe(true);
    expect(canScrapeMetrics(request('127.0.0.1', 'Bearer wrong'))).toBe(false);
  });
  it('records bounded HTTP labels, real pool gauges and nonnegative unique socket counts', async () => {
    const metrics = new TelemetryMetrics();
    try {
      const pool = { totalCount: 3, idleCount: 1, waitingCount: 2 };
      metrics.attachPool('main', pool);
      metrics.recordHttp('GET', '/forms/:id', 200, 0.1);
      metrics.recordHttp('GET', '/forms/:id', 403, 0.05);
      metrics.socketOpened('a');
      metrics.socketOpened('a');
      metrics.socketOpened('b');
      metrics.socketClosed('a');
      metrics.socketClosed('missing');
      let output = await metrics.render();
      expect(output).toContain(
        'http_requests_total{method="GET",path="/forms/:id",status="200",service="apag-backend"} 1',
      );
      expect(output).toContain(
        'http_errors_total{method="GET",path="/forms/:id",status="403",service="apag-backend"} 1',
      );
      expect(output).toMatch(/db_pool_waiting\{[^\n]+\} 2/);
      expect(output).toMatch(/active_websocket_connections\{[^\n]+\} 1/);
      pool.waitingCount = 4;
      output = await metrics.render();
      expect(output).toMatch(/db_pool_waiting\{[^\n]+\} 4/);
      expect(output).toMatch(/queue_enabled\{[^\n]*queue="none"[^\n]*\} 0/);
      expect(output).toContain('process_cpu_usage');
      expect(output).toContain('process_memory_usage');
      expect(output).toContain('event_loop_lag');
    } finally {
      metrics.destroy();
    }
  });
  it('does not turn an unavailable queue into a false zero-depth successful snapshot', async () => {
    const metrics = new TelemetryMetrics();
    try {
      let fail = false;
      metrics.registerQueue('mail', async () => {
        if (fail) throw new Error('unavailable');
        return { waiting: 7, failed: 2 };
      });
      expect(await metrics.render()).toMatch(
        /queue_jobs_waiting\{[^\n]*queue="mail"[^\n]*\} 7/,
      );
      fail = true;
      const output = await metrics.render();
      expect(output).toMatch(/queue_enabled\{[^\n]*queue="mail"[^\n]*\} 0/);
      expect(output).toMatch(
        /queue_jobs_waiting\{[^\n]*queue="mail"[^\n]*\} 7/,
      );
    } finally {
      metrics.destroy();
    }
  });
  it('classifies a SQL operation without retaining a query fingerprint or values', () => {
    expect(databaseOperation({ text: 'SELECT $1', values: ['secret'] })).toBe(
      'SELECT',
    );
    expect(databaseOperation('not_a_statement secret')).toBe('OTHER');
  });
});
