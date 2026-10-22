import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';
import { EvaluationAccessPolicy as Policy } from './evaluation-access.policy';

const actor = (role: UserRole) => ({ id: 'user', role });
describe('EvaluationAccessPolicy', () => {
  it.each(Object.values(UserRole))(
    'has explicit capability decisions for %s even with matching scope facts',
    (role) => {
      const user = actor(role);
      const facts = {
        studentId: 'user',
        assignedToClass: true,
        facultyId: 'faculty',
        assignedFacultyId: 'faculty',
        facultyAvailable: true,
      };
      expect(Policy.canRead(user, facts)).toBe(true);
      expect(Policy.canEdit(user, facts)).toBe(role === UserRole.Student);
      expect(Policy.canReview(user, facts)).toBe(
        [UserRole.ClassLeader, UserRole.Advisor].includes(role),
      );
      expect(Policy.canSubmitClass(user, facts)).toBe(
        [UserRole.ClassLeader, UserRole.Advisor].includes(role),
      );
      expect(Policy.canApproveFaculty(user, facts)).toBe(
        role === UserRole.Faculty,
      );
      expect(Policy.canFinalize(user)).toBe(
        [UserRole.Admin, UserRole.TrainingDepartment].includes(role),
      );
    },
  );
  it.each([
    UserRole.Student,
    UserRole.ClassLeader,
    UserRole.Advisor,
    UserRole.Faculty,
  ])('fails closed for %s without ownership/assignment', (role) => {
    expect(Policy.canRead(actor(role), {})).toBe(false);
    expect(Policy.canEdit(actor(role), {})).toBe(false);
    expect(Policy.canReview(actor(role), {})).toBe(false);
    expect(Policy.canSubmitClass(actor(role), {})).toBe(false);
    expect(Policy.canApproveFaculty(actor(role), {})).toBe(false);
  });
  it('does not grant student reads or edits on another student form', () => {
    expect(
      Policy.canRead(actor(UserRole.Student), { studentId: 'other' }),
    ).toBe(false);
    expect(
      Policy.canEdit(actor(UserRole.Student), { studentId: 'other' }),
    ).toBe(false);
  });
  it('distinguishes the two class forwarding roles and rejects cross-faculty/inactive assignments', () => {
    expect(
      Policy.canSubmitClass(
        actor(UserRole.Advisor),
        { assignedToClass: true },
        UserRole.ClassLeader,
      ),
    ).toBe(false);
    expect(
      Policy.canSubmitClass(
        actor(UserRole.ClassLeader),
        { assignedToClass: true },
        UserRole.Advisor,
      ),
    ).toBe(false);
    expect(
      Policy.canApproveFaculty(actor(UserRole.Faculty), {
        facultyId: 'faculty',
        assignedFacultyId: 'other',
      }),
    ).toBe(false);
    expect(
      Policy.canApproveFaculty(actor(UserRole.Faculty), {
        facultyId: 'faculty',
        assignedFacultyId: 'faculty',
        facultyAvailable: false,
      }),
    ).toBe(false);
  });
  it.each(Object.values(FormStatus))(
    'keeps authorization independent of workflow status %s',
    (status) => {
      const owned = { studentId: 'user', status, isLocked: true };
      expect(Policy.canEdit(actor(UserRole.Student), owned)).toBe(true);
      expect(
        Policy.canReview(actor(UserRole.Advisor), {
          ...owned,
          assignedToClass: true,
        }),
      ).toBe(true);
      expect(Policy.canFinalize(actor(UserRole.Student))).toBe(false);
    },
  );
  it('returns 403 for unknown roles and for wrong-role review before checking status', () => {
    expect(
      Policy.canRead(actor('unknown' as UserRole), {
        studentId: 'user',
        assignedToClass: true,
      }),
    ).toBe(false);
    expect(() => Policy.assertRole('review', actor(UserRole.Admin))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      Policy.assertRole('finalize', actor(UserRole.Student)),
    ).toThrow(ForbiddenException);
  });
});
