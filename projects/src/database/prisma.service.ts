import { observePool } from '../observability/database-observer';
import { getMetrics } from '../observability/metrics';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;
  private readonly connectOnInit: boolean;

  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('app.databaseUrl');

    if (!connectionString) {
      throw new Error(
        'Missing database config: set DATABASE_URL or DB_HOST, DB_NAME, DB_PASS',
      );
    }

    // Mỗi process có pool riêng: tính cả API replicas và report/email workers.
    // Timeout hữu hạn giúp request fail sớm khi pool đầy, thay vì chờ vô hạn.
    const pool = new Pool({
      connectionString,
      max: configService.get<number>('app.databasePool.max') ?? 10,
      idleTimeoutMillis:
        configService.get<number>('app.databasePool.idleTimeoutMillis') ?? 30000,
      connectionTimeoutMillis:
        configService.get<number>('app.databasePool.connectionTimeoutMillis') ??
        2000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
    observePool(pool);
    this.connectOnInit =
      configService.get<boolean>('app.connectOnInit') ?? true;
  }

  async onModuleInit(): Promise<void> {
    if (!this.connectOnInit) {
      return;
    }

    await this.$connect();
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
    getMetrics().detachPool('main');
  }
}
