import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserRole } from 'src/common/shared';
import {
  DATE_ONLY_FORMAT_MESSAGE,
  DATE_ONLY_PATTERN,
} from 'src/common/helpers/date-only.helper';
import {
  normalizeUsername,
  USERNAME_FORMAT_MESSAGE,
  USERNAME_PATTERN,
} from 'src/common/helpers/username.helper';

const MANAGED_USER_ROLES = [
  UserRole.Admin,
  UserRole.ClassLeader,
  UserRole.Advisor,
  UserRole.Faculty,
  UserRole.TrainingDepartment,
];

/**
 * Cập nhật thông tin tài khoản. Không cho sửa password ở đây (dùng /auth/change-password).
 * Cho phép sửa role và isActive trực tiếp - nếu isActive chuyển về false, service sẽ tự
 * đồng bộ lockedAt và thu hồi refresh token giống hành động khóa tài khoản.
 */
export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  /** Cho phép đổi username nhưng phải kiểm tra unique ở service. */
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? normalizeUsername(value) : value,
  )
  @IsString()
  @Length(3, 50)
  @Matches(USERNAME_PATTERN, { message: USERNAME_FORMAT_MESSAGE })
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: DATE_ONLY_FORMAT_MESSAGE })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'Vai trò không hợp lệ' })
  @IsIn(MANAGED_USER_ROLES, {
    message:
      'Không thể đổi vai trò thành sinh viên qua API này. Vui lòng dùng /admin/students',
  })
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @IsOptional()
  @IsUUID('4')
  facultyId?: string;
}

