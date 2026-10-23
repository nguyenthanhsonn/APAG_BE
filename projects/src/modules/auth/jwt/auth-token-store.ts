import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '../types/jwt-payload.type';

export function tokenLifetimeSeconds(value: string): number {
  const match = /^([1-9]\d*)(ms|s|m|h|d|w|y)$/.exec(value);
  if (!match) throw new Error('Invalid configured token lifetime');
  const units: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31557600,
  };
  return Math.ceil(Number(match[1]) * units[match[2]!]!);
}
/** Local revocation state. Một API instance; state hết khi process restart. */
@Injectable()
export class AuthTokenStoreService {
  private readonly revokedTokens = new Map<string, number>();
  private readonly userRevocations = new Map<
    string,
    { stamp: number; expiresAt: number }
  >();
  private readonly maximumLifetime: number;

  constructor(config: ConfigService) {
    this.maximumLifetime =
      Math.max(
        tokenLifetimeSeconds(
          config.get<string>('app.jwtAccessExpiresIn') || '15m',
        ),
        tokenLifetimeSeconds(
          config.get<string>('app.jwtRefreshExpiresIn') || '7d',
        ),
      ) + 2;
  }
  async revokeToken(
    jti: string | undefined,
    expiresAtSeconds: number | undefined,
  ) {
    this.prune();
    if (!jti) return;
    const expiresAt =
      expiresAtSeconds === undefined
        ? Date.now() + this.maximumLifetime * 1000
        : expiresAtSeconds * 1000;
    if (expiresAt > Date.now()) this.revokedTokens.set(jti, expiresAt);
  }
  async revokeUserTokensIssuedBefore(
    userId: string,
    issuedBeforeSeconds?: number,
  ) {
    this.prune();
    const previous = this.userRevocations.get(userId);
    // Monotonic ms stamp vẫn phân biệt được hai lần revoke trong cùng giây.
    const stamp = Math.max(
      issuedBeforeSeconds === undefined
        ? Date.now()
        : issuedBeforeSeconds * 1000,
      (previous?.stamp ?? 0) + 1,
    );
    this.userRevocations.set(userId, {
      stamp,
      expiresAt: Date.now() + this.maximumLifetime * 1000,
    });
  }
  async getRevocationStamp(userId: string) {
    this.prune();
    const entry = this.userRevocations.get(userId);
    return entry ? String(entry.stamp) : undefined;
  }
  async isTokenRevoked(
    payload: Pick<JwtPayload, 'sub' | 'jti' | 'iat' | 'revocationStamp'>,
  ): Promise<boolean> {
    this.prune();
    if (payload.jti && this.revokedTokens.has(payload.jti)) return true;
    const entry = this.userRevocations.get(payload.sub);
    if (!entry) return false;
    if (payload.revocationStamp !== undefined)
      return payload.revocationStamp !== String(entry.stamp);
    return !payload.iat || payload.iat * 1000 <= entry.stamp;
  }
  private prune() {
    const now = Date.now();
    for (const [key, expiresAt] of this.revokedTokens)
      if (expiresAt <= now) this.revokedTokens.delete(key);
    for (const [key, entry] of this.userRevocations)
      if (entry.expiresAt <= now) this.userRevocations.delete(key);
  }
}
