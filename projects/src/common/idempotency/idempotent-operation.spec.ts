import { BadRequestException, Logger } from '@nestjs/common';
import { idempotentOperation } from './idempotent-operation';

describe('idempotentOperation boundaries', () => {
  it.each(['', 'has space', 'line\nbreak', 'ắ', 'x'.repeat(201)])(
    'rejects an invalid key before querying the database: %j',
    async (key) => {
      const prisma = { $transaction: jest.fn() };
      const work = jest.fn();
      await expect(
        idempotentOperation(
          prisma as never,
          {
            actorId: 'actor',
            action: 'submit',
            input: {},
            key,
          },
          work,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
    },
  );

  it('preserves the legacy transaction boundary when no key is supplied', async () => {
    const prisma = {};
    const effect = jest.fn();
    const result = await idempotentOperation(
      prisma as never,
      {
        actorId: 'actor',
        action: 'submit',
        input: {},
      },
      async (database, afterCommit) => {
        expect(database).toBe(prisma);
        afterCommit(effect);
        expect(effect).not.toHaveBeenCalled();
        return { ok: true };
      },
    );
    expect(result).toEqual({ ok: true });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('does not report a committed command as failed when realtime throws', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        idempotentOperation(
          {} as never,
          {
            actorId: 'actor',
            action: 'submit',
            input: {},
          },
          async (_database, afterCommit) => {
            afterCommit(() => {
              throw new Error('socket unavailable');
            });
            return { ok: true };
          },
        ),
      ).resolves.toEqual({ ok: true });
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
