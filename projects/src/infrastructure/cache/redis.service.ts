import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { getLogger } from '../../observability/structured-logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: ReturnType<typeof createClient>;
  private readonly prefix: string;
  private readonly timeout: number;
  constructor(config: ConfigService) {
    this.prefix = config.get<string>('REDIS_KEY_PREFIX') || 'apag:';
    this.timeout = Number(config.get('REDIS_COMMAND_TIMEOUT_MS') || 2000);
    this.client = createClient({
      url: config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1000,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => Math.min(100 * (retries + 1), 2000),
      },
    });
    // Never log driver messages/URLs: Redis authentication errors can contain credentials.
    this.client.on('error', () =>
      getLogger().error(
        { event: 'redis.connection_error' },
        'Shared Redis state unavailable',
      ),
    );
  }
  async onModuleInit() {
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Redis startup timeout')),
            5000,
          );
          timer.unref();
        }),
      ]);
    } catch {
      if (this.client.isOpen) this.client.destroy();
      throw new ServiceUnavailableException('Không kết nối được Redis');
    }
  }
  onModuleDestroy() {
    if (this.client.isOpen) this.client.destroy();
  }
  key(logical: string) {
    return this.prefix + logical;
  }
  async command(args: string[]): Promise<unknown> {
    const operation = /^[A-Z]{1,12}$/.test(args[0] || '') ? args[0]! : 'OTHER';
    return trace.getTracer('apag.redis').startActiveSpan(
      `Redis ${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'db.system.name': 'redis',
          'db.operation.name': operation,
        },
      },
      async (span) => {
        try {
          return await this.client
            .withCommandOptions({ timeout: this.timeout })
            .sendCommand(args);
        } catch {
          span.setStatus({ code: SpanStatusCode.ERROR });
          // Authentication state MUST fail closed; never fall back to process-local memory.
          throw new ServiceUnavailableException(
            'Redis tạm thời không khả dụng, vui lòng thử lại',
          );
        } finally {
          span.end();
        }
      },
    );
  }

  async get(key: string): Promise<string | null> {
    return (await this.command(['GET', this.key(key)])) as string | null;
  }
  async getDel(key: string): Promise<string | null> {
    return (await this.command(['GETDEL', this.key(key)])) as string | null;
  }
  async set(key: string, value: string, ttl: number) {
    await this.command([
      'SET',
      this.key(key),
      value,
      'EX',
      String(Math.max(1, Math.ceil(ttl))),
    ]);
  }
  async del(...keys: string[]) {
    if (keys.length)
      await this.command(['DEL', ...keys.map((key) => this.key(key))]);
  }
  async eval(
    script: string,
    keys: string[],
    args: string[] = [],
  ): Promise<unknown> {
    return this.command([
      'EVAL',
      script,
      String(keys.length),
      ...keys.map((key) => this.key(key)),
      ...args,
    ]);
  }
}
