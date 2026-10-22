import { ProfileCacheService } from '../../../infrastructure/cache/profile-cache.service';
import { assertExpectedEvaluationVersion } from './evaluation-concurrency';
import {
  EvaluationAccessPolicy,
  assertEvaluationAccess,
  type EvaluationActor,
} from '../domain/evaluation-access.policy';
import { EvaluationDeadlinePolicy } from '../domain/evaluation-deadline.policy';
import { idempotentOperation } from '../../../common/idempotency/idempotent-operation';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  assertEditable,
  assertNotLocked,
  assertReviewScoresEditable,
} from '../domain/evaluation-transition';
import {
  calculateActivityScore,
  calculateCommunityScore,
  calculateDisciplineScore,
  calculateRoleScore,
  calculateScoreResult,
  calculateStudyScore,
} from '../domain/score-calculator';
import { ReviewScoresDto } from '../dto/review-scores.dto';
import { UpdateActivityScoreDto } from '../dto/update-activity-score.dto';
import { UpdateCommunityScoreDto } from '../dto/update-community-score.dto';
import { UpdateDisciplineScoreDto } from '../dto/update-discipline-score.dto';
import { UpdateRoleScoreDto } from '../dto/update-role-score.dto';
import { UpdateStudyScoreDto } from '../dto/update-study-score.dto';
import { UpdateTrainingEvaluationDraftDto } from '../dto/update-training-evaluation-draft.dto';
import {
  mapToActivityScoreResponse,
  mapToCommunityScoreResponse,
  mapToDetailResponse,
  mapToDisciplineScoreResponse,
  mapToRoleScoreResponse,
  mapToScoreSummaryResponse,
  mapToStudyScoreResponse,
} from '../helpers/evaluation.mapper';
import {
  activityScoreSelect,
  communityScoreSelect,
  disciplineScoreSelect,
  evaluationDeadlineSelect,
  evaluationDetailSelect,
  evaluationScoreSummarySelect,
  roleScoreSelect,
  studyScoreSelect,
} from '../selects/evaluation-form.select';
import type {
  ActivityScoreResponse,
  CommunityScoreResponse,
  DisciplineScoreResponse,
  EvaluationDetailResponse,
  EvaluationScoreSummaryResponse,
  RoleScoreResponse,
  StudyScoreResponse,
} from '../types/evaluation-form.types';
import {
  assertEvaluationUpdated,
  writeEvaluation,
  writeEvaluationAndRead,
} from './evaluation-concurrency';
import { EvaluationQueryService } from './evaluation-query.service';

