import { ConflictException } from '@nestjs/common';
import { UserRole } from '../../../common/shared';

const VIETNAM_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type EvaluationDeadlines = {
  studentDeadline?: Date | null;
  classDeadline?: Date | null;
  facultyDeadline?: Date | null;
};

/**
 * Một nguồn duy nhất ánh xạ cấp xử lý sang deadline của học kỳ chứa phiếu.
 * Không thực hiện I/O; truyền now khi test để kiểm tra biên mà không phụ thuộc giờ máy.
 */
export class EvaluationDeadlinePolicy {
  static deadlineFor(
    role: UserRole,
    schedule: EvaluationDeadlines,
  ): Date | null {
    switch (role) {
      case UserRole.Student:
        return schedule.studentDeadline ?? null;
      case UserRole.ClassLeader:
      case UserRole.Advisor:
        return schedule.classDeadline ?? null;
      case UserRole.Faculty:
        return schedule.facultyDeadline ?? null;
      // Admin/PĐT chưa có deadline riêng; không dùng nhầm mốc của cấp trước.
      default:
        return null;
    }
  }

  /** API cấu hình hạn theo ngày; ngày đó được phép xử lý đến 23:59:59.999 giờ Việt Nam. */
  static expiresAt(role: UserRole, schedule: EvaluationDeadlines): Date | null {
    const deadline = this.deadlineFor(role, schedule);
    if (deadline === null) return null;
    const parts = Object.fromEntries(
      VIETNAM_DATE.formatToParts(deadline).map((part) => [
        part.type,
        part.value,
      ]),
    );
    return new Date(
      `${parts.year}-${parts.month}-${parts.day}T23:59:59.999+07:00`,
    );
  }

  /**
   * Kiểm tra ngay trước khi ghi nghiệp vụ. Đúng deadline còn hợp lệ; null = không giới hạn.
   * Mốc hết hạn được dựng trong múi giờ Việt Nam, độc lập timezone của process chạy server.
   */
  static assertWithinDeadline(
    role: UserRole,
    schedule: EvaluationDeadlines,
    now: Date = new Date(),
  ): void {
    const deadline = this.expiresAt(role, schedule);
    if (deadline === null || now.getTime() <= deadline.getTime()) return;
    const message =
      role === UserRole.Student
        ? 'Đã quá hạn nộp phiếu đánh giá của sinh viên'
        : role === UserRole.Faculty
          ? 'Đã quá hạn khoa duyệt và gửi phiếu đánh giá'
          : 'Đã quá hạn lớp trưởng/CVHT đánh giá và duyệt phiếu';
    throw new ConflictException(message);
  }
}

/** Giữ API chọn deadline cho notification; dùng cùng ánh xạ với guard ghi. */
export function getEvaluationDeadline(
  role: UserRole,
  schedule: EvaluationDeadlines,
): Date | null {
  return EvaluationDeadlinePolicy.deadlineFor(role, schedule);
}
