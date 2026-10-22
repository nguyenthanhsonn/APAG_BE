import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import {
  assertClassListAccess,
  EvaluationAccessPolicy,
  evaluationReadScope,
  facultyEvaluationScope,
} from './evaluation-access.policy';
import { getEvaluationDeadline } from './evaluation-deadline.policy';
import {
  assertNotLocked,
  assertTransition,
  resolveReviewStage,
} from './evaluation-transition';

describe('evaluation policies', () => {
  it('builds the owner filter before checking assignment for reviewer reads', () => {
    expect(evaluationReadScope('student', UserRole.Student, 'form')).toEqual({
      id: 'form',
      studentId: 'student',
    });
    expect(evaluationReadScope('advisor', UserRole.Advisor, 'form')).toEqual({
      id: 'form',
    });
  });

  it('does not allow a faculty to select another faculty or omit its assignment', () => {
    expect(facultyEvaluationScope('faculty')).toEqual({ facultyId: 'faculty' });
    expect(() => facultyEvaluationScope('faculty', 'other')).toThrow(
      ForbiddenException,
    );
    expect(() => facultyEvaluationScope(undefined)).toThrow(ForbiddenException);
  });

  it('requires a class selection and a valid reviewer assignment', () => {
    expect(() => assertClassListAccess(UserRole.Advisor)).toThrow(
      BadRequestException,
    );
    expect(
      EvaluationAccessPolicy.canReview(
        { id: 'advisor', role: UserRole.Advisor },
        { assignedToClass: false },
      ),
    ).toBe(false);
    expect(
      EvaluationAccessPolicy.canReview(
        { id: 'faculty', role: UserRole.Faculty },
        { assignedToClass: true },
      ),
    ).toBe(false);
    expect(
      EvaluationAccessPolicy.canFinalize({ id: 'admin', role: UserRole.Admin }),
    ).toBe(true);
  });

  it.each([
    [
      UserRole.ClassLeader,
      FormStatus.submitted,
      FormStatus.class_leader_approved,
    ],
    [
      UserRole.Advisor,
      FormStatus.class_leader_approved,
      FormStatus.class_approved,
    ],
    [UserRole.Admin, FormStatus.faculty_approved, FormStatus.finalized],
  ])('resolves the existing %s approval step', (role, current, next) => {
    expect(resolveReviewStage(role, current).nextApprovedStatus).toBe(next);
    expect(() => resolveReviewStage(role, FormStatus.draft)).toThrow(
      ConflictException,
    );
  });

  it('keeps lock and state guards separate from role/deadline lookup', () => {
    expect(() =>
      assertTransition(FormStatus.rejected, FormStatus.submitted),
    ).not.toThrow();
    expect(() =>
      assertTransition(FormStatus.finalized, FormStatus.submitted),
    ).toThrow(ConflictException);
    expect(() =>
      assertNotLocked({
        isLocked: true,
      }),
    ).toThrow('đã bị khóa');
    expect(() =>
      resolveReviewStage(
        UserRole.TrainingDepartment,
        FormStatus.faculty_approved,
      ),
    ).toThrow(ForbiddenException);
  });

  it('selects the same role-specific deadline metadata used by the write guard', () => {
    const studentDeadline = new Date('2020-01-01'),
      classDeadline = new Date('2020-02-01'),
      facultyDeadline = new Date('2020-03-01');
    const schedule = { studentDeadline, classDeadline, facultyDeadline };
    expect(getEvaluationDeadline(UserRole.Student, schedule)).toBe(
      studentDeadline,
    );
    expect(getEvaluationDeadline(UserRole.Advisor, schedule)).toBe(
      classDeadline,
    );
    expect(getEvaluationDeadline(UserRole.ClassLeader, schedule)).toBe(
      classDeadline,
    );
    expect(getEvaluationDeadline(UserRole.Faculty, schedule)).toBe(
      facultyDeadline,
    );
    expect(getEvaluationDeadline(UserRole.Admin, schedule)).toBeNull();
    expect(getEvaluationDeadline(UserRole.Student, {})).toBeNull();
  });
});
