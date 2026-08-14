import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import { randomBytes, randomUUID } from 'node:crypto';
import { read, utils } from 'xlsx';
import {
  normalizeUsername,
  USERNAME_PATTERN,
} from '../../common/helpers/username.helper';
import {
  formatDateOnly,
  parseOptionalDateOnly,
} from '../../common/helpers/date-only.helper';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, UserRole as PrismaUserRole } from '../../generated/prisma/client';
import {
  UserRole as SharedUserRole,
  type PaginatedResult,
} from '../../common/shared';
import { PASSWORD_SALT_ROUNDS } from '../auth/constants/password.constants';
import { StudentAccountMailService } from '../mail/student-account-mail.service';
import { AddClassStudentDto } from './dto/add-class-student.dto';
import { GetClassStudentsQueryDto } from './dto/get-class-students-query.dto';
import {
  adminClassStudentSelect,
  type AdminClassStudentRecord,
} from './selects/admin-class-student.select';
import type {
  AdminClassStudentResponse,
  ImportClassStudentPreviewItem,
  ImportClassStudentsPreviewResponse,
  ImportClassStudentsResult,
} from './types/admin-class-student.types';

// Use SharedUserRole for JWT/controller authorization values, and PrismaUserRole
// for persisted User.role filters/writes so Prisma enum validation stays intact.

type ImportRow = {
  rowNumber: number;
  email?: string;
  studentId?: string;
  studentCode?: string;
  username?: string;
  fullName?: string;
  phone?: string;
  dateOfBirth?: Date | number | string;
  classCode?: string;
};

type ManageableClassRecord = {
  id: string;
  code: string;
  name: string;
  enrollmentYear: number;
  major: {
    name: string;
    facultyId: string;
    faculty: { name: string };
  };
};

type ImportToCreate = {
  row: ImportRow;
  classId: string;
  username: string;
  studentCode: string;
  plainPassword: string;
};

type ImportToEnroll = {
  studentId: string;
  classId: string;
  studentCode: string;
};

type ImportProfileUpdate = {
  studentId: string;
  phone: string;
};

type CachedImportPlan = {
  userId: string;
  role: SharedUserRole;
  expiresAt: number;
  totalRows: number;
  skippedCount: number;
  toCreate: ImportToCreate[];
  toEnroll: ImportToEnroll[];
  profileUpdates: ImportProfileUpdate[];
};

type ImportStudentRecord = {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: Date | null;
};

export type UploadedExcelFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

const IMPORT_GENERATED_PASSWORD_BYTES = 9;
const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;
const IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;
const IMPORT_EMAIL_BATCH_SIZE = 10;
const IMPORT_EMAIL_BATCH_DELAY_MS = 1_000;