/** Ghi điểm/nháp và tính lại tổng; không tự chuyển phiếu sang cấp duyệt tiếp theo. */
@Injectable()
export class EvaluationScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: EvaluationQueryService,
    private readonly profiles: ProfileCacheService,
  ) {}

  /**
   * Cập nhật thông tin nháp của phiếu: số điện thoại và/hoặc ghi chú.
   * Chỉ cập nhật được khi phiếu đang ở trạng thái có thể chỉnh sửa.
   * Cập nhật SĐT trực tiếp lên bảng User (dùng chung với profile).
   */
  async updateDraft(
    actor: EvaluationActor,
    id: string,
    dto: UpdateTrainingEvaluationDraftDto,
  ): Promise<EvaluationDetailResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const hasPhone = Object.prototype.hasOwnProperty.call(dto, 'phone');
    const hasNote = Object.prototype.hasOwnProperty.call(dto, 'note');

    if (!hasPhone && !hasNote) {
      throw new BadRequestException(
        'Chưa cung cấp thông tin nháp nào để cập nhật',
      );
    }

    const form = await this.findOwnedForWrite(actor, id);
    assertExpectedEvaluationVersion(form, dto.expectedVersion);
    assertNotLocked(form);
    assertEditable(form.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Giành version trước khi ghi User; conflict phải rollback cả thông tin liên hệ.
      await writeEvaluation(
        tx,
        form,
        hasNote ? { note: dto.note ?? null } : {},
      );
      if (hasPhone)
        await tx.user.update({
          where: { id: actor.id },
          data: { phone: dto.phone ?? null },
          select: { id: true },
        });
      return tx.evaluationForm.findUniqueOrThrow({
        where: { id },
        select: evaluationDetailSelect,
      });
    });
    if (hasPhone) await this.profiles.invalidate(actor.id);
    return mapToDetailResponse(updated);
  }

  // ─── Mục I – Ý thức học tập (max 20đ) ────────────────────────────────────────

  /**
   * Cập nhật điểm Mục I – Ý thức học tập.
   * Tính điểm theo 3 tiêu chí: điểm TB thường xuyên + hoạt động học thuật + xếp loại TBCHT.
   * Sau khi cập nhật, tổng điểm phiếu được tính lại ngay lập tức.
   */
  async updateStudyScore(
    actor: EvaluationActor,
    id: string,
    dto: UpdateStudyScoreDto,
  ): Promise<StudyScoreResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const current = await this.findOwnedForWrite(actor, id, {
      disciplineScore: true,
      activityScore: true,
      communityScore: true,
      roleScore: true,
    });
    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertEditable(current.status);

    const { score, activities } = calculateStudyScore(dto);

    const { totalScore, rank } = calculateScoreResult({
      studyScore: score,
      disciplineScore: current.disciplineScore,
      activityScore: current.activityScore,
      communityScore: current.communityScore,
      roleScore: current.roleScore,
    });

    const updated = await this.prisma.$transaction((tx) =>
      writeEvaluationAndRead(tx, current, {
        data: {
          studyScore: score,
          studyData: {
            regularScoreLevel: dto.regularScoreLevel,
            academicRank: dto.academicRank,
            activities,
          },
          studentScore: totalScore,
          rank,
        },
        select: studyScoreSelect,
      }),
    );

    return mapToStudyScoreResponse(updated);
  }

  // ─── Mục II – Ý thức chấp hành kỷ luật (max 25đ) ────────────────────────────

  /**
   * Cập nhật điểm Mục II – Ý thức chấp hành kỷ luật.
   * Điểm lưu vào phiếu = điểm nền trừ tổng điểm vi phạm, tối thiểu 0.
   */
  async updateDisciplineScore(
    actor: EvaluationActor,
    id: string,
    dto: UpdateDisciplineScoreDto,
  ): Promise<DisciplineScoreResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const current = await this.findOwnedForWrite(actor, id, {
      studyScore: true,
      activityScore: true,
      communityScore: true,
      roleScore: true,
    });
    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertEditable(current.status);

    const { score, violations } = calculateDisciplineScore(dto);

    const { totalScore, rank } = calculateScoreResult({
      studyScore: current.studyScore,
      disciplineScore: score,
      activityScore: current.activityScore,
      communityScore: current.communityScore,
      roleScore: current.roleScore,
    });

    const updated = await this.prisma.$transaction((tx) =>
      writeEvaluationAndRead(tx, current, {
        data: {
          disciplineBaseScore: dto.baseScore,
          disciplineScore: score,
          disciplineData: { baseScore: dto.baseScore, violations },
          studentScore: totalScore,
          rank,
        },
        select: disciplineScoreSelect,
      }),
    );

    return mapToDisciplineScoreResponse(updated);
  }

  // ─── Mục III – Hoạt động chính trị, VH, thể thao (max 20đ) ──────────────────

  /**
   * Cập nhật điểm Mục III – Hoạt động chính trị, VH, thể thao.
   * Tổng điểm = tổng 4 tiêu chí + điểm khen thưởng, tối đa 20.
   */
  async updateActivityScore(
    actor: EvaluationActor,
    id: string,
    dto: UpdateActivityScoreDto,
  ): Promise<ActivityScoreResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const current = await this.findOwnedForWrite(actor, id, {
      studyScore: true,
      disciplineScore: true,
      communityScore: true,
      roleScore: true,
    });
    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertEditable(current.status);

    const score = calculateActivityScore(dto);

    const { totalScore, rank } = calculateScoreResult({
      studyScore: current.studyScore,
      disciplineScore: current.disciplineScore,
      activityScore: score,
      communityScore: current.communityScore,
      roleScore: current.roleScore,
    });

    const updated = await this.prisma.$transaction((tx) =>
      writeEvaluationAndRead(tx, current, {
        data: {
          activityScore: score,
          activityData: {
            politicalActivityLevel: dto.politicalActivityLevel,
            cultureSportLevel: dto.cultureSportLevel,
            clubActivityLevel: dto.clubActivityLevel,
            socialPreventionLevel: dto.socialPreventionLevel,
            rewardScore: dto.rewardScore,
          },
          studentScore: totalScore,
          rank,
        },
        select: activityScoreSelect,
      }),
    );

    return mapToActivityScoreResponse(updated);
  }

  // ─── Mục IV – Ý thức công dân trong cộng đồng (max 25đ) ──────────────────────

  /**
   * Cập nhật điểm Mục IV – Ý thức công dân trong cộng đồng.
   * Tổng điểm = chấp hành pháp luật + tình nguyện + quan hệ cộng đồng, tối đa 25.
   */
  async updateCommunityScore(
    actor: EvaluationActor,
    id: string,
    dto: UpdateCommunityScoreDto,
  ): Promise<CommunityScoreResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const current = await this.findOwnedForWrite(actor, id, {
      studyScore: true,
      disciplineScore: true,
      activityScore: true,
      roleScore: true,
    });
    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertEditable(current.status);

    const score = calculateCommunityScore(dto);

    const { totalScore, rank } = calculateScoreResult({
      studyScore: current.studyScore,
      disciplineScore: current.disciplineScore,
      activityScore: current.activityScore,
      communityScore: score,
      roleScore: current.roleScore,
    });

    const updated = await this.prisma.$transaction((tx) =>
      writeEvaluationAndRead(tx, current, {
        data: {
          communityScore: score,
          communityData: {
            lawComplianceLevel: dto.lawComplianceLevel,
            volunteerActivityLevel: dto.volunteerActivityLevel,
            communityRelationshipLevel: dto.communityRelationshipLevel,
          },
          studentScore: totalScore,
          rank,
        },
        select: communityScoreSelect,
      }),
    );

    return mapToCommunityScoreResponse(updated);
  }

  // ─── Mục V – Vai trò BCS lớp / BCH tổ chức (max 10đ) ────────────────────────

  /**
   * Cập nhật điểm Mục V – Vai trò BCS lớp / BCH tổ chức.
   * Logic tính điểm phụ thuộc vào loại sinh viên (NORMAL_STUDENT hay cán bộ).
   */
  async updateRoleScore(
    actor: EvaluationActor,
    id: string,
    dto: UpdateRoleScoreDto,
  ): Promise<RoleScoreResponse> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const current = await this.findOwnedForWrite(actor, id, {
      studyScore: true,
      disciplineScore: true,
      activityScore: true,
      communityScore: true,
    });
    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertEditable(current.status);

    const score = calculateRoleScore(dto);
    const { totalScore, rank } = calculateScoreResult({
      studyScore: current.studyScore,
      disciplineScore: current.disciplineScore,
      activityScore: current.activityScore,
      communityScore: current.communityScore,
      roleScore: score,
    });

    const updated = await this.prisma.$transaction((tx) =>
      writeEvaluationAndRead(tx, current, {
        data: {
          roleScore: score,
          roleData: {
            studentRoleType: dto.studentRoleType,
            positionGroup: dto.positionGroup ?? null,
            taskCompletionLevel: dto.taskCompletionLevel ?? null,
            managementSkillLevel: dto.managementSkillLevel ?? null,
            normalStudentActivityScore: dto.normalStudentActivityScore ?? null,
            specialAchievementLevel: dto.specialAchievementLevel ?? null,
          },
          studentScore: totalScore,
          rank,
        },
        select: roleScoreSelect,
      }),
    );

    return mapToRoleScoreResponse(updated);
  }

  /**
   * Lớp trưởng/CVHT cập nhật điểm thẩm định theo từng tiêu chí.
   * Chỉ người được phân công đúng lớp của phiếu mới được thao tác.
   */
  async reviewScores(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ReviewScoresDto,
    transaction?: Prisma.TransactionClient,
    key?: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    EvaluationAccessPolicy.assertRole('review', reviewer);
    if (key !== undefined && !transaction) {
      return idempotentOperation(
        this.prisma,
        {
          actorId: reviewer.id,
          action: 'reviewScores',
          authorizeReplay: (database) =>
            this.queries.assertFormAccess(reviewer, id, 'review', database),
          key,
          input: { id, dto, role: reviewer.role },
        },
        (database) => this.reviewScores(reviewer, id, dto, database),
      );
    }
    const database = transaction ?? this.prisma;
    const form = await database.evaluationForm.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        classId: true,
        status: true,
        isLocked: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    if (!form) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá rèn luyện');
    }

    await this.queries.assertClassAccess(
      reviewer,
      form.classId,
      'review',
      database,
    );

    assertExpectedEvaluationVersion(form, dto.expectedVersion);
    assertNotLocked(form);
    assertReviewScoresEditable(reviewer.role, form.status);

    const criteriaCodes = [
      ...new Set(dto.scores.map((score) => score.criteriaCode)),
    ];
    const criteria = await database.evaluationCriteria.findMany({
      where: { code: { in: criteriaCodes }, isActive: true },
      select: { id: true, code: true, maxScore: true },
    });
    const criteriaByCode = new Map(
      criteria.map((criterion) => [criterion.code, criterion]),
    );

    for (const item of dto.scores) {
      const criterion = criteriaByCode.get(item.criteriaCode);

      if (!criterion) {
        throw new NotFoundException(
          `Không tìm thấy tiêu chí đánh giá ${item.criteriaCode}`,
        );
      }

      if (item.classScore > criterion.maxScore) {
        throw new BadRequestException(
          `classScore của ${item.criteriaCode} không được vượt quá ${criterion.maxScore}`,
        );
      }
    }

    // Điểm tiêu chí, tổng điểm lớp và hủy xác nhận cũ phải đi cùng một lần commit.
    const applyScores = async (tx: Prisma.TransactionClient) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        reviewer.role,
        form.semester,
      );
      // CAS trước điểm con: request thua dừng trước khi sửa tiêu chí; row lock giữ đến commit.
      const claimedVersion = await writeEvaluation(tx, form, {});
      for (const item of dto.scores) {
        const criterion = criteriaByCode.get(item.criteriaCode)!;

        await tx.formCriteriaScore.upsert({
          where: {
            formId_criteriaId: {
              formId: id,
              criteriaId: criterion.id,
            },
          },
          create: {
            formId: id,
            criteriaId: criterion.id,
            classScore: item.classScore,
            note: item.reviewerNote ?? null,
          },
          update: {
            classScore: item.classScore,
            note: item.reviewerNote ?? null,
          },
          select: { id: true },
        });
      }

      const scores = await tx.formCriteriaScore.findMany({
        where: { formId: id, classScore: { not: null } },
        select: { classScore: true },
      });
      const classScore = scores.reduce(
        (total, score) => total + (score.classScore ?? 0),
        0,
      );

      const confirmationResetData =
        reviewer.role === UserRole.ClassLeader
          ? {
              classLeaderReviewedBy: null,
              classLeaderReviewedAt: null,
            }
          : {
              classReviewedBy: null,
              classReviewedAt: null,
            };

      const finished = await tx.evaluationForm.updateMany({
        where: { id, version: claimedVersion },
        data: { classScore, ...confirmationResetData },
      });
      assertEvaluationUpdated(finished.count);
      // Hoàn tất cùng lần ghi đã claim, không tăng version lần thứ hai.
      return tx.evaluationForm.findUniqueOrThrow({
        where: { id },
        select: evaluationScoreSummarySelect,
      });
    };
    const updated = transaction
      ? await applyScores(transaction)
      : await this.prisma.$transaction(applyScores);

    return mapToScoreSummaryResponse(updated);
  }

  /**
   * Query phiếu để ghi (write), luôn lọc theo studentId.
   * Tự động include `id` và `status` để kiểm tra quyền chỉnh sửa.
   * Select thêm các điểm mục còn lại nếu cần tính lại tổng điểm.
   */
  private async findOwnedForWrite<
    TSelect extends Prisma.EvaluationFormSelect = Record<never, never>,
  >(actor: EvaluationActor, id: string, select?: TSelect) {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const evaluation = await this.prisma.evaluationForm.findFirst({
      where: { id, studentId: actor.id },
      select: {
        id: true,
        version: true,
        status: true,
        isLocked: true,
        ...select,
        studentId: true,
      },
    });

    if (!evaluation) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    assertEvaluationAccess(EvaluationAccessPolicy.canEdit(actor, evaluation));
    return evaluation;
  }
}
