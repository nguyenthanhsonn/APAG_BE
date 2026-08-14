import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { read, utils } from 'xlsx';
import { UserRole, type PaginatedResult } from '../../common/shared';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AdminClassCatalogRepository } from './admin-class-catalog.repository';
import { CreateClassDto } from './dto/create-class.dto';
import { GetClassesQueryDto } from './dto/get-classes-query.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { UpdateClassLeadersDto } from './dto/update-class-leaders.dto';
import {
  mapToAdminClassDetailResponse,
  mapToAdminClassResponse,
  normalizeClassCode,
} from './mappers/admin-class-catalog.mapper';
import type {
  AdminClassDetailResponse,
  AdminClassResponse,
} from './types/admin-class-catalog.types';

type ImportClassRow = {
  rowNumber: number;
  code?: string;
  name?: string;
  facultyName?: string;
  majorName?: string;
};

export type UploadedClassExcelFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

export type ImportClassesResult = {
  totalRows: number;
  successCount: number;
  createdCount: number;
  createdClasses: AdminClassResponse[];
  failedCount: number;
  errors: Array<{ row: number; message: string }>;
};

export type ImportClassesPreviewResponse = {
  importToken: string;
  expiresAt: Date;
  totalRows: number;
  successCount: number;
  previewCount: number;
  previewClasses: Array<{
    code: string;
    name: string;
    facultyName: string;
    majorName: string;
    enrollmentYear: number;
  }>;
  failedCount: number;
  errors: Array<{ row: number; message: string }>;
};

type CachedClassImportPlan = {
  expiresAt: number;
  totalRows: number;
  rows: Array<{
    code: string;
    name: string;
    majorId: string;
    facultyName: string;
    majorName: string;
    enrollmentYear: number;
  }>;
};

const IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;

/**
 * Service quản lý danh mục lớp (CRUD) cho Task 4.2 - tách biệt hoàn toàn với
 * AdminClassesService (quản lý sinh viên trong lớp/import Excel).
 */
@Injectable()
export class AdminClassCatalogService {
  private readonly importPreviewCache = new Map<
    string,
    CachedClassImportPlan
  >();

  constructor(
    private readonly repository: AdminClassCatalogRepository,
    private readonly prisma: PrismaService,
  ) {}