@Injectable()
export class AdminClassesService {
  private readonly logger = new Logger(AdminClassesService.name);
  private readonly importPreviewCache = new Map<string, CachedImportPlan>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentAccountMailService: StudentAccountMailService,
  ) {}

  private logImportTiming(
    timingId: string,
    step: string,
    startedAt: number,
    context: Record<string, unknown> = {},
  ): void {
    this.logger.log({
      event: 'admin-students-import.timing',
      timingId,
      step,
      durationMs: Date.now() - startedAt,
      ...context,
    });
  }

  async findStudents(
    userId: string,
    role: SharedUserRole,
    classId: string,
    query: GetClassStudentsQueryDto,
  ): Promise<PaginatedResult<AdminClassStudentResponse>> {
    await this.assertCanManageClass(userId, role, classId);

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const where: Prisma.ClassStudentWhereInput = {
      classId,
      ...(search
        ? {
            OR: [
              { studentCode: { contains: search, mode: 'insensitive' } },
              { student: { email: { contains: search, mode: 'insensitive' } } },
              {
                student: {
                  fullName: { contains: search, mode: 'insensitive' },
                },
              },
              { student: { phone: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [students, total, classLeaderAssignments] = await Promise.all([
      this.prisma.classStudent.findMany({
        where,
        select: adminClassStudentSelect,
        orderBy: [{ enrolledAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.classStudent.count({ where }),
      this.prisma.classLeaderAssignment.findMany({
        where: { classId },
        select: { id: true, userId: true, assignedAt: true },
      }),
    ]);
    const classLeaderAssignmentByUserId = new Map(
      classLeaderAssignments.map((assignment) => [
        assignment.userId,
        { id: assignment.id, assignedAt: assignment.assignedAt },
      ]),
    );

    return {
      items: students.map((student) =>
        mapToAdminClassStudentResponse(
          student,
          classLeaderAssignmentByUserId.get(student.studentId) ?? null,
        ),
      ),
      page,
      limit,
      total,
    };
  }

  async addStudent(
    userId: string,
    role: SharedUserRole,
    classId: string,
    dto: AddClassStudentDto,
  ): Promise<AdminClassStudentResponse> {
    await this.assertCanManageClass(userId, role, classId);
    await this.assertStudentExists(dto.studentId);
    await this.assertStudentCodeAvailableForStudent(
      dto.studentCode,
      dto.studentId,
    );

    const currentEnrollment = await this.prisma.classStudent.findFirst({
      where: { studentId: dto.studentId },
      select: { id: true, classId: true },
    });

    const enrollment = currentEnrollment
      ? await this.prisma.classStudent.update({
          where: { id: currentEnrollment.id },
          data: {
            classId,
            studentCode: dto.studentCode,
          },
          select: adminClassStudentSelect,
        })
      : await this.prisma.classStudent.create({
          data: {
            classId,
            studentId: dto.studentId,
            studentCode: dto.studentCode,
          },
          select: adminClassStudentSelect,
        });

    return mapToAdminClassStudentResponse(enrollment);
  }

  async removeStudent(
    userId: string,
    role: SharedUserRole,
    classId: string,
    studentId: string,
  ): Promise<AdminClassStudentResponse> {
    await this.assertCanManageClass(userId, role, classId);

    const enrollment = await this.prisma.classStudent.findFirst({
      where: { classId, studentId },
      select: { ...adminClassStudentSelect },
    });

    if (!enrollment) {
      throw new NotFoundException('Không tìm thấy sinh viên trong lớp học');
    }

    const hasEvaluation = await this.prisma.evaluationForm.findFirst({
      where: { studentId, classId },
      select: { id: true },
    });

    if (hasEvaluation) {
      throw new BadRequestException(
        'Không thể xóa sinh viên khỏi lớp vì dữ liệu phiếu rèn luyện đã phát sinh.',
      );
    }

    await this.prisma.classStudent.delete({
      where: { id: enrollment.id },
      select: { id: true },
    });

    return mapToAdminClassStudentResponse(enrollment);
  }

  async importStudents(
    userId: string,
    role: SharedUserRole,
    classId: string,
    file: UploadedExcelFile | undefined,
  ): Promise<ImportClassStudentsPreviewResponse> {
    const timingId = createImportTimingId();
    const startedAt = Date.now();
    this.logImportTiming(timingId, 'api-preview-start', startedAt, {
      endpoint: '/admin/classes/:classId/students/import',
      userId,
      role,
      classId,
      fileName: file?.originalname ?? null,
      mimeType: file?.mimetype ?? null,
      fileSizeBytes: file?.buffer.length ?? 0,
    });

    const classRecord = await this.assertCanManageClass(userId, role, classId);
    const parseStartedAt = Date.now();
    const rows = parseUploadedImportFile(file);
    this.logImportTiming(timingId, 'parse-file', parseStartedAt, {
      endpoint: '/admin/classes/:classId/students/import',
      rowCount: rows.length,
      fileName: file?.originalname ?? null,
      fileSizeBytes: file?.buffer.length ?? 0,
    });

    const response = await this.previewImportParsedRows(
      userId,
      role,
      rows,
      timingId,
      classRecord,
    );
    this.logImportTiming(timingId, 'api-preview-done', startedAt, {
      endpoint: '/admin/classes/:classId/students/import',
      rowCount: rows.length,
      importToken: response.importToken,
      successCount: response.successCount,
      skippedCount: response.skippedCount,
      createdAccountCount: response.createdAccountCount,
    });

    return response;
  }

  async importStudentsFromTemplate(
    userId: string,
    role: SharedUserRole,
    file: UploadedExcelFile | undefined,
  ): Promise<ImportClassStudentsPreviewResponse> {
    const timingId = createImportTimingId();
    const startedAt = Date.now();
    this.logImportTiming(timingId, 'api-preview-start', startedAt, {
      endpoint: '/admin/students/import',
      userId,
      role,
      fileName: file?.originalname ?? null,
      mimeType: file?.mimetype ?? null,
      fileSizeBytes: file?.buffer.length ?? 0,
    });

    const parseStartedAt = Date.now();
    const rows = parseUploadedImportFile(file);
    this.logImportTiming(timingId, 'parse-file', parseStartedAt, {
      endpoint: '/admin/students/import',
      rowCount: rows.length,
      fileName: file?.originalname ?? null,
      fileSizeBytes: file?.buffer.length ?? 0,
    });

    const response = await this.previewImportParsedRows(
      userId,
      role,
      rows,
      timingId,
    );
    this.logImportTiming(timingId, 'api-preview-done', startedAt, {
      endpoint: '/admin/students/import',
      rowCount: rows.length,
      importToken: response.importToken,
      successCount: response.successCount,
      skippedCount: response.skippedCount,
      createdAccountCount: response.createdAccountCount,
    });

    return response;
  }

  async confirmImportStudents(
    userId: string,
    role: SharedUserRole,
    importToken: string,
  ): Promise<ImportClassStudentsResult> {
    const startedAt = Date.now();
    const timingId = createImportTimingId();
    this.logImportTiming(timingId, 'api-confirm-start', startedAt, {
      endpoint: '/admin/students/import/confirm',
      userId,
      role,
      importToken,
    });

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

    if (plan.userId !== userId || plan.role !== role) {
      throw new ForbiddenException(
        'Bạn không có quyền xác nhận phiên import này',
      );
    }

    this.importPreviewCache.delete(importToken);
    try {
      const result = await this.commitImportPlan(plan, timingId);
      this.logImportTiming(timingId, 'api-confirm-done', startedAt, {
        endpoint: '/admin/students/import/confirm',
        importToken,
        totalRows: result.totalRows,
        successCount: result.successCount,
        skippedCount: result.skippedCount,
        createdAccountCount: result.createdAccountCount,
        emailSentCount: result.emailSentCount,
        emailFailedCount: result.emailFailedCount,
      });

      return result;
    } catch (error) {
      this.logImportTiming(timingId, 'api-confirm-failed', startedAt, {
        endpoint: '/admin/students/import/confirm',
        importToken,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async generateImportTemplate(): Promise<Buffer> {
    return this.buildImportTemplate('CNTT01');
  }

  private async previewImportParsedRows(
    userId: string,
    role: SharedUserRole,
    rows: ImportRow[],
    timingId: string,
    fixedClassRecord?: ManageableClassRecord,
  ): Promise<ImportClassStudentsPreviewResponse> {
    const previewStartedAt = Date.now();
    const errors: ImportClassStudentsResult['errors'] = [];
    const preloadLabel = createImportTimingLabel(timingId, 'preload');
    const preloadStartedAt = Date.now();
    let classes: ManageableClassRecord[] = [];
    let existingStudents: ImportStudentRecord[] = [];
    let existingGeneratedUsernames: string[] = [];
    let existingEnrollments: Array<{
      classId: string;
      studentId: string;
      studentCode: string;
    }> = [];
    let enrollmentsByCode: Array<{
      classId: string;
      studentId: string;
      studentCode: string;
    }> = [];

    console.time(preloadLabel);
    try {
      classes = fixedClassRecord
        ? [fixedClassRecord]
        : await this.preloadImportClasses(rows);
      if (fixedClassRecord) {
        await this.assertCanManageClassRecord(userId, role, fixedClassRecord);
      } else {
        this.assertAdminRole(role);
      }

      existingStudents = await this.preloadImportStudents(rows);
      existingGeneratedUsernames =
        await this.preloadExistingGeneratedImportUsernames(rows);
      const existingStudentIds = existingStudents.map((student) => student.id);

      const studentCodesToCheck = collectImportStudentCodes(
        rows,
        existingStudents,
      );

      const [studentEnrollments, codeEnrollments] = await Promise.all([
        existingStudentIds.length > 0
          ? this.prisma.classStudent.findMany({
              where: { studentId: { in: existingStudentIds } },
              select: { classId: true, studentId: true, studentCode: true },
            })
          : Promise.resolve([]),
        studentCodesToCheck.length > 0
          ? this.prisma.classStudent.findMany({
              where: { studentCode: { in: studentCodesToCheck } },
              select: { classId: true, studentId: true, studentCode: true },
            })
          : Promise.resolve([]),
      ]);

      existingEnrollments = studentEnrollments;
      enrollmentsByCode = codeEnrollments;
    } finally {
      console.timeEnd(preloadLabel);
      this.logImportTiming(timingId, 'preload', preloadStartedAt, {
        rowCount: rows.length,
        classCount: classes.length,
        existingStudentCount: existingStudents.length,
        existingEnrollmentCount: existingEnrollments.length,
        codeEnrollmentCount: enrollmentsByCode.length,
      });
    }

    const planStartedAt = Date.now();

    const classByCode = new Map(
      classes.map((classRecord) => [
        normalizeComparableValue(classRecord.code),
        classRecord,
      ]),
    );
    const classByName = new Map(
      classes.map((classRecord) => [
        normalizeComparableValue(classRecord.name),
        classRecord,
      ]),
    );
    const studentByEmail = new Map(
      existingStudents.map((student) => [student.email, student]),
    );
    const studentByUsername = new Map(
      existingStudents.map((student) => [student.username, student]),
    );
    const studentById = new Map(
      existingStudents.map((student) => [student.id, student]),
    );
    const enrollmentByStudentId = new Map(
      existingEnrollments.map((enrollment) => [
        enrollment.studentId,
        enrollment,
      ]),
    );
    const enrollmentByCode = new Map(
      enrollmentsByCode.map((enrollment) => [
        enrollment.studentCode,
        enrollment,
      ]),
    );
    const toCreate: ImportToCreate[] = [];
    const toEnroll: ImportToEnroll[] = [];
    const profileUpdates: ImportProfileUpdate[] = [];
    const previewStudents: ImportClassStudentPreviewItem[] = [];
    const seenStudentCodes = new Set<string>();
    const seenStudentIds = new Set<string>();
    const seenNewEmails = new Set<string>();
    const seenNewUsernames = new Set<string>(existingGeneratedUsernames);
    let skippedCount = 0;

    for (const row of rows) {
      try {
        if (!row.studentId && !row.email && !row.username) {
          throw new BadRequestException(
            'Thiếu mã sinh viên hệ thống, email hoặc tên đăng nhập',
          );
        }

        const classRecord = resolveImportClass(
          row,
          fixedClassRecord,
          classByCode,
          classByName,
        );

        const student =
          (row.studentId ? studentById.get(row.studentId) : undefined) ??
          (row.email
            ? studentByEmail.get(normalizeEmail(row.email))
            : undefined) ??
          (row.username
            ? studentByUsername.get(normalizeUsername(row.username))
            : undefined);

        if (!student && row.studentId) {
          throw new BadRequestException(
            'Không tìm thấy sinh viên theo mã hệ thống trong file import',
          );
        }

        if (!student) {
          if (!row.email) {
            throw new BadRequestException(
              'Không tìm thấy sinh viên trong hệ thống và dòng import thiếu email để tạo tài khoản mới',
            );
          }
          if (!row.fullName) {
            throw new BadRequestException(
              'Không tìm thấy sinh viên trong hệ thống và dòng import thiếu họ tên để tạo tài khoản mới',
            );
          }

          parseOptionalDateOnly(row.dateOfBirth);

          const email = normalizeEmail(row.email);
          const username = generateUniqueImportUsername(
            row.fullName,
            seenNewUsernames,
          );
          if (seenNewEmails.has(email)) {
            throw new BadRequestException('Email bị trùng trong file import');
          }
          if (seenNewUsernames.has(username)) {
            throw new BadRequestException(
              'Tên đăng nhập bị trùng trong file import',
            );
          }

          const studentCode =
            row.studentCode ?? deriveStudentCodeFromEmail(email);
          validateImportStudentCode(studentCode);
          assertImportStudentCodeAvailable(
            studentCode,
            undefined,
            classRecord.id,
            enrollmentByCode,
            seenStudentCodes,
          );

          const plainPassword = generateImportPassword();
          seenNewEmails.add(email);
          seenNewUsernames.add(username);
          seenStudentCodes.add(studentCode);
          toCreate.push({
            row,
            classId: classRecord.id,
            username,
            studentCode,
            plainPassword,
          });
          previewStudents.push(
            buildPreviewStudentItem({
              row,
              action: 'create',
              studentId: null,
              studentCode,
              fullName: row.fullName,
              email,
              phone: row.phone ?? null,
              dateOfBirth: formatDateOnly(
                parseOptionalDateOnly(row.dateOfBirth) ?? null,
              ),
              username,
              password: plainPassword,
              classRecord,
              note: 'Sẽ tạo tài khoản sinh viên mới khi xác nhận',
            }),
          );
          continue;
        }

        if (seenStudentIds.has(student.id)) {
          throw new BadRequestException('Sinh viên bị trùng trong file import');
        }

        const studentCode =
          row.studentCode ??
          deriveStudentCodeFromEmail(student.email) ??
          deriveStudentCodeFromUsername(student.username);
        validateImportStudentCode(studentCode);

        const enrollmentByStudent = enrollmentByStudentId.get(student.id);
        if (
          enrollmentByStudent &&
          enrollmentByStudent.classId !== classRecord.id
        ) {
          throw new BadRequestException(
            'Sinh viên đã thuộc lớp khác, vui lòng chuyển lớp thủ công trước khi import',
          );
        }

        assertImportStudentCodeAvailable(
          studentCode,
          student.id,
          classRecord.id,
          enrollmentByCode,
          seenStudentCodes,
        );

        const importedPhone = row.phone?.trim();
        if (importedPhone && importedPhone !== student.phone) {
          profileUpdates.push({
            studentId: student.id,
            phone: importedPhone,
          });
        }

        if (enrollmentByStudent) {
          skippedCount += 1;
          previewStudents.push(
            buildPreviewStudentItem({
              row,
              action: 'skip',
              studentId: student.id,
              studentCode,
              fullName: student.fullName,
              email: student.email,
              phone: importedPhone ?? student.phone,
              dateOfBirth: formatDateOnly(student.dateOfBirth),
              username: student.username,
              password: null,
              classRecord,
              note: importedPhone
                ? 'Sinh viên đã có trong lớp, sẽ cập nhật số điện thoại khi xác nhận'
                : 'Sinh viên đã có trong lớp, bỏ qua khi xác nhận',
            }),
          );
          continue;
        }

        seenStudentIds.add(student.id);
        seenStudentCodes.add(studentCode);
        toEnroll.push({
          studentId: student.id,
          classId: classRecord.id,
          studentCode,
        });
        previewStudents.push(
          buildPreviewStudentItem({
            row,
            action: 'enroll',
            studentId: student.id,
            studentCode,
            fullName: student.fullName,
            email: student.email,
            phone: importedPhone ?? student.phone,
            dateOfBirth: formatDateOnly(student.dateOfBirth),
            username: student.username,
            password: null,
            classRecord,
            note: importedPhone
              ? 'Sẽ thêm sinh viên có sẵn vào lớp và cập nhật số điện thoại khi xác nhận'
              : 'Sẽ thêm sinh viên có sẵn vào lớp khi xác nhận',
          }),
        );
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

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Import file thất bại',
        errors: errors.map((error) => ({
          field: `row ${error.row}`,
          error: error.message,
        })),
      });
    }

    const importToken = randomUUID();
    const expiresAt = new Date(Date.now() + IMPORT_PREVIEW_TTL_MS);
    const previewCreatedAccounts = toCreate.map((item) => ({
      username: item.username,
      email: normalizeEmail(item.row.email ?? ''),
      password: item.plainPassword,
      studentCode: item.studentCode,
      fullName: item.row.fullName?.trim() ?? '',
    }));

    this.importPreviewCache.set(importToken, {
      userId,
      role,
      expiresAt: expiresAt.getTime(),
      totalRows: rows.length,
      skippedCount,
      toCreate,
      toEnroll,
      profileUpdates,
    });

    this.logImportTiming(timingId, 'build-preview-plan', planStartedAt, {
      rowCount: rows.length,
      createCount: toCreate.length,
      enrollCount: toEnroll.length,
      skippedCount,
      profileUpdateCount: profileUpdates.length,
      previewStudentCount: previewStudents.length,
    });
    this.logImportTiming(timingId, 'preview-total', previewStartedAt, {
      rowCount: rows.length,
      createCount: toCreate.length,
      enrollCount: toEnroll.length,
      skippedCount,
      profileUpdateCount: profileUpdates.length,
    });

    return {
      importToken,
      expiresAt,
      totalRows: rows.length,
      successCount: toCreate.length + toEnroll.length,
      skippedCount,
      createdAccountCount: previewCreatedAccounts.length,
      createdAccounts: previewCreatedAccounts,
      previewStudents,
      failedCount: 0,
      errors: [],
    };
  }

  private async commitImportPlan(
    plan: CachedImportPlan,
    timingId: string,
  ): Promise<ImportClassStudentsResult> {
    const commitStartedAt = Date.now();
    const createdAccounts: ImportClassStudentsResult['createdAccounts'] = [];
    const preparePasswordsLabel = createImportTimingLabel(
      timingId,
      'prepare-passwords',
    );
    const loopInsertLabel = createImportTimingLabel(timingId, 'loop-insert');
    const preparePasswordsStartedAt = Date.now();
    console.time(preparePasswordsLabel);
    const preparedCreates = await Promise.all(
      plan.toCreate.map(async (item) => ({
        ...item,
        passwordHash: await bcrypt.hash(
          item.plainPassword,
          PASSWORD_SALT_ROUNDS,
        ),
      })),
    );
    console.timeEnd(preparePasswordsLabel);
    this.logImportTiming(timingId, 'prepare-passwords', preparePasswordsStartedAt, {
      createCount: plan.toCreate.length,
    });

    const toEnroll = [...plan.toEnroll];
    const profileUpdateByStudentId = new Map(
      plan.profileUpdates.map((update) => [update.studentId, update]),
    );
    let successCount = 0;
    const loopInsertStartedAt = Date.now();
    console.time(loopInsertLabel);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const createUsersStartedAt = Date.now();
          if (preparedCreates.length > 0) {
            const usersToCreate = preparedCreates.map((item) => {
              if (!item.row.email) {
                throw new BadRequestException(
                  'Không tìm thấy sinh viên trong hệ thống và dòng import thiếu email để tạo tài khoản mới',
                );
              }

              if (!item.row.fullName) {
                throw new BadRequestException(
                  'Không tìm thấy sinh viên trong hệ thống và dòng import thiếu họ tên để tạo tài khoản mới',
                );
              }

              validateImportUsername(item.username);

              return {
                username: item.username,
                email: normalizeEmail(item.row.email),
                fullName: item.row.fullName.trim(),
                passwordHash: item.passwordHash,
                role: PrismaUserRole.student,
                phone: item.row.phone ?? null,
                dateOfBirth: parseOptionalDateOnly(item.row.dateOfBirth),
              };
            });

            let createdUsers: Array<{
              id: string;
              email: string;
              username: string;
            }>;

            try {
              // Bulk insert removes the N+1 create() round-trips that made
              // 100 new students spend ~20s+ waiting on the remote database.
              createdUsers = await tx.user.createManyAndReturn({
                data: usersToCreate,
                select: { id: true, email: true, username: true },
              });
            } catch (error) {
              handleImportUserCreateError(error);
              throw error;
            }

            if (createdUsers.length !== preparedCreates.length) {
              throw new ConflictException(
                'Số lượng tài khoản tạo mới không khớp với kế hoạch import',
              );
            }

            const createdUserByUsername = new Map(
              createdUsers.map((user) => [user.username, user]),
            );

            for (const item of preparedCreates) {
              const createdUser = createdUserByUsername.get(item.username);
              if (!createdUser) {
                throw new ConflictException(
                  'Không tìm thấy tài khoản vừa tạo để ghi danh vào lớp',
                );
              }

              createdAccounts.push({
                username: createdUser.username,
                email: createdUser.email,
                password: item.plainPassword,
                studentCode: item.studentCode,
                fullName: item.row.fullName?.trim() ?? '',
              });
              toEnroll.push({
                studentId: createdUser.id,
                classId: item.classId,
                studentCode: item.studentCode,
              });
            }
          }
          this.logImportTiming(
            timingId,
            'db-create-users',
            createUsersStartedAt,
            {
              createCount: preparedCreates.length,
            },
          );

          // Import template may include updated phone numbers for existing students.
          // Only non-empty phone cells are cached, so blank cells never clear data.
          const updateProfilesStartedAt = Date.now();
          for (const update of profileUpdateByStudentId.values()) {
            await tx.user.update({
              where: { id: update.studentId },
              data: { phone: update.phone },
              select: { id: true },
            });
          }
          this.logImportTiming(
            timingId,
            'db-update-existing-student-profiles',
            updateProfilesStartedAt,
            {
              profileUpdateCount: profileUpdateByStudentId.size,
            },
          );

          const createEnrollmentsStartedAt = Date.now();
          if (toEnroll.length > 0) {
            // Preview already validates uniqueness. A duplicate at confirm time
            // means the import plan is stale and should fail clearly.
            const result = await tx.classStudent.createMany({
              data: toEnroll,
            });
            successCount = result.count;
          }
          this.logImportTiming(
            timingId,
            'db-create-enrollments',
            createEnrollmentsStartedAt,
            {
              enrollInputCount: toEnroll.length,
              enrollCreatedCount: successCount,
            },
          );
        },
        {
          timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
        },
      );
    } finally {
      console.timeEnd(loopInsertLabel);
      this.logImportTiming(timingId, 'loop-insert-total', loopInsertStartedAt, {
        createCount: preparedCreates.length,
        enrollInputCount: toEnroll.length,
        profileUpdateCount: profileUpdateByStudentId.size,
      });
    }

    const sendEmailsLabel = createImportTimingLabel(timingId, 'send-emails');
    const sendEmailsStartedAt = Date.now();
    console.time(sendEmailsLabel);
    let emailResult: {
      sentCount: number;
      errors: ImportClassStudentsResult['emailErrors'];
    };

    try {
      emailResult = await this.sendCreatedAccountEmails(createdAccounts);
    } finally {
      console.timeEnd(sendEmailsLabel);
      this.logImportTiming(timingId, 'send-emails', sendEmailsStartedAt, {
        emailCount: createdAccounts.length,
      });
    }

    this.logImportTiming(timingId, 'commit-total', commitStartedAt, {
      totalRows: plan.totalRows,
      createCount: preparedCreates.length,
      enrollInputCount: toEnroll.length,
      profileUpdateCount: profileUpdateByStudentId.size,
      emailCount: createdAccounts.length,
      successCount,
    });

    return {
      totalRows: plan.totalRows,
      successCount,
      skippedCount: plan.skippedCount,
      createdAccountCount: createdAccounts.length,
      createdAccounts,
      emailSentCount: emailResult.sentCount,
      emailFailedCount: emailResult.errors.length,
      emailErrors: emailResult.errors,
      failedCount: 0,
      errors: [],
    };
  }

  private async sendCreatedAccountEmails(
    accounts: ImportClassStudentsResult['createdAccounts'],
  ): Promise<{
    sentCount: number;
    errors: ImportClassStudentsResult['emailErrors'];
  }> {
    if (accounts.length === 0) {
      return { sentCount: 0, errors: [] };
    }

    if (!this.studentAccountMailService.isConfigured()) {
      return {
        sentCount: 0,
        errors: accounts.map((account) => ({
          email: account.email,
          message:
            'Chưa thiết lập chức năng gửi email nên tài khoản chưa được gửi đi',
        })),
      };
    }

    const emailErrors: ImportClassStudentsResult['emailErrors'] = [];

    for (
      let index = 0;
      index < accounts.length;
      index += IMPORT_EMAIL_BATCH_SIZE
    ) {
      const batch = accounts.slice(index, index + IMPORT_EMAIL_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((account) =>
          this.studentAccountMailService.sendStudentAccount(account),
        ),
      );

      results.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
          return;
        }

        const account = batch[batchIndex];
        if (!account) {
          return;
        }

        emailErrors.push({
          email: account.email,
          message: 'Chưa gửi được email tài khoản, vui lòng kiểm tra lại sau',
        });
      });

      if (index + IMPORT_EMAIL_BATCH_SIZE < accounts.length) {
        // Keep the current API contract, but throttle SMTP bursts so providers
        // are less likely to rate-limit a 100-student import.
        await sleep(IMPORT_EMAIL_BATCH_DELAY_MS);
      }
    }

    return {
      sentCount: accounts.length - emailErrors.length,
      errors: emailErrors,
    };
  }

  private async preloadImportClasses(
    rows: ImportRow[],
  ): Promise<ManageableClassRecord[]> {
    const classCodes = [
      ...new Set(rows.map((row) => row.classCode?.trim()).filter(Boolean)),
    ] as string[];

    if (classCodes.length === 0) {
      return [];
    }

    return this.prisma.class.findMany({
      where: {
        OR: classCodes.flatMap((classCode) => [
          { code: { equals: classCode, mode: 'insensitive' as const } },
          { name: { equals: classCode, mode: 'insensitive' as const } },
        ]),
      },
      select: {
        id: true,
        code: true,
        name: true,
        enrollmentYear: true,
        major: {
          select: {
            name: true,
            facultyId: true,
            faculty: { select: { name: true } },
          },
        },
      },
    });
  }

  private async preloadImportStudents(
    rows: ImportRow[],
  ): Promise<ImportStudentRecord[]> {
    const studentIds = [
      ...new Set(rows.map((row) => row.studentId).filter(Boolean)),
    ] as string[];
    const emails = [
      ...new Set(
        rows
          .map((row) => row.email && normalizeEmail(row.email))
          .filter(Boolean),
      ),
    ] as string[];
    const usernames = [
      ...new Set(
        rows
          .map((row) =>
            normalizeUsername(
              row.username ?? row.studentCode ?? row.email?.split('@')[0] ?? '',
            ),
          )
          .filter(Boolean),
      ),
    ] as string[];
    const orConditions: Prisma.UserWhereInput[] = [
      ...(studentIds.length > 0 ? [{ id: { in: studentIds } }] : []),
      ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
      ...(usernames.length > 0 ? [{ username: { in: usernames } }] : []),
    ];

    if (orConditions.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        role: PrismaUserRole.student,
        deletedAt: null,
        OR: orConditions,
      },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        phone: true,
        dateOfBirth: true,
      },
    });
  }

  private async preloadExistingGeneratedImportUsernames(
    rows: ImportRow[],
  ): Promise<string[]> {
    const usernamePrefixes = [
      ...new Set(
        rows
          .map((row) =>
            row.fullName ? buildImportUsernameBase(row.fullName) : undefined,
          )
          .filter(Boolean),
      ),
    ] as string[];

    if (usernamePrefixes.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        OR: usernamePrefixes.map((usernamePrefix) => ({
          username: { startsWith: usernamePrefix },
        })),
      },
      select: { username: true },
    });

    return users.map((user) => user.username);
  }

  private async buildImportTemplate(classCode: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh sách');

    sheet.columns = [
      { header: 'Mã sinh viên', key: 'studentCode', width: 15 },
      { header: 'Họ và tên', key: 'fullName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Số điện thoại', key: 'phone', width: 18 },
      { header: 'Ngày sinh', key: 'dateOfBirth', width: 15 },
      { header: 'Lớp', key: 'className', width: 15 },
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
      studentCode: 'SV001',
      fullName: 'Nguyễn Văn A',
      email: 'vana@example.com',
      phone: '0901234567',
      dateOfBirth: '2004-01-01',
      className: classCode,
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async assertCanManageClass(
    userId: string,
    role: SharedUserRole,
    classId: string,
  ) {
    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        code: true,
        name: true,
        enrollmentYear: true,
        major: {
          select: {
            name: true,
            facultyId: true,
            faculty: { select: { name: true } },
          },
        },
      },
    });

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    await this.assertCanManageClassRecord(userId, role, classRecord);
    return classRecord;
  }

  private async assertCanManageClassRecord(
    userId: string,
    role: SharedUserRole,
    classRecord: ManageableClassRecord,
  ) {
    if (role === SharedUserRole.Admin) {
      return;
    }

    if (role === SharedUserRole.Faculty) {
      const assignment = await this.prisma.facultyAssignment.findUnique({
        where: { userId },
        select: { facultyId: true },
      });

      if (!assignment || assignment.facultyId !== classRecord.major.facultyId) {
        throw new ForbiddenException(
          'Bạn không được phân công quản lý khoa của lớp này',
        );
      }
      return;
    }

    if (![SharedUserRole.ClassLeader, SharedUserRole.Advisor].includes(role)) {
      throw new ForbiddenException('Bạn không có quyền quản lý lớp học này');
    }

    const assignment =
      role === SharedUserRole.Advisor
        ? await this.prisma.advisorAssignment.findUnique({
            where: {
              userId_classId: {
                userId,
                classId: classRecord.id,
              },
            },
            select: { id: true },
          })
        : await this.prisma.classLeaderAssignment.findFirst({
            where: { userId, classId: classRecord.id },
            select: { id: true },
          });

    if (!assignment) {
      throw new ForbiddenException(
        'Bạn không được phân công phụ trách lớp này',
      );
    }
  }

  private assertAdminRole(role: SharedUserRole): void {
    if (role !== SharedUserRole.Admin) {
      throw new ForbiddenException('Bạn không có quyền quản lý lớp học này');
    }
  }

  private async assertStudentExists(studentId: string) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentId, role: PrismaUserRole.student },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Không tìm thấy sinh viên');
    }
  }

  private async assertStudentCodeAvailableForStudent(
    studentCode: string,
    studentId: string,
  ) {
    const existing = await this.prisma.classStudent.findUnique({
      where: { studentCode },
      select: { studentId: true },
    });

    if (existing && existing.studentId !== studentId) {
      throw new ConflictException('Mã sinh viên đã được sử dụng');
    }
  }
}

