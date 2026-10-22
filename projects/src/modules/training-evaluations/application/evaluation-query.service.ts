import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, type PaginatedResult } from '../../../common/shared';
import { PrismaService } from '../../../database/prisma.service';
import { FormStatus, Prisma } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  assertClassListAccess,
  assertEvaluationAccess,
  EvaluationAccessPolicy,
  type EvaluationActor,
  evaluationReadScope,
  facultyEvaluationScope,
} from '../domain/evaluation-access.policy';
import { AdminListEvaluationsQueryDto } from '../dto/admin-list-evaluations-query.dto';
import {
  mapToAdminApprovalListItem,
  mapToAdminListItem,
  mapToDetailResponse,
  mapToListResponse,
  mapToScoreSummaryResponse,
  mapToStatusResponse,
} from '../helpers/evaluation.mapper';
import { resolveSemesterId } from '../helpers/semester.helper';
import {
  evaluationAdminApprovalListSelect,
  evaluationAdminListSelect,
  evaluationDetailSelect,
  evaluationListSelect,
  evaluationScoreSummarySelect,
  evaluationStatusSelect,
  type EvaluationAdminListRecord,
  type EvaluationDetailRecord,
  type EvaluationScoreSummaryRecord,
  type EvaluationStatusRecord,
} from '../selects/evaluation-form.select';
import type {
  EvaluationAdminApprovalListItem,
  EvaluationAdminListItem,
  EvaluationDetailResponse,
  EvaluationListResponse,
  EvaluationScoreSummaryResponse,
  EvaluationStatusResponse,
} from '../types/evaluation-form.types';

