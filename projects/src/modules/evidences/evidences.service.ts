import { assertExpectedEvaluationVersion } from '../training-evaluations/application/evaluation-concurrency';
import {
  EvaluationAccessPolicy,
  assertEvaluationAccess,
  type EvaluationActor,
} from '../training-evaluations/domain/evaluation-access.policy';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { writeEvaluation } from '../training-evaluations/application/evaluation-concurrency';
import {
  assertEditable,
  assertNotLocked,
} from '../training-evaluations/domain/evaluation-transition';
import { LinkEvidenceUrlDto } from './dto/link-evidence-url.dto';
import { mapToEvidenceResponse } from './mappers/evidence.mapper';
import { evidenceSelect } from './selects/evidence.select';
import type { EvidenceResponse } from './types/evidence.types';

@Injectable()
export class EvidencesService {
  constructor(private readonly prisma: PrismaService) {}

  async linkUrl(
    actor: EvaluationActor,
    dto: LinkEvidenceUrlDto,
  ): Promise<EvidenceResponse & { evaluationVersion: number }> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    return this.prisma.$transaction(async (tx) => {
      const form = await this.findOwnedEditableForm(
        tx,
        actor,
        dto.evaluationFormId,
      );
      assertExpectedEvaluationVersion(form, dto.expectedVersion);
      const criterion = await tx.evaluationCriteria.findFirst({
        where: { code: dto.criteriaCode, isActive: true },
        select: { id: true },
      });
      if (!criterion)
        throw new NotFoundException('Không tìm thấy tiêu chí đánh giá');

      // Giành version trước khi ghi minh chứng. Nếu submit/khóa vừa thay đổi phiếu,
      // CAS trả 409; không được lưu ảnh bằng snapshot còn editable nhưng đã hết hiệu lực.
      const evaluationVersion = await writeEvaluation(tx, form, {});
      const evidence = await tx.evidence.create({
        data: {
          studentId: actor.id,
          evaluationFormId: form.id,
          criterionId: criterion.id,
          imageUrl: dto.imageUrl,
          publicId: dto.publicId,
        },
        select: evidenceSelect,
      });
      return { ...mapToEvidenceResponse(evidence), evaluationVersion };
    });
  }

  async findMine(actor: EvaluationActor): Promise<EvidenceResponse[]> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const evidences = await this.prisma.evidence.findMany({
      where: { studentId: actor.id },
      select: evidenceSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return evidences.map(mapToEvidenceResponse);
  }

  async remove(
    actor: EvaluationActor,
    id: string,
    expectedVersion?: number,
  ): Promise<EvidenceResponse & { evaluationVersion: number }> {
    EvaluationAccessPolicy.assertRole('edit', actor);
    return this.prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.findFirst({
        where: { id, studentId: actor.id },
        select: { evaluationFormId: true },
      });
      if (!evidence) throw new NotFoundException('Không tìm thấy minh chứng');

      // Xóa cũng kiểm tra chủ sở hữu của chính phiếu chứa evidence, không chỉ evidence.studentId.
      const form = await this.findOwnedEditableForm(
        tx,
        actor,
        evidence.evaluationFormId,
      );
      assertExpectedEvaluationVersion(form, expectedVersion);
      const evaluationVersion = await writeEvaluation(tx, form, {});
      const deleted = await tx.evidence.delete({
        where: { id },
        select: evidenceSelect,
      });
      return { ...mapToEvidenceResponse(deleted), evaluationVersion };
    });
  }

  private async findOwnedEditableForm(
    tx: Prisma.TransactionClient,
    actor: EvaluationActor,
    evaluationFormId: string,
  ) {
    EvaluationAccessPolicy.assertRole('edit', actor);
    const form = await tx.evaluationForm.findFirst({
      where: { id: evaluationFormId, studentId: actor.id },
      select: {
        id: true,
        studentId: true,
        version: true,
        status: true,
        isLocked: true,
      },
    });
    // 404 cho cả ID không tồn tại và phiếu người khác, không tiết lộ dữ liệu của sinh viên khác.
    if (!form)
      throw new NotFoundException('Không tìm thấy phiếu đánh giá rèn luyện');
    assertEvaluationAccess(EvaluationAccessPolicy.canEdit(actor, form));
    assertNotLocked(form);
    assertEditable(form.status);
    return form;
  }
}
