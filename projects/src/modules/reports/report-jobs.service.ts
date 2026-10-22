import type { Job } from 'bullmq';
import type { JobEnvelope } from '../../infrastructure/queue/queue.types';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { ReportStorage } from '../../infrastructure/queue/report-storage.service';
import {
  REPORT_CONTENT_TYPES,
  type ReportPayload,
  type ReportResult,
} from '../../infrastructure/queue/queue.types';
import { CreateReportExportDto } from './dto/create-report-export.dto';

@Injectable()
export class ReportJobsService {
  constructor(
    private readonly queues: QueueService,
    private readonly storage: ReportStorage,
  ) {}
  async create(ownerId: string, dto: CreateReportExportDto, key?: string) {
    if (key && !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      throw new BadRequestException('Idempotency-Key không hợp lệ');
    const { format, ...filters } = dto;
    const payload: ReportPayload = { ownerId, format, filters };
    const jobId = await this.queues.enqueue('report', payload, {
      ownerId,
      key,
      ttl: this.storage.lifetime,
    });
    return { jobId, statusUrl: `/api/v1/reports/exports/${jobId}` };
  }
  private async job(ownerId: string, id: string) {
    if (!/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(id))
      throw new NotFoundException('Không tìm thấy export job');
    let job;
    try {
      job = await this.queues.get('report').getJob(id);
    } catch {
      throw new ServiceUnavailableException('Queue tạm thời không khả dụng');
    }
    // Hide existence of jobs belonging to a different user.
    if (!job || job.data.ownerId !== ownerId)
      throw new NotFoundException('Không tìm thấy export job');
    return job;
  }
  private async state(job: Job<JobEnvelope>) {
    try {
      return await job.getState();
    } catch {
      throw new ServiceUnavailableException('Queue tạm thời không khả dụng');
    }
  }
  async status(ownerId: string, id: string) {
    const job = await this.job(ownerId, id);
    const state = await this.state(job);
    const status =
      state === 'completed'
        ? 'completed'
        : state === 'failed'
          ? 'failed'
          : state === 'active'
            ? 'processing'
            : 'pending';
    const result = job.returnvalue as ReportResult | undefined;
    const expired = Date.now() >= (result?.expiresAt ?? job.data.expiresAt);
    if (expired) throw new GoneException('Export job đã hết hạn');
    return {
      jobId: id,
      status,
      attemptsMade: job.attemptsMade,
      ...(status === 'completed' && result
        ? {
            fileName: result.fileName,
            bytes: result.bytes,
            expiresAt: new Date(result.expiresAt).toISOString(),
            downloadUrl: `/api/v1/reports/exports/${id}/download`,
          }
        : {}),
      ...(status === 'failed'
        ? {
            error:
              'Không thể tạo báo cáo sau các lần thử, vui lòng tạo yêu cầu mới',
          }
        : {}),
    };
  }
  async download(ownerId: string, id: string) {
    const job = await this.job(ownerId, id);
    if ((await this.state(job)) !== 'completed')
      throw new ConflictException('Báo cáo chưa hoàn tất');
    const result = job.returnvalue as ReportResult;
    const buffer = await this.storage.read(id, result.format, result.expiresAt);
    return {
      buffer,
      fileName: result.fileName,
      contentType: REPORT_CONTENT_TYPES[result.format],
    };
  }
}
