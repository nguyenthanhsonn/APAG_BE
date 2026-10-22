import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

export type EvaluationSnapshot = { id: string; version: number };
export const EVALUATION_CONFLICT_MESSAGE =
  'Phiếu đã được cập nhật bởi yêu cầu khác. Vui lòng tải lại dữ liệu và thử lại.';

export function assertEvaluationUpdated(count: number): void {
  if (count !== 1) throw new ConflictException(EVALUATION_CONFLICT_MESSAGE);
}

/**
 * Compare-and-swap (CAS): không tách kiểm tra version thành một SELECT trước UPDATE.
 * DB kiểm tra id + version và tăng version trong cùng câu lệnh. Throw bên trong
 * transaction để rollback cả điểm tiêu chí/notification của request thua cuộc.
 * Đây là guard ghi đồng thời, không phải repository bọc các truy vấn Prisma.
 */
export async function writeEvaluation(
  tx: Prisma.TransactionClient,
  snapshot: EvaluationSnapshot,
  data: Omit<Prisma.EvaluationFormUncheckedUpdateManyInput, 'version'>,
): Promise<number> {
  const result = await tx.evaluationForm.updateMany({
    where: { id: snapshot.id, version: snapshot.version },
    data: { ...data, version: { increment: 1 } },
  });
  assertEvaluationUpdated(result.count);
  return snapshot.version + 1;
}

/** Đọc response trong cùng transaction, khi row lock của lần CAS vẫn còn được giữ. */
export async function writeEvaluationAndRead<
  TSelect extends Prisma.EvaluationFormSelect,
>(
  tx: Prisma.TransactionClient,
  snapshot: EvaluationSnapshot,
  args: {
    data: Omit<Prisma.EvaluationFormUncheckedUpdateManyInput, 'version'>;
    select: TSelect;
  },
): Promise<Prisma.EvaluationFormGetPayload<{ select: TSelect }>> {
  await writeEvaluation(tx, snapshot, args.data);
  return (await tx.evaluationForm.findUniqueOrThrow({
    where: { id: snapshot.id },
    select: args.select,
  })) as Prisma.EvaluationFormGetPayload<{ select: TSelect }>;
}

/** So sánh snapshot màn hình trước lần CAS; CAS vẫn chặn thay đổi xảy ra sau lần đọc này. */
export function assertExpectedEvaluationVersion(
  snapshot: EvaluationSnapshot,
  expectedVersion?: number,
): void {
  if (expectedVersion !== undefined && snapshot.version !== expectedVersion) {
    throw new ConflictException(EVALUATION_CONFLICT_MESSAGE);
  }
}

/** Khi client gửi snapshot của selection, mọi ID phải còn đúng version và còn là candidate. */
export function assertExpectedEvaluationVersions(
  snapshots: EvaluationSnapshot[],
  selectedIds: string[],
  expected?: EvaluationSnapshot[],
): void {
  if (expected === undefined) return;
  const versions = new Map(expected.map((item) => [item.id, item.version]));
  if (
    versions.size !== expected.length ||
    versions.size !== selectedIds.length ||
    snapshots.length !== selectedIds.length ||
    selectedIds.some((id) => !versions.has(id))
  ) {
    throw new ConflictException(
      'Danh sách phiếu đã thay đổi. Vui lòng tải lại dữ liệu.',
    );
  }
  for (const snapshot of snapshots) {
    if (!versions.has(snapshot.id))
      throw new ConflictException(EVALUATION_CONFLICT_MESSAGE);
    assertExpectedEvaluationVersion(snapshot, versions.get(snapshot.id));
  }
}
