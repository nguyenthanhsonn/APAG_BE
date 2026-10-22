import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  context,
  createContextKey,
  propagation,
  trace,
  type Context,
} from '@opentelemetry/api';

export type RequestContext = {
  requestId: string;
  correlationId: string;
  userId?: string;
  role?: string;
};
export const requestContext = new AsyncLocalStorage<RequestContext>();
const requestContextKey = createContextKey('apag.request_context');
export function currentRequestContext(): RequestContext | undefined {
  return (
    requestContext.getStore() ??
    (context.active().getValue(requestContextKey) as RequestContext | undefined)
  );
}
/** Prisma can re-enter through OTel's captured context rather than the originating Node ALS resource. */
export function runRequestContext<T>(ids: RequestContext, work: () => T): T {
  return context.with(context.active().setValue(requestContextKey, ids), () =>
    requestContext.run(ids, work),
  );
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(
    value,
  );
export function correlationContext(
  requestId?: unknown,
  correlationId?: unknown,
): RequestContext {
  const id = validId(requestId) ? requestId : randomUUID();
  return {
    requestId: id,
    correlationId: validId(correlationId) ? correlationId : id,
  };
}
export function logContext() {
  const currentSpan = trace.getActiveSpan()?.spanContext();
  return {
    ...currentRequestContext(),
    ...(currentSpan
      ? {
          traceId: currentSpan.traceId,
          spanId: currentSpan.spanId,
          traceSampled: Boolean(currentSpan.traceFlags & 1),
        }
      : {}),
  };
}
/** Carrier chỉ chứa correlation + W3C trace context; không serialize user/token/job payload. */
export function captureJobContext(): Record<string, string> {
  const current = currentRequestContext();
  const carrier: Record<string, string> = {};
  if (current) {
    carrier.requestId = current.requestId;
    carrier.correlationId = current.correlationId;
  }
  propagation.inject(context.active(), carrier);
  return carrier;
}
export function restoreJobContext<T>(
  carrier: Record<string, string>,
  work: (parent: Context) => T,
): T {
  const parent = propagation.extract(context.active(), {
    traceparent: carrier.traceparent,
    tracestate: carrier.tracestate,
  });
  return context.with(parent, () =>
    runRequestContext(
      correlationContext(carrier.requestId, carrier.correlationId),
      () => work(context.active()),
    ),
  );
}
