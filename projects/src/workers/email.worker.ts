import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
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
import type {
  EmailPayload,
  JobEnvelope,
} from '../infrastructure/queue/queue.types';
import { SmtpMailService } from '../modules/mail/smtp-mail.service';
import { runWorkerJob } from './worker-job';
import { getLogger } from '../observability/structured-logger';

@Injectable()
export class EmailWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<JobEnvelope>;
  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    private readonly smtp: SmtpMailService,
    private readonly prisma: PrismaService,
  ) {}
  onModuleInit() {
    this.worker = new Worker<JobEnvelope>(
      'email',
      async (job) => {
        // Do not deliver an expired reset link after a prolonged queue outage.
        return runWorkerJob('email', job, async () => {
          if (Date.now() >= job.data.expiresAt)
            throw new UnrecoverableError('Job expired');
          const payload = this.queues.crypto.open<EmailPayload>(
            job.data.encrypted,
            this.queues.aad('email', job.id!),
          );
          if (payload.kind === 'student')
            await this.smtp.sendStudentAccount(payload, job.id);
          else if (payload.kind === 'staff')
            await this.smtp.sendStaffAccount(payload, job.id);
          else {
            const token = new URL(payload.resetUrl).searchParams.get('token');
            if (!token) throw new UnrecoverableError('Invalid reset link');
            const reset = await this.prisma.passwordResetToken.findUnique({
              where: {
                tokenHash: createHash('sha256').update(token).digest('hex'),
              },
              select: {
                expiresAt: true,
                usedAt: true,
                user: { select: { isActive: true, deletedAt: true } },
              },
            });
            if (
              !reset ||
              reset.usedAt ||
              reset.expiresAt.getTime() <= Date.now() ||
              !reset.user.isActive ||
              reset.user.deletedAt
            )
              throw new UnrecoverableError('Reset link no longer valid');
            await this.smtp.sendPasswordReset(payload, job.id);
          }
          return { delivered: true };
        });
      },
      {
        prefix: this.queues.prefix,
        connection: queueConnection(this.config, true),
        concurrency: Number(this.config.get('EMAIL_WORKER_CONCURRENCY') || 3),
        limiter: { max: 20, duration: 1000 },
      },
    );
    this.worker.on('failed', (job) =>
      getLogger().error(
        {
          event: 'queue.job_failed',
          queue: 'email',
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
        },
        'Queue job attempt failed',
      ),
    );
    this.worker.on('error', () =>
      getLogger().error(
        { event: 'queue.worker_error', queue: 'email' },
        'Email worker unavailable',
      ),
    );
  }
  async onModuleDestroy() {
    await this.worker?.close();
  }
}
