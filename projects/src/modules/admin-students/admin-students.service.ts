import { ProfileCacheService } from '../../infrastructure/cache/profile-cache.service';
import { safeError } from '../../observability/safe-log';
import { normalizeUsername } from '../../common/helpers/username.helper';
import {
  assertUserIdentifiersAvailable,
  throwBusinessUniqueConflict,
} from '../../common/helpers/business-uniqueness.helper';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, UserRole } from '../../generated/prisma/client';
import type {
  PaginatedResult,
  UserRole as SharedUserRole,
} from '../../common/shared';
import { buildAccountActiveStateData } from '../../common/helpers/account-active-state.helper';
import {
  formatDateOnly,
  parseOptionalDateOnly,
} from '../../common/helpers/date-only.helper';
import { AuthTokenStoreService } from '../auth/jwt/auth-token-store';
import { PASSWORD_SALT_ROUNDS } from '../auth/constants/password.constants';
import { StudentAccountMailService } from '../mail/student-account-mail.service';
import { mapToDetailResponse } from '../training-evaluations/helpers/evaluation.mapper';
import {
  evaluationDetailSelect,
  type EvaluationDetailRecord,
} from '../training-evaluations/selects/evaluation-form.select';
import type { EvaluationDetailResponse } from '../training-evaluations/types/evaluation-form.types';
import { CreateStudentDto } from './dto/create-student.dto';
import { GetAdminStudentsQueryDto } from './dto/get-admin-students-query.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import {
  adminStudentSelect,
  type AdminStudentRecord,
} from './selects/admin-student.select';
import type { AdminStudentResponse } from './types/admin-student.types';

@Injectable()
export class AdminStudentsService {
  private readonly logger = new Logger(AdminStudentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenStore: AuthTokenStoreService,
    private readonly accountMailService: StudentAccountMailService,
    private readonly profiles: ProfileCacheService,
  ) {}

  /**
   * Lấy danh sách hồ sơ sinh viên có phân trang, tìm kiếm theo username/email/họ tên/
   * số điện thoại/mã sinh viên và lọc theo lớp/khoa. Mặc định chỉ lấy sinh viên chưa xóa mềm.
   */
  async findAll(
    query: GetAdminStudentsQueryDto,
  ): Promise<PaginatedResult<AdminStudentResponse>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const keyword = query.keyword?.trim();

    // Gộp mọi điều kiện lọc theo lớp/khoa vào 1 object duy nhất - tránh bug
    // key "classStudents" bị ghi đè khi khai báo lặp lại nhiều lần trong cùng where.
    const classFilter: Prisma.ClassStudentWhereInput = { deletedAt: null };
    if (query.classId) {
      classFilter.classId = query.classId;
    }
    if (query.facultyId) {
      classFilter.class = { major: { facultyId: query.facultyId } };
    }

