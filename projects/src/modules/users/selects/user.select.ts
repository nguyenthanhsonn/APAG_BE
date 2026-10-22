import { Prisma } from '../../../generated/prisma/client';

export const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  phone: true,
  dateOfBirth: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const authProfileUserSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
} satisfies Prisma.UserSelect;

// Principal hiện tại: query tối thiểu cho authorization, không lấy password/token hash.
export const authorizationUserSelect = {
  ...authProfileUserSelect,
  deletedAt: true,
} satisfies Prisma.UserSelect;
export type AuthorizationUser = Prisma.UserGetPayload<{
  select: typeof authorizationUserSelect;
}>;

// Dùng để đăng nhập - tìm theo username, nhưng vẫn lấy kèm email để đưa vào JWT payload.
export const loginUserSelect = {
  id: true,
  username: true,
  email: true,
  passwordHash: true,
  role: true,
  isActive: true,
} satisfies Prisma.UserSelect;

export const passwordUserSelect = {
  id: true,
  passwordHash: true,
} satisfies Prisma.UserSelect;

export const refreshTokenUserSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  refreshTokenHash: true,
  refreshTokenExpiresAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export type AuthProfileUser = Prisma.UserGetPayload<{
  select: typeof authProfileUserSelect;
}>;

export type LoginUser = Prisma.UserGetPayload<{
  select: typeof loginUserSelect;
}>;

export type PasswordUser = Prisma.UserGetPayload<{
  select: typeof passwordUserSelect;
}>;

export type RefreshTokenUser = Prisma.UserGetPayload<{
  select: typeof refreshTokenUserSelect;
}>;
