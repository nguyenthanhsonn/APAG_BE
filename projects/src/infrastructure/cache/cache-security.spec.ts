import { ConfigService } from '@nestjs/config';
import {
  AuthTokenStoreService,
  tokenLifetimeSeconds,
} from '../../modules/auth/jwt/auth-token-store';
import { ImportPreviewStore } from './import-preview-store.service';
import { ProfileCacheService } from './profile-cache.service';

describe('single-instance auth/import state', () => {
  afterEach(() => jest.useRealTimers());
  it.each([
    ['15m', 900],
    ['7d', 604800],
    ['1h', 3600],
    ['500ms', 1],
  ])('uses configured lifetime %s', (duration, seconds) => {
    expect(tokenLifetimeSeconds(String(duration))).toBe(seconds);
  });
  it('revokes valid tokens until expiry without retaining expired revocations', async () => {
    jest.useFakeTimers();
    const store = new AuthTokenStoreService(new ConfigService());
    const payload = { sub: 'u', jti: 'token' };
    await store.revokeToken('expired', Date.now() / 1000 - 1);
    expect(await store.isTokenRevoked({ sub: 'u', jti: 'expired' })).toBe(
      false,
    );
    await store.revokeToken('token', Date.now() / 1000 + 5);
    expect(await store.isTokenRevoked(payload)).toBe(true);
    jest.advanceTimersByTime(6000);
    expect(await store.isTokenRevoked(payload)).toBe(false);
  });
  it('keeps monotonic revocation stamps and accepts freshly issued tokens only', async () => {
    const store = new AuthTokenStoreService(new ConfigService());
    const old = { sub: 'u', jti: 'old', iat: Math.floor(Date.now() / 1000) };
    await store.revokeUserTokensIssuedBefore('u');
    const first = await store.getRevocationStamp('u');
    expect(await store.isTokenRevoked(old)).toBe(true);
    expect(await store.isTokenRevoked({ ...old, revocationStamp: first })).toBe(
      false,
    );
    await store.revokeUserTokensIssuedBefore('u');
    expect(await store.getRevocationStamp('u')).not.toBe(first);
    expect(await store.isTokenRevoked({ ...old, revocationStamp: first })).toBe(
      true,
    );
  });
  it('claims import previews once and expires unconsumed data', async () => {
    jest.useFakeTimers();
    const store = new ImportPreviewStore(
      new ConfigService({ app: { jwtRefreshSecret: 'test-preview-key' } }),
    );
    await store.set('preview', { password: 'test-password' });
    expect(await store.get('preview')).toEqual({ password: 'test-password' });
    const claims = await Promise.all([
      store.get('preview', true),
      store.get('preview', true),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await store.set('expired', { rows: [] });
    jest.advanceTimersByTime(600001);
    expect(await store.get('expired')).toBeNull();
  });
  it('loads profiles from the database again after updates', async () => {
    const profiles = new ProfileCacheService();
    let name = 'before';
    const loader = jest.fn(async () => ({ name }));
    expect(await profiles.getOrLoad('u', 'personal', loader)).toEqual({
      name: 'before',
    });
    name = 'after';
    await profiles.invalidate('u');
    expect(await profiles.getOrLoad('u', 'personal', loader)).toEqual({
      name: 'after',
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
