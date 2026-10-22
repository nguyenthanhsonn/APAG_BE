import type { ReportsExportQueryDto } from '../../modules/reports/dto/reports-export-query.dto';

export type EmailPayload =
  | {
      kind: 'student';
      email: string;
      fullName: string;
      username: string;
      password: string;
      studentCode: string;
    }
  | {
      kind: 'staff';
      email: string;
      fullName: string;
      username: string;
      password: string;
      roleLabel: string;
    }
  | {
      kind: 'password-reset';
      email: string;
      fullName: string;
      resetUrl: string;
      expiresInMinutes: number;
      expiresAt?: number;
    };
export type ReportFormat = 'pdf' | 'xlsx' | 'docx';
export type ReportPayload = {
  ownerId: string;
  format: ReportFormat;
  filters: ReportsExportQueryDto;
};
export type QueueName = 'email' | 'report';
export type JobEnvelope = {
  encrypted: string;
  digest: string;
  ownerId?: string;
  expiresAt: number;
  context: Record<string, string>;
};
export type ReportResult = {
  format: ReportFormat;
  fileName: string;
  bytes: number;
  expiresAt: number;
};
export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
