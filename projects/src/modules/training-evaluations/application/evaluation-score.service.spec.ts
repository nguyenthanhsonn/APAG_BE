import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  evaluationFixture,
  evaluationWriteMocks,
  reviewerFixture,
} from '../../../../test/fixtures/evaluation.fixture';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationScoreService } from './evaluation-score.service';

function setup(form = evaluationFixture()) {
  const prisma = {
    evaluationForm: {
      findFirst: jest.fn().mockResolvedValue(form),
      findUnique: jest.fn().mockResolvedValue(form),
      ...evaluationWriteMocks(form),
    },
    evaluationCriteria: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'criterion', code: 'I.1', maxScore: 10 }]),
    },
    formCriteriaScore: {
      upsert: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([{ classScore: 7 }, { classScore: 8 }]),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  const queries = {
    assertClassAccess: jest.fn().mockResolvedValue(undefined),
    assertFormAccess: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    queries,
    service: new EvaluationScoreService(
      prisma as never,
      queries as never,
      { invalidate: jest.fn() } as never,
    ),
  };
}

describe('EvaluationScoreService', () => {
  it('updates a section and total without changing workflow status', async () => {
    const { prisma, service } = setup();
    const result = await service.updateRoleScore(
      { id: 'student', role: UserRole.Student },
      'form',
      {
        studentRoleType: 'NORMAL_STUDENT',
        normalStudentActivityScore: 3,
        specialAchievementLevel: 'SCHOOL_LEVEL_OR_HIGHER',
      },
    );
    expect(result).toMatchObject({ score: 10, totalScore: 85 });
    const data = prisma.evaluationForm.updateMany.mock.calls[0]![0].data;
    expect(data).toMatchObject({ roleScore: 10, studentScore: 85 });
    expect(data).not.toHaveProperty('status');
    expect(prisma.evaluationForm.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'form',
      studentId: 'student',
    });
  });

  it('rejects locked and submitted student edits without writing', async () => {
    const { prisma, service } = setup(
      evaluationFixture({ status: FormStatus.submitted }),
    );
    await expect(
      service.updateDraft({ id: 'student', role: UserRole.Student }, 'form', {
        note: 'note',
      }),
    ).rejects.toThrow(ConflictException);
    prisma.evaluationForm.findFirst.mockResolvedValueOnce(
      evaluationFixture({ isLocked: true }),
    );
    await expect(
      service.updateDraft({ id: 'student', role: UserRole.Student }, 'form', {
        note: 'note',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('clears confirmation after changing reviewed scores in the same transaction', async () => {
    const { prisma, service } = setup(
      evaluationFixture({ status: FormStatus.submitted }),
    );
    await service.reviewScores(reviewerFixture(UserRole.ClassLeader), 'form', {
      scores: [{ criteriaCode: 'I.1', classScore: 7 }],
    });
    expect(prisma.formCriteriaScore.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          classScore: 15,
          classLeaderReviewedBy: null,
          classLeaderReviewedAt: null,
        },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('checks reviewer assignment and criterion bounds before writing', async () => {
    const { prisma, service, queries } = setup(
      evaluationFixture({ status: FormStatus.class_leader_approved }),
    );
    queries.assertClassAccess.mockRejectedValueOnce(new ForbiddenException());
    const dto = { scores: [{ criteriaCode: 'I.1', classScore: 11 }] };
    await expect(
      service.reviewScores(reviewerFixture(), 'form', dto),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.reviewScores(reviewerFixture(), 'form', dto),
    ).rejects.toThrow('không được vượt quá 10');
    prisma.evaluationCriteria.findMany.mockResolvedValueOnce([]);
    await expect(
      service.reviewScores(reviewerFixture(), 'form', dto),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not write any criterion after losing the form version claim', async () => {
    const { service, prisma } = setup(
      evaluationFixture({ status: FormStatus.submitted }),
    );
    prisma.evaluationForm.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.reviewScores(reviewerFixture(UserRole.ClassLeader), 'form', {
        scores: [{ criteriaCode: 'I.1', classScore: 7 }],
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.formCriteriaScore.upsert).not.toHaveBeenCalled();
  });

  it.each([UserRole.ClassLeader, UserRole.Advisor])(
    'does not update criterion scores for %s after classDeadline',
    async (role) => {
      const { service, prisma } = setup(
        evaluationFixture({
          status:
            role === UserRole.ClassLeader
              ? FormStatus.submitted
              : FormStatus.class_leader_approved,
          semester: {
            ...evaluationFixture().semester,
            classDeadline: new Date(0),
          },
        }),
      );
      await expect(
        service.reviewScores(reviewerFixture(role), 'form', {
          scores: [{ criteriaCode: 'I.1', classScore: 7 }],
        }),
      ).rejects.toThrow('quá hạn');
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
      expect(prisma.formCriteriaScore.upsert).not.toHaveBeenCalled();
    },
  );
});
