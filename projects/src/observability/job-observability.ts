import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { performance } from 'node:perf_hooks';
import { getMetrics } from './metrics';
import { restoreJobContext } from './request-context';
import { getLogger } from './structured-logger';

/** Future queue adapters call this with captureJobContext() metadata, never the business payload. */
export async function observeJob<T>(
  queue: string,
  carrier: Record<string, string>,
  work: () => Promise<T>,
): Promise<T> {
  if (!/^[a-z][a-z0-9_-]{0,40}$/.test(queue) || queue === 'none')
    throw new Error('Invalid queue name');
  return restoreJobContext(carrier, (parent) =>
    trace
      .getTracer('apag.jobs')
      .startActiveSpan(
        'queue.process',
        { kind: SpanKind.CONSUMER, attributes: { 'job.queue': queue } },
        parent,
        async (span) => {
          const started = performance.now();
          let status = 'success';
          try {
            return await work();
          } catch (error) {
            status = 'error';
            span.setStatus({ code: SpanStatusCode.ERROR });
            getLogger().error(
              { event: 'queue.job_failed', queue },
              'Background job failed',
            );
            throw error;
          } finally {
            getMetrics().queueDuration.observe(
              { queue, status },
              (performance.now() - started) / 1000,
            );
            span.end();
          }
        },
      ),
  );
}