function mapToAdminClassStudentResponse(
  record: AdminClassStudentRecord,
  classLeaderAssignment: { id: string; assignedAt: Date } | null = null,
): AdminClassStudentResponse {
  return {
    id: record.id,
    classId: record.classId,
    studentId: record.studentId,
    studentCode: record.studentCode,
    email: record.student.email,
    fullName: record.student.fullName,
    role: record.student.role,
    phone: record.student.phone,
    dateOfBirth: record.student.dateOfBirth,
    isActive: record.student.isActive,
    enrolledAt: record.enrolledAt,
    isClassLeader: Boolean(classLeaderAssignment),
    classLeaderAssignment,
  };
}

function buildPreviewStudentItem(params: {
  row: ImportRow;
  action: ImportClassStudentPreviewItem['action'];
  studentId: string | null;
  studentCode: string;
  fullName: string;
  email: string;
  phone: string | null;
  dateOfBirth: string | null;
  username: string;
  password: string | null;
  classRecord: ManageableClassRecord;
  note: string | null;
}): ImportClassStudentPreviewItem {
  return {
    row: params.row.rowNumber,
    action: params.action,
    studentId: params.studentId,
    studentCode: params.studentCode,
    fullName: params.fullName.trim(),
    email: normalizeEmail(params.email),
    phone: params.phone,
    dateOfBirth: params.dateOfBirth,
    username: params.username,
    password: params.password,
    classId: params.classRecord.id,
    classCode: params.classRecord.code,
    className: params.classRecord.name,
    majorName: params.classRecord.major.name,
    enrollmentYear: params.classRecord.enrollmentYear,
    facultyName: params.classRecord.major.faculty.name,
    note: params.note,
  };
}

