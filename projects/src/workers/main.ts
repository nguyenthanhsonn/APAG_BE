import { drainWorkers } from './shutdown';
import '../observability/initialize';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WorkerModule } from './worker.module';
import {
  StructuredLogger,
  getLogger,
} from '../observability/structured-logger';

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(StructuredLogger));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void drainWorkers(app).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  const config = app.get(ConfigService);
  await app.listen(
    Number(config.get('WORKER_METRICS_PORT') || 5051),
    config.get<string>('WORKER_HOST') || '127.0.0.1',
  );
  getLogger().info({ event: 'workers.ready' }, 'Email/report workers ready');
}
void bootstrap().catch(() => {
  getLogger().fatal(
    { event: 'workers.startup_failed' },
    'Worker startup failed',
  );
  process.exit(1);
});
