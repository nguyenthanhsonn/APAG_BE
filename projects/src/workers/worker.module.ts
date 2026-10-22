import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import appConfig from '../config/app.config';
import { validateEnvironment } from '../config/env.validation';
import { PrismaModule } from '../database/prisma.module';
import { QueueModule } from '../infrastructure/queue/queue.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SmtpMailService } from '../modules/mail/smtp-mail.service';
import { ReportsService } from '../modules/reports/reports.service';
import { ReportRenderer } from '../modules/reports/export/report-renderer.service';
import { EmailWorker } from './email.worker';
import { ReportWorker } from './report.worker';

// Separate process: only /metrics is exposed; no auth/business controllers or WebSocket adapter.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '../../.env'),
      load: [appConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
    ObservabilityModule,
    QueueModule,
  ],
  providers: [
    SmtpMailService,
    ReportsService,
    ReportRenderer,
    EmailWorker,
    ReportWorker,
  ],
})
export class WorkerModule {}
