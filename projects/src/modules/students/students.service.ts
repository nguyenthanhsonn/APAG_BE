import { ProfileCacheService } from '../../infrastructure/cache/profile-cache.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UpdateStudentContactDto } from './dto/update-student-contact.dto';
import {
  mapStudentProfile,
  type StudentProfile,
} from './mappers/student.mapper';
import {
  studentEvaluationSelect,
  studentProfileSelect,
  type StudentEvaluationRecord,
  type StudentProfileRecord,
} from './selects/student.select';

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileCacheService,
  ) {}

  async getProfileStudent(userId: string): Promise<StudentProfile> {
    return this.profiles.getOrLoad(userId, 'student', async () => {
      const student = await this.prisma.user.findUnique({
        where: { id: userId },
        select: studentProfileSelect,
      });

      if (!student) {
        throw new NotFoundException('Không tìm thấy sinh viên');
      }

      const profile = mapStudentProfile(student);

      return profile;
    });
  }

  async updateProfile(
    userId: string,
    dto: UpdateStudentContactDto,
  ): Promise<StudentProfile> {
    const updateData: Prisma.UserUpdateInput = {
      ...(dto?.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
    };

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('Chưa cung cấp thông tin cần cập nhật');
    }

    try {
      const student: StudentProfileRecord = await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: studentProfileSelect,
      });

      const profile = mapStudentProfile(student);
      await this.profiles.invalidate(userId);

      return profile;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('Không tìm thấy sinh viên');
        }
      }

      throw error;
    }
  }

  async getMyEvaluations(
    user: AuthenticatedUser,
  ): Promise<StudentEvaluationRecord[]> {
    return this.prisma.evaluationForm.findMany({
      where: { studentId: user.id },
      select: studentEvaluationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
