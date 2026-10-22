import { ConfigService } from '@nestjs/config';
import {
  AuthTokenStoreService,
  tokenLifetimeSeconds,
} from '../../modules/auth/jwt/auth-token-store';

describe('shared auth state boundaries', () => {
  it.each([
    ['15m', 900],
    ['7d', 604800],
    ['1h', 3600],
    ['500ms', 1],
  ])('uses configured lifetime %s for revocation TTL', (duration, seconds) => {
    expect(tokenLifetimeSeconds(String(duration))).toBe(seconds);
  });
  it('does not write an already expired revocation and awaits the shared revocation read', async () => {
    const redis = {
      set: jest.fn(),
      key: (key: string) => `unit:${key}`,
      command: jest.fn().mockResolvedValue(['1', null]),
    };
    const store = new AuthTokenStoreService(
      redis as never,
      new ConfigService(),
    );
    await store.revokeToken('expired', Date.now() / 1000 - 1);
    expect(redis.set).not.toHaveBeenCalled();
    await expect(
      store.isTokenRevoked({ sub: 'user', jti: 'revoked' }),
    ).resolves.toBe(true);
    redis.command.mockResolvedValue([null, '1001']);
    await expect(
      store.isTokenRevoked({
        sub: 'user',
        jti: 'valid',
        revocationStamp: '1000',
      }),
    ).resolves.toBe(true);
    await expect(
      store.isTokenRevoked({
        sub: 'user',
        jti: 'valid',
        revocationStamp: '1001',
      }),
    ).resolves.toBe(false);
  });
});
