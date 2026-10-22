import { assertExpectedEvaluationVersion } from './evaluation-concurrency';
import { EvaluationAccessPolicy } from '../domain/evaluation-access.policy';
import { EvaluationDeadlinePolicy } from '../domain/evaluation-deadline.policy';
import {
  idempotentOperation,
  type CommandDatabase,
  type AfterCommit,
} from '../../../common/idempotency/idempotent-operation';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  mapToNotificationResponse,
  NotificationsService,
} from '../../notifications/notifications.service';
import { createNotificationOnce } from '../../notifications/create-notification-once';
import {
  assertNotLocked,
  assertReviewScoresEditable,
  assertTransition,
  EVALUATION_TRANSITIONS,
  resolveReviewStage,
} from '../domain/evaluation-transition';
import { calculateClassification } from '../domain/score-calculator';
import { ConfirmReviewDto } from '../dto/confirm-review.dto';
import { ReturnEvaluationToStudentDto } from '../dto/return-evaluation-to-student.dto';
import { ReviewTrainingEvaluationDto } from '../dto/review-training-evaluation.dto';
import { mapToScoreSummaryResponse } from '../helpers/evaluation.mapper';
import {
  evaluationDeadlineSelect,
  evaluationScoreSummarySelect,
} from '../selects/evaluation-form.select';
import type { EvaluationScoreSummaryResponse } from '../types/evaluation-form.types';
import { writeEvaluationAndRead } from './evaluation-concurrency';
import { EvaluationFinalizeService } from './evaluation-finalize.service';
import { EvaluationQueryService } from './evaluation-query.service';
import { EvaluationScoreService } from './evaluation-score.service';

