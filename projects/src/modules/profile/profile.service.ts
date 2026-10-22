import { ProfileCacheService } from '../../infrastructure/cache/profile-cache.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  mapToProfileResponse,
  type ProfileResponse,
} from './mappers/profile.mapper';
import { profileSelect } from './selects/profile.select';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileCacheService,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    return this.profiles.getOrLoad(userId, 'personal', async () => {
      const user = await this.prisma.user.findFirst({
        where: {
          id: userId,
          deletedAt: null,
        },
        select: profileSelect,
      });

      if (!user) {
        throw new NotFoundException('Không tìm thấy thông tin cá nhân');
      }

      return mapToProfileResponse(user);
    });
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const data: Prisma.UserUpdateInput = {};

    if (dto.phone !== undefined) {
      data.phone = dto.phone?.trim() || null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId, deletedAt: null },
        data,
        select: profileSelect,
      });

      await this.profiles.invalidate(userId);
      return mapToProfileResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Không tìm thấy thông tin cá nhân');
      }

      throw error;
    }
  }
}