function isExcelFile(file: UploadedExcelFile) {
  const fileName = file.originalname.toLowerCase();
  return (
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.xls') ||
    file.mimetype ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mimetype === 'application/vnd.ms-excel'
  );
}

function parseUploadedImportFile(file: UploadedExcelFile | undefined) {
  if (!file) {
    throw new BadRequestException('Vui lòng tải lên file Excel');
  }

  if (!isExcelFile(file)) {
    throw new BadRequestException(
      'File import phải có định dạng .xlsx hoặc .xls',
    );
  }

  const rows = parseImportRows(file.buffer);
  if (rows.length === 0) {
    throw new BadRequestException('File Excel không có dữ liệu sinh viên');
  }

  return rows;
}

function parseImportRows(buffer: Buffer): ImportRow[] {
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
    .map((row, index) => {
      const normalizedRow = normalizeImportRow(row);

      return {
        rowNumber: index + 2,
        studentId: getCellValue(normalizedRow, [
          'studentid',
          'student_id',
          'id',
          'masinhvienhethong',
        ]),
        email: getCellValue(normalizedRow, ['email', 'mail', 'gmail']),
        username: getCellValue(normalizedRow, [
          'username',
          'tendangnhap',
          'taikhoan',
        ]),
        fullName: getCellValue(normalizedRow, [
          'hovaten',
          'hoten',
          'fullname',
          'name',
        ]),
        phone: getCellValue(normalizedRow, ['sodienthoai', 'phone']),
        dateOfBirth: getRawCellValue(normalizedRow, [
          'ngaysinh',
          'dateofbirth',
          'dob',
        ]),
        studentCode: getCellValue(normalizedRow, [
          'studentcode',
          'student_code',
          'masinhvien',
          'masv',
          'mssv',
        ]),
        classCode: getCellValue(normalizedRow, [
          'lop',
          'class',
          'classcode',
          'malop',
        ]),
      };
    })
    .filter(
      (row) =>
        row.studentId ||
        row.email ||
        row.username ||
        row.fullName ||
        row.studentCode ||
        row.classCode,
    );
}

function getCellValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return undefined;
}

function getRawCellValue(
  row: Record<string, unknown>,
  keys: string[],
): Date | number | string | undefined {
  for (const key of keys) {
    const value = row[key];

    if (value === undefined || value === null || String(value).trim() === '') {
      continue;
    }

    if (value instanceof Date || typeof value === 'number') {
      return value;
    }

    return String(value).trim();
  }

  return undefined;
}

function normalizeImportRow(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>(
    (result, [key, value]) => {
      result[normalizeHeader(key)] = value;
      return result;
    },
    {},
  );
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

function normalizeComparableValue(value: string) {
  return normalizeHeader(value).replace(/_/g, '');
}

function isSameClassInImportFile(
  importedClass: string,
  classCode: string,
  className: string,
) {
  const imported = normalizeComparableValue(importedClass);
  return (
    imported === normalizeComparableValue(classCode) ||
    imported === normalizeComparableValue(className)
  );
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function deriveStudentCodeFromEmail(email: string) {
  const localPart = email.split('@')[0]?.trim();

  if (!localPart || localPart.length > 20) {
    return undefined;
  }

  return localPart;
}

function deriveStudentCodeFromUsername(username: string) {
  if (!username || username.length > 20) {
    return undefined;
  }

  return username;
}

function buildImportUsernameBase(fullName: string): string {
  const base = normalizeHeader(fullName).replace(/_/g, '').slice(0, 40);

  return base || 'sinhvien';
}

function generateImportUsername(fullName = 'sinhvien'): string {
  const suffix = randomBytes(2).readUInt16BE(0).toString().padStart(5, '0');
  return `${buildImportUsernameBase(fullName)}${suffix}`;
}

function generateUniqueImportUsername(
  fullName: string,
  seenUsernames: Set<string>,
): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = generateImportUsername(fullName);
    if (!seenUsernames.has(username)) {
      return username;
    }
  }

  throw new BadRequestException('Không thể sinh tên đăng nhập ngẫu nhiên');
}

