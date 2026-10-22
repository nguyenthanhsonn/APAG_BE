import { ConflictException } from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { EvaluationDeadlinePolicy } from './evaluation-deadline.policy';

const deadline = new Date('2026-10-20T10:00:00Z');
const expiresAt = new Date('2026-10-20T16:59:59.999Z');
const schedule = {
  studentDeadline: deadline,
  classDeadline: deadline,
  facultyDeadline: deadline,
};
describe('EvaluationDeadlinePolicy', () => {
  it.each([
    UserRole.Student,
    UserRole.ClassLeader,
    UserRole.Advisor,
    UserRole.Faculty,
  ])(
    'allows %s before/at the deadline and rejects one millisecond after it',
    (role) => {
      for (const offset of [-1, 0])
        expect(() =>
          EvaluationDeadlinePolicy.assertWithinDeadline(
            role,
            schedule,
            new Date(expiresAt.getTime() + offset),
          ),
        ).not.toThrow();
      expect(() =>
        EvaluationDeadlinePolicy.assertWithinDeadline(
          role,
          schedule,
          new Date(expiresAt.getTime() + 1),
        ),
      ).toThrow(ConflictException);
    },
  );
  it.each([
    [UserRole.Student, 'studentDeadline'],
    [UserRole.ClassLeader, 'classDeadline'],
    [UserRole.Advisor, 'classDeadline'],
    [UserRole.Faculty, 'facultyDeadline'],
  ] as const)('uses only the deadline for %s', (role, field) => {
    const mixed = {
      studentDeadline: new Date(0),
      classDeadline: new Date(0),
      facultyDeadline: new Date(0),
      [field]: new Date('2100-01-01'),
    };
    expect(() =>
      EvaluationDeadlinePolicy.assertWithinDeadline(role, mixed, deadline),
    ).not.toThrow();
  });
  it.each(Object.values(UserRole))(
    'allows %s without a configured deadline',
    (role) => {
      expect(() =>
        EvaluationDeadlinePolicy.assertWithinDeadline(role, {}, deadline),
      ).not.toThrow();
      expect(() =>
        EvaluationDeadlinePolicy.assertWithinDeadline(
          role,
          { studentDeadline: null, classDeadline: null, facultyDeadline: null },
          deadline,
        ),
      ).not.toThrow();
    },
  );
  it.each([UserRole.Admin, UserRole.TrainingDepartment])(
    'does not impose a preceding-stage deadline on %s',
    (role) => {
      expect(() =>
        EvaluationDeadlinePolicy.assertWithinDeadline(
          role,
          {
            studentDeadline: new Date(0),
            classDeadline: new Date(0),
            facultyDeadline: new Date(0),
          },
          deadline,
        ),
      ).not.toThrow();
    },
  );
  it('compares the same instant across UTC and Vietnam timezone offsets', () => {
    const vietnamDeadline = new Date('2026-10-20T17:00:00+07:00');
    expect(() =>
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Student,
        { studentDeadline: vietnamDeadline },
        deadline,
      ),
    ).not.toThrow();
    expect(() =>
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Student,
        { studentDeadline: vietnamDeadline },
        new Date('2026-10-20T17:00:00.000Z'),
      ),
    ).toThrow(ConflictException);
  });
  it('keeps a date-only API deadline open through the whole selected Vietnam day', () => {
    const dateOnly = { studentDeadline: new Date('2026-10-20T00:00:00Z') };
    expect(
      EvaluationDeadlinePolicy.expiresAt(UserRole.Student, dateOnly),
    ).toEqual(expiresAt);
    expect(() =>
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Student,
        dateOnly,
        expiresAt,
      ),
    ).not.toThrow();
    expect(() =>
      EvaluationDeadlinePolicy.assertWithinDeadline(
        UserRole.Student,
        dateOnly,
        new Date('2026-10-20T17:00:00Z'),
      ),
    ).toThrow(ConflictException);
  });
});
