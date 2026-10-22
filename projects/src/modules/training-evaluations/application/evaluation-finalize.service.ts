import {
  assertExpectedEvaluationVersion,
  assertExpectedEvaluationVersions,
} from './evaluation-concurrency';
import {
  EvaluationAccessPolicy,
  assertEvaluationAccess,
  type EvaluationActor,
} from '../domain/evaluation-access.policy';
import { UserRole } from '../../../common/shared';
import {
  EvaluationDeadlinePolicy,
  type EvaluationDeadlines,
} from '../domain/evaluation-deadline.policy';
import {
  idempotentOperation,
  type CommandDatabase,
} from '../../../common/idempotency/idempotent-operation';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { FormStatus, Prisma } from '../../../generated/prisma/client';
import {
  assertNotLocked,
  assertReopenTransition,
  assertTransition,
  EVALUATION_TRANSITIONS,
} from '../domain/evaluation-transition';
import { calculateClassification } from '../domain/score-calculator';
import { BulkFinalizeDto } from '../dto/bulk-finalize.dto';
import { FinalizeByFilterDto } from '../dto/finalize-by-filter.dto';
import { FinalizeEvaluationDto } from '../dto/finalize-evaluation.dto';
import {
  mapToDetailResponse,
  mapToScoreSummaryResponse,
} from '../helpers/evaluation.mapper';
import {
  evaluationDeadlineSelect,
  evaluationDetailSelect,
  evaluationScoreSummarySelect,
} from '../selects/evaluation-form.select';
import type {
  EvaluationDetailResponse,
  EvaluationScoreSummaryResponse,
} from '../types/evaluation-form.types';
import {
  writeEvaluation,
  writeEvaluationAndRead,
} from './evaluation-concurrency';

const BULK_FINALIZE_LIMIT = 500;
type FinalizeBatchResult = {
  message: string;
  approvedCount: number;
  skippedCount?: number;
};

