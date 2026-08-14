import type { UserRole } from 'src/common/shared';

/** Response tài khoản cho admin - không chứa passwordHash/refreshTokenHash. */
export type AdminUserResponse = {
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
  classId: string | null;
  facultyId: string | null;
  class: {
    id: string;
    code: string;
    name: string;
  } | null;
  faculty: {
    id: string;
    code: string;
    name: string;
  } | null;
  managedClasses: Array<{
    id: string;
    code: string;
    name: string;
    assignedAt: Date;
  }>;
  managedFaculty: {
    id: string;
    code: string;
    name: string;
    assignedAt: Date;
  } | null;
  accountEmailSent?: boolean;
  accountEmailError?: string | null;
};
