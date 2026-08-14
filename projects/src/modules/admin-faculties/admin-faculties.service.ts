import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, type PaginatedResult } from '../../common/shared';
import { FormStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { GetMajorsQueryDto } from '../admin-majors/dto/get-majors-query.dto';
import { mapToAdminMajorResponse } from '../admin-majors/mappers/admin-major.mapper';
import { adminMajorSelect } from '../admin-majors/selects/admin-major.select';
import type { AdminMajorResponse } from '../admin-majors/types/admin-major.types';
import { AdminFacultiesRepository } from './admin-faculties.repository';
import { CreateFacultyDto } from './dto/create-faculty.dto';
import { GetFacultiesQueryDto } from './dto/get-faculties-query.dto';
import { UpdateFacultyStatusDto } from './dto/update-faculty-status.dto';
import { UpdateFacultyDto } from './dto/update-faculty.dto';
import {
  mapToAdminFacultyResponse,
  normalizeFacultyCode,
} from './mappers/admin-faculty.mapper';
import type { AdminFacultyResponse } from './types/admin-faculty.types';
import type {
  FacultyClassStatsItem,
  FacultyClassStatsResponse,
  FacultyCouncilReviewItem,
  FacultyCouncilReviewResponse,
} from './types/faculty-class-stats.types';

@Injectable()
export class AdminFacultiesService {
  private readonly logger = new Logger(AdminFacultiesService.name);

  constructor(
    private readonly repository: AdminFacultiesRepository,
    private readonly prisma: PrismaService,
  ) {}

  /** Lấy danh sách khoa có phân trang, tìm kiếm và lọc. Mặc định chỉ lấy khoa chưa xóa mềm. */
  async findAll(
    query: GetFacultiesQueryDto,
  ): Promise<PaginatedResult<AdminFacultyResponse>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.FacultyWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const { items, total } = await this.repository.findMany(where, skip, limit);

    return {
      items: items.map(mapToAdminFacultyResponse),
      page,
      limit,
      total,
    };
  }

  /** Lấy danh sách ngành thuộc một khoa, dùng cho UI chọn Khoa -> Ngành. */
  async findMajors(
    facultyId: string,
    query: GetMajorsQueryDto,
  ): Promise<PaginatedResult<AdminMajorResponse>> {
    const faculty = await this.repository.findActiveById(facultyId);
    if (!faculty) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const where: Prisma.MajorWhereInput = {
      facultyId,
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.major.findMany({
        where,
        select: adminMajorSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.major.count({ where }),
    ]);

    return {
      items: items.map(mapToAdminMajorResponse),
      page,
      limit,
      total,
    };
  }

  /**
   * Endpoint /faculties/:id/majors dùng chung cho admin và khoa.
   * Admin xem mọi khoa, role khoa chỉ xem đúng khoa được gán cho tài khoản.
   */
  async findMajorsForViewer(
    userId: string,
    role: UserRole,
    facultyId: string,
    query: GetMajorsQueryDto,
  ): Promise<PaginatedResult<AdminMajorResponse>> {
    if (role === UserRole.Admin) {
      return this.findMajors(facultyId, query);
    }

    if (role === UserRole.Faculty) {
      const assignment = await this.prisma.facultyAssignment.findUnique({
        where: { userId },
        select: { facultyId: true },
      });

      if (!assignment || assignment.facultyId !== facultyId) {
        throw new ForbiddenException('Bạn không được quản lý khoa này');
      }

      return this.findMajors(facultyId, query);
    }

    throw new ForbiddenException('Không có quyền xem danh sách ngành của khoa này');
  }

  /** Xem chi tiết 1 khoa - cho phép xem cả khoa đã xóa mềm để phục vụ tra cứu/audit. */
  async findOne(id: string): Promise<AdminFacultyResponse> {
    const faculty = await this.repository.findById(id);

    if (!faculty) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    return mapToAdminFacultyResponse(faculty);
  }

  async create(dto: CreateFacultyDto): Promise<AdminFacultyResponse> {
    const code = normalizeFacultyCode(dto.code);
    await this.assertCodeAvailable(code);

    try {
      const faculty = await this.repository.create({
        code,
        name: dto.name.trim(),
      });

      return mapToAdminFacultyResponse(faculty);
    } catch (error) {
      this.handleKnownFacultyError(error);
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateFacultyDto,
  ): Promise<AdminFacultyResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    const current = await this.repository.findActiveById(id);
    if (!current) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const nextCode =
      dto.code !== undefined ? normalizeFacultyCode(dto.code) : undefined;

    if (nextCode !== undefined && nextCode !== current.code) {
      await this.assertCodeAvailable(nextCode);
    }

    try {
      const faculty = await this.repository.update(id, {
        ...(nextCode !== undefined && { code: nextCode }),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      });

      return mapToAdminFacultyResponse(faculty);
    } catch (error) {
      this.handleKnownFacultyError(error);
      throw error;
    }
  }

  /** Giữ lại endpoint /status riêng cho tương thích ngược - chỉ đổi isActive, không đổi code/name. */
  async updateStatus(
    id: string,
    dto: UpdateFacultyStatusDto,
  ): Promise<AdminFacultyResponse> {
    const current = await this.repository.findActiveById(id);
    if (!current) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const faculty = await this.repository.update(id, {
      isActive: dto.isActive,
    });

    return mapToAdminFacultyResponse(faculty);
  }

  /**
   * Xóa mềm khoa bằng cách cập nhật deletedAt + isActive=false.
   * Chặn xóa nếu khoa còn ngành học đang hoạt động,
   * tránh để dữ liệu con "mồ côi" tham chiếu tới 1 khoa đã bị xóa.
   */
  async remove(id: string): Promise<AdminFacultyResponse> {
    const faculty = await this.repository.findActiveById(id);

    if (!faculty) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    if (faculty._count.majors > 0) {
      throw new BadRequestException(
        'Không thể xóa khoa đang có ngành học hoạt động. Vui lòng ẩn hoặc xóa các ngành học trước.',
      );
    }

    const removed = await this.repository.softDelete(id);

    return mapToAdminFacultyResponse(removed);
  }

  /**
   * Kiểm tra mã khoa còn dùng được không - phân biệt rõ 2 trường hợp: trùng với khoa
   * đang hoạt động (Conflict thông thường) hay trùng với khoa đã xóa mềm (Conflict kèm
   * gợi ý rõ ràng, không tự động ghi đè/khôi phục bản ghi cũ).
   */
  private async assertCodeAvailable(code: string): Promise<void> {
    const existing = await this.repository.findByCode(code);

    if (!existing) {
      return;
    }

    if (existing.deletedAt) {
      throw new ConflictException(
        'Mã khoa này đã thuộc về một khoa đã bị xóa mềm trước đó. Vui lòng dùng mã khác.',
      );
    }

    throw new ConflictException('Mã khoa đã tồn tại');
  }

  /**
   * Thống kê danh sách lớp thuộc Khoa cho trang Faculty Dashboard (0 N+1 Query).
   */
  async getClassStatsForFaculty(
    facultyId: string,
    semesterId?: string,
  ): Promise<FacultyClassStatsResponse> {
    let targetSemesterId = semesterId;
    if (!targetSemesterId) {
      const activeSemester = await this.prisma.semester.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      targetSemesterId = activeSemester?.id;
    }

    const classes = await this.prisma.class.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        major: { facultyId },
      },
      select: {
        id: true,
        code: true,
        name: true,
        classLeaderAssignments: {
          select: {
            user: { select: { fullName: true, username: true } },
          },
          take: 1,
        },
        _count: {
          select: {
            classStudents: { where: { deletedAt: null } },
          },
        },
        evaluationForms: targetSemesterId
          ? {
              where: { semesterId: targetSemesterId },
              select: {
                status: true,
                updatedAt: true,
                classReviewedAt: true,
              },
            }
          : false,
      },
      orderBy: [{ code: 'asc' }],
    });

    const items: FacultyClassStatsItem[] = classes.map((cls) => {
      const totalStudents = cls._count.classStudents;
      const leaderUser = cls.classLeaderAssignments[0]?.user;
      const leaderName = leaderUser?.fullName || leaderUser?.username || '—';

      const forms = cls.evaluationForms || [];
      const submittedCount = forms.filter((f) => f.status !== FormStatus.draft).length;
      const pendingCount = forms.filter((f) => f.status === FormStatus.class_approved).length;
      const facultyApprovedCount = forms.filter(
        (f) => f.status === FormStatus.faculty_approved || f.status === FormStatus.finalized,
      ).length;

      let status: FacultyClassStatsItem['status'] = 'IN_PROGRESS';
      let statusLabel = 'Đang làm việc cấp Lớp';

      if (pendingCount > 0) {
        status = 'PENDING_FACULTY';
        statusLabel = 'Chờ Khoa gửi PĐT';
      } else if (totalStudents > 0 && facultyApprovedCount === totalStudents) {
        status = 'FACULTY_APPROVED';
        statusLabel = 'Đã gửi PĐT';
      }

      let transferredDate = '-';
      if (status === 'FACULTY_APPROVED' || status === 'PENDING_FACULTY') {
        const lastUpdated = forms
          .map((f) => f.classReviewedAt || f.updatedAt)
          .filter(Boolean)
          .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

        if (lastUpdated) {
          const d = new Date(lastUpdated);
          transferredDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        }
      }

      return {
        id: cls.id,
        className: cls.name || cls.code,
        classCode: cls.code,
        leader: leaderName,
        totalStudents,
        totalStudentsLabel: `${totalStudents} SV`,
        submittedCount,
        approvedCount: facultyApprovedCount,
        submittedFraction: `${submittedCount}/${totalStudents}`,
        status,
        statusLabel,
        transferredDate,
        canSubmitToTrainingDepartment: status === 'PENDING_FACULTY',
      };
    });

    return {
      totalClasses: items.length,
      items,
    };
  }

  /**
   * Lấy danh sách đánh giá của sinh viên trong một Lớp cho Hội đồng Khoa duyệt (Biên bản Hội đồng Khoa)
   */
  async getCouncilReviewForClass(
    facultyId: string,
    classId: string,
    semesterId?: string,
  ): Promise<FacultyCouncilReviewResponse> {
    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        name: true,
        code: true,
        major: { select: { facultyId: true } },
      },
    });

    if (!classRecord || classRecord.major.facultyId !== facultyId) {
      throw new ForbiddenException('Lớp học không thuộc khoa được gán');
    }

    const classStudents = await this.prisma.classStudent.findMany({
      where: { classId },
      select: {
        studentId: true,
        studentCode: true,
        student: {
          select: {
            id: true,
            fullName: true,
            username: true,
            dateOfBirth: true,
          },
        },
      },
      orderBy: { studentCode: 'asc' },
    });

    const formWhere: Prisma.EvaluationFormWhereInput = { classId };
    if (semesterId) {
      formWhere.semesterId = semesterId;
    } else {
      const activeSemester = await this.prisma.semester.findFirst({
        where: { isActive: true },
        select: { id: true },
      });
      if (activeSemester) {
        formWhere.semesterId = activeSemester.id;
      }
    }

    let evaluationForms = await this.prisma.evaluationForm.findMany({
      where: formWhere,
      select: {
        id: true,
        studentId: true,
        status: true,
        classScore: true,
        finalScore: true,
        studentScore: true,
        rank: true,
        note: true,
        student: {
          select: {
            id: true,
            fullName: true,
            username: true,
            dateOfBirth: true,
          },
        },
      },
    });

    if (evaluationForms.length === 0 && !semesterId) {
      evaluationForms = await this.prisma.evaluationForm.findMany({
        where: { classId },
        select: {
          id: true,
          studentId: true,
          status: true,
          classScore: true,
          finalScore: true,
          studentScore: true,
          rank: true,
          note: true,
          student: {
            select: {
              id: true,
              fullName: true,
              username: true,
              dateOfBirth: true,
            },
          },
        },
      });
    }

    const evalMap = new Map(evaluationForms.map((e) => [e.studentId, e]));

    this.logger.log(
      `[getCouncilReviewForClass] facultyId=${facultyId}, classId=${classId} (${classRecord.name || classRecord.code}) -> classStudents=${classStudents.length}, evaluationForms=${evaluationForms.length}`,
    );

    type StudentInfo = {
      studentId: string;
      studentCode: string;
      fullName: string;
      dateOfBirth: Date | null;
      form?: (typeof evaluationForms)[0];
    };

    const studentMap = new Map<string, StudentInfo>();

    for (const cs of classStudents) {
      studentMap.set(cs.studentId, {
        studentId: cs.studentId,
        studentCode: cs.studentCode || cs.student.username || '—',
        fullName: cs.student.fullName || '—',
        dateOfBirth: cs.student.dateOfBirth,
        form: evalMap.get(cs.studentId),
      });
    }

    for (const form of evaluationForms) {
      const existing = studentMap.get(form.studentId);
      if (existing) {
        existing.form = form;
      } else {
        studentMap.set(form.studentId, {
          studentId: form.studentId,
          studentCode: form.student?.username || '—',
          fullName: form.student?.fullName || '—',
          dateOfBirth: form.student?.dateOfBirth ?? null,
          form,
        });
      }
    }

    const allStudents = Array.from(studentMap.values());

    const items: FacultyCouncilReviewItem[] = allStudents.map((item, index) => {
      const form = item.form;
      const dob = item.dateOfBirth
        ? new Date(item.dateOfBirth).toLocaleDateString('vi-VN')
        : '—';

      return {
        stt: index + 1,
        studentId: item.studentId,
        studentCode: item.studentCode,
        fullName: item.fullName,
        dateOfBirth: dob,
        evaluationId: form?.id ?? null,
        status: form?.status ?? 'draft',
        classScore: form?.classScore ?? form?.studentScore ?? null,
        facultyScore: form?.finalScore ?? form?.classScore ?? null,
        classification: form?.rank ?? '—',
        note: form?.note ?? '',
      };
    });

    return {
      classId: classRecord.id,
      className: classRecord.name || classRecord.code,
      totalStudents: items.length,
      items,
    };
  }

  private handleKnownFacultyError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return;
    }

    if (error.code === 'P2002') {
      throw new ConflictException('Mã khoa đã tồn tại');
    }

    if (error.code === 'P2025') {
      throw new NotFoundException('Không tìm thấy khoa');
    }
  }
}
