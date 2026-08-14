import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from 'src/common/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExportBbHopLopDto } from './dto/export-bb-hop-lop.dto';
import {
  BbHopKhoaMeetingInfoDto,
  ExportBbHopKhoaDto,
} from './dto/export-bb-hop-khoa.dto';
import { ReportsAggregateQueryDto } from './dto/reports-aggregate-query.dto';
import { ReportsExportQueryDto } from './dto/reports-export-query.dto';
import { BbHopLopExportService } from './export/bb-hop-lop-export.service';
import { BbHopKhoaDocxExportService } from './export/bb-hop-khoa-docx-export.service';
import { BbHopKhoaExportService } from './export/bb-hop-khoa-export.service';
import { PdfReportExportService } from './export/pdf-report-export.service';
import { ReportsService } from './reports.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Thiếu hoặc sai access token.' })
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Admin)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pdfExportService: PdfReportExportService,
    private readonly bbHopLopExportService: BbHopLopExportService,
    private readonly bbHopKhoaExportService: BbHopKhoaExportService,
    private readonly bbHopKhoaDocxExportService: BbHopKhoaDocxExportService,
  ) {}

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description: 'Endpoint GET overview trong nhóm Admin Reports; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('overview')
  getOverview(@Query() query: ReportsAggregateQueryDto) {
    return this.reportsService.getOverview(query);
  }

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description: 'Endpoint GET training-results trong nhóm Admin Reports; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('training-results')
  getTrainingResults(@Query() query: ReportsAggregateQueryDto) {
    return this.reportsService.getTrainingResults(query);
  }

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description: 'Endpoint GET by-class trong nhóm Admin Reports; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('by-class')
  getByClass(@Query() query: ReportsAggregateQueryDto) {
    return this.reportsService.getByClass(query);
  }

  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description: 'Endpoint GET by-faculty trong nhóm Admin Reports; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('by-faculty')
  getByFaculty(@Query() query: ReportsAggregateQueryDto) {
    return this.reportsService.getByFaculty(query);
  }

  /** Xuất file PDF — dùng @Res() để tránh ResponseInterceptor bọc JSON làm hỏng file. */
  @ApiOperation({
    summary: 'Lấy dữ liệu',
    description: 'Endpoint GET export-pdf trong nhóm Admin Reports; xem schema DTO/query và response mẫu trực tiếp trong Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Thao tác thành công.' })
  @Get('export-pdf')
  async exportPdf(
    @Query() query: ReportsExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const rows = await this.reportsService.getExportRows(query);
    this.pdfExportService.streamToResponse(rows, res, this.buildFileName(query, 'pdf'));
  }

  /** Xuất biên bản họp khoa từ dữ liệu FE gửi lên và template Excel có sẵn. */
  @ApiOperation({
    summary: 'Xuất biên bản họp khoa',
    description:
      'FE gửi thông tin cuộc họp và danh sách sinh viên; API trả về file Excel .xlsx để tải xuống.',
  })
  @ApiResponse({ status: 200, description: 'Xuất file Excel thành công.' })
  @Post('export/excel/bien-ban-hop-khoa')
  @Roles(UserRole.Faculty)
  async exportBbHopKhoa(
    @Body() body: ExportBbHopKhoaDto,
    @Res() res: Response,
  ): Promise<void> {
    const info = this.normalizeBbHopKhoaInfo(body);
    const students = body.students ?? [];
    const buffer = await this.bbHopKhoaExportService.export(
      info,
      students,
    );
    const fileName = this.buildBbHopKhoaFileName(info.tenLop, 'xlsx');

    this.sendFileResponse(
      res,
      buffer,
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  /** Xuất biên bản họp khoa từ dữ liệu FE gửi lên và template Word có sẵn. */
  @ApiOperation({
    summary: 'Xuất biên bản họp khoa Word',
    description:
      'FE gửi thông tin cuộc họp và danh sách sinh viên; API trả về file Word .docx để tải xuống.',
  })
  @ApiResponse({ status: 200, description: 'Xuất file Word thành công.' })
  @Post('export/word/bien-ban-hop-khoa')
  @Roles(UserRole.Faculty)
  async exportBbHopKhoaDocx(
    @Body() body: ExportBbHopKhoaDto,
    @Res() res: Response,
  ): Promise<void> {
    const info = this.normalizeBbHopKhoaInfo(body);
    const students = body.students ?? [];
    const buffer = this.bbHopKhoaDocxExportService.export(
      info,
      students,
      body,
    );
    const fileName = this.buildBbHopKhoaFileName(info.tenLop, 'docx');

    this.sendFileResponse(
      res,
      buffer,
      fileName,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  }

  /** Xuất biên bản họp lớp từ dữ liệu FE gửi lên và template Excel có sẵn. */
  @ApiOperation({
    summary: 'Xuất biên bản họp lớp',
    description:
      'FE gửi thông tin cuộc họp lớp và danh sách sinh viên; API trả về file Excel .xlsx để tải xuống.',
  })
  @ApiResponse({ status: 200, description: 'Xuất file Excel thành công.' })
  @Post('export/excel/bien-ban-hop-lop')
  @Roles(UserRole.ClassLeader)
  async exportBbHopLopExcel(
    @Body() body: ExportBbHopLopDto,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.bbHopLopExportService.export(body);

    this.sendFileResponse(
      res,
      buffer,
      this.bbHopLopExportService.getFileName(body),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  private buildFileName(query: ReportsExportQueryDto, extension: string): string {
    const parts = ['ket-qua-ren-luyen', query.academicYear, query.semester].filter(
      Boolean,
    );

    return `${parts.join('-')}.${extension}`;
  }

  private buildBbHopKhoaFileName(
    className: string,
    extension: 'docx' | 'xlsx',
  ): string {
    const safeClassName = className
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    return `bb-hop-khoa-${safeClassName || 'lop'}.${extension}`;
  }

  private normalizeBbHopKhoaInfo(
    body: ExportBbHopKhoaDto,
  ): BbHopKhoaMeetingInfoDto {
    return {
      tenKhoa: body.info?.tenKhoa ?? body.khoa ?? body.facultyName ?? '',
      tenLop: body.info?.tenLop ?? body.lop ?? body.className ?? '',
      hocKy: body.info?.hocKy ?? body.hocKy ?? body.semester ?? '',
      namHoc: body.info?.namHoc ?? body.namHoc ?? body.academicYear ?? '',
      ngayHop: body.info?.ngayHop ?? body.ngayHop ?? body.meetingDay ?? '',
      thangHop: body.info?.thangHop ?? body.thangHop ?? body.meetingMonth ?? '',
      namHop: body.info?.namHop ?? body.namHop ?? body.meetingYear ?? '',
      diaDiem: body.info?.diaDiem ?? body.diaDiem ?? body.location ?? '',
      chuToa: body.info?.chuToa ?? body.chuToa ?? body.chairperson ?? '',
      thuKy: body.info?.thuKy ?? body.thuKy ?? body.secretary ?? '',
    };
  }

  private sendFileResponse(
    res: Response,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): void {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Length, Content-Type',
    );
    res.send(buffer);
  }
}
