import type { UserRole } from '../../../common/shared';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { AuthTokenStoreService } from '../jwt/auth-token-store';
import type { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly tokenStore: AuthTokenStoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('app.jwtAccessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.jti || (await this.tokenStore.isTokenRevoked(payload))) {
      throw new UnauthorizedException('Mã truy cập không hợp lệ');
    }
    const user = await this.usersService.findAuthorizationUserById(payload.sub);
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Tài khoản không còn hoạt động');
    }
    // JWT xác nhận danh tính; quyền hiện tại lấy từ DB, không tin role cũ trong token.
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: user.role as UserRole,
      isActive: user.isActive,
      accessTokenId: payload.jti,
      tokenIssuedAt: payload.iat,
      tokenExpiresAt: payload.exp,
    };
  }
}
