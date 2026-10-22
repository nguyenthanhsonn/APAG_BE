import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueCrypto } from './queue-crypto.service';
import { ReportStorage } from './report-storage.service';
@Module({
  providers: [QueueService, QueueCrypto, ReportStorage],
  exports: [QueueService, QueueCrypto, ReportStorage],
})
export class QueueModule {}
