import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  authProfileUserSelect,
  authorizationUserSelect,
  type AuthorizationUser,
  loginUserSelect,
  passwordUserSelect,
  publicUserSelect,
  refreshTokenUserSelect,
  type AuthProfileUser,
  type LoginUser,
  type PasswordUser,
  type PublicUser,
  type RefreshTokenUser,
} from './selects/user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  /** Không cache role/trạng thái: thay đổi quyền hoặc soft delete phải có hiệu lực ở request kế tiếp. */
  findAuthorizationUserById(id: string): Promise<AuthorizationUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: authorizationUserSelect,
    });
  }

  async findAuthProfileById(id: string): Promise<AuthProfileUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: authProfileUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  /** Tìm tài khoản theo username - dùng riêng cho đăng nhập. */
  findByUsernameWithPassword(username: string): Promise<LoginUser | null> {
    return this.prisma.user.findUnique({
      where: { username },
      select: loginUserSelect,
    });
  }

  async findByIdWithPassword(id: string): Promise<PasswordUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: passwordUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  async findByIdWithRefreshToken(id: string): Promise<RefreshTokenUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: refreshTokenUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    return user;
  }

  async updateRefreshToken(
    id: string,
    refreshTokenHash: string,
    refreshTokenExpiresAt: Date,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        refreshTokenHash,
        refreshTokenExpiresAt,
      },
    });
  }

  async rotateRefreshToken(
    id: string,
    previousHash: string,
    nextHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: {
        id,
        refreshTokenHash: previousHash,
        isActive: true,
        deletedAt: null,
      },
      data: { refreshTokenHash: nextHash, refreshTokenExpiresAt: expiresAt },
    });
    return result.count === 1;
  }

  async clearRefreshToken(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }
}
