import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { getMetrics } from '../../observability/metrics';
import { captureJobContext } from '../../observability/request-context';
import { getLogger } from '../../observability/structured-logger';
import { canonicalPayload, QueueCrypto } from './queue-crypto.service';
import type { JobEnvelope, QueueName } from './queue.types';

export function queueConnection(config: ConfigService, worker = false) {
  const url = new URL(
    config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
  );
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(url.protocol === 'rediss:'
      ? { tls: { servername: url.hostname } }
      : {}),
    connectTimeout: 2000,
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    retryStrategy: (attempt: number) => Math.min(100 * attempt, 2000),
  };
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  readonly prefix: string;
  private readonly queues: Record<QueueName, Queue<JobEnvelope>>;
  constructor(
    private readonly config: ConfigService,
    readonly crypto: QueueCrypto,
  ) {
    this.prefix = `${config.get<string>('REDIS_KEY_PREFIX') || 'apag:'}bull`;
    this.queues = Object.fromEntries(
      (['email', 'report'] as const).map((name) => {
        const queue = new Queue<JobEnvelope>(name, {
          connection: queueConnection(config),
          prefix: this.prefix,
          defaultJobOptions: {
            attempts: name === 'email' ? 4 : 3,
            backoff: {
              type: 'exponential',
              delay: Number(config.get('QUEUE_BACKOFF_MS') || 1000),
            },
            removeOnComplete: { age: 86400, count: 10000 },
            removeOnFail: { age: 604800, count: 10000 },
            stackTraceLimit: 1,
          },
        });
        queue.on('error', () =>
          getLogger().error(
            { event: 'queue.connection_error', queue: name },
            'Queue unavailable',
          ),
        );
        getMetrics().registerQueue(name, async () => {
          const counts = await queue.getJobCounts(
            'waiting',
            'delayed',
            'failed',
          );
          return {
            waiting: (counts.waiting || 0) + (counts.delayed || 0),
            failed: counts.failed || 0,
          };
        });
        return [name, queue];
      }),
    ) as Record<QueueName, Queue<JobEnvelope>>;
  }
  async onModuleInit() {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all(Object.values(this.queues).map((q) => q.waitUntilReady())),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Queue startup timeout')),
            5000,
          );
        }),
      ]);
    } catch {
      await this.onModuleDestroy();
      throw new ServiceUnavailableException('Không kết nối được queue Redis');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  get(name: QueueName) {
    return this.queues[name];
  }
  aad(name: QueueName, id: string) {
    return `${this.prefix}/${name}/${id}`;
  }
  async enqueue(
    name: QueueName,
    payload: unknown,
    options: { ownerId?: string; key?: string; ttl?: number } = {},
  ) {
    const digest = this.crypto.digest(canonicalPayload(payload));
    const id = options.key
      ? this.crypto.digest(`${name}/${options.ownerId || ''}/${options.key}`)
      : randomUUID();
    const data: JobEnvelope = {
      encrypted: this.crypto.seal(payload, this.aad(name, id)),
      digest,
      ownerId: options.ownerId,
      expiresAt: Date.now() + (options.ttl ?? 86400) * 1000,
      context: captureJobContext(),
    };
    try {
      await this.get(name).add(name, data, { jobId: id });
      // BullMQ returns the caller's data on duplicate add; read stored data to detect intent conflicts.
      const stored = await this.get(name).getJob(id);
      if (
        !stored ||
        stored.data.digest !== digest ||
        stored.data.ownerId !== options.ownerId
      ) {
        throw new ConflictException(
          'Idempotency-Key đã được dùng cho yêu cầu khác',
        );
      }
      return id;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Chưa thể thêm tác vụ vào hàng đợi, vui lòng thử lại',
      );
    }
  }
  async onModuleDestroy() {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}
