import { createNotificationOnce } from './create-notification-once';
import { getEvaluationDeadline } from '../training-evaluations/domain/evaluation-deadline.policy';
import { Injectable, NotFoundException } from '@nestjs/common';
import { FormStatus, SemesterNo } from '../../generated/prisma/client';
import { UserRole, type PaginatedResult } from '../../common/shared';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import type { GetNotificationsQueryDto } from './dto/get-notifications-query.dto';
import { NotificationType } from './enums/notification-type.enum';
import {
  notificationSelect,
  type NotificationRecord,
} from './selects/notification.select';
import type { NotificationResponse } from './types/notification.types';

const EVALUATION_REMINDER_TITLE =
  'Nhắc nhở: Bạn chưa nộp phiếu đánh giá rèn luyện';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findMine(
    userId: string,
    role: UserRole,
    query: GetNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationResponse>> {
    await this.createEvaluationReminderIfNeeded(userId, role);

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [notifications, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        select: notificationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      items: notifications.map(mapToNotificationResponse),
      page,
      limit,
      total,
    };
  }

  async countUnread(
    userId: string,
    role: UserRole,
  ): Promise<{ unreadCount: number }> {
    await this.createEvaluationReminderIfNeeded(userId, role);

    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount };
  }

  async markAsRead(userId: string, id: string): Promise<NotificationResponse> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!notification) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
      select: notificationSelect,
    });

    return mapToNotificationResponse(updated);
  }

  async markAllAsRead(userId: string): Promise<{ updatedCount: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { updatedCount: result.count };
  }

  emitCreated(notification: NotificationResponse) {
    this.notificationsGateway.emitNotification(
      notification.userId,
      notification,
    );
  }

  private async createEvaluationReminderIfNeeded(
    userId: string,
    role: UserRole,
  ) {
    if (role !== UserRole.Student) {
      return;
    }

    const activeSemester = await this.prisma.semester.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        year: true,
        semester: true,
        studentDeadline: true,
      },
      orderBy: [{ year: 'desc' }, { semester: 'desc' }],
    });

    if (!activeSemester) {
      return;
    }

    const evaluation = await this.prisma.evaluationForm.findFirst({
      where: {
        studentId: userId,
        semesterId: activeSemester.id,
      },
      select: { status: true },
    });

    if (
      evaluation &&
      !([FormStatus.draft, FormStatus.rejected] as FormStatus[]).includes(
        evaluation.status,
      )
    ) {
      return;
    }

    const semesterLabel = toSemesterLabel(activeSemester.semester);
    const deadline = getEvaluationDeadline(role, activeSemester);
    const deadlineText = deadline
      ? ` Hạn nộp: ${formatVietnamDate(deadline)}.`
      : '';
    const content = `Bạn hiện chưa nộp phiếu đánh giá rèn luyện ${semesterLabel} năm học ${activeSemester.year}.${deadlineText} Việc hoàn thành đánh giá rèn luyện đúng hạn giúp bạn đảm bảo quyền lợi xét học bổng, khen thưởng, thi đua và các chế độ chính sách khác của nhà trường. Vui lòng truy cập hệ thống để hoàn thành phiếu tự đánh giá trước khi hết hạn.`;

    // Dữ liệu trước migration chưa có dedupeKey; giữ reminder cũ thay vì tạo thêm một bản.
    // Unique constraint trong createNotificationOnce vẫn bảo vệ hai request cùng vượt qua SELECT.
    const legacyReminder = await this.prisma.notification.findFirst({
      where: {
        userId,
        dedupeKey: null,
        title: EVALUATION_REMINDER_TITLE,
        content,
      },
      select: { id: true },
    });
    if (legacyReminder) return;

    const notification = await createNotificationOnce(
      this.prisma,
      {
        userId,
        type: NotificationType.NEW_EVALUATION_PERIOD,
        title: EVALUATION_REMINDER_TITLE,
        content,
      },
      ['evaluation-reminder', activeSemester.id],
    );

    if (notification) this.emitCreated(mapToNotificationResponse(notification));
  }
}

export function mapToNotificationResponse(
  notification: NotificationRecord,
): NotificationResponse {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    content: notification.content,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}

export function toSemesterLabel(semester: SemesterNo) {
  const labels: Record<SemesterNo, string> = {
    [SemesterNo.SEMESTER_1]: 'học kỳ 1',
    [SemesterNo.SEMESTER_2]: 'học kỳ 2',
    [SemesterNo.summer]: 'học kỳ hè',
  };

  return labels[semester];
}

function formatVietnamDate(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}
