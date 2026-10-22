import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  evaluationFixture,
  evaluationWriteMocks,
  reviewerFixture,
} from '../../../../test/fixtures/evaluation.fixture';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationSubmitService } from './evaluation-submit.service';

function setup(form = evaluationFixture()) {
  const events: string[] = [];
  const receiver = {
    userId: 'receiver',
    user: {
      id: 'receiver',
      fullName: 'Receiver',
      isActive: true,
      deletedAt: null,
    },
  };
  const faculty = {
    id: 'faculty',
    code: 'FAC',
    name: 'Faculty',
    isActive: true,
    deletedAt: null,
  };
  const prisma = {
    evaluationForm: {
      findFirst: jest.fn().mockResolvedValue(form),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: form.id, status: FormStatus.submitted, classScore: 80 },
        ]),
      count: jest.fn().mockResolvedValue(0),
      ...evaluationWriteMocks(form),
    },
    formCriteriaScore: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    class: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'class',
        code: 'CLS',
        name: 'Class',
        major: { faculty },
      }),
    },
    advisorAssignment: { findMany: jest.fn().mockResolvedValue([receiver]) },
    facultyAssignment: {
      findMany: jest.fn().mockResolvedValue([receiver]),
      findUnique: jest
        .fn()
        .mockResolvedValue({ facultyId: faculty.id, faculty }),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: receiver.userId }]) },
    semester: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'semester',
        year: 2026,
        semester: form.semester.semester,
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'semester',
        year: 2026,
        semester: form.semester.semester,
      }),
    },
    notification: {
      createManyAndReturn: jest.fn().mockImplementation(async ({ data }) => {
        events.push('notification-saved');
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
  const notifications = { emitCreated: jest.fn(() => events.push('emit')) };
  const queries = {
    assertClassAccess: jest.fn().mockResolvedValue(undefined),
    assertFormAccess: jest.fn().mockResolvedValue(undefined),
    requireFacultyAssignment: jest
      .fn()
      .mockResolvedValue({ facultyId: faculty.id, faculty }),
  };
  return {
    prisma,
    notifications,
    queries,
    events,
    service: new EvaluationSubmitService(
      prisma as never,
      notifications as never,
      queries as never,
    ),
  };
}

describe('EvaluationSubmitService', () => {
  it.each([FormStatus.draft, FormStatus.rejected])(
    'submits %s and clears the previous review cycle atomically',
    async (status) => {
      const { service, prisma } = setup(
        evaluationFixture({ status, classScore: 77, finalScore: 77 }),
      );
      const result = await service.submit(
        { id: 'student', role: UserRole.Student },
        'form',
      );
      expect(prisma.evaluationForm.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'form', studentId: 'student' },
        }),
      );
      expect(prisma.formCriteriaScore.updateMany).toHaveBeenCalledWith({
        where: { formId: 'form' },
        data: { classScore: null, note: null },
      });
      expect(prisma.evaluationForm.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FormStatus.submitted,
            studentScore: 80,
            classScore: null,
            finalScore: null,
            classLeaderReviewedBy: null,
            classReviewedBy: null,
            adminFinalizedBy: null,
          }),
        }),
      );
      expect(result).toMatchObject({ status: 'submitted', totalScore: 80 });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    FormStatus.submitted,
    FormStatus.class_leader_approved,
    FormStatus.class_approved,
    FormStatus.faculty_approved,
    FormStatus.finalized,
  ])(
    'rejects resubmitting %s before starting a transaction',
    async (status) => {
      const { service, prisma } = setup(evaluationFixture({ status }));
      await expect(
        service.submit({ id: 'student', role: UserRole.Student }, 'form'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a locked or missing owned form', async () => {
    const { service, prisma } = setup(evaluationFixture({ isLocked: true }));
    await expect(
      service.submit({ id: 'student', role: UserRole.Student }, 'form'),
    ).rejects.toThrow(ConflictException);
    prisma.evaluationForm.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.submit({ id: 'other-student', role: UserRole.Student }, 'form'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['advisor', 'faculty', 'training_department'] as const)(
    'emits only after committing the forward-to-%s transaction',
    async (destination) => {
      const { service, events, prisma } = setup();
      if (destination === 'advisor') {
        await service.submitClassToAdvisor(
          reviewerFixture(UserRole.ClassLeader),
          'class',
          { semesterId: 'semester' },
        );
      } else if (destination === 'faculty') {
        prisma.evaluationForm.findMany.mockResolvedValueOnce([
          {
            id: 'form',
            status: FormStatus.class_leader_approved,
            classScore: 80,
          },
        ]);
        await service.submitClassToFaculty(reviewerFixture(), 'class', {
          semesterId: 'semester',
        });
      } else {
        prisma.evaluationForm.findMany.mockResolvedValueOnce([
          {
            id: 'form',
            version: 0,
            status: FormStatus.class_approved,
            classScore: 80,
          },
        ]);
        await service.submitFacultyToTrainingDepartment(
          reviewerFixture(UserRole.Faculty),
          'faculty',
          { semesterId: 'semester' },
        );
      }
      expect(events).toEqual(['notification-saved', 'commit', 'emit']);
      expect(prisma.semester.findUnique).toHaveBeenCalled();
      expect(prisma.semester.findFirst).not.toHaveBeenCalled();
    },
  );

  it('does not emit an event when the transaction fails', async () => {
    const { service, prisma, notifications } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      service.submitClassToAdvisor(
        reviewerFixture(UserRole.ClassLeader),
        'class',
        {},
      ),
    ).rejects.toThrow('commit failed');
    expect(notifications.emitCreated).not.toHaveBeenCalled();
  });

  it.each(['advisor', 'faculty', 'training_department'] as const)(
    'rejects an invalid candidate state before forwarding to %s',
    async (destination) => {
      const { service, prisma, notifications } = setup();
      prisma.evaluationForm.findMany.mockResolvedValueOnce([
        { id: 'form', version: 0, status: FormStatus.draft, classScore: 80 },
      ]);
      const request =
        destination === 'advisor'
          ? service.submitClassToAdvisor(
              reviewerFixture(UserRole.ClassLeader),
              'class',
              {},
            )
          : destination === 'faculty'
            ? service.submitClassToFaculty(reviewerFixture(), 'class', {})
            : service.submitFacultyToTrainingDepartment(
                reviewerFixture(UserRole.Faculty),
                'faculty',
                {},
              );
      await expect(request).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.emitCreated).not.toHaveBeenCalled();
    },
  );
  it('does not clear old review scores after a stale submit', async () => {
    const { service, prisma } = setup();
    prisma.evaluationForm.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.submit({ id: 'student', role: UserRole.Student }, 'form'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.formCriteriaScore.updateMany).not.toHaveBeenCalled();
  });

  it.each([FormStatus.draft, FormStatus.rejected])(
    'rejects %s submit after the student deadline without resetting child scores',
    async (status) => {
      const { service, prisma } = setup(
        evaluationFixture({
          status,
          semester: {
            ...evaluationFixture().semester,
            studentDeadline: new Date(0),
          },
        }),
      );
      await expect(
        service.submit({ id: 'student', role: UserRole.Student }, 'form'),
      ).rejects.toThrow('quá hạn nộp');
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
      expect(prisma.formCriteriaScore.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(['advisor', 'faculty', 'training_department'] as const)(
    'rejects expired forward-to-%s before writing any form or notification',
    async (destination) => {
      const { service, prisma, notifications } = setup();
      prisma.semester.findUnique.mockResolvedValueOnce({
        id: 'semester',
        year: 2026,
        semester: 'SEMESTER_1',
        studentDeadline: new Date('2100-01-01'),
        classDeadline:
          destination === 'training_department'
            ? new Date('2100-01-01')
            : new Date(0),
        facultyDeadline:
          destination === 'training_department'
            ? new Date(0)
            : new Date('2100-01-01'),
      });
      const status =
        destination === 'advisor'
          ? FormStatus.submitted
          : destination === 'faculty'
            ? FormStatus.class_leader_approved
            : FormStatus.class_approved;
      prisma.evaluationForm.findMany.mockResolvedValueOnce([
        { id: 'form', version: 0, status, classScore: 80 },
      ]);
      const request =
        destination === 'advisor'
          ? service.submitClassToAdvisor(
              reviewerFixture(UserRole.ClassLeader),
              'class',
              { semesterId: 'semester' },
            )
          : destination === 'faculty'
            ? service.submitClassToFaculty(reviewerFixture(), 'class', {
                semesterId: 'semester',
              })
            : service.submitFacultyToTrainingDepartment(
                reviewerFixture(UserRole.Faculty),
                'faculty',
                { semesterId: 'semester' },
              );
      await expect(request).rejects.toThrow('quá hạn');
      expect(prisma.evaluationForm.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
      expect(notifications.emitCreated).not.toHaveBeenCalled();
    },
  );
});
