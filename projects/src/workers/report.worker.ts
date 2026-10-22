import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, UnrecoverableError } from 'bullmq';
import {
  QueueService,
  queueConnection,
} from '../infrastructure/queue/queue.service';
import { ReportStorage } from '../infrastructure/queue/report-storage.service';
import type {
  JobEnvelope,
  ReportPayload,
} from '../infrastructure/queue/queue.types';
import { PrismaService } from '../database/prisma.service';
import { ReportsService } from '../modules/reports/reports.service';
import { ReportRenderer } from '../modules/reports/export/report-renderer.service';
import { runWorkerJob } from './worker-job';
import { getLogger } from '../observability/structured-logger';

@Injectable()
export class ReportWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<JobEnvelope>;
  private cleanup?: NodeJS.Timeout;
  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    private readonly storage: ReportStorage,
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly renderer: ReportRenderer,
  ) {}
  async onModuleInit() {
    await this.storage.cleanup();
    this.cleanup = setInterval(() => {
      void this.storage
        .cleanup()
        .catch(() =>
          getLogger().error(
            { event: 'report.cleanup_failed' },
            'Report cleanup failed',
          ),
        );
    }, 3600000);
    this.cleanup.unref();
    this.worker = new Worker<JobEnvelope>(
      'report',
      async (job) => {
        return runWorkerJob('report', job, async () => {
          if (Date.now() >= job.data.expiresAt)
            throw new UnrecoverableError('Job expired');
          const payload = this.queues.crypto.open<ReportPayload>(
            job.data.encrypted,
            this.queues.aad('report', job.id!),
          );
          const owner = await this.prisma.user.findUnique({
            where: { id: payload.ownerId },
            select: { role: true, isActive: true, deletedAt: true },
          });
          if (!owner?.isActive || owner.deletedAt || owner.role !== 'admin')
            throw new UnrecoverableError('Report permission changed');
          await job.updateProgress(10);
          const rows = await this.reports.getExportRows(payload.filters);
          await job.updateProgress(40);
          const buffer = await this.renderer.render(payload.format, rows);
          const stored = await this.storage.save(
            job.id!,
            payload.format,
            buffer,
          );
          return {
            ...stored,
            format: payload.format,
            fileName: `ket-qua-ren-luyen.${payload.format}`,
          };
        });
      },
      {
        prefix: this.queues.prefix,
        connection: queueConnection(this.config, true),
        concurrency: 1,
        lockDuration: 120000,
      },
    );
    this.worker.on('failed', (job) =>
      getLogger().error(
        {
          event: 'queue.job_failed',
          queue: 'report',
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
        },
        'Queue job attempt failed',
      ),
    );
    this.worker.on('error', () =>
      getLogger().error(
        { event: 'queue.worker_error', queue: 'report' },
        'Report worker unavailable',
      ),
    );
  }
  async onModuleDestroy() {
    if (this.cleanup) clearInterval(this.cleanup);
    await this.worker?.close();
  }
}
