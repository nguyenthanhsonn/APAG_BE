import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { Attributes } from '@opentelemetry/api';

// Export an allowlist, never HTTP headers/query strings, SQL/params, exception messages or job payloads.
const allowed = new Set([
  'http.method',
  'http.request.method',
  'http.status_code',
  'http.response.status_code',
  'http.route',
  'db.system',
  'db.system.name',
  'db.operation',
  'db.operation.name',
  'db.namespace',
  'db.name',
  'db.collection.name',
  'server.address',
  'server.port',
  'nestjs.type',
  'nestjs.module',
  'nestjs.controller',
  'nestjs.callback',
  'model',
  'method',
  'app.request_id',
  'app.correlation_id',
  'dependency.system',
  'job.queue',
]);
export function safeSpan(span: ReadableSpan): ReadableSpan {
  const attributes: Attributes = Object.fromEntries(
    Object.entries(span.attributes).filter(([key]) => allowed.has(key)),
  );
  const pgQuery =
    span.instrumentationScope.name === '@opentelemetry/instrumentation-pg' &&
    (span.attributes['db.statement'] !== undefined ||
      span.attributes['db.query.text'] !== undefined);
  // Instrumentation may include SQL or a URL in a span name. Only keep known framework names and methods.
  const name = pgQuery
    ? `PostgreSQL ${String(attributes['db.operation.name'] ?? attributes['db.operation'] ?? 'query')}`
    : span.name
        .replace(/(?:https?:\/\/|postgres(?:ql)?:\/\/)[^\s]+/gi, '[endpoint]')
        .split('?')[0]!;
  // Explicit ReadableSpan projection also prevents private SDK state/circular references escaping.
  return {
    name,
    kind: span.kind,
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    attributes,
    spanContext: () => span.spanContext(),
    status: { code: span.status.code },
    events: [],
    links: span.links.map((link) => ({ ...link, attributes: {} })),
  };
}
export class SafeSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}
  export(
    spans: ReadableSpan[],
    callback: Parameters<SpanExporter['export']>[1],
  ) {
    this.delegate.export(spans.map(safeSpan), callback);
  }
  shutdown() {
    return this.delegate.shutdown();
  }
  forceFlush() {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}
