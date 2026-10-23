export type ReportFormat = 'pdf' | 'xlsx' | 'docx';
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
