import type { UserRole } from 'src/common/shared';

/** Response hồ sơ sinh viên cho admin - không chứa passwordHash/refreshTokenHash. */
export type AdminStudentResponse = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
  role: UserRole;
  isActive: boolean;
  lockedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  studentInfo: {
    fullName: string;
    dateOfBirth: string | null;
    majorName: string | null;
    phone: string | null;
    email: string;
    studentCode: string | null;
    classCode: string | null;
    enrollmentYear: number | null;
    facultyName: string | null;
  };
  studentCode: string | null;
  enrolledAt: Date | null;
  class: { id: string; code: string; name: string } | null;
  major: { id: string; code: string; name: string } | null;
  faculty: { id: string; code: string; name: string } | null;
  accountEmailSent?: boolean;
  accountEmailQueued?: boolean;
  accountEmailError?: string | null;
};
