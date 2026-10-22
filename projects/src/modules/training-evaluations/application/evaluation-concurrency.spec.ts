import { ConflictException } from '@nestjs/common';
import {
  writeEvaluation,
  writeEvaluationAndRead,
} from './evaluation-concurrency';

describe('evaluation compare-and-swap', () => {
  it('matches id and the read version and increments it atomically', async () => {
    const tx = {
      evaluationForm: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await expect(
      writeEvaluation(
        tx as never,
        { id: 'form', version: 7 },
        { studentScore: 80 },
      ),
    ).resolves.toBe(8);
    expect(tx.evaluationForm.updateMany).toHaveBeenCalledWith({
      where: { id: 'form', version: 7 },
      data: { studentScore: 80, version: { increment: 1 } },
    });
  });

  it('maps zero affected rows to 409 and does not read a response for a lost write', async () => {
    const tx = {
      evaluationForm: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
      },
    };
    try {
      await writeEvaluationAndRead(
        tx as never,
        { id: 'form', version: 7 },
        { data: { studentScore: 80 }, select: { id: true } },
      );
      throw new Error('Expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
    }
    expect(tx.evaluationForm.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('does not retry a stale snapshot automatically', async () => {
    const tx = {
      evaluationForm: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await expect(
      writeEvaluation(tx as never, { id: 'form', version: 7 }, {}),
    ).rejects.toThrow(ConflictException);
    expect(tx.evaluationForm.updateMany).toHaveBeenCalledTimes(1);
  });
});
