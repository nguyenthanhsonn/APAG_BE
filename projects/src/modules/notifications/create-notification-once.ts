import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { notificationSelect } from './selects/notification.select';

/** Recipient là một phần của key: cùng sự kiện chỉ tạo một thông báo/người nhận. */
export function notificationDedupeKey(userId: string, event: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([userId, event]))
    .digest('hex');
}

/** INSERT ... ON CONFLICT DO NOTHING, không dùng check-then-create gây race. */
export async function createNotificationOnce(
  database: Pick<Prisma.TransactionClient, 'notification'>,
  data: Omit<Prisma.NotificationCreateManyInput, 'dedupeKey'>,
  event: unknown,
) {
  const created = await database.notification.createManyAndReturn({
    data: [{ ...data, dedupeKey: notificationDedupeKey(data.userId, event) }],
    skipDuplicates: true,
    select: notificationSelect,
  });
  // null = request khác đã tạo; caller không phát lại realtime cho notification cũ.
  return created[0] ?? null;
}