    const where: Prisma.UserWhereInput = {
      role: UserRole.student,
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...((query.classId || query.facultyId) && {
        classStudents: { some: classFilter },
      }),
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: 'insensitive' } },
              { email: { contains: keyword, mode: 'insensitive' } },
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword, mode: 'insensitive' } },
              {
                classStudents: {
                  some: {
                    deletedAt: null,
                    studentCode: { contains: keyword, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [students, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: adminStudentSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: students.map(mapToAdminStudentResponse),
      page,
      limit,
      total,
    };
  }

  /** Xem chi tiết 1 hồ sơ sinh viên theo id - cho phép xem cả hồ sơ đã xóa mềm để phục vụ tra cứu. */
  async findOne(id: string): Promise<AdminStudentResponse> {
    const student = await this.prisma.user.findFirst({
      where: { id, role: UserRole.student },
      select: adminStudentSelect,
    });

    if (!student) {
      throw new NotFoundException('Không tìm thấy hồ sơ sinh viên');
    }

    return mapToAdminStudentResponse(student);
  }

  /**
   * Lấy toàn bộ phiếu đánh giá rèn luyện của một sinh viên cho màn chi tiết admin.
   * Response dùng mapper chi tiết chung để luôn có đủ điểm 5 mục, trạng thái duyệt
   * và minh chứng ảnh/file đính kèm sau khi sinh viên đánh giá.
   */
  async findEvaluations(id: string): Promise<EvaluationDetailResponse[]> {
    await this.assertStudentExists(id);

    const evaluations = await this.prisma.evaluationForm.findMany({
      relationLoadStrategy: 'join',
      where: { studentId: id },
      select: evaluationDetailSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return evaluations.map((evaluation: EvaluationDetailRecord) =>
      mapToDetailResponse(evaluation),
    );
  }

  /**
   * Tạo hồ sơ sinh viên mới - tạo User (role=student) với mật khẩu đã hash bằng bcrypt.
   * classId/studentCode là tùy chọn nhưng phải đi kèm nhau; nếu có sẽ tạo luôn enrollment
   * (ClassStudent) trong cùng 1 transaction để đảm bảo dữ liệu nhất quán.
   */
  async create(dto: CreateStudentDto): Promise<AdminStudentResponse> {
    this.assertEnrollmentFieldsPaired(dto.classId, dto.studentCode);

    if (dto.classId) {
      await this.assertClassExists(dto.classId);
    }

    if (dto.studentCode) {
      await this.assertStudentCodeAvailable(dto.studentCode);
    }

    const username = normalizeUsername(dto.username);
    await assertUserIdentifiersAvailable(this.prisma, {
      username,
      email: normalizeEmail(dto.email),
    });
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    try {
      const studentId = await this.prisma.$transaction(async (tx) => {
        const student = await tx.user.create({
          data: {
            username,
            email: normalizeEmail(dto.email),
            fullName: dto.fullName.trim(),
            passwordHash,
            role: UserRole.student,
            phone: dto.phone,
            dateOfBirth: parseOptionalDateOnly(dto.dateOfBirth),
          },
          select: { id: true },
        });

        if (dto.classId && dto.studentCode) {
          await tx.classStudent.create({
            data: {
              studentId: student.id,
              classId: dto.classId,
              studentCode: dto.studentCode,
            },
            select: { id: true },
          });
        }

        return student.id;
      });

      const response = await this.findOne(studentId);
      const mailResult = await this.sendCreatedStudentEmail(dto);

      return {
        ...response,
        accountEmailSent: false, // SMTP delivery is asynchronous.
        accountEmailQueued: mailResult.sent,
        accountEmailError: mailResult.error,
      };
    } catch (error) {
      this.handleKnownStudentError(error);
      throw error;
    }
  }

  /**
   * Cập nhật hồ sơ sinh viên: thông tin User (fullName/email/phone/dateOfBirth/isActive)
   * và/hoặc enrollment (classId/studentCode). Nếu sinh viên đã có enrollment, cho phép sửa
   * riêng lẻ từng field (giữ nguyên field còn lại); nếu chưa có thì bắt buộc truyền đủ cả 2
   * để tạo mới. Nếu isActive chuyển về false, đồng bộ lockedAt, xóa refresh token và thu hồi
   * phiên đăng nhập hiện tại ngay lập tức.
   */
  async update(
    id: string,
    dto: UpdateStudentDto,
  ): Promise<AdminStudentResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    await this.assertActiveStudentExists(id);

    const enrollmentUpdate = await this.resolveEnrollmentUpdate(
      id,
      dto.classId,
      dto.studentCode,
    );

    await assertUserIdentifiersAvailable(
      this.prisma,
      {
        username:
          dto.username !== undefined
            ? normalizeUsername(dto.username)
            : undefined,
        email: dto.email !== undefined ? normalizeEmail(dto.email) : undefined,
      },
      id,
    );

    const activeStateData =
      dto.isActive !== undefined
        ? buildAccountActiveStateData(dto.isActive)
        : {};

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(dto.fullName !== undefined && {
              fullName: dto.fullName.trim(),
            }),
            ...(dto.username !== undefined && {
              username: normalizeUsername(dto.username),
            }),
            ...(dto.email !== undefined && {
              email: normalizeEmail(dto.email),
            }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.dateOfBirth !== undefined && {
              dateOfBirth: parseOptionalDateOnly(dto.dateOfBirth),
            }),
            ...activeStateData,
          },
        });

        if (!enrollmentUpdate) {
          return;
        }

        if (enrollmentUpdate.existingId) {
          await tx.classStudent.update({
            where: { id: enrollmentUpdate.existingId },
            data: {
              classId: enrollmentUpdate.classId,
              studentCode: enrollmentUpdate.studentCode,
            },
          });
        } else {
          await tx.classStudent.create({
            data: {
              studentId: id,
              classId: enrollmentUpdate.classId,
              studentCode: enrollmentUpdate.studentCode,
            },
          });
        }
      });

      if (dto.isActive === false) {
        await this.tokenStore.revokeUserTokensIssuedBefore(id);
      }
      await this.profiles.invalidate(id);

      return await this.findOne(id);
    } catch (error) {
      this.handleKnownStudentError(error);
      throw error;
    }
  }

  /**
   * Xóa mềm hồ sơ sinh viên bằng cách cập nhật deletedAt trên cả User và ClassStudent
   * (nếu có enrollment đang hoạt động). Không xóa cứng - dữ liệu phiếu đánh giá/minh chứng
   * đã phát sinh vẫn được giữ nguyên.
   */
  async remove(id: string): Promise<AdminStudentResponse> {
    const student = await this.assertActiveStudentExists(id);
    const enrollment = student.classStudents[0];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          lockedAt: new Date(),
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
        },
      });

      if (enrollment && !enrollment.deletedAt) {
        await tx.classStudent.update({
          where: { id: enrollment.id },
          data: { deletedAt: new Date() },
        });
      }
    });

    await this.tokenStore.revokeUserTokensIssuedBefore(id);
    await this.profiles.invalidate(id);

    return this.findOne(id);
  }

  /**
   * Tính toán dữ liệu enrollment cần ghi khi update - lấy field còn thiếu từ enrollment
   * hiện có (nếu có) để cho phép sửa riêng lẻ classId hoặc studentCode.
   */
  private async resolveEnrollmentUpdate(
    studentId: string,
    classId: string | undefined,
    studentCode: string | undefined,
  ): Promise<{
    existingId: string | undefined;
    classId: string;
    studentCode: string;
  } | null> {
    if (classId === undefined && studentCode === undefined) {
      return null;
    }

    const existingEnrollment = await this.prisma.classStudent.findFirst({
      where: { studentId, deletedAt: null },
      select: { id: true, classId: true, studentCode: true },
    });

    const nextClassId = classId ?? existingEnrollment?.classId;
    const nextStudentCode = studentCode ?? existingEnrollment?.studentCode;

    if (!nextClassId || !nextStudentCode) {
      throw new BadRequestException(
        'Sinh viên chưa có lớp - cần cung cấp đầy đủ classId và studentCode để tạo enrollment mới',
      );
    }

    if (classId) {
      await this.assertClassExists(classId);
    }

    if (studentCode) {
      await this.assertStudentCodeAvailable(studentCode, studentId);
    }

    return {
      existingId: existingEnrollment?.id,
      classId: nextClassId,
      studentCode: nextStudentCode,
    };
  }

  private assertEnrollmentFieldsPaired(
    classId: string | undefined,
    studentCode: string | undefined,
  ): void {
    if (Boolean(classId) !== Boolean(studentCode)) {
      throw new BadRequestException(
        'classId và studentCode phải được truyền cùng nhau',
      );
    }
  }

  private async assertClassExists(classId: string): Promise<void> {
    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true },
    });

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }
  }

  /** Đảm bảo mã sinh viên chưa được dùng bởi sinh viên khác (chưa xóa mềm). */
  private async assertStudentCodeAvailable(
    studentCode: string,
    excludeStudentId?: string,
  ): Promise<void> {
    const existing = await this.prisma.classStudent.findFirst({
      where: { studentCode },
      select: { studentId: true },
    });

    if (existing && existing.studentId !== excludeStudentId) {
      throw new ConflictException('Mã sinh viên đã tồn tại');
    }
  }

  /** Đảm bảo id truyền vào thật sự là sinh viên; cho phép xem lịch sử kể cả hồ sơ đã xóa mềm. */
  private async assertStudentExists(id: string): Promise<void> {
    const student = await this.prisma.user.findFirst({
      where: { id, role: UserRole.student },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Không tìm thấy hồ sơ sinh viên');
    }
  }

  /** Đảm bảo sinh viên tồn tại, đúng role=student và chưa bị xóa mềm. */
  private async assertActiveStudentExists(
    id: string,
  ): Promise<AdminStudentRecord> {
    const student = await this.prisma.user.findFirst({
      where: { id, role: UserRole.student, deletedAt: null },
      select: adminStudentSelect,
    });

    if (!student) {
      throw new NotFoundException('Không tìm thấy hồ sơ sinh viên');
    }

    return student;
  }

  private handleKnownStudentError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return;
    }

    throwBusinessUniqueConflict(error);

    if (error.code === 'P2025') {
      throw new NotFoundException('Không tìm thấy hồ sơ sinh viên');
    }
  }

  private async sendCreatedStudentEmail(
    dto: CreateStudentDto,
  ): Promise<{ sent: boolean; error: string | null }> {
    if (!this.accountMailService.isConfigured()) {
      return {
        sent: false,
        error:
          'Chưa thiết lập chức năng gửi email nên tài khoản chưa được gửi đi',
      };
    }

    try {
      await this.accountMailService.sendStudentAccount({
        email: normalizeEmail(dto.email),
        fullName: dto.fullName.trim(),
        username: dto.username,
        password: dto.password,
        studentCode: dto.studentCode ?? 'Chưa gán',
      });

      return { sent: true, error: null };
    } catch (error) {
      this.logger.error({
        event: 'mail.student_account_failed',
        error: safeError(error),
      });

      return {
        sent: false,
        error: 'Chưa gửi được email tài khoản, vui lòng kiểm tra lại sau',
      };
    }
  }
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function mapToAdminStudentResponse(
  student: AdminStudentRecord,
): AdminStudentResponse {
  const enrollment = student.classStudents[0] ?? null;
  const currentClass = enrollment?.class ?? null;
  const currentMajor = currentClass?.major ?? null;
  const currentFaculty = currentMajor?.faculty ?? null;

  return {
    id: student.id,
    username: student.username,
    email: student.email,
    fullName: student.fullName,
    phone: student.phone,
    dateOfBirth: formatDateOnly(student.dateOfBirth),
    role: student.role as SharedUserRole,
    isActive: student.isActive,
    lockedAt: student.lockedAt,
    deletedAt: student.deletedAt,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
    studentInfo: {
      fullName: student.fullName,
      dateOfBirth: formatDateOnly(student.dateOfBirth),
      majorName: currentMajor?.name ?? null,
      phone: student.phone,
      email: student.email,
      studentCode: enrollment?.studentCode ?? null,
      classCode: currentClass?.code ?? null,
      enrollmentYear: currentClass?.enrollmentYear ?? null,
      facultyName: currentFaculty?.name ?? null,
    },
    studentCode: enrollment?.studentCode ?? null,
    enrolledAt: enrollment?.enrolledAt ?? null,
    class: currentClass
      ? {
          id: currentClass.id,
          code: currentClass.code,
          name: currentClass.name,
        }
      : null,
    major: currentMajor
      ? {
          id: currentMajor.id,
          code: currentMajor.code,
          name: currentMajor.name,
        }
      : null,
    faculty: currentFaculty
      ? {
          id: currentFaculty.id,
          code: currentFaculty.code,
          name: currentFaculty.name,
        }
      : null,
  };
}
