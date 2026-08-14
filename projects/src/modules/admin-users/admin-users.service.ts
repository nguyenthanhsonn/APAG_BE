import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, UserRole as PrismaUserRole } from '../../generated/prisma/client';
import {
  UserRole as SharedUserRole,
  type PaginatedResult,
} from '../../common/shared';
import { buildAccountActiveStateData } from '../../common/helpers/account-active-state.helper';
import {
  formatDateOnly,
  parseOptionalDateOnly,
} from '../../common/helpers/date-only.helper';
import { AuthTokenStoreService } from '../auth/jwt/auth-token-store';
import { PASSWORD_SALT_ROUNDS } from '../auth/constants/password.constants';
import { StudentAccountMailService } from '../mail/student-account-mail.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { GetAdminUsersQueryDto } from './dto/get-admin-users-query.dto';
import { LockAdminUserDto } from './dto/lock-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import {
  adminUserSelect,
  type AdminUserRecord,
} from './selects/admin-user.select';
import type { AdminUserResponse } from './types/admin-user.types';

const MANAGED_PRISMA_USER_ROLES = [
  PrismaUserRole.admin,
  PrismaUserRole.class_leader,
  PrismaUserRole.advisor,
  PrismaUserRole.faculty,
  PrismaUserRole.training_department,
];

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenStore: AuthTokenStoreService,
    private readonly accountMailService: StudentAccountMailService,
  ) {}

  /**
   * Lấy danh sách tài khoản có phân trang, tìm kiếm theo username/email/họ tên/số điện thoại
   * và lọc theo vai trò/trạng thái hoạt động. Mặc định chỉ lấy tài khoản chưa xóa mềm.
   */
  async findAll(
    query: GetAdminUsersQueryDto,
  ): Promise<PaginatedResult<AdminUserResponse>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const keyword = query.keyword?.trim();

    const where: Prisma.UserWhereInput = {
      role: query.role
        ? toPrismaManagedUserRole(query.role)
        : { in: MANAGED_PRISMA_USER_ROLES },
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: 'insensitive' } },
              { email: { contains: keyword, mode: 'insensitive' } },
              { fullName: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: adminUserSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(mapToAdminUserResponse),
      page,
      limit,
      total,
    };
  }

  /** Xem chi tiết 1 tài khoản theo id - cho phép xem cả tài khoản đã xóa mềm để phục vụ tra cứu/audit. */
  async findOne(id: string): Promise<AdminUserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id, role: { in: MANAGED_PRISMA_USER_ROLES } },
      select: adminUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }

    return mapToAdminUserResponse(user);
  }

  /** Tạo tài khoản mới - mật khẩu được hash bằng bcrypt trước khi lưu vào CSDL. */
  async create(dto: CreateAdminUserDto): Promise<AdminUserResponse> {
    this.assertNotStudentRole(
      dto.role,
      'Vui lòng dùng API /admin/students để tạo sinh viên',
    );

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_SALT_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (dto.classId) {
          await assertClassExists(tx, dto.classId);
        }

        if (dto.facultyId) {
          await assertFacultyExists(tx, dto.facultyId);
        }

        const created = await tx.user.create({
          data: {
            username: dto.username,
            email: normalizeEmail(dto.email),
            fullName: dto.fullName.trim(),
            passwordHash,
            role: toPrismaManagedUserRole(dto.role),
            phone: dto.phone,
            dateOfBirth: parseOptionalDateOnly(dto.dateOfBirth),
          },
          select: adminUserSelect,
        });

        if (dto.classId) {
          await replaceManagedClassAssignment(tx, created.id, dto.role, dto.classId);
        }

        if (dto.facultyId) {
          await replaceManagedFacultyAssignment(tx, created.id, dto.role, dto.facultyId);
        }

        if (dto.classId || dto.facultyId) {
          return tx.user.findUniqueOrThrow({
            where: { id: created.id },
            select: adminUserSelect,
          });
        }

        return created;
      });

      const response = mapToAdminUserResponse(user);
      const mailResult = await this.sendCreatedManagedUserEmail(dto);

      return {
        ...response,
        accountEmailSent: mailResult.sent,
        accountEmailError: mailResult.error,
      };
    } catch (error) {
      this.handleKnownUserError(error);
      throw error;
    }
  }

  /**
   * Cập nhật thông tin tài khoản (fullName, email, phone, dateOfBirth, role, isActive).
   * Nếu isActive chuyển về false, đồng bộ lockedAt, xóa refresh token và thu hồi phiên
   * đăng nhập hiện tại ngay lập tức - giống hệt hành động khóa tài khoản.
   */
  async update(
    id: string,
    dto: UpdateAdminUserDto,
    currentUserId: string,
  ): Promise<AdminUserResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    await this.assertManagedActiveExists(id);

    if (dto.role !== undefined) {
      this.assertNotStudentRole(
        dto.role,
        'Không thể đổi vai trò thành sinh viên qua API này. Vui lòng dùng /admin/students',
      );
    }

    if (dto.isActive === false) {
      this.assertNotSelf(id, currentUserId, 'khóa');
    }

    const activeStateData =
      dto.isActive !== undefined
        ? buildAccountActiveStateData(dto.isActive)
        : {};

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (dto.classId) {
          await assertClassExists(tx, dto.classId);
        }

        if (dto.facultyId) {
          await assertFacultyExists(tx, dto.facultyId);
        }

        const updated = await tx.user.update({
          where: { id },
          data: {
            ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
            ...(dto.username !== undefined && { username: dto.username }),
            ...(dto.email !== undefined && { email: normalizeEmail(dto.email) }),
            ...(dto.phone !== undefined && { phone: dto.phone }),
            ...(dto.dateOfBirth !== undefined && {
              dateOfBirth: parseOptionalDateOnly(dto.dateOfBirth),
            }),
            ...(dto.role !== undefined && {
              role: toPrismaManagedUserRole(dto.role),
            }),
            ...activeStateData,
          },
          select: adminUserSelect,
        });

        const effectiveRole = (dto.role ?? updated.role) as SharedUserRole;

        if (dto.role !== undefined && !isClassManagedRole(dto.role)) {
          await clearManagedClassAssignments(tx, id);
        }

        if (dto.role !== undefined && !isFacultyManagedRole(dto.role)) {
          await clearManagedFacultyAssignments(tx, id);
        }

        if (dto.classId) {
          await replaceManagedClassAssignment(
            tx,
            id,
            effectiveRole,
            dto.classId,
          );
        }

        if (dto.facultyId) {
          await replaceManagedFacultyAssignment(
            tx,
            id,
            effectiveRole,
            dto.facultyId,
          );
        }

        return tx.user.findUniqueOrThrow({
          where: { id },
          select: adminUserSelect,
        });
      });

      if (dto.isActive === false) {
        this.tokenStore.revokeUserTokensIssuedBefore(id);
      }

      return mapToAdminUserResponse(user);
    } catch (error) {
      this.handleKnownUserError(error);
      throw error;
    }
  }

  /**
   * Khóa/mở khóa tài khoản người dùng.
   * Khóa: set isActive=false, lockedAt=hiện tại, xóa refresh token và thu hồi ngay phiên
   * đăng nhập đang hoạt động (kể cả access token chưa hết hạn). Mở khóa: set isActive=true,
   * lockedAt=null.
   */
  async lock(
    id: string,
    dto: LockAdminUserDto,
    currentUserId: string,
  ): Promise<AdminUserResponse> {
    await this.assertActiveExists(id);

    if (dto.locked) {
      this.assertNotSelf(id, currentUserId, 'khóa');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: buildAccountActiveStateData(!dto.locked),
      select: adminUserSelect,
    });

    if (dto.locked) {
      this.tokenStore.revokeUserTokensIssuedBefore(id);
    }

    return mapToAdminUserResponse(user);
  }

  /** Xóa mềm tài khoản khỏi hệ thống và thu hồi phiên đăng nhập đang hoạt động. */
  async remove(id: string, currentUserId: string): Promise<AdminUserResponse> {
    await this.assertActiveExists(id);
    this.assertNotSelf(id, currentUserId, 'xóa');

    try {
      const deletedAt = new Date();
      const user = await this.prisma.$transaction(async (tx) => {
        const deletedUser = await tx.user.update({
          where: { id },
          data: {
            deletedAt,
            isActive: false,
            lockedAt: deletedAt,
            refreshTokenHash: null,
            refreshTokenExpiresAt: null,
          },
          select: adminUserSelect,
        });

        if (deletedUser.role === PrismaUserRole.student) {
          await tx.classStudent.updateMany({
            where: { studentId: id, deletedAt: null },
            data: { deletedAt },
          });
        }

        return deletedUser;
      });

      this.tokenStore.revokeUserTokensIssuedBefore(id);

      return mapToAdminUserResponse(user);
    } catch (error) {
      this.handleKnownUserError(error);
      throw error;
    }
  }

  /** Đảm bảo tài khoản nhân sự được quản lý tồn tại và chưa bị xóa mềm trước khi cho phép chỉnh sửa thông tin. */
  private async assertManagedActiveExists(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        role: { in: MANAGED_PRISMA_USER_ROLES },
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }
  }

  /** Đảm bảo tài khoản bất kỳ role nào tồn tại và chưa bị xóa mềm trước khi khóa/xóa. */
  private async assertActiveExists(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }
  }

  /** Chặn admin tự khóa hoặc tự xóa chính tài khoản đang đăng nhập. */
  private assertNotSelf(
    targetId: string,
    currentUserId: string,
    action: string,
  ): void {
    if (targetId === currentUserId) {
      throw new ForbiddenException(`Bạn không thể tự ${action} chính mình`);
    }
  }

  private assertNotStudentRole(role: SharedUserRole, message: string): void {
    if (role === SharedUserRole.Student) {
      throw new BadRequestException(message);
    }
  }

  private async sendCreatedManagedUserEmail(
    dto: CreateAdminUserDto,
  ): Promise<{ sent: boolean; error: string | null }> {
    if (!this.accountMailService.isConfigured()) {
      return {
        sent: false,
        error:
          'Chưa thiết lập chức năng gửi email nên tài khoản chưa được gửi đi',
      };
    }

    try {
      await this.accountMailService.sendStaffAccount({
        email: normalizeEmail(dto.email),
        fullName: dto.fullName.trim(),
        username: dto.username,
        password: dto.password,
        roleLabel: getRoleLabel(dto.role),
      });

      return { sent: true, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Gửi email tài khoản thất bại';
      this.logger.error(
        `Gửi email tài khoản ${dto.role} thất bại: ${message}`,
      );

      return {
        sent: false,
        error: 'Chưa gửi được email tài khoản, vui lòng kiểm tra lại sau',
      };
    }
  }

  private handleKnownUserError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return;
    }

    if (error.code === 'P2002') {
      const target =
        (error.meta?.target as string[] | undefined)?.join(',') ?? '';

      if (target.includes('username')) {
        throw new ConflictException('Tên đăng nhập đã tồn tại');
      }

      throw new ConflictException('Email đã tồn tại');
    }

    if (error.code === 'P2025') {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }

    if (error.code === 'P2003') {
      throw new ConflictException(
        'Không thể xóa tài khoản này vì vẫn còn dữ liệu liên quan',
      );
    }
  }
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

