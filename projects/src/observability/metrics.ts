import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { trace } from '@opentelemetry/api';

const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
export class TelemetryMetrics {
  readonly registry = new Registry(Registry.OPENMETRICS_CONTENT_TYPE);
  private readonly pools = new Map<
    string,
    Pick<Pool, 'totalCount' | 'idleCount' | 'waitingCount'>
  >();
  private readonly sockets = new Set<string>();
  private readonly queues = new Map<
    string,
    () => Promise<{ waiting: number; failed: number }>
  >();
  private readonly delay = monitorEventLoopDelay({ resolution: 20 });
  private cpu = process.cpuUsage();
  private cpuTime = process.hrtime.bigint();
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram<string>({
    name: 'http_request_duration_seconds',
    help: 'HTTP response duration including middleware and guards',
    labelNames: ['method', 'path', 'status'],
    buckets,
    enableExemplars: true,
    registers: [this.registry],
  });
  readonly httpErrors = new Counter({
    name: 'http_errors_total',
    help: 'HTTP responses with status >= 400',
    labelNames: ['method', 'path', 'status'],
    registers: [this.registry],
  });
  readonly dbDuration = new Histogram<string>({
    name: 'db_query_duration_seconds',
    help: 'PostgreSQL query roundtrip (no SQL/parameters retained)',
    labelNames: ['operation', 'status'],
    buckets,
    enableExemplars: true,
    registers: [this.registry],
  });
  readonly dbSlow = new Counter({
    name: 'db_slow_queries_total',
    help: 'PostgreSQL queries over DB_SLOW_QUERY_MS',
    labelNames: ['operation'],
    registers: [this.registry],
  });
  readonly dbAcquire = new Histogram({
    name: 'db_pool_acquire_duration_seconds',
    help: 'PostgreSQL pool connection checkout wait',
    buckets,
    registers: [this.registry],
  });
  readonly queueWaiting = new Gauge({
    name: 'queue_jobs_waiting',
    help: 'Waiting jobs; queue=none means no queue installed',
    labelNames: ['queue'],
    registers: [this.registry],
  });
  readonly queueFailed = new Gauge({
    name: 'queue_jobs_failed',
    help: 'Failed jobs retained by queue backend',
    labelNames: ['queue'],
    registers: [this.registry],
  });
  readonly queueUp = new Gauge({
    name: 'queue_enabled',
    help: '1 for a registered reachable queue; 0 for none/unreachable',
    labelNames: ['queue'],
    registers: [this.registry],
  });
  readonly queueDuration = new Histogram({
    name: 'queue_job_duration',
    help: 'Queue job execution duration in seconds',
    labelNames: ['queue', 'status'],
    buckets: [...buckets, 60, 120, 300],
    registers: [this.registry],
  });
  readonly websocket = new Gauge({
    name: 'active_websocket_connections',
    help: 'Open Socket.IO connections in notifications namespace',
    registers: [this.registry],
  });
  readonly tracingEnabled = new Gauge({
    name: 'tracing_enabled',
    help: 'Whether OpenTelemetry export is configured for this process',
    registers: [this.registry],
  });

  constructor() {
    this.registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE);
    this.registry.setDefaultLabels({
      service: process.env.OTEL_SERVICE_NAME || 'apag-backend',
    });
    const cpuMetric = new Gauge({
      name: 'process_cpu_usage',
      help: 'CPU cores consumed over the interval between scrapes (1 = one full core)',
      registers: [this.registry],
      collect: () => {
        const now = process.hrtime.bigint(),
          usage = process.cpuUsage();
        const seconds = Number(now - this.cpuTime) / 1e9;
        cpuMetric.set(
          seconds > 0
            ? (usage.user - this.cpu.user + (usage.system - this.cpu.system)) /
                1e6 /
                seconds
            : 0,
        );
        this.cpu = usage;
        this.cpuTime = now;
      },
    });
    const memory = new Gauge({
      name: 'process_memory_usage',
      help: 'Process resident memory in bytes',
      registers: [this.registry],
      collect: () => {
        memory.set(process.memoryUsage().rss);
      },
    });
    const lag = new Gauge({
      name: 'event_loop_lag',
      help: 'Mean event loop delay in seconds since previous scrape',
      registers: [this.registry],
      collect: () => {
        lag.set(Number.isFinite(this.delay.mean) ? this.delay.mean / 1e9 : 0);
        this.delay.reset();
      },
    });
    for (const [name, field] of [
      ['db_pool_total', 'totalCount'],
      ['db_pool_idle', 'idleCount'],
      ['db_pool_waiting', 'waitingCount'],
    ] as const) {
      const gauge = new Gauge({
        name,
        help: `PostgreSQL pool ${field}`,
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          gauge.reset();
          for (const [poolName, pool] of this.pools)
            gauge.set({ pool: poolName }, pool[field]);
        },
      });
    }
    this.websocket.set(0);
    this.tracingEnabled.set(process.env.OTEL_ENABLED === 'true' ? 1 : 0);
    this.queueWaiting.set({ queue: 'none' }, 0);
    this.queueFailed.set({ queue: 'none' }, 0);
    this.queueUp.set({ queue: 'none' }, 0);
    this.queueDuration.zero({ queue: 'none', status: 'success' });
    this.delay.enable();
  }
  attachPool(
    name: string,
    pool: Pick<Pool, 'totalCount' | 'idleCount' | 'waitingCount'>,
  ) {
    this.pools.set(name, pool);
  }
  detachPool(name: string) {
    this.pools.delete(name);
  }
  recordHttp(
    method: string,
    path: string,
    status: number,
    seconds: number,
    traceId?: string,
  ) {
    const labels = {
      method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)
        ? method
        : 'OTHER',
      path,
      status: String(status),
    };
    this.httpRequests.inc(labels);
    const current = trace.getActiveSpan()?.spanContext();
    const id = traceId ?? (current?.traceFlags ? current.traceId : undefined);
    this.httpDuration.observe({
      labels,
      value: seconds,
      ...(id ? { exemplarLabels: { traceId: id } } : {}),
    });
    if (status >= 400) this.httpErrors.inc(labels);
  }
  socketOpened(id: string) {
    this.sockets.add(id);
    this.websocket.set(this.sockets.size);
  }
  socketClosed(id: string) {
    this.sockets.delete(id);
    this.websocket.set(this.sockets.size);
  }
  registerQueue(
    name: string,
    snapshot: () => Promise<{ waiting: number; failed: number }>,
  ) {
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(name) || name === 'none')
      throw new Error('Invalid queue metric name');
    this.queues.set(name, snapshot);
    this.queueWaiting.remove({ queue: 'none' });
    this.queueFailed.remove({ queue: 'none' });
    this.queueUp.remove({ queue: 'none' });
  }
  async render() {
    await Promise.all(
      [...this.queues].map(async ([queue, snapshot]) => {
        try {
          const state = await snapshot();
          this.queueWaiting.set({ queue }, state.waiting);
          this.queueFailed.set({ queue }, state.failed);
          this.queueUp.set({ queue }, 1);
        } catch {
          this.queueUp.set({ queue }, 0);
        } // Do not turn a failed backend read into a false zero-depth queue.
      }),
    );
    return this.registry.metrics();
  }
  destroy() {
    this.delay.disable();
  }
}
let singleton: TelemetryMetrics | undefined;
export function getMetrics() {
  return (singleton ??= new TelemetryMetrics());
}
