import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infrastructure/cache/redis.service';
import { cacheKeys } from '../../../infrastructure/cache/cache.keys';
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
const monotonicRevocation = `
local old=tonumber(redis.call('GET',KEYS[1]) or '0'); local next=math.max(tonumber(ARGV[1]),old+1)
local ttl=math.max(tonumber(ARGV[2]),redis.call('TTL',KEYS[1])); redis.call('SET',KEYS[1],string.format('%.0f',next),'EX',ttl); return next`;
@Injectable()
export class AuthTokenStoreService {
  private readonly maximumLifetime: number;
  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
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
    if (!jti) return;
    const lifetime = expiresAtSeconds
      ? Math.ceil(expiresAtSeconds - Date.now() / 1000)
      : this.maximumLifetime;
    if (lifetime > 0)
      await this.redis.set(cacheKeys.revokedToken(jti), '1', lifetime);
  }
  async revokeUserTokensIssuedBefore(
    userId: string,
    issuedBeforeSeconds?: number,
  ) {
    // Monotonic millisecond stamp also distinguishes two revocations within the same JWT iat second.
    await this.redis.eval(
      monotonicRevocation,
      [cacheKeys.userRevokedAfter(userId)],
      [
        String(
          issuedBeforeSeconds === undefined
            ? Date.now()
            : issuedBeforeSeconds * 1000,
        ),
        String(this.maximumLifetime),
      ],
    );
  }
  async getRevocationStamp(userId: string) {
    return (
      (await this.redis.get(cacheKeys.userRevokedAfter(userId))) ?? undefined
    );
  }
  async isTokenRevoked(
    payload: Pick<JwtPayload, 'sub' | 'jti' | 'iat' | 'revocationStamp'>,
  ): Promise<boolean> {
    const values = (await this.redis.command([
      'MGET',
      this.redis.key(cacheKeys.revokedToken(payload.jti || 'missing')),
      this.redis.key(cacheKeys.userRevokedAfter(payload.sub)),
    ])) as (string | null)[];
    if (values[0]) return true;
    const stamp = values[1];
    if (!stamp) return false;
    if (payload.revocationStamp !== undefined)
      return payload.revocationStamp !== stamp;
    return !payload.iat || payload.iat * 1000 <= Number(stamp); // Legacy JWTs minted before this rollout.
  }
}
