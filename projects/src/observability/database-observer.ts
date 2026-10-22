import { currentRequestContext } from './request-context';
import type { Pool, PoolClient } from 'pg';
import { performance } from 'node:perf_hooks';
import { trace } from '@opentelemetry/api';
import { getMetrics } from './metrics';
import { getLogger } from './structured-logger';

export function databaseOperation(input: unknown): string {
  const text =
    typeof input === 'string'
      ? input
      : input && typeof input === 'object'
        ? (input as { text?: unknown }).text
        : '';
  const token =
    typeof text === 'string'
      ? text.trimStart().split(/\s/)[0]?.toUpperCase()
      : '';
  return [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'WITH',
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'SET',
    'SHOW',
    'CREATE',
    'ALTER',
    'DROP',
    'TRUNCATE',
  ].includes(token ?? '')
    ? token!
    : 'OTHER';
}
const observed = new WeakSet<PoolClient>();
/** Observe the real driver, including Prisma transaction clients; never retain SQL or parameter values. */
export function observePool(pool: Pool, name = 'main') {
  getMetrics().attachPool(name, pool);
  pool.on('connect', (client) => {
    if (observed.has(client)) return;
    observed.add(client);
    const original = client.query;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      const started = performance.now();
      const ids = currentRequestContext();
      const operation = databaseOperation(args[0]);
      const current = trace.getActiveSpan()?.spanContext();
      let ended = false;
      const end = (error?: unknown) => {
        if (ended) return;
        ended = true;
        const durationMs = performance.now() - started;
        getMetrics().dbDuration.observe({
          labels: { operation, status: error ? 'error' : 'success' },
          value: durationMs / 1000,
          ...(current?.traceFlags
            ? { exemplarLabels: { traceId: current.traceId } }
            : {}),
        });
        if (durationMs >= Number(process.env.DB_SLOW_QUERY_MS || 500)) {
          getMetrics().dbSlow.inc({ operation });
          getLogger().warn(
            {
              ...ids,
              event: 'db.slow_query',
              operation,
              durationMs,
              ...(current
                ? { traceId: current.traceId, spanId: current.spanId }
                : {}),
            },
            'PostgreSQL query exceeded threshold',
          );
        }
      };
      const callback = args.at(-1);
      if (typeof callback === 'function')
        args[args.length - 1] = function (
          this: unknown,
          error: unknown,
          result: unknown,
        ) {
          end(error);
          return Reflect.apply(callback, this, [error, result]);
        };
      try {
        const result: unknown = Reflect.apply(original, this, args);
        if (result instanceof Promise)
          return result.then(
            (value) => {
              end();
              return value;
            },
            (error: unknown) => {
              end(error);
              throw error;
            },
          );
        // Callback API ends through the wrapped callback; unsupported streaming API is not falsely timed.
        return result;
      } catch (error) {
        end(error);
        throw error;
      }
    } as PoolClient['query'];
  });
  const connect = pool.connect;
  pool.connect = function (this: Pool, ...args: unknown[]) {
    const started = performance.now();
    let ended = false;
    const end = () => {
      if (!ended) {
        ended = true;
        getMetrics().dbAcquire.observe((performance.now() - started) / 1000);
      }
    };
    const callback = args[0];
    if (typeof callback === 'function')
      args[0] = function (this: unknown, ...values: unknown[]) {
        end();
        return Reflect.apply(callback, this, values);
      };
    try {
      const result: unknown = Reflect.apply(connect, this, args);
      if (result instanceof Promise)
        return result.then(
          (value) => {
            end();
            return value;
          },
          (error: unknown) => {
            end();
            throw error;
          },
        );
      return result;
    } catch (error) {
      end();
      throw error;
    }
  } as Pool['connect'];
  pool.on('error', () =>
    getLogger().error(
      { event: 'db.pool_error', pool: name },
      'Idle PostgreSQL connection failed',
    ),
  );
}
