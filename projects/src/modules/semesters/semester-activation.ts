import type { Prisma } from '../../generated/prisma/client';

/**
 * Serialize các lệnh ghi học kỳ trước khi đọc trạng thái active hiện tại.
 * Dùng khóa PostgreSQL chung giữa các instance; unique partial index bảo vệ cả SQL ngoài app.
 * Không dùng khóa in-memory vì mỗi process có bộ nhớ riêng.
 */
export async function lockSemesterActivation(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029, 1)::text`;
}
