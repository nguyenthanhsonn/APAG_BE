import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
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

/** Dữ liệu tạo tài khoản mới - mật khẩu sẽ được hash bằng bcrypt trước khi lưu. */
export class CreateAdminUserDto {
  @IsString()
  @MaxLength(255)
  fullName: string;

  /** Tên đăng nhập - dùng để login, phải là duy nhất trong hệ thống. */
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? normalizeUsername(value) : value,
  )
  @IsString()
  @Length(3, 50)
  @Matches(USERNAME_PATTERN, { message: USERNAME_FORMAT_MESSAGE })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(UserRole, { message: 'Vai trò không hợp lệ' })
  @IsIn(MANAGED_USER_ROLES, {
    message: 'Vui lòng dùng API /admin/students để tạo sinh viên',
  })
  role: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: DATE_ONLY_FORMAT_MESSAGE })
  dateOfBirth?: string;

  @IsOptional()
  @IsUUID('4')
  classId?: string;

  @IsOptional()
  @IsUUID('4')
  facultyId?: string;
}

