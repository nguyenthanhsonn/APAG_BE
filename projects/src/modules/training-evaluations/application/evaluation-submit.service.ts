import {
  assertExpectedEvaluationVersion,
  assertExpectedEvaluationVersions,
} from './evaluation-concurrency';
import {
  EvaluationAccessPolicy,
  assertEvaluationAccess,
  type EvaluationActor,
} from '../domain/evaluation-access.policy';
import { EvaluationDeadlinePolicy } from '../domain/evaluation-deadline.policy';
import {
  idempotentOperation,
  type CommandDatabase,
  type AfterCommit,
} from '../../../common/idempotency/idempotent-operation';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { PrismaService } from '../../../database/prisma.service';
import { FormStatus, Prisma } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  mapToNotificationResponse,
  NotificationsService,
} from '../../notifications/notifications.service';
import { createNotificationOnce } from '../../notifications/create-notification-once';
import {
  assertNotLocked,
  assertTransition,
  EVALUATION_TRANSITIONS,
} from '../domain/evaluation-transition';
import {
  calculateClassification,
  calculateScoreResult,
} from '../domain/score-calculator';
import { CreateTrainingEvaluationDto } from '../dto/create-training-evaluation.dto';
import { SubmitClassToAdvisorDto } from '../dto/submit-class-to-advisor.dto';
import { SubmitClassToFacultyDto } from '../dto/submit-class-to-faculty.dto';
import { SubmitFacultyToTrainingDepartmentDto } from '../dto/submit-faculty-to-training-department.dto';
import {
  mapToListResponse,
  mapToScoreSummaryResponse,
} from '../helpers/evaluation.mapper';
import {
  parseAcademicYearStart,
  toSemesterNo,
} from '../helpers/semester.helper';
import {
  evaluationDeadlineSelect,
  evaluationListSelect,
  evaluationScoreSummarySelect,
} from '../selects/evaluation-form.select';
import type {
  EvaluationListResponse,
  EvaluationScoreSummaryResponse,
} from '../types/evaluation-form.types';
import {
  writeEvaluation,
  writeEvaluationAndRead,
} from './evaluation-concurrency';
import { EvaluationQueryService } from './evaluation-query.service';

