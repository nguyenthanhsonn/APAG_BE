import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { EvaluationAccessPolicy } from '../../training-evaluations/domain/evaluation-access.policy';
import { JwtStrategy } from './jwt.strategy';

const payload = {
  sub: 'user',
  username: 'old-name',
  email: 'old@example.test',
  role: UserRole.Admin,
  jti: 'token',
};
const current = {
  id: 'user',
  username: 'current-name',
  email: 'current@example.test',
  fullName: 'Current',
  role: UserRole.Student,
  isActive: true,
  deletedAt: null,
};
function setup() {
  const users = {
    findAuthorizationUserById: jest.fn().mockResolvedValue(current),
  };
  const tokens = { isTokenRevoked: jest.fn().mockResolvedValue(false) };
  const strategy = new JwtStrategy(
    { getOrThrow: () => 'test-only-secret' } as never,
    users as never,
    tokens as never,
  );
  return { users, tokens, strategy };
}
describe('JwtStrategy current authorization principal', () => {
  it('uses the database role rather than an older admin claim in a valid token', async () => {
    const { strategy, users } = setup();
    const principal = await strategy.validate(payload);
    expect(users.findAuthorizationUserById).toHaveBeenCalledWith('user');
    expect(principal).toMatchObject({
      id: 'user',
      role: UserRole.Student,
      username: 'current-name',
      email: 'current@example.test',
      fullName: 'Current',
      isActive: true,
    });
    expect(EvaluationAccessPolicy.canFinalize(principal)).toBe(false);
  });
  it.each([
    null,
    { ...current, isActive: false },
    { ...current, deletedAt: new Date() },
  ])(
    'rejects a missing, inactive or deleted account despite a valid JWT: %j',
    async (user) => {
      const { strategy, users } = setup();
      users.findAuthorizationUserById.mockResolvedValueOnce(user);
      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
  it('rejects revoked tokens before loading the account', async () => {
    const { strategy, tokens, users } = setup();
    tokens.isTokenRevoked.mockResolvedValue(true);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.findAuthorizationUserById).not.toHaveBeenCalled();
  });
  it('propagates auth state errors instead of bypassing token validation', async () => {
    const { strategy, tokens, users } = setup();
    tokens.isTokenRevoked.mockRejectedValue(new ServiceUnavailableException());
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(users.findAuthorizationUserById).not.toHaveBeenCalled();
  });
});
