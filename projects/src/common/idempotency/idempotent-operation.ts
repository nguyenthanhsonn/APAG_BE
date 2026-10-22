import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

/** Các transaction con dùng lại transaction của command, không commit riêng. */
export type CommandDatabase = Prisma.TransactionClient & {
  $transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
};
export type AfterCommit = (effect: () => void) => void;
const logger = new Logger('IdempotentOperation');

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// Lưu cây có tag để replay giữ Date/undefined của service, không đoán kiểu từ chuỗi ISO.
type Saved =
  | { type: 'date'; value: string }
  | { type: 'undefined' }
  | { type: 'array'; value: Saved[] }
  | { type: 'object'; value: Record<string, Saved> }
  | { type: 'value'; value: string | number | boolean | null };
function save(value: unknown): Saved {
  if (value === undefined) return { type: 'undefined' };
  if (value instanceof Date)
    return { type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return { type: 'array', value: value.map(save) };
  if (value !== null && typeof value === 'object')
    return {
      type: 'object',
      value: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, save(v)]),
      ),
    };
  return { type: 'value', value: value as string | number | boolean | null };
}
function restore(saved: Saved): unknown {
  switch (saved.type) {
    case 'date':
      return new Date(saved.value);
    case 'undefined':
      return undefined;
    case 'array':
      return saved.value.map(restore);
    case 'object':
      return Object.fromEntries(
        Object.entries(saved.value).map(([k, v]) => [k, restore(v)]),
      );
    case 'value':
      return saved.value;
  }
}

/**
 * Client tạo một key cho mỗi ý định thao tác, giữ nguyên key khi retry/double-click.
 * Khóa advisory ở PostgreSQL chờ request cùng key kể cả khi chạy ở process khác.
 * Receipt và nghiệp vụ commit cùng nhau: lỗi/rollback không để lại receipt thành công.
 * Không có key giữ CAS cũ; server không đoán hai body giống nhau là cùng một ý định.
 */
export async function idempotentOperation<T>(
  prisma: PrismaService,
  command: {
    actorId: string;
    action: string;
    key?: string;
    input: unknown;
    authorizeReplay?: (database: Prisma.TransactionClient) => Promise<void>;
  },
  work: (database: CommandDatabase, afterCommit: AfterCommit) => Promise<T>,
): Promise<T> {
  const effects: Array<() => void> = [];
  const afterCommit: AfterCommit = (effect) => effects.push(effect);
  let result: T;
  if (command.key === undefined) {
    result = await work(prisma as CommandDatabase, afterCommit);
  } else {
    if (!/^[!-~]{1,200}$/.test(command.key)) {
      throw new BadRequestException(
        'Idempotency-Key phải gồm 1–200 ký tự ASCII không chứa khoảng trắng',
      );
    }
    const scope = digest(
      canonical([command.actorId, command.action, command.key]),
    );
    const requestHash = digest(canonical(command.input));
    result = await prisma.$transaction(
      async (tx) => {
        // Hai int32 lấy từ SHA-256; SQL parameterized, không nội suy header vào SQL.
        const lock = Buffer.from(scope, 'hex');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock.readInt32BE(0)}::int, ${lock.readInt32BE(4)}::int)::text`;
        const receipt = await tx.operationReceipt.findUnique({
          where: { scope },
        });
        if (receipt) {
          if (receipt.requestHash !== requestHash)
            throw new ConflictException(
              'Idempotency-Key đã được dùng với dữ liệu khác. Hãy dùng key mới cho thao tác mới.',
            );
          // Replay không ghi nghiệp vụ, nhưng vẫn phải tôn trọng việc thu hồi quyền hiện tại.
          await command.authorizeReplay?.(tx);
          return restore(receipt.response as unknown as Saved) as T;
        }
        const database = new Proxy(tx, {
          get(target, property) {
            if (property === '$transaction')
              return async (
                callback: (
                  client: Prisma.TransactionClient,
                ) => Promise<unknown>,
              ) => callback(tx);
            return Reflect.get(target, property);
          },
        }) as CommandDatabase;
        const response = await work(database, afterCommit);
        await tx.operationReceipt.create({
          data: {
            scope,
            requestHash,
            response: save(response) as unknown as Prisma.InputJsonValue,
          },
        });
        return response;
      },
      { maxWait: 10000, timeout: 30000, isolationLevel: 'ReadCommitted' },
    );
  }
  // Socket chỉ là tín hiệu; lỗi socket không được biến một command đã commit thành lỗi API.
  for (const effect of effects) {
    try {
      effect();
    } catch (error) {
      logger.error('Không phát được realtime sau commit', error);
    }
  }
  return result;
}
