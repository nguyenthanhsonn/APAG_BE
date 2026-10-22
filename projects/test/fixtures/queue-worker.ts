import { drainWorkers } from '../../src/workers/shutdown';
import '../../src/observability/initialize';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../../src/workers/worker.module';
import { StructuredLogger } from '../../src/observability/structured-logger';
async function main() {
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(StructuredLogger));
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as import('node:http').Server;
  process.send?.({
    ready: true,
    port: (server.address() as import('node:net').AddressInfo).port,
  });
  process.on('message', (message) => {
    if (message === 'stop') void drainWorkers(app).then(() => process.exit(0));
  });
}
void main().catch(() => {
  process.send?.({ failed: true });
  process.exit(1);
});
