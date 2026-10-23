import { IsIn } from 'class-validator';
import { ReportsExportQueryDto } from './reports-export-query.dto';
import type { ReportFormat } from '../../../infrastructure/reports/report.types';
export class CreateReportExportDto extends ReportsExportQueryDto {
  @IsIn(['pdf', 'xlsx', 'docx'])
  format: ReportFormat;
}