function validateImportUsername(username: string): void {
  if (!username) {
    throw new BadRequestException('Thiếu tên đăng nhập để tạo tài khoản mới');
  }

  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestException(
      'Tên đăng nhập chỉ được chứa chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang, không chứa khoảng trắng',
    );
  }

  if (username.length < 3 || username.length > 50) {
    throw new BadRequestException('Tên đăng nhập phải có từ 3 đến 50 ký tự');
  }
}

function handleImportUserCreateError(error: unknown): void {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return;
  }

  if (error.code !== 'P2002') {
    return;
  }

  const target = (error.meta?.target as string[] | undefined)?.join(',') ?? '';

  if (target.includes('username')) {
    throw new ConflictException('Tên đăng nhập đã tồn tại');
  }

  throw new ConflictException('Email đã tồn tại');
}

function generateImportPassword(): string {
  return `Sv@${randomBytes(IMPORT_GENERATED_PASSWORD_BYTES).toString('base64url')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectImportStudentCodes(
  rows: ImportRow[],
  existingStudents: Array<{ id: string; email: string; username: string }>,
): string[] {
  const studentByEmail = new Map(
    existingStudents.map((student) => [student.email, student]),
  );
  const studentByUsername = new Map(
    existingStudents.map((student) => [student.username, student]),
  );
  const studentById = new Map(
    existingStudents.map((student) => [student.id, student]),
  );
  const studentCodes = new Set<string>();

  for (const row of rows) {
    if (row.studentCode) {
      studentCodes.add(row.studentCode);
      continue;
    }

    const student =
      (row.studentId ? studentById.get(row.studentId) : undefined) ??
      (row.email ? studentByEmail.get(normalizeEmail(row.email)) : undefined) ??
      (row.username
        ? studentByUsername.get(normalizeUsername(row.username))
        : undefined);
    const derivedCode = student
      ? (deriveStudentCodeFromEmail(student.email) ??
        deriveStudentCodeFromUsername(student.username))
      : row.email
        ? deriveStudentCodeFromEmail(normalizeEmail(row.email))
        : undefined;

    if (derivedCode) {
      studentCodes.add(derivedCode);
    }
  }

  return [...studentCodes];
}

function resolveImportClass(
  row: ImportRow,
  fixedClassRecord: ManageableClassRecord | undefined,
  classByCode: Map<string, ManageableClassRecord>,
  classByName: Map<string, ManageableClassRecord>,
): ManageableClassRecord {
  if (fixedClassRecord) {
    if (
      row.classCode &&
      !isSameClassInImportFile(
        row.classCode,
        fixedClassRecord.code,
        fixedClassRecord.name,
      )
    ) {
      throw new BadRequestException(
        `Lớp trong file (${row.classCode}) không khớp với lớp đang import (${fixedClassRecord.code})`,
      );
    }

    return fixedClassRecord;
  }

  if (!row.classCode) {
    throw new BadRequestException('Thiếu lớp');
  }

  const normalizedClass = normalizeComparableValue(row.classCode);
  const classRecord =
    classByCode.get(normalizedClass) ?? classByName.get(normalizedClass);

  if (!classRecord) {
    throw new BadRequestException(`Không tìm thấy lớp ${row.classCode}`);
  }

  return classRecord;
}

function validateImportStudentCode(
  studentCode: string | undefined,
): asserts studentCode is string {
  if (!studentCode) {
    throw new BadRequestException(
      'Thiếu mã sinh viên. Vui lòng bổ sung cột "Mã sinh viên" hoặc dùng email/tên đăng nhập có phần mã không quá 20 ký tự',
    );
  }

  if (studentCode.length > 20) {
    throw new BadRequestException('Mã sinh viên không được vượt quá 20 ký tự');
  }
}

function assertImportStudentCodeAvailable(
  studentCode: string,
  studentId: string | undefined,
  classId: string,
  enrollmentByCode: Map<
    string,
    { classId: string; studentId: string; studentCode: string }
  >,
  seenStudentCodes: Set<string>,
): void {
  if (seenStudentCodes.has(studentCode)) {
    throw new BadRequestException('Mã sinh viên bị trùng trong file import');
  }

  const enrollment = enrollmentByCode.get(studentCode);
  if (!enrollment) {
    return;
  }

  if (!studentId || enrollment.studentId !== studentId) {
    throw new BadRequestException(
      'Mã sinh viên đã được sử dụng cho sinh viên khác',
    );
  }

  if (enrollment.classId !== classId) {
    throw new BadRequestException(
      'Mã sinh viên đang thuộc lớp khác, vui lòng kiểm tra lại file import',
    );
  }
}

function createImportTimingId(): string {
  return randomBytes(4).toString('hex');
}

function createImportTimingLabel(timingId: string, step: string): string {
  return `admin-students-import:${timingId}:${step}`;
}