/** Tạo, nộp và chuyển danh sách giữa các cấp; notification chỉ emit sau khi commit. */
@Injectable()
export class EvaluationSubmitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly queries: EvaluationQueryService,
  ) {}

  // ─── Quản lý phiếu (CRUD + lifecycle) ────────────────────────────────────────

  /**
   * Tạo phiếu đánh giá mới cho học kỳ/năm học được chỉ định.
   * Sinh viên phải thuộc ít nhất một lớp học và học kỳ phải tồn tại trong hệ thống.
   * Mỗi sinh viên chỉ được có tối đa 1 phiếu mỗi học kỳ (unique constraint).
   */
  async create(
    actor: EvaluationActor,
    dto: CreateTrainingEvaluationDto,
  ): Promise<EvaluationListResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const userId = actor.id;
    const academicYearStart = parseAcademicYearStart(dto.academicYear);
    const semesterNo = toSemesterNo(dto.semester);

    const [semester, currentClass] = await Promise.all([
      this.prisma.semester.findUnique({
        where: {
          year_semester: { year: academicYearStart, semester: semesterNo },
        },
        select: { id: true },
      }),
      this.prisma.classStudent.findFirst({
        where: { studentId: userId },
        orderBy: { enrolledAt: 'desc' },
        select: { classId: true },
      }),
    ]);

    if (!semester) {
      throw new NotFoundException(
        'Không tìm thấy thông tin học kỳ cho năm học được yêu cầu',
      );
    }

    if (!currentClass) {
      throw new BadRequestException(
        'Sinh viên phải thuộc một lớp học trước khi tạo phiếu đánh giá',
      );
    }

    const existing = await this.prisma.evaluationForm.findUnique({
      where: {
        studentId_semesterId: { studentId: userId, semesterId: semester.id },
      },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException(
        'Phiếu đánh giá đã tồn tại cho học kỳ và năm học này',
      );

    try {
      const evaluation = await this.prisma.evaluationForm.create({
        data: {
          studentId: userId,
          classId: currentClass.classId,
          semesterId: semester.id,
          status: FormStatus.draft,
          studentScore: 0,
        },
        select: evaluationListSelect,
      });

      return mapToListResponse(evaluation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Phiếu đánh giá đã tồn tại cho học kỳ và năm học này',
        );
      }
      throw error;
    }
  }

  /**
   * Sinh viên nộp phiếu để lớp/CVHT duyệt.
   * Chỉ nộp được khi phiếu đang là draft hoặc bị trả về (rejected).
   * Khi nộp, hệ thống tính lại tổng điểm và reset toàn bộ thông tin duyệt cũ.
   */
  async submit(
    actor: EvaluationActor,
    id: string,
    key?: string,
    expectedVersion?: number,
  ): Promise<EvaluationScoreSummaryResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const userId = actor.id;
    return idempotentOperation(
      this.prisma,
      {
        actorId: userId,
        action: 'submit',
        key,
        input: { id, expectedVersion },
        authorizeReplay: (database) =>
          this.queries.assertFormAccess(actor, id, 'edit', database),
      },
      (database) => this.submitCommand(actor, id, database, expectedVersion),
    );
  }

  private async submitCommand(
    actor: EvaluationActor,
    id: string,
    database: CommandDatabase,
    expectedVersion?: number,
  ): Promise<EvaluationScoreSummaryResponse> {
    const userId = actor.id;
    const current = await database.evaluationForm.findFirst({
      where: { id, studentId: userId },
      select: evaluationScoreSummarySelect,
    });

    if (!current) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    assertEvaluationAccess(EvaluationAccessPolicy.canEdit(actor, current));
    assertExpectedEvaluationVersion(current, expectedVersion);
    assertNotLocked(current);

    assertTransition(current.status, EVALUATION_TRANSITIONS.submit.target);

    const scoreResult = calculateScoreResult({
      studyScore: current.studyScore,
      disciplineScore: current.disciplineScore,
      activityScore: current.activityScore,
      communityScore: current.communityScore,
      roleScore: current.roleScore,
    });

    // Reset điểm/audit và chuyển submitted cùng một transaction: không lưu nửa vòng duyệt.
    const evaluation = await database.$transaction(async (tx) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Student,
        current.semester,
      );
      const updated = await writeEvaluationAndRead(tx, current, {
        data: {
          status: EVALUATION_TRANSITIONS.submit.target,
          submittedAt: new Date(),
          studentScore: scoreResult.totalScore,
          rank: scoreResult.rank,
          classScore: null,
          finalScore: null,
          classLeaderReviewedBy: null,
          classLeaderReviewedAt: null,
          classReviewedBy: null,
          classReviewedAt: null,
          adminFinalizedBy: null,
          adminFinalizedAt: null,
        },
        select: evaluationScoreSummarySelect,
      });
      await tx.formCriteriaScore.updateMany({
        where: { formId: id },
        data: {
          classScore: null,
          note: null,
        },
      });
      return updated;
    });

    return mapToScoreSummaryResponse(evaluation);
  }

  /**
   * Lớp trưởng gửi toàn bộ phiếu sinh viên đã nộp trong lớp lên CVHT.
   * Chỉ chuyển các phiếu đang `submitted`; các phiếu nháp, bị trả về, đã gửi
   * lên CVHT, đã CVHT duyệt hoặc đã chốt cuối được giữ nguyên để tránh ghi đè audit.
   */
  async submitClassToAdvisor(
    reviewer: AuthenticatedUser,
    classId: string,
    dto: SubmitClassToAdvisorDto,
    key?: string,
  ) {
    EvaluationAccessPolicy.assertRole(
      'submitClass',
      reviewer,
      UserRole.ClassLeader,
    );
    return idempotentOperation(
      this.prisma,
      {
        actorId: reviewer.id,
        action: 'submitClassToAdvisor',
        authorizeReplay: (database) =>
          this.queries.assertClassAccess(
            reviewer,
            classId,
            'submitClass',
            database,
            UserRole.ClassLeader,
          ),
        key,
        input: { classId, dto, role: reviewer.role },
      },
      (database, afterCommit) =>
        this.submitClassToAdvisorCommand(
          reviewer,
          classId,
          dto,
          database,
          afterCommit,
        ),
    );
  }

  private async submitClassToAdvisorCommand(
    reviewer: AuthenticatedUser,
    classId: string,
    dto: SubmitClassToAdvisorDto,
    database: CommandDatabase,
    afterCommit: AfterCommit,
  ) {
    const transition = EVALUATION_TRANSITIONS.classLeaderApproval;
    const classRecord = await database.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: { id: true, code: true, name: true },
    });

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    await this.queries.assertClassAccess(
      reviewer,
      classId,
      'submitClass',
      database,
      UserRole.ClassLeader,
    );

    const advisorAssignments = await database.advisorAssignment.findMany({
      where: { classId },
      select: {
        userId: true,
        user: {
          select: { id: true, fullName: true, isActive: true, deletedAt: true },
        },
      },
    });
    const activeAdvisors = advisorAssignments.filter(
      (assignment) => assignment.user.isActive && !assignment.user.deletedAt,
    );

    if (activeAdvisors.length === 0) {
      throw new BadRequestException('Lớp chưa được gán cố vấn học tập');
    }

    const semester = await this.findSubmissionSemester(
      dto.semesterId,
      database,
    );

    const whereBase: Prisma.EvaluationFormWhereInput = {
      classId,
      semesterId: semester.id,
    };
    const targetWhere: Prisma.EvaluationFormWhereInput = {
      ...whereBase,
      ...(dto.evaluationIds && { id: { in: dto.evaluationIds } }),
    };
    const [
      totalForms,
      eligibleForms,
      missingConfirmationCount,
      alreadyForwardedCount,
      notReadyCount,
    ] = await Promise.all([
      database.evaluationForm.count({ where: targetWhere }),
      database.evaluationForm.findMany({
        where: {
          ...targetWhere,
          status: transition.from[0],
          classLeaderReviewedAt: { not: null },
          isLocked: false,
        },
        select: { id: true, version: true, status: true },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: transition.from[0],
          classLeaderReviewedAt: null,
          isLocked: false,
        },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: {
            in: [
              transition.target,
              FormStatus.class_approved,
              FormStatus.faculty_approved,
              FormStatus.finalized,
            ],
          },
        },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: { in: [FormStatus.draft, FormStatus.rejected] },
        },
      }),
    ]);

    assertExpectedEvaluationVersions(
      eligibleForms,
      dto.evaluationIds ?? eligibleForms.map((form) => form.id),
      dto.expectedVersions,
    );

    if (eligibleForms.length === 0) {
      throw new ConflictException(
        missingConfirmationCount > 0
          ? 'Các phiếu đang chờ gửi lên CVHT chưa được lớp trưởng xác nhận'
          : 'Không có phiếu nào đang chờ lớp trưởng gửi lên CVHT',
      );
    }

    // Kiểm tra trạng thái thực của từng candidate, không suy ra chỉ từ bộ lọc SQL.
    for (const form of eligibleForms)
      assertTransition(form.status, transition.target);

    const submittedToAdvisorAt = new Date();
    const { updatedCount, notifications } = await database.$transaction(
      async (tx) => {
        EvaluationDeadlinePolicy.assertWithinDeadline(
          UserRole.ClassLeader,
          semester,
        );
        for (const form of [...eligibleForms].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          await writeEvaluation(tx, form, { status: transition.target });
        }
        const updated = { count: eligibleForms.length };

        const notifications =
          updated.count > 0
            ? await Promise.all(
                activeAdvisors.map((assignment) =>
                  createNotificationOnce(
                    tx,
                    {
                      userId: assignment.userId,
                      type: NotificationType.GENERAL,
                      title: 'Lớp trưởng đã gửi danh sách đánh giá',
                      content: `Lớp ${classRecord.code} đã gửi ${updated.count} phiếu đánh giá rèn luyện lên CVHT. Vui lòng kiểm tra và duyệt tiếp.`,
                    },
                    [
                      'evaluation-forwarded',
                      transition.target,
                      [...eligibleForms]
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((form) => [form.id, form.version + 1]),
                    ],
                  ),
                ),
              )
            : [];

        return { updatedCount: updated.count, notifications };
      },
    );

    // DB đã commit; chỉ phát realtime sau khi notification đã được lưu thành công.
    for (const notification of notifications) {
      if (notification)
        afterCommit(() =>
          this.notificationsService.emitCreated(
            mapToNotificationResponse(notification),
          ),
        );
    }

    return {
      classId: classRecord.id,
      classCode: classRecord.code,
      className: classRecord.name,
      semesterId: semester.id,
      academicYear: `${semester.year}-${semester.year + 1}`,
      fromStatus: transition.from[0],
      toStatus: transition.target,
      submittedToAdvisorAt,
      submittedCount: updatedCount,
      requestedCount: dto.evaluationIds?.length ?? null,
      totalForms,
      notReadyCount,
      missingConfirmationCount,
      alreadyForwardedCount,
      advisorIds: activeAdvisors.map((assignment) => assignment.userId),
      message: `Đã gửi ${updatedCount} phiếu đánh giá của lớp ${classRecord.code} lên CVHT.`,
    };
  }

  /**
   * CVHT gửi toàn bộ phiếu đã được lớp trưởng chuyển lên khoa/cấp trên.
   * Chỉ chuyển các phiếu đang `class_leader_approved` và đã có `classScore`.
   */
  async submitClassToFaculty(
    reviewer: AuthenticatedUser,
    classId: string,
    dto: SubmitClassToFacultyDto,
    key?: string,
  ) {
    EvaluationAccessPolicy.assertRole(
      'submitClass',
      reviewer,
      UserRole.Advisor,
    );
    return idempotentOperation(
      this.prisma,
      {
        actorId: reviewer.id,
        action: 'submitClassToFaculty',
        authorizeReplay: (database) =>
          this.queries.assertClassAccess(
            reviewer,
            classId,
            'submitClass',
            database,
            UserRole.Advisor,
          ),
        key,
        input: { classId, dto, role: reviewer.role },
      },
      (database, afterCommit) =>
        this.submitClassToFacultyCommand(
          reviewer,
          classId,
          dto,
          database,
          afterCommit,
        ),
    );
  }

  private async submitClassToFacultyCommand(
    reviewer: AuthenticatedUser,
    classId: string,
    dto: SubmitClassToFacultyDto,
    database: CommandDatabase,
    afterCommit: AfterCommit,
  ) {
    const transition = EVALUATION_TRANSITIONS.advisorApproval;
    const classRecord = await database.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        major: {
          select: {
            faculty: {
              select: { id: true, code: true, name: true },
            },
          },
        },
      },
    });

    if (!classRecord) {
      throw new NotFoundException('Không tìm thấy lớp học');
    }

    await this.queries.assertClassAccess(
      reviewer,
      classId,
      'submitClass',
      database,
      UserRole.Advisor,
    );

    const facultyAssignments = await database.facultyAssignment.findMany({
      where: { facultyId: classRecord.major.faculty.id },
      select: {
        userId: true,
        user: {
          select: { id: true, fullName: true, isActive: true, deletedAt: true },
        },
      },
    });
    const activeFacultyUsers = facultyAssignments.filter(
      (assignment) => assignment.user.isActive && !assignment.user.deletedAt,
    );

    if (activeFacultyUsers.length === 0) {
      throw new BadRequestException(
        'Khoa của lớp chưa được gán tài khoản phụ trách',
      );
    }

    const semester = await this.findSubmissionSemester(
      dto.semesterId,
      database,
    );

    const whereBase: Prisma.EvaluationFormWhereInput = {
      classId,
      semesterId: semester.id,
    };
    const targetWhere: Prisma.EvaluationFormWhereInput = {
      ...whereBase,
      ...(dto.evaluationIds && { id: { in: dto.evaluationIds } }),
    };
    const [
      totalForms,
      eligibleForms,
      missingClassScoreCount,
      missingConfirmationCount,
      alreadyForwardedCount,
      notReadyCount,
    ] = await Promise.all([
      database.evaluationForm.count({ where: targetWhere }),
      database.evaluationForm.findMany({
        where: {
          ...targetWhere,
          status: transition.from[0],
          classScore: { not: null },
          classReviewedAt: { not: null },
          isLocked: false,
        },
        select: { id: true, version: true, status: true, classScore: true },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: transition.from[0],
          classScore: null,
          isLocked: false,
        },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: transition.from[0],
          classScore: { not: null },
          classReviewedAt: null,
          isLocked: false,
        },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: {
            in: [
              transition.target,
              FormStatus.faculty_approved,
              FormStatus.finalized,
            ],
          },
        },
      }),
      database.evaluationForm.count({
        where: {
          ...targetWhere,
          status: {
            in: [FormStatus.draft, FormStatus.submitted, FormStatus.rejected],
          },
        },
      }),
    ]);

    assertExpectedEvaluationVersions(
      eligibleForms,
      dto.evaluationIds ?? eligibleForms.map((form) => form.id),
      dto.expectedVersions,
    );

    if (eligibleForms.length === 0) {
      throw new ConflictException(
        missingClassScoreCount > 0
          ? 'Các phiếu đang chờ CVHT gửi lên khoa chưa có điểm CVHT'
          : missingConfirmationCount > 0
            ? 'Các phiếu đang chờ gửi lên khoa chưa được CVHT xác nhận'
            : 'Không có phiếu nào đang chờ CVHT gửi lên khoa',
      );
    }

    // Kiểm tra trạng thái thực của từng candidate, không suy ra chỉ từ bộ lọc SQL.
    for (const form of eligibleForms)
      assertTransition(form.status, transition.target);

    const submittedToFacultyAt = new Date();
    const { updatedCount, notifications } = await database.$transaction(
      async (tx) => {
        EvaluationDeadlinePolicy.assertWithinDeadline(
          UserRole.Advisor,
          semester,
        );
        let updatedCount = 0;

        for (const form of [...eligibleForms].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          if (form.classScore === null) {
            continue;
          }

          await writeEvaluation(tx, form, {
            status: transition.target,
            rank: calculateClassification(form.classScore),
          });
          updatedCount += 1;
        }

        const notifications =
          updatedCount > 0
            ? await Promise.all(
                activeFacultyUsers.map((assignment) =>
                  createNotificationOnce(
                    tx,
                    {
                      userId: assignment.userId,
                      type: NotificationType.GENERAL,
                      title: 'CVHT đã gửi danh sách đánh giá',
                      content: `Lớp ${classRecord.code} đã gửi ${updatedCount} phiếu đánh giá rèn luyện lên khoa ${classRecord.major.faculty.code}.`,
                    },
                    [
                      'evaluation-forwarded',
                      transition.target,
                      [...eligibleForms]
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((form) => [form.id, form.version + 1]),
                    ],
                  ),
                ),
              )
            : [];

        return { updatedCount, notifications };
      },
    );

    // DB đã commit; chỉ phát realtime sau khi notification đã được lưu thành công.
    for (const notification of notifications) {
      if (notification)
        afterCommit(() =>
          this.notificationsService.emitCreated(
            mapToNotificationResponse(notification),
          ),
        );
    }

    return {
      classId: classRecord.id,
      classCode: classRecord.code,
      className: classRecord.name,
      facultyId: classRecord.major.faculty.id,
      facultyCode: classRecord.major.faculty.code,
      facultyName: classRecord.major.faculty.name,
      semesterId: semester.id,
      academicYear: `${semester.year}-${semester.year + 1}`,
      fromStatus: transition.from[0],
      toStatus: transition.target,
      submittedToFacultyAt,
      submittedCount: updatedCount,
      requestedCount: dto.evaluationIds?.length ?? null,
      totalForms,
      notReadyCount,
      missingClassScoreCount,
      missingConfirmationCount,
      alreadyForwardedCount,
      facultyUserIds: activeFacultyUsers.map((assignment) => assignment.userId),
      message: `Đã gửi ${updatedCount} phiếu đánh giá của lớp ${classRecord.code} lên khoa.`,
    };
  }

  /**
   * Khoa gửi toàn bộ phiếu đã được CVHT chốt lên Phòng Đào tạo.
   * Trạng thái `faculty_approved` là hàng đợi để PĐT duyệt cuối.
   */
  async submitFacultyToTrainingDepartment(
    reviewer: AuthenticatedUser,
    facultyId: string,
    dto: SubmitFacultyToTrainingDepartmentDto,
    key?: string,
  ) {
    EvaluationAccessPolicy.assertRole(
      'approveFaculty',
      reviewer,
      UserRole.Faculty,
    );
    return idempotentOperation(
      this.prisma,
      {
        actorId: reviewer.id,
        action: 'submitFacultyToTrainingDepartment',
        authorizeReplay: async (database) => {
          await this.queries.requireFacultyAssignment(
            reviewer,
            facultyId,
            database,
          );
        },
        key,
        input: { facultyId, dto, role: reviewer.role },
      },
      (database, afterCommit) =>
        this.submitFacultyToTrainingDepartmentCommand(
          reviewer,
          facultyId,
          dto,
          database,
          afterCommit,
        ),
    );
  }

  private async submitFacultyToTrainingDepartmentCommand(
    reviewer: AuthenticatedUser,
    facultyId: string,
    dto: SubmitFacultyToTrainingDepartmentDto,
    database: CommandDatabase,
    afterCommit: AfterCommit,
  ) {
    const transition = EVALUATION_TRANSITIONS.facultyApproval;
    const assignment = await this.queries.requireFacultyAssignment(
      reviewer,
      facultyId,
      database,
    );

    if (dto.classId) {
      const classRecord = await database.class.findFirst({
        where: {
          id: dto.classId,
          deletedAt: null,
          major: { facultyId },
        },
        select: { id: true, code: true, name: true },
      });

      if (!classRecord) {
        throw new NotFoundException(
          'Không tìm thấy lớp thuộc khoa đang phụ trách',
        );
      }
    }

    const trainingDepartmentUsers = await database.user.findMany({
      where: {
        role: UserRole.TrainingDepartment,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (trainingDepartmentUsers.length === 0) {
      throw new BadRequestException(
        'Chưa có tài khoản Phòng Đào tạo đang hoạt động',
      );
    }

    const semester = await this.findSubmissionSemester(
      dto.semesterId,
      database,
    );

    const whereBase: Prisma.EvaluationFormWhereInput = {
      semesterId: semester.id,
      ...(dto.classId && { classId: dto.classId }),
      class: { major: { facultyId } },
    };
    const [
      totalForms,
      eligibleForms,
      missingClassScoreCount,
      alreadyForwardedCount,
      notReadyCount,
    ] = await Promise.all([
      database.evaluationForm.count({ where: whereBase }),
      database.evaluationForm.findMany({
        where: {
          ...whereBase,
          status: transition.from[0],
          classScore: { not: null },
          isLocked: false,
        },
        select: { id: true, version: true, status: true },
      }),
      database.evaluationForm.count({
        where: {
          ...whereBase,
          status: transition.from[0],
          classScore: null,
          isLocked: false,
        },
      }),
      database.evaluationForm.count({
        where: {
          ...whereBase,
          status: { in: [transition.target, FormStatus.finalized] },
        },
      }),
      database.evaluationForm.count({
        where: {
          ...whereBase,
          status: {
            in: [
              FormStatus.draft,
              FormStatus.submitted,
              FormStatus.class_leader_approved,
              FormStatus.rejected,
            ],
          },
        },
      }),
    ]);

    if (eligibleForms.length === 0) {
      throw new ConflictException(
        missingClassScoreCount > 0
          ? 'Các phiếu đang chờ khoa gửi lên PĐT chưa có điểm CVHT'
          : 'Không có phiếu nào đang chờ khoa gửi lên PĐT',
      );
    }

    // Kiểm tra trạng thái thực của từng candidate, không suy ra chỉ từ bộ lọc SQL.
    for (const form of eligibleForms)
      assertTransition(form.status, transition.target);

    const submittedToTrainingDepartmentAt = new Date();
    const { updatedCount, notifications } = await database.$transaction(
      async (tx) => {
        EvaluationDeadlinePolicy.assertWithinDeadline(
          UserRole.Faculty,
          semester,
        );
        for (const form of [...eligibleForms].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          await writeEvaluation(tx, form, { status: transition.target });
        }
        const updated = { count: eligibleForms.length };

        const notifications =
          updated.count > 0
            ? await Promise.all(
                trainingDepartmentUsers.map((user) =>
                  createNotificationOnce(
                    tx,
                    {
                      userId: user.id,
                      type: NotificationType.GENERAL,
                      title: 'Khoa đã gửi danh sách đánh giá',
                      content: `Khoa ${assignment.faculty.code} đã gửi ${updated.count} phiếu đánh giá rèn luyện lên Phòng Đào tạo.`,
                    },
                    [
                      'evaluation-forwarded',
                      transition.target,
                      [...eligibleForms]
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((form) => [form.id, form.version + 1]),
                    ],
                  ),
                ),
              )
            : [];

        return { updatedCount: updated.count, notifications };
      },
    );

    // DB đã commit; chỉ phát realtime sau khi notification đã được lưu thành công.
    for (const notification of notifications) {
      if (notification)
        afterCommit(() =>
          this.notificationsService.emitCreated(
            mapToNotificationResponse(notification),
          ),
        );
    }

    return {
      facultyId: assignment.faculty.id,
      facultyCode: assignment.faculty.code,
      facultyName: assignment.faculty.name,
      classId: dto.classId ?? null,
      semesterId: semester.id,
      academicYear: `${semester.year}-${semester.year + 1}`,
      fromStatus: transition.from[0],
      toStatus: transition.target,
      submittedToTrainingDepartmentAt,
      submittedCount: updatedCount,
      totalForms,
      notReadyCount,
      missingClassScoreCount,
      alreadyForwardedCount,
      trainingDepartmentUserIds: trainingDepartmentUsers.map((user) => user.id),
      message: `Đã gửi ${updatedCount} phiếu đánh giá của khoa ${assignment.faculty.code} lên Phòng Đào tạo.`,
    };
  }
  /**
   * Dùng học kỳ chỉ định hoặc học kỳ active mới nhất như code cũ.
   * Đọc đầy đủ deadline của học kỳ để các bước chuyển cấp dùng chung policy.
   */
  private async findSubmissionSemester(
    semesterId?: string,
    database: CommandDatabase = this.prisma,
  ) {
    const select = {
      id: true,
      year: true,
      semester: true,
      ...evaluationDeadlineSelect,
    } as const;
    const semester = semesterId
      ? await database.semester.findUnique({
          where: { id: semesterId },
          select,
        })
      : await database.semester.findFirst({
          where: { isActive: true },
          select,
          orderBy: [{ year: 'desc' }, { semester: 'desc' }],
        });
    if (!semester)
      throw new NotFoundException('Không tìm thấy học kỳ đánh giá');
    return semester;
  }
}
