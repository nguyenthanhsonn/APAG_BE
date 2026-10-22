import { ConflictException } from '@nestjs/common';
import { normalizeUsername } from './username.helper';
import { Prisma } from '../../generated/prisma/client';

/** Precheck giúp báo lỗi rõ; unique constraint vẫn là trọng tài khi hai request cùng ghi. */
export async function assertUserIdentifiersAvailable(
  database: Pick<Prisma.TransactionClient, 'user'>,
  input: { username?: string; email?: string },
  excludeId?: string,
): Promise<void> {
  const alternatives: Prisma.UserWhereInput[] = [];
  if (input.username !== undefined)
    alternatives.push({
      username: { equals: input.username, mode: 'insensitive' },
    });
  if (input.email !== undefined) alternatives.push({ email: input.email });
  if (!alternatives.length) return;
  // Bao gồm bản ghi đã xóa mềm: DB unique toàn cục vẫn giữ định danh đó.
  const existing = await database.user.findFirst({
    where: { OR: alternatives, ...(excludeId && { id: { not: excludeId } }) },
    select: { username: true, email: true },
  });
  if (!existing) return;
  if (normalizeUsername(existing.username) === input.username)
    throw new ConflictException('Tên đăng nhập đã tồn tại');
  throw new ConflictException('Email đã tồn tại');
}

/** Prisma có thể trả target dạng mảng cột hoặc tên index (đặc biệt partial index). */
export function throwBusinessUniqueConflict(error: unknown): void {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return;
  const target = error.meta?.target;
  // Prisma 7 adapter-pg có thể không cung cấp meta.target, chỉ trả constraint trong cause.
  const adapter = error.meta?.driverAdapterError as
    | {
        cause?: {
          constraint?: { index?: string; fields?: string[] };
          table?: string;
        };
      }
    | undefined;
  const constraint = adapter?.cause?.constraint;
  const identity = [
    error.meta?.modelName,
    Array.isArray(target) ? target.join(',') : target,
    constraint?.index,
    constraint?.fields?.join(','),
    adapter?.cause?.table,
  ].join(':');
  let message = 'Dữ liệu đã tồn tại hoặc vừa được tạo bởi yêu cầu khác';
  if (/username/.test(identity)) message = 'Tên đăng nhập đã tồn tại';
  else if (/student_code|studentCode/.test(identity))
    message = 'Mã sinh viên đã tồn tại';
  else if (/email/.test(identity)) message = 'Email đã tồn tại';
  else if (/ClassLeaderAssignment|class_leader_assignments/.test(identity))
    message = 'Lớp trưởng đã được phân công cho một lớp khác';
  else if (/AdvisorAssignment|advisor_assignments/.test(identity))
    message = 'Phân công CVHT cho lớp này đã tồn tại';
  else if (/FacultyAssignment|faculty_assignments/.test(identity))
    message = 'Tài khoản khoa đã được phân công cho một khoa';
  else if (/EvaluationForm|evaluation_forms/.test(identity))
    message = 'Phiếu đánh giá đã tồn tại cho học kỳ và năm học này';
  else if (/ClassStudent|class_students/.test(identity))
    message = 'Sinh viên đã có hồ sơ lớp, vui lòng tải lại dữ liệu';
  else if (/single_active|is_active|isActive/.test(identity))
    message = 'Hệ thống chỉ được có tối đa một học kỳ đang hoạt động';
  else if (/Semester|semesters/.test(identity))
    message = 'Học kỳ này đã tồn tại trong hệ thống';
  else if (/Class:|classes.*code/.test(identity)) message = 'Mã lớp đã tồn tại';
  throw new ConflictException(message);
}