/** Xác nhận, duyệt và trả về; xác nhận từng phiếu chưa phải chuyển danh sách. */
@Injectable()
export class EvaluationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly queries: EvaluationQueryService,
    private readonly scores: EvaluationScoreService,
    private readonly finalization: EvaluationFinalizeService,
  ) {}

  /**
   * Xác nhận cột điểm đã được người duyệt hiện tại kiểm tra xong.
   * Bước này chưa chuyển trạng thái phiếu; API batch gửi cấp tiếp theo sẽ chỉ
   * nhận những phiếu đã có dấu xác nhận tương ứng.
   */
  async confirmReview(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ConfirmReviewDto = {},
    key?: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    EvaluationAccessPolicy.assertRole('review', reviewer);
    return idempotentOperation(
      this.prisma,
      {
        actorId: reviewer.id,
        action: 'confirmReview',
        authorizeReplay: (database) =>
          this.queries.assertFormAccess(reviewer, id, 'review', database),
        key,
        input: { id, dto, role: reviewer.role },
      },
      (database) => this.confirmReviewCommand(reviewer, id, dto, database),
    );
  }

  private async confirmReviewCommand(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ConfirmReviewDto,
    database: CommandDatabase,
  ): Promise<EvaluationScoreSummaryResponse> {
    // Chấm kèm xác nhận dùng chung transaction: conflict không để lại điểm chưa xác nhận.
    return database.$transaction(async (tx) => {
      // Điểm thay đổi làm mất dấu xác nhận cũ; chấm xong mới ghi nhận xác nhận mới.
      if (dto.scores?.length) {
        await this.scores.reviewScores(
          reviewer,
          id,
          { scores: dto.scores, expectedVersion: dto.expectedVersion },
          tx,
        );
      }

      const form = await tx.evaluationForm.findUnique({
        where: { id },
        select: {
          id: true,
          version: true,
          classId: true,
          status: true,
          isLocked: true,
          classScore: true,
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
        tx,
      );
      if (!dto.scores?.length)
        assertExpectedEvaluationVersion(form, dto.expectedVersion);
      assertNotLocked(form);

      if (form.classScore === null) {
        throw new ConflictException(
          'Phiếu chưa có điểm lớp/CVHT đánh giá để xác nhận',
        );
      }

      EvaluationDeadlinePolicy.assertWithinDeadline(
        reviewer.role,
        form.semester,
      );
      const confirmedClassScore = form.classScore;
      if (reviewer.role === UserRole.ClassLeader) {
        assertReviewScoresEditable(reviewer.role, form.status);

        const confirmed = await writeEvaluationAndRead(tx, form, {
          data: {
            classLeaderReviewedBy: reviewer.id,
            classLeaderReviewedAt: new Date(),
          },
          select: evaluationScoreSummarySelect,
        });

        return mapToScoreSummaryResponse(confirmed);
      }

      if (reviewer.role === UserRole.Advisor) {
        assertReviewScoresEditable(reviewer.role, form.status);

        const confirmed = await writeEvaluationAndRead(tx, form, {
          data: {
            rank: calculateClassification(confirmedClassScore),
            classReviewedBy: reviewer.id,
            classReviewedAt: new Date(),
          },
          select: evaluationScoreSummarySelect,
        });

        return mapToScoreSummaryResponse(confirmed);
      }

      throw new ForbiddenException(
        'Vai trò này không có quyền xác nhận phiếu đánh giá',
      );
    });
  }

  /**
   * Duyệt phiếu theo state machine đa cấp:
   * submitted -> class_leader_approved -> class_approved -> faculty_approved -> finalized.
   * REJECT ở bất kỳ cấp đang duyệt sẽ trả về rejected để sinh viên sửa lại.
   */
  async review(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ReviewTrainingEvaluationDto,
    key?: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    EvaluationAccessPolicy.assertRole('reviewDecision', reviewer);
    return idempotentOperation(
      this.prisma,
      {
        actorId: reviewer.id,
        action: 'review',
        authorizeReplay: async (database) => {
          if (!EvaluationAccessPolicy.canFinalize(reviewer))
            await this.queries.assertFormAccess(
              reviewer,
              id,
              'review',
              database,
            );
        },
        key,
        input: { id, dto, role: reviewer.role },
      },
      (database, afterCommit) =>
        this.reviewCommand(reviewer, id, dto, database, afterCommit),
    );
  }

  private async reviewCommand(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ReviewTrainingEvaluationDto,
    database: CommandDatabase,
    afterCommit: AfterCommit,
  ): Promise<EvaluationScoreSummaryResponse> {
    const evaluation = await database.evaluationForm.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        studentId: true,
        status: true,
        classId: true,
        classScore: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    if (!evaluation) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    if (!EvaluationAccessPolicy.canFinalize(reviewer)) {
      await this.queries.assertClassAccess(
        reviewer,
        evaluation.classId,
        'review',
        database,
      );
    }
    assertExpectedEvaluationVersion(evaluation, dto.expectedVersion);
    const stage = resolveReviewStage(reviewer.role, evaluation.status);

    if (dto.action === 'reject') {
      assertTransition(evaluation.status, EVALUATION_TRANSITIONS.reject.target);
      const { rejected, notification } = await database.$transaction(
        async (tx) => {
          EvaluationDeadlinePolicy.assertWithinDeadline(
            reviewer.role,
            evaluation.semester,
          );
          const rejected = await writeEvaluationAndRead(tx, evaluation, {
            data: {
              status: EVALUATION_TRANSITIONS.reject.target,
              note: `${stage.notePrefix} ${dto.comment}`,
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
          const notification = await createNotificationOnce(
            tx,
            {
              userId: evaluation.studentId,
              type: NotificationType.EVALUATION_REJECTED,
              title: 'Phiếu đánh giá bị trả lại',
              content:
                dto.comment ??
                'Phiếu đánh giá rèn luyện cần được chỉnh sửa và nộp lại.',
            },
            ['evaluation-rejected', id, evaluation.version + 1],
          );
          return { rejected, notification };
        },
      );

      // Chỉ gửi realtime sau transaction, không để client đọc phiếu chưa commit.
      if (notification)
        afterCommit(() =>
          this.notificationsService.emitCreated(
            mapToNotificationResponse(notification),
          ),
        );

      return mapToScoreSummaryResponse(rejected);
    }

    // Route review cũ của admin vẫn chốt từ classScore; finalize service sở hữu toàn bộ ghi điểm cuối.
    if (reviewer.role === UserRole.Admin) {
      return this.finalization.finalizeReviewedForm(
        reviewer,
        evaluation,
        database,
      );
    }

    const data: Prisma.EvaluationFormUncheckedUpdateInput = {
      status: stage.nextApprovedStatus,
    };

    if (reviewer.role === UserRole.ClassLeader) {
      data.classLeaderReviewedBy = reviewer.id;
      data.classLeaderReviewedAt = new Date();
    } else if (reviewer.role === UserRole.Advisor) {
      if (dto.classScore === undefined) {
        throw new BadRequestException(
          'classScore là bắt buộc khi CVHT duyệt phiếu',
        );
      }

      data.classScore = dto.classScore;
      data.rank = calculateClassification(dto.classScore);
      data.classReviewedBy = reviewer.id;
      data.classReviewedAt = new Date();
    }

    const approved = await database.$transaction((tx) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        reviewer.role,
        evaluation.semester,
      );
      return writeEvaluationAndRead(tx, evaluation, {
        data: data,
        select: evaluationScoreSummarySelect,
      });
    });

    return mapToScoreSummaryResponse(approved);
  }

  /**
   * Alias nghiệp vụ riêng cho CVHT trả phiếu về sinh viên kèm lý do.
   * Dùng chung state machine reject để giữ audit, note và notification nhất quán.
   */
  async returnToStudent(
    reviewer: AuthenticatedUser,
    id: string,
    dto: ReturnEvaluationToStudentDto,
    key?: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    return this.review(
      reviewer,
      id,
      {
        action: 'reject',
        comment: dto.reason,
        expectedVersion: dto.expectedVersion,
      },
      key,
    );
  }
}
