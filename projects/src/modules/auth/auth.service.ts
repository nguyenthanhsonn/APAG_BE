import { ProfileCacheService } from '../../infrastructure/cache/profile-cache.service';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User, UserRole } from 'src/common/shared';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { StudentAccountMailService } from '../mail/student-account-mail.service';
import { UsersService } from '../users/users.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthTokenStoreService } from './jwt/auth-token-store';
import { mapAuthProfileToUser } from '../users/mappers/user.mapper';
import { PASSWORD_SALT_ROUNDS } from './constants/password.constants';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import type { JwtPayload, TokenSubject } from './types/jwt-payload.type';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type LogoutResult = {
  loggedOut: true;
};

type ChangePasswordResult = {
  passwordChanged: true;
  requiresLogin: true;
};

type ForgotPasswordResult = {
  message: string;
};

type ResetPasswordResult = {
  message: string;
};

const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TTL_MINUTES = 15;
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
const FORGOT_PASSWORD_RESPONSE_MESSAGE =
  'Vui lòng kiểm tra email của bạn để tiếp tục đặt lại mật khẩu.';
const DEFAULT_DUMMY_PASSWORD_HASH =
  '$2b$12$DjZDTP1LMXJ6CGgi9sEmJO2AuIvrdOc4FFkSSI1U7oBRQl6np1Y5.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tokenStore: AuthTokenStoreService,
    private readonly prisma: PrismaService,
    private readonly mailService: StudentAccountMailService,
    private readonly profiles: ProfileCacheService,
  ) {}

  // đăng nhập bằng username + mật khẩu
  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.usersService.findByUsernameWithPassword(
      dto.username,
    );
    const hashToCompare = user
      ? user.passwordHash
      : (this.configService.get<string>('app.dummyPasswordHash') ??
        DEFAULT_DUMMY_PASSWORD_HASH);
    const isPasswordValid = await bcrypt.compare(dto.password, hashToCompare);

    // Keep the dummy hash comparison above so a missing account still takes
    // roughly the same path as a wrong password, then return the clearer FE message.
    if (!user) {
      throw new UnauthorizedException('Tài khoản không tồn tại');
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Mật khẩu không đúng');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Tài khoản đã bị khóa hoặc không còn hoạt động',
      );
    }

    return this.createSession({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as UserRole,
    });
  }

  // lấy thông tin người dùng
  async getProfile(id: string): Promise<User> {
    return this.profiles.getOrLoad(id, 'auth', async () => {
      const user = await this.usersService.findAuthProfileById(id);
      if (!user) {
        throw new NotFoundException('Người dùng không tồn tại');
      }
      if (!user.isActive) {
        throw new UnauthorizedException('Người dùng không hoạt động');
      }

      const profile = mapAuthProfileToUser(user);

      return profile;
    });
  }

  // làm mới token
  async refreshToken(dto: RefreshTokenDto): Promise<AuthTokens> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    const user = await this.usersService.findByIdWithRefreshToken(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Mã làm mới không hợp lệ');
    }

    if (!user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new UnauthorizedException('Mã làm mới đã bị thu hồi');
    }

    if (user.refreshTokenExpiresAt.getTime() <= Date.now()) {
      await this.usersService.clearRefreshToken(user.id);
      throw new UnauthorizedException('Mã làm mới đã hết hạn');
    }

    const isRefreshTokenValid = await this.isRefreshTokenHashValid(
      dto.refreshToken,
      user.refreshTokenHash,
    );

    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Mã làm mới không hợp lệ');
    }

    return this.createSession(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role as UserRole,
      },
      user.refreshTokenHash,
    );
  }

  async logout(
    user: AuthenticatedUser,
    dto: LogoutDto = {},
  ): Promise<LogoutResult> {
    await this.tokenStore.revokeToken(user.accessTokenId, user.tokenExpiresAt);

    if (dto.refreshToken) {
      const payload = await this.verifyRefreshToken(dto.refreshToken);
      if (payload.sub !== user.id) {
        throw new UnauthorizedException('Mã làm mới không hợp lệ');
      }
    }

    await this.usersService.clearRefreshToken(user.id);
    await this.profiles.invalidate(user.id);

    return { loggedOut: true };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<ForgotPasswordResult> {
    const identifier = dto.identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ username: identifier }, { email: identifier }],
      },
      select: { id: true, email: true, fullName: true },
    });

    // Không tiết lộ tài khoản có tồn tại hay không để tránh bị dò username/email.
    if (!user) {
      return { message: FORGOT_PASSWORD_RESPONSE_MESSAGE };
    }

    const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString(
      'base64url',
    );
    const tokenHash = this.hashPasswordResetToken(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });

      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });
    });

    try {
      await this.mailService.sendPasswordReset({
        email: user.email,
        fullName: user.fullName,
        resetUrl: this.buildPasswordResetUrl(rawToken),
        expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        expiresAt: expiresAt.getTime(),
      });
    } catch (error) {
      await this.prisma.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null },
        data: { usedAt: new Date() },
      });
      this.logger.error(
        `Không thể gửi email đặt lại mật khẩu cho userId=${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Không thể gửi email đặt lại mật khẩu, vui lòng thử lại sau',
      );
    }

    return { message: FORGOT_PASSWORD_RESPONSE_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<ResetPasswordResult> {
    const tokenHash = this.hashPasswordResetToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            passwordHash: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() <= Date.now() ||
      resetToken.user.deletedAt
    ) {
      throw new BadRequestException(
        'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
      );
    }

    if (await bcrypt.compare(dto.newPassword, resetToken.user.passwordHash)) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(
      dto.newPassword,
      PASSWORD_SALT_ROUNDS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      }),
      this.prisma.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          usedAt: null,
        },
        data: { usedAt: now },
      }),
    ]);

    await this.tokenStore.revokeUserTokensIssuedBefore(resetToken.userId);
    await this.profiles.invalidate(resetToken.userId);

    return {
      message:
        'Đặt lại mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
    };
  }

  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<ChangePasswordResult> {
    const userWithPassword = await this.usersService.findByIdWithPassword(
      user.id,
    );

    if (
      !userWithPassword ||
      !(await bcrypt.compare(
        dto.currentPassword,
        userWithPassword.passwordHash,
      ))
    ) {
      throw new UnauthorizedException('Mật khẩu hiện tại không đúng');
    }

    if (await bcrypt.compare(dto.newPassword, userWithPassword.passwordHash)) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    const passwordHash = await bcrypt.hash(
      dto.newPassword,
      PASSWORD_SALT_ROUNDS,
    );
    await this.usersService.updatePasswordHash(user.id, passwordHash);
    await this.usersService.clearRefreshToken(user.id);
    await this.tokenStore.revokeUserTokensIssuedBefore(user.id);
    await this.profiles.invalidate(user.id);
    await this.tokenStore.revokeToken(user.accessTokenId, user.tokenExpiresAt);

    return {
      passwordChanged: true,
      requiresLogin: true,
    };
  }

  private async createSession(
    subject: TokenSubject,
    previousRefreshHash?: string,
  ): Promise<AuthTokens> {
    const revocationStamp = await this.tokenStore.getRevocationStamp(
      subject.id,
    );
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(subject, revocationStamp),
      this.signRefreshToken(subject, revocationStamp),
    ]);
    const refreshTokenPayload =
      this.jwtService.decode<JwtPayload>(refreshToken);
    const refreshTokenExpiresAt = this.getTokenExpiresAt(refreshTokenPayload);
    const refreshTokenHash = this.hashRefreshToken(refreshToken);

    if (previousRefreshHash) {
      const updated = await this.usersService.rotateRefreshToken(
        subject.id,
        previousRefreshHash,
        refreshTokenHash,
        refreshTokenExpiresAt,
      );
      if (!updated)
        throw new UnauthorizedException(
          'Mã làm mới đã được sử dụng hoặc đã bị thu hồi',
        );
    } else {
      await this.usersService.updateRefreshToken(
        subject.id,
        refreshTokenHash,
        refreshTokenExpiresAt,
      );
    }

    return {
      accessToken,
      refreshToken,
    };
  }

  private signAccessToken(
    subject: TokenSubject,
    revocationStamp?: string,
  ): Promise<string> {
    const payload: JwtPayload = {
      revocationStamp,
      sub: subject.id,
      username: subject.username,
      email: subject.email,
      role: subject.role,
      jti: randomUUID(),
    };

    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('app.jwtAccessSecret'),
      expiresIn: this.configService.get<string>(
        'app.jwtAccessExpiresIn',
        '15m',
      ) as never,
    });
  }

  private signRefreshToken(
    subject: TokenSubject,
    revocationStamp?: string,
  ): Promise<string> {
    const payload: JwtPayload = {
      revocationStamp,
      jti: randomUUID(),
      sub: subject.id,
      username: subject.username,
      email: subject.email,
      role: subject.role,
    };

    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('app.jwtRefreshSecret'),
      expiresIn: this.configService.get<string>(
        'app.jwtRefreshExpiresIn',
        '7d',
      ) as never,
    });
  }

  private async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('app.jwtRefreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Mã làm mới không hợp lệ');
    }
    if (await this.tokenStore.isTokenRevoked(payload))
      throw new UnauthorizedException('Mã làm mới đã bị thu hồi');
    return payload;
  }

  private getTokenExpiresAt(payload: JwtPayload): Date {
    if (!payload.exp) {
      throw new UnauthorizedException('Mã làm mới không hợp lệ');
    }

    return new Date(payload.exp * 1000);
  }

  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private hashPasswordResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildPasswordResetUrl(token: string): string {
    const explicitResetUrl = this.configService.get<string>(
      'app.passwordResetUrl',
    );
    const frontendUrls =
      this.configService.get<string[]>('app.frontendUrls') ?? [];
    const preferredFrontendUrl =
      frontendUrls.find((url) => !url.includes('localhost')) ?? frontendUrls[0];
    const rawBaseUrl =
      explicitResetUrl ??
      preferredFrontendUrl ??
      this.configService.get<string>('app.studentPortalUrl') ??
      '';

    if (!rawBaseUrl) {
      return '';
    }

    try {
      const baseUrl = new URL(rawBaseUrl);
      if (!explicitResetUrl) {
        baseUrl.pathname = '/reset-password';
        baseUrl.search = '';
        baseUrl.hash = '';
      }
      baseUrl.searchParams.set('token', token);
      return baseUrl.toString();
    } catch {
      return '';
    }
  }

  private async isRefreshTokenHashValid(
    refreshToken: string,
    refreshTokenHash: string,
  ): Promise<boolean> {
    const tokenHash = this.hashRefreshToken(refreshToken);

    if (tokenHash === refreshTokenHash) {
      return true;
    }

    if (!refreshTokenHash.startsWith('$2')) {
      return false;
    }

    return bcrypt.compare(refreshToken, refreshTokenHash);
  }
}
