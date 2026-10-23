import { ReportStorage } from '../../infrastructure/reports/report-storage.service';
import { ReportRenderer } from './export/report-renderer.service';
import { ReportJobsService } from './report-jobs.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { BbHopLopExportService } from './export/bb-hop-lop-export.service';
import { BbHopKhoaDocxExportService } from './export/bb-hop-khoa-docx-export.service';
import { BbHopKhoaExportService } from './export/bb-hop-khoa-export.service';
import { PdfReportExportService } from './export/pdf-report-export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportJobsService,
    ReportStorage,
    ReportRenderer,
    PdfReportExportService,
    BbHopLopExportService,
    BbHopKhoaExportService,
    BbHopKhoaDocxExportService,
  ],
})
export class ReportsModule {}
