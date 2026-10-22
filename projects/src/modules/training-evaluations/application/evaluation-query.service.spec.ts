import {
  evaluationFixture,
  reviewerFixture,
} from '../../../../test/fixtures/evaluation.fixture';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationQueryService } from './evaluation-query.service';

describe('EvaluationQueryService', () => {
  function createService() {
    const prisma = {
      evaluationForm: {
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn((args: unknown) => args),
      },
      $transaction: jest.fn((operations: unknown[]) =>
        Promise.resolve(operations),
      ),
    };
    return { prisma, service: new EvaluationQueryService(prisma as never) };
  }
  it('returns admin approval list without extra review stats or student score', async () => {
    const { prisma, service } = createService();
    prisma.evaluationForm.findMany.mockResolvedValueOnce([
      {
        id: 'safe',
        status: FormStatus.class_approved,
        submittedAt: null,
        classScore: 73,
        rank: 'good',
        student: {
          id: 'student',
          fullName: 'Student',
          email: 'student@example.com',
        },
        class: {
          id: 'class',
          code: 'CLS',
          name: 'Class',
          major: {
            faculty: { id: 'faculty', code: 'FAC', name: 'Faculty' },
          },
        },
        semester: { year: 2026, semester: 'SEMESTER_2', isActive: true },
      },
    ]);
    prisma.evaluationForm.count.mockResolvedValueOnce(1);

    const result = await service.findAdminApprovalList(
      reviewerFixture(UserRole.Admin),
      {
        page: 1,
        limit: 20,
      },
    );

    expect(result).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(result).not.toHaveProperty('stats');
    expect(result.items[0]).toMatchObject({ classScore: 73, rank: 'good' });
    expect(result.items[0]).not.toHaveProperty('stats');
    expect(result.items[0]).not.toHaveProperty('studentScore');
  });
});

describe('evaluation read access', () => {
  function setup() {
    const prisma = {
      evaluationForm: {
        findFirst: jest.fn().mockResolvedValue({
          ...evaluationFixture(),
          class: { major: { facultyId: 'faculty' } },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      facultyAssignment: {
        findUnique: jest.fn().mockResolvedValue({
          facultyId: 'faculty',
          faculty: { isActive: true, deletedAt: null },
        }),
      },
      advisorAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
      classLeaderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { prisma, service: new EvaluationQueryService(prisma as never) };
  }

  it('scopes student reads by owner and requires assignment for reviewer reads', async () => {
    const { service, prisma } = setup();
    await service.getSummary('student', UserRole.Student, 'form');
    expect(prisma.evaluationForm.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'form',
      studentId: 'student',
    });
    await expect(
      service.getSummary('advisor', UserRole.Advisor, 'form'),
    ).rejects.toThrow('không được phân công');
    prisma.advisorAssignment.findUnique.mockResolvedValueOnce({
      id: 'assignment',
    });
    await service.getSummary('advisor', UserRole.Advisor, 'form');
    expect(prisma.evaluationForm.findFirst.mock.calls[1]![0].where).toEqual({
      id: 'form',
    });
  });

  it('applies faculty scope to both list and count and refuses cross-faculty selection', async () => {
    const { service, prisma } = setup();
    await service.findAll(reviewerFixture(UserRole.Faculty), {
      page: 2,
      limit: 20,
    });
    expect(prisma.evaluationForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { class: { major: { facultyId: 'faculty' } } },
        skip: 20,
        take: 20,
      }),
    );
    expect(prisma.evaluationForm.count).toHaveBeenCalledWith({
      where: { class: { major: { facultyId: 'faculty' } } },
    });
    await expect(
      service.findAll(reviewerFixture(UserRole.Faculty), {
        page: 1,
        limit: 20,
        facultyId: 'other',
      }),
    ).rejects.toThrow('khoa khác');
    expect(prisma.evaluationForm.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not query evaluations for an unassigned advisor', async () => {
    const { service, prisma } = setup();
    await expect(
      service.findAll(reviewerFixture(), {
        page: 1,
        limit: 20,
        classId: 'class',
      }),
    ).rejects.toThrow('không được phân công');
    expect(prisma.evaluationForm.findMany).not.toHaveBeenCalled();
  });

  it.each(['findOne', 'getSummary', 'getStatus'] as const)(
    'denies cross-faculty %s and allows the assigned faculty',
    async (method) => {
      const { service, prisma } = setup();
      await expect(
        service[method]('faculty-user', UserRole.Faculty, 'form'),
      ).resolves.toBeDefined();
      prisma.facultyAssignment.findUnique.mockResolvedValueOnce({
        facultyId: 'other',
        faculty: { isActive: true, deletedAt: null },
      });
      await expect(
        service[method]('faculty-user', UserRole.Faculty, 'form'),
      ).rejects.toThrow('khoa khác');
    },
  );

  it('denies an unassigned class leader but lets admin and training department read globally', async () => {
    const { service } = setup();
    await expect(
      service.getSummary('leader', UserRole.ClassLeader, 'form'),
    ).rejects.toThrow('không được phân công');
    await expect(
      service.getSummary('admin', UserRole.Admin, 'form'),
    ).resolves.toBeDefined();
    await expect(
      service.getSummary('training', UserRole.TrainingDepartment, 'form'),
    ).resolves.toBeDefined();
  });
});