type ManagedClassAssignmentTx = Pick<
  Prisma.TransactionClient,
  'class' | 'classLeaderAssignment' | 'advisorAssignment'
>;

async function assertClassExists(
  tx: ManagedClassAssignmentTx,
  classId: string,
): Promise<void> {
  const classRecord = await tx.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true },
  });

  if (!classRecord) {
    throw new NotFoundException('Không tìm thấy lớp phụ trách');
  }
}

function isClassManagedRole(role: SharedUserRole): boolean {
  return role === SharedUserRole.ClassLeader || role === SharedUserRole.Advisor;
}

async function clearManagedClassAssignments(
  tx: ManagedClassAssignmentTx,
  userId: string,
): Promise<void> {
  await Promise.all([
    tx.classLeaderAssignment.deleteMany({ where: { userId } }),
    tx.advisorAssignment.deleteMany({ where: { userId } }),
  ]);
}

async function replaceManagedClassAssignment(
  tx: ManagedClassAssignmentTx,
  userId: string,
  role: SharedUserRole,
  classId: string,
): Promise<void> {
  if (!isClassManagedRole(role)) {
    throw new BadRequestException(
      'Chỉ lớp trưởng hoặc CVHT mới được gán lớp phụ trách',
    );
  }

  await clearManagedClassAssignments(tx, userId);

  if (role === SharedUserRole.ClassLeader) {
    await tx.classLeaderAssignment.create({
      data: { userId, classId },
      select: { id: true },
    });
    return;
  }

  await tx.advisorAssignment.create({
    data: { userId, classId },
    select: { id: true },
  });
}

