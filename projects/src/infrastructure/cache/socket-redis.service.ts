import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { getLogger } from '../../observability/structured-logger';

// Pub/Sub needs its own two connections; never put the command client into subscriber mode.
@Injectable()
export class SocketRedisService implements OnModuleDestroy {
  private readonly pub;
  private readonly sub;
  private factory?: ReturnType<typeof createAdapter>;
  constructor(private readonly config: ConfigService) {
    this.pub = createClient({
      url: config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1000,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (n) => Math.min(100 * (n + 1), 2000),
      },
    });
    this.sub = this.pub.duplicate();
    for (const client of [this.pub, this.sub]) {
      client.on('error', () =>
        getLogger().error(
          { event: 'socket.redis_error' },
          'Realtime Redis unavailable',
        ),
      );
    }
  }
  async connect() {
    if (this.factory) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([this.pub.connect(), this.sub.connect()]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Realtime Redis startup timeout')),
            5000,
          );
        }),
      ]);
      this.factory = createAdapter(this.pub, this.sub, {
        key: `${this.config.get<string>('REDIS_KEY_PREFIX') || 'apag:'}socket.io`,
        publishOnSpecificResponseChannel: true,
      });
    } catch {
      this.onModuleDestroy();
      throw new ServiceUnavailableException(
        'Không kết nối được Redis realtime',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  adapter() {
    if (!this.factory)
      throw new Error('Connect realtime Redis before initializing Socket.IO');
    return this.factory;
  }
  onModuleDestroy() {
    for (const client of [this.pub, this.sub])
      if (client.isOpen) client.destroy();
    this.factory = undefined;
  }
}