/** Phê duyệt cuối và mở lại; giữ nguyên quy tắc duyệt đơn/batch của API hiện có. */
@Injectable()
export class EvaluationFinalizeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mở lại phiếu đánh giá: chuyển trạng thái về draft để sinh viên chỉnh sửa lại từ đầu.
   * Giữ nguyên điểm 5 mục đã chấm (study/discipline/activity/community/role) vì đây vẫn
   * là dữ liệu hợp lệ của sinh viên; chỉ reset các trường thuộc vòng duyệt (điểm lớp,
   * điểm cuối, người/thời điểm duyệt ở từng cấp) vì vòng duyệt cũ không còn hiệu lực.
   *
   * @throws NotFoundException nếu phiếu không tồn tại
   * @throws ConflictException nếu phiếu đang ở trạng thái draft (mở lại vô nghĩa)
   */
  async reopen(
    actor: EvaluationActor,
    id: string,
    expectedVersion?: number,
  ): Promise<EvaluationDetailResponse> {
    assertEvaluationAccess(EvaluationAccessPolicy.canFinalize(actor));
    const current = await this.prisma.evaluationForm.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        status: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    if (!current) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    assertExpectedEvaluationVersion(current, expectedVersion);
    assertReopenTransition(current.status);

    const evaluation = await this.prisma.$transaction((tx) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Admin,
        current.semester,
      );
      return writeEvaluationAndRead(tx, current, {
        data: {
          status: EVALUATION_TRANSITIONS.reopen.target,
          submittedAt: null,
          classScore: null,
          finalScore: null,
          classLeaderReviewedBy: null,
          classLeaderReviewedAt: null,
          classReviewedBy: null,
          classReviewedAt: null,
          adminFinalizedBy: null,
          adminFinalizedAt: null,
        },
        select: evaluationDetailSelect,
      });
    });

    return mapToDetailResponse(evaluation);
  }

  async finalize(
    actor: EvaluationActor,
    id: string,
    dto: FinalizeEvaluationDto,
    key?: string,
  ): Promise<EvaluationScoreSummaryResponse> {
    assertEvaluationAccess(EvaluationAccessPolicy.canFinalize(actor));
    const adminId = actor.id;
    return idempotentOperation(
      this.prisma,
      { actorId: adminId, action: 'finalize', key, input: { id, dto } },
      (database) => this.finalizeCommand(adminId, id, dto, database),
    );
  }

  private async finalizeCommand(
    adminId: string,
    id: string,
    dto: FinalizeEvaluationDto,
    database: CommandDatabase,
  ): Promise<EvaluationScoreSummaryResponse> {
    const current = await database.evaluationForm.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        status: true,
        classScore: true,
        isLocked: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    if (!current) {
      throw new NotFoundException('Không tìm thấy phiếu đánh giá');
    }

    assertExpectedEvaluationVersion(current, dto.expectedVersion);
    assertNotLocked(current);
    assertTransition(current.status, EVALUATION_TRANSITIONS.finalize.target);

    const finalScore = dto.finalScore ?? current.classScore;
    if (finalScore === null) {
      throw new ConflictException(
        'Phiếu chưa có điểm lớp chấm, không thể phê duyệt cuối',
      );
    }

    const evaluation = await database.$transaction((tx) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Admin,
        current.semester,
      );
      return writeEvaluationAndRead(tx, current, {
        data: {
          status: EVALUATION_TRANSITIONS.finalize.target,
          finalScore,
          rank: calculateClassification(finalScore),
          adminFinalizedBy: adminId,
          adminFinalizedAt: new Date(),
        },
        select: evaluationScoreSummarySelect,
      });
    });

    return mapToScoreSummaryResponse(evaluation);
  }

  async bulkFinalize(
    actor: EvaluationActor,
    dto: BulkFinalizeDto,
    key?: string,
  ): Promise<FinalizeBatchResult> {
    assertEvaluationAccess(EvaluationAccessPolicy.canFinalize(actor));
    const adminId = actor.id;
    return idempotentOperation(
      this.prisma,
      { actorId: adminId, action: 'bulkFinalize', key, input: dto },
      (database) => this.bulkFinalizeCommand(adminId, dto, database),
    );
  }

  private async bulkFinalizeCommand(
    adminId: string,
    dto: BulkFinalizeDto,
    database: CommandDatabase,
  ): Promise<FinalizeBatchResult> {
    if (dto.ids.length > BULK_FINALIZE_LIMIT) {
      throw new BadRequestException(
        `Chỉ được phê duyệt tối đa ${BULK_FINALIZE_LIMIT} phiếu mỗi lần`,
      );
    }

    const forms = await database.evaluationForm.findMany({
      where: {
        id: { in: dto.ids },
        status: EVALUATION_TRANSITIONS.finalize.from[0],
      },
      select: {
        id: true,
        version: true,
        status: true,
        classScore: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    assertExpectedEvaluationVersions(forms, dto.ids, dto.expectedVersions);

    if (forms.length === 0) {
      throw new BadRequestException(
        'Không có phiếu hợp lệ để phê duyệt (có thể đã được duyệt trước đó)',
      );
    }

    await this.finalizeForms(adminId, forms, database);

    const skipped = dto.ids.length - forms.length;
    return {
      message: `Đã phê duyệt ${forms.length} phiếu${
        skipped > 0 ? `, bỏ qua ${skipped} phiếu không hợp lệ trạng thái` : ''
      }`,
      approvedCount: forms.length,
      skippedCount: skipped,
    };
  }

  async finalizeByFilter(
    actor: EvaluationActor,
    dto: FinalizeByFilterDto,
    key?: string,
  ): Promise<FinalizeBatchResult> {
    assertEvaluationAccess(EvaluationAccessPolicy.canFinalize(actor));
    const adminId = actor.id;
    return idempotentOperation(
      this.prisma,
      { actorId: adminId, action: 'finalizeByFilter', key, input: dto },
      (database) => this.finalizeByFilterCommand(adminId, dto, database),
    );
  }

  private async finalizeByFilterCommand(
    adminId: string,
    dto: FinalizeByFilterDto,
    database: CommandDatabase,
  ): Promise<FinalizeBatchResult> {
    const where: Prisma.EvaluationFormWhereInput = {
      status: EVALUATION_TRANSITIONS.finalize.from[0],
      ...(dto.semesterId && { semesterId: dto.semesterId }),
      ...(dto.classId && { classId: dto.classId }),
      ...(dto.facultyId && {
        class: { major: { facultyId: dto.facultyId } },
      }),
    };

    const candidates = await database.evaluationForm.findMany({
      where,
      select: {
        id: true,
        version: true,
        status: true,
        classScore: true,
        semester: { select: evaluationDeadlineSelect },
      },
    });

    if (candidates.length === 0) {
      return {
        message: 'Không có phiếu nào phù hợp để phê duyệt',
        approvedCount: 0,
      };
    }

    if (candidates.length > BULK_FINALIZE_LIMIT && !dto.confirmLargeAction) {
      throw new BadRequestException({
        message: `Thao tác này sẽ phê duyệt ${candidates.length} phiếu, vượt ngưỡng an toàn ${BULK_FINALIZE_LIMIT}. Vui lòng xác nhận lại bằng cách gửi confirmLargeAction=true.`,
        count: candidates.length,
      });
    }

    await this.finalizeForms(adminId, candidates, database);

    return {
      message: `Đã phê duyệt ${candidates.length} phiếu`,
      approvedCount: candidates.length,
    };
  }

  /**
   * Tương thích POST /:id/review: role/status/assignment đã được review kiểm tra.
   * Nhánh cũ không kiểm tra isLocked, khác finalize() đơn; giữ nguyên để refactor không đổi API.
   */
  async finalizeReviewedForm(
    actor: EvaluationActor,
    form: {
      id: string;
      version: number;
      status: FormStatus;
      classScore: number | null;
      semester: EvaluationDeadlines;
    },
    database: CommandDatabase = this.prisma,
  ): Promise<EvaluationScoreSummaryResponse> {
    assertEvaluationAccess(EvaluationAccessPolicy.canFinalize(actor));
    const adminId = actor.id;
    assertTransition(form.status, EVALUATION_TRANSITIONS.finalize.target);
    if (form.classScore === null)
      throw new ConflictException(
        'Phiếu chưa có điểm lớp chấm, không thể phê duyệt cuối',
      );
    const finalScore = form.classScore;
    const approved = await database.$transaction((tx) => {
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Admin,
        form.semester,
      );
      return writeEvaluationAndRead(tx, form, {
        data: {
          status: EVALUATION_TRANSITIONS.finalize.target,
          finalScore,
          rank: calculateClassification(finalScore),
          adminFinalizedBy: adminId,
          adminFinalizedAt: new Date(),
        },
        select: evaluationScoreSummarySelect,
      });
    });
    return mapToScoreSummaryResponse(approved);
  }

  // Batch giữ transaction ban đầu; classScore null vẫn thành 0 theo hành vi cũ.
  private finalizeForms(
    adminId: string,
    forms: Array<{
      id: string;
      version: number;
      status: FormStatus;
      classScore: number | null;
      semester: EvaluationDeadlines;
    }>,
    database: CommandDatabase = this.prisma,
  ) {
    // Valide toàn bộ batch trước khi tạo bất kỳ thao tác ghi nào.
    for (const form of forms)
      assertTransition(form.status, EVALUATION_TRANSITIONS.finalize.target);
    const finalizedAt = new Date();
    return database.$transaction(async (tx) => {
      // Thứ tự khóa ổn định cho hai batch giao nhau; một conflict rollback cả batch.
      for (const form of [...forms].sort((a, b) => a.id.localeCompare(b.id))) {
        EvaluationDeadlinePolicy.assertWithinDeadline(
          UserRole.Admin,
          form.semester,
        );
        const finalScore = form.classScore ?? 0;
        await writeEvaluation(tx, form, {
          status: EVALUATION_TRANSITIONS.finalize.target,
          finalScore,
          rank: calculateClassification(finalScore),
          adminFinalizedBy: adminId,
          adminFinalizedAt: finalizedAt,
        });
      }
    });
  }
}
