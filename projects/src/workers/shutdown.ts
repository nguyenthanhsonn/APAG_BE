import type { INestApplication } from '@nestjs/common';
import { EmailWorker } from './email.worker';
import { ReportWorker } from './report.worker';

export async function drainWorkers(app: INestApplication) {
  // Finish in-flight jobs BEFORE Nest tears down Prisma/queue providers.
  await Promise.all([
    app.get(EmailWorker).onModuleDestroy(),
    app.get(ReportWorker).onModuleDestroy(),
  ]);
  await app.close();
}