type ManagedFacultyAssignmentTx = Pick<
  Prisma.TransactionClient,
  'faculty' | 'facultyAssignment'
>;

async function assertFacultyExists(
  tx: ManagedFacultyAssignmentTx,
  facultyId: string,
): Promise<void> {
  const facultyRecord = await tx.faculty.findFirst({
    where: { id: facultyId, deletedAt: null },
    select: { id: true },
  });

  if (!facultyRecord) {
    throw new NotFoundException('Không tìm thấy khoa phụ trách');
  }
}

function isFacultyManagedRole(role: SharedUserRole): boolean {
  return role === SharedUserRole.Faculty;
}

async function clearManagedFacultyAssignments(
  tx: ManagedFacultyAssignmentTx,
  userId: string,
): Promise<void> {
  await tx.facultyAssignment.deleteMany({ where: { userId } });
}

async function replaceManagedFacultyAssignment(
  tx: ManagedFacultyAssignmentTx,
  userId: string,
  role: SharedUserRole,
  facultyId: string,
): Promise<void> {
  if (!isFacultyManagedRole(role)) {
    throw new BadRequestException(
      'Chỉ tài khoản đại diện khoa mới được gán khoa phụ trách',
    );
  }

  await clearManagedFacultyAssignments(tx, userId);

  await tx.facultyAssignment.create({
    data: { userId, facultyId },
    select: { id: true },
  });
}

