import { ForbiddenException } from '@nestjs/common';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/shared';
import { EvidencesService } from '../../evidences/evidences.service';
import { reviewerFixture } from '../../../../test/fixtures/evaluation.fixture';
import { TrainingEvaluationsController } from '../presentation/training-evaluations.controller';
import { EvaluationFinalizeService } from './evaluation-finalize.service';
import { EvaluationQueryService } from './evaluation-query.service';
import { EvaluationReviewService } from './evaluation-review.service';
import { EvaluationScoreService } from './evaluation-score.service';
import { EvaluationSubmitService } from './evaluation-submit.service';

const cases = [
  'create',
  'student-submit',
  'draft-edit',
  'review-scores',
  'confirm-review',
  'review-decision',
  'class-to-advisor',
  'class-to-faculty',
  'faculty-approval',
  'finalize',
  'bulk-finalize',
  'filter-finalize',
  'reopen',
  'admin-list',
  'evidence-link',
  'evidence-remove',
] as const;
describe('application authorization boundaries', () => {
  it.each(['create', 'findMine'] as const)(
    'allows students and class leaders through the roles guard for %s',
    (handler) => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          TrainingEvaluationsController.prototype[handler],
        ),
      ).toEqual([UserRole.Student, UserRole.ClassLeader]);
    },
  );

  it.each(cases)(
    'rejects wrong-role %s with 403 before queries, status validation or receipt replay',
    async (name) => {
      const prisma = {
        $transaction: jest.fn(),
        evaluationForm: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn(),
        },
      };
      const queries = new EvaluationQueryService(prisma as never);
      const scores = new EvaluationScoreService(prisma as never, queries, {
        invalidate: jest.fn(),
      } as never);
      const submit = new EvaluationSubmitService(
        prisma as never,
        {} as never,
        queries,
      );
      const finalize = new EvaluationFinalizeService(prisma as never);
      const review = new EvaluationReviewService(
        prisma as never,
        {} as never,
        queries,
        scores,
      );
      const evidence = new EvidencesService(prisma as never);
      const student = reviewerFixture(UserRole.Student),
        advisor = reviewerFixture(UserRole.Advisor);
      const admin = reviewerFixture(UserRole.Admin),
        leader = reviewerFixture(UserRole.ClassLeader);
      const calls: Record<(typeof cases)[number], () => Promise<unknown>> = {
        create: () =>
          submit.create(advisor, {
            semester: 'HK1',
            academicYear: '2026-2027',
          }),
        'student-submit': () =>
          submit.submit(admin, 'form', 'already-used-key'),
        'draft-edit': () => scores.updateDraft(admin, 'form', {}),
        'review-scores': () =>
          scores.reviewScores(student, 'form', { scores: [] }),
        'confirm-review': () => review.confirmReview(student, 'form'),
        'review-decision': () =>
          review.review(student, 'form', { action: 'approve' }),
        'class-to-advisor': () =>
          submit.submitClassToAdvisor(advisor, 'class', {}),
        'class-to-faculty': () =>
          submit.submitClassToFaculty(leader, 'class', {}),
        'faculty-approval': () =>
          submit.submitFacultyToTrainingDepartment(admin, 'faculty', {}),
        finalize: () =>
          finalize.finalize(admin, 'form', {}, 'already-used-key'),
        'bulk-finalize': () => finalize.bulkFinalize(admin, { ids: ['form'] }),
        'filter-finalize': () => finalize.finalizeByFilter(admin, {}),
        reopen: () => finalize.reopen(student, 'form'),
        'admin-list': () =>
          queries.findAdminApprovalList(student, { page: 1, limit: 20 }),
        'evidence-link': () =>
          evidence.linkUrl(admin, {
            evaluationFormId: 'form',
            criteriaCode: 'I.1',
            imageUrl: 'https://res.cloudinary.com/test.jpg',
            publicId: 'test',
          }),
        'evidence-remove': () => evidence.remove(admin, 'evidence'),
      };
      await expect(calls[name]()).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      for (const read of Object.values(prisma.evaluationForm))
        expect(read).not.toHaveBeenCalled();
    },
  );
});
