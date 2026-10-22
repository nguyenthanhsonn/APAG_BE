import { ConflictException } from '@nestjs/common';
import {
  evaluationFixture,
  evaluationWriteMocks,
  reviewerFixture,
} from '../../../../test/fixtures/evaluation.fixture';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationReviewService } from './evaluation-review.service';

function setup(
  form = evaluationFixture({
    status: FormStatus.class_leader_approved,
    classScore: 80,
  }),
) {
  const events: string[] = [];
  const prisma = {
    evaluationForm: {
      findUnique: jest.fn().mockResolvedValue(form),
      ...evaluationWriteMocks(form),
    },
    formCriteriaScore: { updateMany: jest.fn() },
    notification: {
      createManyAndReturn: jest.fn().mockImplementation(async ({ data }) => {
        events.push('saved');
        return [
          {
            id: 'notification',
            ...data[0],
            isRead: false,
            createdAt: new Date(),
          },
        ];
      }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => {
    const result = await callback(prisma);
    events.push('commit');
    return result;
  });
  const queries = {
    assertClassAccess: jest.fn().mockResolvedValue(undefined),
    assertFormAccess: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { emitCreated: jest.fn(() => events.push('emit')) };
  const scores = {
    reviewScores: jest.fn().mockResolvedValue({ version: form.version }),
  };
  const finalization = {
    finalizeReviewedForm: jest
      .fn()
      .mockResolvedValue({ status: FormStatus.finalized }),
  };
  return {
    prisma,
    queries,
    notifications,
    scores,
    finalization,
    events,
    service: new EvaluationReviewService(
      prisma as never,
      notifications as never,
      queries as never,
      scores as never,
      finalization as never,
    ),
  };
}

describe('EvaluationReviewService', () => {
  it('confirms a reviewed form without advancing its status', async () => {
    const { service, prisma, scores } = setup();
    const dto = { scores: [{ criteriaCode: 'I.1', classScore: 7 }] };
    const result = await service.confirmReview(reviewerFixture(), 'form', dto);
    expect(scores.reviewScores).toHaveBeenCalledWith(
      reviewerFixture(),
      'form',
      dto,
      prisma,
    );
    const data = prisma.evaluationForm.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      classReviewedBy: 'reviewer',
      classReviewedAt: expect.any(Date),
    });
    expect(data).not.toHaveProperty('status');
    expect(result.status).toBe(FormStatus.class_leader_approved);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects confirmation until there is a class score', async () => {
    const { service, prisma } = setup(
      evaluationFixture({ status: FormStatus.class_leader_approved }),
    );
    await expect(
      service.confirmReview(reviewerFixture(), 'form'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
  });

  it('returns a form, clears review data and emits after commit', async () => {
    const { service, prisma, events } = setup();
    const result = await service.returnToStudent(reviewerFixture(), 'form', {
      reason: 'Bổ sung minh chứng',
    });
    expect(result.status).toBe(FormStatus.rejected);
    expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          note: '[CVHT trả về] Bổ sung minh chứng',
          classScore: null,
          finalScore: null,
          classReviewedBy: null,
        }),
      }),
    );
    expect(events).toEqual(['saved', 'commit', 'emit']);
  });

  it('delegates the legacy admin approval to finalization', async () => {
    const form = evaluationFixture({
      status: FormStatus.faculty_approved,
      classScore: 80,
    });
    const { service, prisma, finalization } = setup(form);
    await service.review(reviewerFixture(UserRole.Admin), 'form', {
      action: 'approve',
    });
    expect(finalization.finalizeReviewedForm).toHaveBeenCalledWith(
      reviewerFixture(UserRole.Admin),
      form,
      prisma,
    );
    expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
  });

  it('does not emit when returning a form fails to commit', async () => {
    const { service, prisma, notifications } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      service.returnToStudent(reviewerFixture(), 'form', { reason: 'reason' }),
    ).rejects.toThrow('write failed');
    expect(notifications.emitCreated).not.toHaveBeenCalled();
  });

  it.each([
    [UserRole.ClassLeader, FormStatus.class_leader_approved],
    [UserRole.Advisor, FormStatus.submitted],
  ] as const)(
    'does not confirm a form outside the %s review step',
    async (role, status) => {
      const { service, prisma } = setup(
        evaluationFixture({ status, classScore: 80 }),
      );
      await expect(
        service.confirmReview(reviewerFixture(role), 'form'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
    },
  );
  it('does not clear child scores or emit a notification after a stale reject', async () => {
    const { service, prisma, notifications } = setup();
    prisma.evaluationForm.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.returnToStudent(reviewerFixture(), 'form', { reason: 'reason' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.formCriteriaScore.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(notifications.emitCreated).not.toHaveBeenCalled();
  });

  it.each([
    [UserRole.ClassLeader, FormStatus.submitted, 'approve'],
    [UserRole.ClassLeader, FormStatus.submitted, 'reject'],
    [UserRole.Advisor, FormStatus.class_leader_approved, 'approve'],
    [UserRole.Advisor, FormStatus.class_leader_approved, 'reject'],
  ] as const)(
    'rejects overdue %s %s %s without writes or notifications',
    async (role, status, action) => {
      const { service, prisma, notifications } = setup(
        evaluationFixture({
          status,
          classScore: 80,
          semester: {
            ...evaluationFixture().semester,
            classDeadline: new Date(0),
          },
        }),
      );
      await expect(
        service.review(reviewerFixture(role), 'form', {
          action,
          comment: 'reason',
          classScore: 80,
        }),
      ).rejects.toThrow('quá hạn lớp trưởng/CVHT');
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
      expect(prisma.formCriteriaScore.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
      expect(notifications.emitCreated).not.toHaveBeenCalled();
    },
  );
  it.each([UserRole.ClassLeader, UserRole.Advisor])(
    'does not confirm %s review after classDeadline',
    async (role) => {
      const { service, prisma } = setup(
        evaluationFixture({
          status:
            role === UserRole.ClassLeader
              ? FormStatus.submitted
              : FormStatus.class_leader_approved,
          classScore: 80,
          semester: {
            ...evaluationFixture().semester,
            classDeadline: new Date(0),
          },
        }),
      );
      await expect(
        service.confirmReview(reviewerFixture(role), 'form'),
      ).rejects.toThrow('quá hạn');
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
    },
  );
});
