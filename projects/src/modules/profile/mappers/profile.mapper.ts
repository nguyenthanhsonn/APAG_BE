import { formatDateOnly } from '../../../common/helpers/date-only.helper';
import type { ProfileRecord } from '../selects/profile.select';

export function mapToProfileResponse(user: ProfileRecord) {
  const currentEnrollment = user.classStudents[0] ?? null;
  const currentClass = currentEnrollment?.class ?? null;
  const currentMajor = currentClass?.major ?? null;
  const currentFaculty = currentMajor?.faculty ?? null;
  const classAssignments =
    user.role === 'advisor'
      ? user.advisorAssignments
      : user.classLeaderAssignments;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    dateOfBirth: formatDateOnly(user.dateOfBirth),
    role: user.role,
    isActive: user.isActive,
    student: currentEnrollment
      ? {
          studentCode: currentEnrollment.studentCode,
          enrolledAt: currentEnrollment.enrolledAt,
          class: currentClass
            ? {
                id: currentClass.id,
                code: currentClass.code,
                name: currentClass.name,
                enrollmentYear: currentClass.enrollmentYear,
              }
            : null,
          major: currentMajor
            ? {
                id: currentMajor.id,
                code: currentMajor.code,
                name: currentMajor.name,
              }
            : null,
          faculty: currentFaculty
            ? {
                id: currentFaculty.id,
                code: currentFaculty.code,
                name: currentFaculty.name,
              }
            : null,
        }
      : null,
    managedClasses: classAssignments.map((assignment) => {
      const assignedClass = assignment.class;
      const major = assignedClass.major;

      return {
        classId: assignedClass.id,
        classCode: assignedClass.code,
        className: assignedClass.name,
        enrollmentYear: assignedClass.enrollmentYear,
        studentCount: assignedClass._count.classStudents,
        assignedAt: assignment.assignedAt,
        major: {
          id: major.id,
          code: major.code,
          name: major.name,
        },
        faculty: {
          id: major.faculty.id,
          code: major.faculty.code,
          name: major.faculty.name,
        },
      };
    }),
    managedFaculty: user.facultyAssignment
      ? {
          id: user.facultyAssignment.faculty.id,
          code: user.facultyAssignment.faculty.code,
          name: user.facultyAssignment.faculty.name,
          assignedAt: user.facultyAssignment.assignedAt,
        }
      : null,
  };
}

export type ProfileResponse = ReturnType<typeof mapToProfileResponse>;