  /** Lấy danh sách lớp có phân trang, tìm kiếm và lọc theo ngành/khoa. Mặc định chỉ lấy lớp chưa xóa mềm. */
  async findAll(
    query: GetClassesQueryDto,
  ): Promise<PaginatedResult<AdminClassResponse>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.ClassWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.majorId ? { majorId: query.majorId } : {}),
      ...(query.facultyId ? { major: { facultyId: query.facultyId } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { major: { name: { contains: search, mode: 'insensitive' } } },
              {
                major: {
                  faculty: { name: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const { items, total } = await this.repository.findMany(where, skip, limit);

    return {
      items: items.map(mapToAdminClassResponse),
      page,
      limit,
      total,
    };
  }

  /** Xem chi tiết 1 lớp - cho phép xem cả lớp đã xóa mềm để phục vụ tra cứu/audit. */
  async findOne(id: string): Promise<AdminClassDetailResponse> {
    const classRecord = await this.repository.findDetailById(id);

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    return mapToAdminClassDetailResponse(classRecord);
  }

  async findOneForClassLeader(
    userId: string,
    role: UserRole,
    id: string,
  ): Promise<AdminClassDetailResponse> {
    const classRecord = await this.repository.findDetailById(id);

    if (!classRecord || classRecord.deletedAt) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    if (role === UserRole.Admin) {
      return mapToAdminClassDetailResponse(classRecord);
    }

    if (role === UserRole.Faculty) {
      const assignment = await this.prisma.facultyAssignment.findUnique({
        where: { userId },
        select: { facultyId: true },
      });

      if (!assignment || assignment.facultyId !== classRecord.major.faculty.id) {
        throw new ForbiddenException('Bạn không được quản lý khoa của lớp này');
      }

      return mapToAdminClassDetailResponse(classRecord);
    }

    const isAssigned = [
      ...classRecord.classLeaderAssignments,
      ...classRecord.advisorAssignments,
    ].some((assignment) => assignment.userId === userId);

    if (!isAssigned) {
      throw new ForbiddenException('Bạn không được phân công phụ trách lớp này');
    }

    return mapToAdminClassDetailResponse(classRecord);
  }

  async create(dto: CreateClassDto): Promise<AdminClassResponse> {
    await this.assertMajorExists(dto.majorId);
    const code = normalizeClassCode(dto.code);
    await this.assertCodeAvailable(code);

    try {
      const classRecord = await this.repository.create({
        code,
        name: dto.name.trim(),
        majorId: dto.majorId,
        enrollmentYear: dto.enrollmentYear,
      });

      return mapToAdminClassResponse(classRecord);
    } catch (error) {
      this.handleKnownClassError(error);
      throw error;
    }
  }

  async generateImportTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sách lớp');

    sheet.columns = [
      { header: 'Mã lớp', key: 'code', width: 20 },
      { header: 'Tên lớp', key: 'name', width: 35 },
      { header: 'Tên khoa', key: 'facultyName', width: 35 },
      { header: 'Tên ngành', key: 'majorName', width: 35 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4472C4' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.addRow({
      code: 'CNTT01',
      name: 'Công nghệ thông tin 01',
      facultyName: 'Công nghệ thông tin',
      majorName: 'Công nghệ phần mềm',
    });
    sheet.addRow({
      code: 'CNTT02',
      name: 'Công nghệ thông tin 02',
      facultyName: 'Công nghệ thông tin',
      majorName: 'Hệ thống thông tin',
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async importFromTemplate(
    file: UploadedClassExcelFile | undefined,
  ): Promise<ImportClassesPreviewResponse> {
    const rows = parseUploadedClassFile(file);
    const errors: ImportClassesResult['errors'] = [];
    const seenCodes = new Map<string, number>();
    const validRows: Array<{
      rowNumber: number;
      code: string;
      name: string;
      facultyName: string;
      majorName: string;
      enrollmentYear: number;
    }> = [];

    for (const row of rows) {
      try {
        const code = normalizeClassCode(row.code ?? '');
        const name = row.name?.trim() ?? '';
        const facultyName = row.facultyName?.trim() ?? '';
        const majorName = row.majorName?.trim() ?? '';
        const enrollmentYear = inferEnrollmentYear(code, name);

        validateImportClassRow(
          code,
          name,
          facultyName,
          majorName,
          enrollmentYear,
        );

        const duplicateRow = seenCodes.get(code);
        if (duplicateRow !== undefined) {
          throw new BadRequestException(
            `Mã lớp bị trùng trong file với dòng ${duplicateRow}`,
          );
        }

        seenCodes.set(code, row.rowNumber);
        validRows.push({
          rowNumber: row.rowNumber,
          code,
          name,
          facultyName,
          majorName,
          enrollmentYear,
        });
      } catch (error) {
        errors.push({
          row: row.rowNumber,
          message:
            error instanceof Error
              ? error.message
              : 'Dòng dữ liệu không hợp lệ',
        });
      }
    }

    const majorValues = [
      ...new Set(validRows.map((row) => row.majorName).filter(Boolean)),
    ];
    const facultyValues = [
      ...new Set(validRows.map((row) => row.facultyName).filter(Boolean)),
    ];
    const majors =
      majorValues.length > 0
        ? await this.repository.findActiveMajorsByNamesOrCodes(
            majorValues,
            facultyValues,
          )
        : [];
    const majorsByValue = new Map<string, { id: string }>();

    for (const major of majors) {
      const facultyKeys = [
        normalizeLookupValue(major.faculty.name),
        normalizeLookupValue(major.faculty.code),
      ];
      const majorKeys = [
        normalizeLookupValue(major.name),
        normalizeLookupValue(major.code),
      ];

      for (const facultyKey of facultyKeys) {
        for (const majorKey of majorKeys) {
          majorsByValue.set(`${facultyKey}::${majorKey}`, major);
        }
      }
    }

    for (const row of validRows) {
      const major = majorsByValue.get(
        `${normalizeLookupValue(row.facultyName)}::${normalizeLookupValue(
          row.majorName,
        )}`,
      );

      if (!major) {
        errors.push({
          row: row.rowNumber,
          message: `Không tìm thấy ngành ${row.majorName} thuộc khoa ${row.facultyName}`,
        });
      }
    }

    const existingClasses =
      validRows.length > 0
        ? await this.repository.findByCodes(validRows.map((row) => row.code))
        : [];
    const existingByCode = new Map(
      existingClasses.map((classRecord) => [classRecord.code, classRecord]),
    );

    for (const row of validRows) {
      const existing = existingByCode.get(row.code);
      if (!existing) {
        continue;
      }

      errors.push({
        row: row.rowNumber,
        message: existing.deletedAt
          ? 'Mã lớp này đã thuộc về một lớp đã bị xóa mềm trước đó. Vui lòng dùng mã khác.'
          : 'Mã lớp đã tồn tại',
      });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Import file thất bại',
        errors: errors.map((error) => ({
          field: `row ${error.row}`,
          error: error.message,
        })),
      });
    }

    const previewRows = validRows.map((row) => {
      const major = majorsByValue.get(
        `${normalizeLookupValue(row.facultyName)}::${normalizeLookupValue(
          row.majorName,
        )}`,
      );

      if (!major) {
        throw new BadRequestException('Không xác định được ngành của lớp');
      }

      return {
        code: row.code,
        name: row.name,
        majorId: major.id,
        facultyName: row.facultyName,
        majorName: row.majorName,
        enrollmentYear: row.enrollmentYear,
      };
    });

    const importToken = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_PREVIEW_TTL_MS);
    this.importPreviewCache.set(importToken, {
      expiresAt: expiresAt.getTime(),
      totalRows: rows.length,
      rows: previewRows,
    });

    return {
      importToken,
      expiresAt,
      totalRows: rows.length,
      successCount: previewRows.length,
      previewCount: previewRows.length,
      previewClasses: previewRows.map((row) => ({
        code: row.code,
        name: row.name,
        facultyName: row.facultyName,
        majorName: row.majorName,
        enrollmentYear: row.enrollmentYear,
      })),
      failedCount: 0,
      errors: [],
    };
  }

  async confirmImport(importToken: string): Promise<ImportClassesResult> {
    const plan = this.importPreviewCache.get(importToken);

    if (!plan) {
      throw new BadRequestException(
        'Phiên import không tồn tại hoặc đã được xác nhận',
      );
    }

    if (plan.expiresAt <= Date.now()) {
      this.importPreviewCache.delete(importToken);
      throw new BadRequestException(
        'Phiên import đã hết hạn, vui lòng tải lại file',
      );
    }

    this.importPreviewCache.delete(importToken);

    try {
      await this.repository.createMany(
        plan.rows.map((row) => ({
          code: row.code,
          name: row.name,
          majorId: row.majorId,
          enrollmentYear: row.enrollmentYear,
        })),
      );

      const createdRecords = await this.repository.findByCodes(
        plan.rows.map((row) => row.code),
      );
      const createdByCode = new Map(
        createdRecords.map((record) => [record.code, record]),
      );
      const createdClasses = plan.rows
        .map((row) => createdByCode.get(row.code))
        .filter((record): record is NonNullable<typeof record> =>
          Boolean(record),
        )
        .map(mapToAdminClassResponse);

      return {
        totalRows: plan.totalRows,
        successCount: createdClasses.length,
        createdCount: createdClasses.length,
        createdClasses,
        failedCount: 0,
        errors: [],
      };
    } catch (error) {
      this.handleKnownClassError(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateClassDto): Promise<AdminClassResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    const current = await this.repository.findActiveById(id);
    if (!current) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    if (dto.majorId !== undefined) {
      await this.assertMajorExists(dto.majorId);
    }

    const nextCode =
      dto.code !== undefined ? normalizeClassCode(dto.code) : undefined;

    if (nextCode !== undefined && nextCode !== current.code) {
      await this.assertCodeAvailable(nextCode);
    }

    try {
      const classRecord = await this.repository.update(id, {
        ...(nextCode !== undefined && { code: nextCode }),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.majorId !== undefined && { majorId: dto.majorId }),
        ...(dto.enrollmentYear !== undefined && {
          enrollmentYear: dto.enrollmentYear,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      });

      return mapToAdminClassResponse(classRecord);
    } catch (error) {
      this.handleKnownClassError(error);
      throw error;
    }
  }

  async updateClassLeaders(
    id: string,
    dto: UpdateClassLeadersDto,
  ): Promise<AdminClassDetailResponse> {
    const classRecord = await this.repository.findActiveById(id);
    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    const userIds = [...new Set(dto.userIds)];
    if (userIds.length > 0) {
      const users =
        await this.repository.findAssignableClassLeaderUsers(userIds);
      if (users.length !== userIds.length) {
        throw new BadRequestException(
          'Có tài khoản không hợp lệ, đã bị khóa/xóa hoặc không phải vai trò lớp trưởng',
        );
      }
    }

    try {
      await this.repository.replaceClassLeaders(id, userIds);
      return this.findOne(id);
    } catch (error) {
      this.handleKnownClassError(error);
      throw error;
    }
  }

  /**
   * Xóa mềm lớp bằng cách cập nhật deletedAt + isActive=false.
   * Chặn xóa nếu lớp còn sinh viên đang theo học hoặc đã phát sinh phiếu đánh giá,
   * tránh mất dấu vết dữ liệu đã gắn với lớp.
   */
  async remove(id: string): Promise<AdminClassResponse> {
    const classRecord = await this.repository.findActiveById(id);

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    if (classRecord._count.classStudents > 0) {
      throw new BadRequestException(
        'Không thể xóa lớp đang có sinh viên theo học. Vui lòng chuyển lớp hoặc xóa hồ sơ sinh viên trước.',
      );
    }

    if (classRecord._count.evaluationForms > 0) {
      throw new BadRequestException(
        'Không thể xóa lớp đã phát sinh phiếu đánh giá rèn luyện.',
      );
    }

    const removed = await this.repository.softDelete(id);

    return mapToAdminClassResponse(removed);
  }

  /** Kiểm tra ngành tồn tại và chưa xóa mềm trước khi gán cho lớp. */
  private async assertMajorExists(majorId: string): Promise<void> {
    const major = await this.repository.findActiveMajorById(majorId);

    if (!major) {
      throw new NotFoundException('Không tìm thấy ngành học');
    }
  }

  /**
   * Kiểm tra mã lớp còn dùng được không - phân biệt trùng với lớp đang hoạt động
   * hay trùng với lớp đã xóa mềm (không tự động ghi đè/khôi phục bản ghi cũ).
   */
  private async assertCodeAvailable(code: string): Promise<void> {
    const existing = await this.repository.findByCode(code);

    if (!existing) {
      return;
    }

    if (existing.deletedAt) {
      throw new ConflictException(
        'Mã lớp này đã thuộc về một lớp đã bị xóa mềm trước đó. Vui lòng dùng mã khác.',
      );
    }

    throw new ConflictException('Mã lớp đã tồn tại');
  }

  private handleKnownClassError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return;
    }

    if (error.code === 'P2002') {
      throw new ConflictException('Mã lớp đã tồn tại');
    }

    if (error.code === 'P2025') {
      throw new NotFoundException('Không tìm thấy lớp học');
    }
  }
}

function isExcelFile(file: UploadedClassExcelFile) {
  const fileName = file.originalname.toLowerCase();
  return (
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls') ||
    file.mimetype ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mimetype === 'application/vnd.ms-excel'
  );
}

function parseUploadedClassFile(
  file: UploadedClassExcelFile | undefined,
): ImportClassRow[] {
  if (!file) {
    throw new BadRequestException('Vui lòng tải lên file Excel');
  }

  if (!isExcelFile(file)) {
    throw new BadRequestException(
      'File import phải có định dạng .xlsx hoặc .xls',
    );
  }

  const rows = parseClassRows(file.buffer);
  if (rows.length === 0) {
    throw new BadRequestException('File Excel không có dữ liệu lớp');
  }

  return rows;
}

function parseClassRows(buffer: Buffer): ImportClassRow[] {
  const workbook = read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new BadRequestException('File Excel không có sheet dữ liệu');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new BadRequestException(
      'Không đọc được sheet dữ liệu trong file Excel',
    );
  }

  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  return rows
    .map((row, index) => ({
      rowNumber: index + 2,
      ...normalizeImportClassRow(row),
    }))
    .filter((row) => row.code || row.name || row.facultyName || row.majorName);
}

function normalizeImportClassRow(row: Record<string, unknown>) {
  const normalized: {
    code?: string;
    name?: string;
    facultyName?: string;
    majorName?: string;
  } = {};

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeHeader(key);
    const stringValue =
      value === null || value === undefined ? '' : String(value).trim();

    if (['ma_lop', 'code', 'class_code'].includes(normalizedKey)) {
      normalized.code = stringValue;
      continue;
    }

    if (['ten_lop', 'name', 'class_name'].includes(normalizedKey)) {
      normalized.name = stringValue;
      continue;
    }

    if (
      ['ten_khoa', 'ma_khoa', 'khoa', 'faculty', 'faculty_name'].includes(
        normalizedKey,
      )
    ) {
      normalized.facultyName = stringValue;
      continue;
    }

    if (
      [
        'ten_nganh',
        'ma_nganh',
        'nganh',
        'major',
        'major_name',
        'major_code',
      ].includes(normalizedKey)
    ) {
      normalized.majorName = stringValue;
    }
  }

  return normalized;
}

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function validateImportClassRow(
  code: string,
  name: string,
  facultyName: string,
  majorName: string,
  enrollmentYear: number,
): void {
  if (!code) {
    throw new BadRequestException('Mã lớp không được để trống');
  }

  if (code.length > 30) {
    throw new BadRequestException('Mã lớp không được vượt quá 30 ký tự');
  }

  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw new BadRequestException(
      'Mã lớp chỉ được chứa chữ in hoa, số, dấu gạch dưới hoặc gạch ngang',
    );
  }

  if (!name) {
    throw new BadRequestException('Tên lớp không được để trống');
  }

  if (name.length > 255) {
    throw new BadRequestException('Tên lớp không được vượt quá 255 ký tự');
  }

  if (!facultyName) {
    throw new BadRequestException('Tên khoa không được để trống');
  }

  if (!majorName) {
    throw new BadRequestException('Tên ngành không được để trống');
  }

  if (enrollmentYear < 2000 || enrollmentYear > 2100) {
    throw new BadRequestException('Năm tuyển sinh không hợp lệ');
  }
}

function inferEnrollmentYear(code: string, name: string): number {
  const source = `${code} ${name}`;
  const cohortMatch = source.match(/K(\d{2})/i);

  if (cohortMatch?.[1]) {
    return 2000 + Number(cohortMatch[1]);
  }

  return new Date().getFullYear();
}

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase();
}
