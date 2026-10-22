import type { UserRole } from 'src/common/shared';

export type TokenSubject = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
};

export type JwtPayload = {
  sub: string;
  username: string;
  email: string;
  role: UserRole;
  jti?: string;
  revocationStamp?: string;
  iat?: number;
  exp?: number;
};
