import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ReportStorage } from '../../infrastructure/reports/report-storage.service';
import {
  REPORT_CONTENT_TYPES,
  type ReportResult,
} from '../../infrastructure/reports/report.types';
import { CreateReportExportDto } from './dto/create-report-export.dto';
import { ReportRenderer } from './export/report-renderer.service';
import { ReportsService } from './reports.service';

type LocalExport = {
  ownerId: string;
  key?: string;
  intent: string;
  status: 'processing' | 'completed' | 'failed';
  expiresAt: number;
  completion?: Promise<void>;
  result?: ReportResult;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/**
 * Single-instance export registry, giữ contract POST/status/download cho FE.
 * Render ngay trong request; không có background queue hoặc worker bên ngoài.
 * Metadata/idempotency trong RAM mất sau restart. File có TTL trong local storage.
 */
@Injectable()
export class ReportJobsService {
  private readonly jobs = new Map<string, LocalExport>();
  private readonly keys = new Map<string, string>();
  private running = false;

  constructor(
    private readonly reports: ReportsService,
    private readonly renderer: ReportRenderer,
    private readonly storage: ReportStorage,
  ) {}

  async create(ownerId: string, dto: CreateReportExportDto, key?: string) {
    if (key && !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      throw new BadRequestException('Idempotency-Key không hợp lệ');
    this.prune();
    const scopedKey = key ? `${ownerId}:${key}` : undefined;
    const intent = createHash('sha256')
      .update(JSON.stringify(canonical(dto)))
      .digest('hex');
    const previousId = scopedKey ? this.keys.get(scopedKey) : undefined;
    const previous = previousId ? this.jobs.get(previousId) : undefined;
    if (previous) {
      if (previous.intent !== intent)
        throw new ConflictException(
          'Idempotency-Key đã được dùng cho yêu cầu khác',
        );
      await previous.completion;
      return this.accepted(previousId!);
    }
    // Không tạo queue RAM không giới hạn hoặc render nhiều file nặng cùng lúc.
    if (this.running || this.jobs.size >= 256)
      throw new ServiceUnavailableException(
        'Export đang bận, vui lòng thử lại sau',
      );
    this.running = true;
    const id = randomUUID();
    const job: LocalExport = {
      ownerId,
      key: scopedKey,
      intent,
      status: 'processing',
      expiresAt: Date.now() + this.storage.lifetime * 1000,
    };
    this.jobs.set(id, job);
    if (scopedKey) this.keys.set(scopedKey, id);
    job.completion = this.render(id, job, dto).finally(() => {
      this.running = false;
    });
    await job.completion;
    return this.accepted(id);
  }

  private accepted(id: string) {
    return { jobId: id, statusUrl: `/api/v1/reports/exports/${id}` };
  }

  private async render(
    id: string,
    job: LocalExport,
    dto: CreateReportExportDto,
  ) {
    try {
      await this.storage.cleanup();
      const { format, ...filters } = dto;
      const rows = await this.reports.getExportRows(filters);
      const buffer = await this.renderer.render(format, rows);
      const stored = await this.storage.save(id, format, buffer);
      job.result = {
        ...stored,
        format,
        fileName: `ket-qua-ren-luyen.${format}`,
      };
      job.expiresAt = stored.expiresAt;
      job.status = 'completed';
    } catch {
      // API status chỉ trả lỗi tổng quát, không lộ SQL/path/credential.
      job.status = 'failed';
    }
  }

  private get(ownerId: string, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.ownerId !== ownerId)
      throw new NotFoundException('Không tìm thấy export job');
    if (job.expiresAt <= Date.now())
      throw new GoneException('Export đã hết hạn');
    return job;
  }

  async status(ownerId: string, id: string) {
    const job = this.get(ownerId, id);
    return {
      jobId: id,
      status: job.status,
      attemptsMade: 1,
      ...(job.result
        ? {
            fileName: job.result.fileName,
            bytes: job.result.bytes,
            expiresAt: new Date(job.result.expiresAt).toISOString(),
            downloadUrl: `/api/v1/reports/exports/${id}/download`,
          }
        : {}),
      ...(job.status === 'failed'
        ? { error: 'Không thể tạo báo cáo, vui lòng tạo yêu cầu mới' }
        : {}),
    };
  }

  async download(ownerId: string, id: string) {
    const job = this.get(ownerId, id);
    if (job.status !== 'completed' || !job.result)
      throw new ConflictException('Báo cáo chưa hoàn tất');
    const result = job.result;
    const buffer = await this.storage.read(id, result.format, result.expiresAt);
    return {
      buffer,
      fileName: result.fileName,
      contentType: REPORT_CONTENT_TYPES[result.format],
    };
  }

  private prune() {
    for (const [id, job] of this.jobs) {
      if (job.status !== 'processing' && job.expiresAt <= Date.now()) {
        this.jobs.delete(id);
        if (job.key) this.keys.delete(job.key);
      }
    }
  }
}
