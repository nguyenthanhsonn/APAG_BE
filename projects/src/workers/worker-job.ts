import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { UnrecoverableError, type Job } from 'bullmq';
import { restoreJobContext } from '../observability/request-context';
import { getMetrics } from '../observability/metrics';
import { getLogger } from '../observability/structured-logger';
import type {
  JobEnvelope,
  QueueName,
} from '../infrastructure/queue/queue.types';

export function runWorkerJob<T>(
  name: QueueName,
  job: Job<JobEnvelope>,
  work: () => Promise<T>,
): Promise<T> {
  return restoreJobContext(job.data.context, () =>
    trace
      .getTracer('apag.queue')
      .startActiveSpan(
        `queue.${name}`,
        {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'bullmq',
            'messaging.destination.name': name,
          },
        },
        async (span) => {
          const started = process.hrtime.bigint();
          let status = 'success';
          try {
            return await work();
          } catch (error) {
            status = 'failed';
            span.setStatus({ code: SpanStatusCode.ERROR });
            // BullMQ persists failedReason/stacktrace. Never persist raw SMTP, payload or DB errors.
            if (error instanceof UnrecoverableError)
              throw new UnrecoverableError(
                `${name} job expired or unauthorized`,
              );
            throw new Error(`${name} job failed`);
          } finally {
            getMetrics().queueDuration.observe(
              { queue: name, status },
              Number(process.hrtime.bigint() - started) / 1e9,
            );
            getLogger()[status === 'success' ? 'info' : 'error'](
              {
                event: 'queue.job',
                queue: name,
                jobId: job.id,
                attempt: job.attemptsMade + 1,
                status,
              },
              'Queue job finished',
            );
            span.end();
          }
        },
      ),
  );
}