function toPrismaManagedUserRole(role: SharedUserRole): PrismaUserRole {
  if (role === SharedUserRole.Admin) {
    return PrismaUserRole.admin;
  }

  if (role === SharedUserRole.ClassLeader) {
    return PrismaUserRole.class_leader;
  }

  if (role === SharedUserRole.Advisor) {
    return PrismaUserRole.advisor;
  }

  if (role === SharedUserRole.Faculty) {
    return PrismaUserRole.faculty;
  }

  if (role === SharedUserRole.TrainingDepartment) {
    return PrismaUserRole.training_department;
  }

  throw new BadRequestException(
    'API /admin/users chỉ quản lý tài khoản nhân sự',
  );
}

function getRoleLabel(role: SharedUserRole): string {
  switch (role) {
    case SharedUserRole.ClassLeader:
      return 'Lớp trưởng';
    case SharedUserRole.Advisor:
      return 'Cố vấn học tập';
    case SharedUserRole.Faculty:
      return 'Tài khoản Khoa';
    case SharedUserRole.TrainingDepartment:
      return 'Phòng Đào tạo';
    case SharedUserRole.Admin:
      return 'Quản trị viên';
    default:
      return 'Nhân sự';
  }
}

function mapToAdminUserResponse(user: AdminUserRecord): AdminUserResponse {
  const classAssignments =
    user.role === PrismaUserRole.advisor
      ? user.advisorAssignments
      : user.classLeaderAssignments;

  const primaryClass = classAssignments[0]?.class ?? null;
  const faculty = user.facultyAssignment?.faculty ?? null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    dateOfBirth: formatDateOnly(user.dateOfBirth),
    role: user.role as SharedUserRole,
    isActive: user.isActive,
    lockedAt: user.lockedAt,
    deletedAt: user.deletedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    classId: primaryClass?.id ?? null,
    facultyId: faculty?.id ?? null,
    class: primaryClass
      ? {
          id: primaryClass.id,
          code: primaryClass.code,
          name: primaryClass.name,
        }
      : null,
    faculty: faculty
      ? {
          id: faculty.id,
          code: faculty.code,
          name: faculty.name,
        }
      : null,
    managedClasses: classAssignments.map((assignment) => ({
      id: assignment.class.id,
      code: assignment.class.code,
      name: assignment.class.name,
      assignedAt: assignment.assignedAt,
    })),
    managedFaculty: user.facultyAssignment
      ? {
          id: user.facultyAssignment.faculty.id,
          code: user.facultyAssignment.faculty.code,
          name: user.facultyAssignment.faculty.name,
          assignedAt: user.facultyAssignment.assignedAt,
        }
      : null,
  };
}