/** Các truy vấn đọc và tra cứu phân công; giữ Prisma trực tiếp, không bọc thành repository. */
@Injectable()
export class EvaluationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // Giữ nguyên select/pagination; tối ưu join cần đo trên dataset đại diện riêng.
  async findAll(
    user: AuthenticatedUser,
    query: AdminListEvaluationsQueryDto,
  ): Promise<PaginatedResult<EvaluationAdminListItem>> {
    const { facultyId: scopeFacultyId } = await this.assertCanListEvaluations(
      user,
      query.classId,
      query.facultyId,
    );

    const targetFacultyId = scopeFacultyId ?? query.facultyId;

    const semesterId = await resolveSemesterId(
      this.prisma,
      query.semester,
      query.academicYear,
    );

    const where: Prisma.EvaluationFormWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.classId && { classId: query.classId }),
      ...(targetFacultyId && {
        class: { major: { facultyId: targetFacultyId } },
      }),
      ...(semesterId && { semesterId }),
      ...(query.keyword && {
        student: {
          OR: [
            { fullName: { contains: query.keyword, mode: 'insensitive' } },
            { email: { contains: query.keyword, mode: 'insensitive' } },
          ],
        },
      }),
    };

    const [evaluations, total] = await Promise.all([
      this.prisma.evaluationForm.findMany({
        where,
        select: evaluationAdminListSelect,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.evaluationForm.count({ where }),
    ]);

    return {
      items: evaluations.map((evaluation: EvaluationAdminListRecord) =>
        mapToAdminListItem(evaluation),
      ),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /**
   * Lấy danh sách tất cả phiếu của sinh viên đang đăng nhập,
   * sắp xếp mới nhất lên đầu.
   */
  async findMine(actor: EvaluationActor): Promise<EvaluationListResponse[]> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const userId = actor.id;
    const evaluations = await this.prisma.evaluationForm.findMany({
      // Small per-student list with one many-to-one relation; measured lower latency and unchanged payload.
      relationLoadStrategy: 'join',
      where: { studentId: userId },
      select: evaluationListSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return evaluations.map(mapToListResponse);
  }

  /**
   * Lấy chi tiết một phiếu đánh giá theo ID.
   * Sinh viên chỉ xem phiếu của mình; các cấp khác bị giới hạn theo assignment, admin/PĐT đọc toàn hệ thống.
   */
  async findOne(
    userId: string,
    role: UserRole,
    id: string,
  ): Promise<EvaluationDetailResponse> {
    const evaluation = await this.findAccessible<
      typeof evaluationDetailSelect,
      EvaluationDetailRecord
    >(userId, role, id, evaluationDetailSelect, {
      relationLoadStrategy: 'join',
    });
    return mapToDetailResponse(evaluation);
  }

  /**
   * Lấy tóm tắt điểm toàn phiếu: điểm SV tự chấm, điểm lớp, điểm cuối,
   * điểm từng mục và trạng thái trong luồng duyệt.
   * Sinh viên chỉ xem phiếu của mình; các cấp khác bị giới hạn theo assignment, admin/PĐT đọc toàn hệ thống.
   */
  async getSummary(
    userId: string,
    role: UserRole,
    id: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    const evaluation = await this.findAccessible<
      typeof evaluationScoreSummarySelect,
      EvaluationScoreSummaryRecord
    >(userId, role, id, evaluationScoreSummarySelect, {
      // One many-to-one relation (semester); measured lower Supabase round-trips with identical payload.
      relationLoadStrategy: 'join',
    });
    return mapToScoreSummaryResponse(evaluation);
  }

  /**
   * Lấy trạng thái hiện tại và lịch sử duyệt phiếu (4 bước).
   * Sinh viên chỉ xem phiếu của mình; các cấp khác bị giới hạn theo assignment, admin/PĐT đọc toàn hệ thống.
   */
  async getStatus(
    userId: string,
    role: UserRole,
    id: string,
  ): Promise<EvaluationStatusResponse> {
    const evaluation = await this.findAccessible<
      typeof evaluationStatusSelect,
      EvaluationStatusRecord
    >(userId, role, id, evaluationStatusSelect, {
      // One many-to-one relation (semester); measured lower Supabase round-trips with identical payload.
      relationLoadStrategy: 'join',
    });
    return mapToStatusResponse(evaluation);
  }

  // ─── Private: DB queries ────────────────────────────────────────────────────

  /**
   * Query phiếu để đọc với phân quyền theo role.
   * Student chỉ xem phiếu của mình; reviewer/khoa phải có assignment đúng lớp/khoa.
   */
  private async findAccessible<
    TSelect extends Prisma.EvaluationFormSelect,
    TResult,
  >(
    userId: string,
    role: UserRole,
    id: string,
    select: TSelect,
    options?: { relationLoadStrategy?: Prisma.RelationLoadStrategy },
  ): Promise<TResult> {
    const actor = { id: userId, role };
    EvaluationAccessPolicy.assertRole('read', actor);
    const where = evaluationReadScope(userId, role, id);

    const accessSelect: Prisma.EvaluationFormSelect = {
      ...select,
      studentId: true,
      classId: true,
      ...(role === UserRole.Faculty && {
        class: { select: { major: { select: { facultyId: true } } } },
      }),
    };
    const evaluation = await this.prisma.evaluationForm.findFirst({
      where,
      select: accessSelect,
      ...options,
    });

    if (!evaluation) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    const facts = evaluation as unknown as {
      studentId: string;
      classId: string;
      class?: { major: { facultyId: string } };
    };
    if (role === UserRole.Faculty) {
      const assignment = await this.prisma.facultyAssignment.findUnique({
        where: { userId },
        select: {
          facultyId: true,
          faculty: { select: { isActive: true, deletedAt: true } },
        },
      });
      assertEvaluationAccess(
        EvaluationAccessPolicy.canRead(actor, {
          facultyId: facts.class?.major.facultyId,
          assignedFacultyId: assignment?.facultyId,
          facultyAvailable:
            assignment?.faculty.isActive === true &&
            !assignment.faculty.deletedAt,
        }),
        'Bạn không có quyền xem phiếu của khoa khác',
      );
    } else if (role === UserRole.ClassLeader || role === UserRole.Advisor) {
      await this.assertClassAccess(actor, facts.classId, 'read');
    } else {
      assertEvaluationAccess(EvaluationAccessPolicy.canRead(actor, facts));
    }
    return evaluation as TResult;
  }
  /** I/O chỉ đọc dữ kiện; canRead/canReview/canSubmitClass quyết định quyền ở domain. */
  async assertClassAccess(
    actor: EvaluationActor,
    classId: string,
    action: 'read' | 'review' | 'submitClass',
    database: Prisma.TransactionClient = this.prisma,
    requiredRole?: UserRole,
  ): Promise<void> {
    EvaluationAccessPolicy.assertRole(action, actor, requiredRole);
    let assigned = false;
    if (actor.role === UserRole.Advisor) {
      assigned = Boolean(
        await database.advisorAssignment.findUnique({
          where: { userId_classId: { userId: actor.id, classId } },
          select: { id: true },
        }),
      );
    } else if (actor.role === UserRole.ClassLeader) {
      assigned = Boolean(
        await database.classLeaderAssignment.findFirst({
          where: { userId: actor.id, classId },
          select: { id: true },
        }),
      );
    }
    const facts = { assignedToClass: assigned };
    const allowed =
      action === 'read'
        ? EvaluationAccessPolicy.canRead(actor, facts)
        : action === 'review'
          ? EvaluationAccessPolicy.canReview(actor, facts)
          : EvaluationAccessPolicy.canSubmitClass(actor, facts, requiredRole);
    assertEvaluationAccess(
      allowed,
      'Bạn không được phân công phụ trách lớp này',
    );
  }
  /** Authorization-only cho receipt replay: không kiểm tra lại status/deadline của command cũ. */
  async assertFormAccess(
    actor: EvaluationActor,
    id: string,
    action: 'edit' | 'review',
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    EvaluationAccessPolicy.assertRole(action, actor);
    const form = await database.evaluationForm.findUnique({
      where: { id },
      select: { studentId: true, classId: true },
    });
    if (!form) throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    if (action === 'edit') {
      assertEvaluationAccess(EvaluationAccessPolicy.canEdit(actor, form));
    } else {
      await this.assertClassAccess(actor, form.classId, 'review', database);
    }
  }

  /** Dùng cho cả lần duyệt mới và replay; trả metadata đã đọc để tạo nội dung notification. */
  async requireFacultyAssignment(
    actor: EvaluationActor,
    facultyId: string,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    EvaluationAccessPolicy.assertRole('approveFaculty', actor);
    const assignment = await database.facultyAssignment.findUnique({
      where: { userId: actor.id },
      select: {
        facultyId: true,
        faculty: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });
    assertEvaluationAccess(
      assignment &&
        EvaluationAccessPolicy.canApproveFaculty(actor, {
          facultyId,
          assignedFacultyId: assignment.facultyId,
          facultyAvailable:
            assignment.faculty.isActive && !assignment.faculty.deletedAt,
        }),
      'Bạn không được phân công phụ trách khoa này',
    );
    return assignment;
  }

  private async assertCanListEvaluations(
    user: AuthenticatedUser,
    classId: string | undefined,
    facultyIdQuery?: string,
  ): Promise<{ facultyId?: string }> {
    if (EvaluationAccessPolicy.canFinalize(user)) return {};
    if (user.role === UserRole.Faculty) {
      const assignment = await this.prisma.facultyAssignment.findUnique({
        where: { userId: user.id },
        select: {
          facultyId: true,
          faculty: { select: { isActive: true, deletedAt: true } },
        },
      });
      assertEvaluationAccess(
        assignment &&
          EvaluationAccessPolicy.canRead(user, {
            facultyId: assignment.facultyId,
            assignedFacultyId: assignment.facultyId,
            facultyAvailable:
              assignment.faculty.isActive && !assignment.faculty.deletedAt,
          }),
        'Tài khoản khoa chưa được gán khoa quản lý hoạt động',
      );
      return facultyEvaluationScope(assignment.facultyId, facultyIdQuery);
    }
    assertClassListAccess(user.role, classId);
    await this.assertClassAccess(user, classId, 'read');
    return {};
  }

  /**
   * Lấy danh sách toàn bộ phiếu đánh giá trong hệ thống, có phân trang và bộ lọc nâng cao
   * (lớp, khoa, trạng thái, học kỳ, từ khóa tên/email sinh viên).
   * Không giới hạn theo sinh viên như phía client — admin xem được mọi phiếu.
   */
  async findAdminApprovalList(
    actor: EvaluationActor,
    query: AdminListEvaluationsQueryDto,
  ): Promise<PaginatedResult<EvaluationAdminApprovalListItem>> {
    assertEvaluationAccess(EvaluationAccessPolicy.canRead(actor, {}));
    const semesterId =
      query.semesterId ??
      (await resolveSemesterId(
        this.prisma,
        query.semester,
        query.academicYear,
      ));
    const search = query.search?.trim() || query.keyword?.trim();

    const where: Prisma.EvaluationFormWhereInput = {
      status: query.status ?? FormStatus.faculty_approved,
      ...(query.classId && { classId: query.classId }),
      ...(query.facultyId && {
        class: { major: { facultyId: query.facultyId } },
      }),
      ...(semesterId && { semesterId }),
      ...(search && {
        student: {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            {
              classStudents: {
                some: {
                  studentCode: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ],
        },
      }),
    };

    const [evaluations, total] = await Promise.all([
      this.prisma.evaluationForm.findMany({
        where,
        relationLoadStrategy: 'join',
        select: evaluationAdminApprovalListSelect,
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.evaluationForm.count({ where }),
    ]);

    return {
      items: evaluations.map(mapToAdminApprovalListItem),
      page: query.page,
      limit: query.limit,
      total,
    };
  }
}
