import { ConflictException } from '@nestjs/common';
import { FormStatus } from '../../../generated/prisma/client';
import {
assertReopenTransition,
assertTransition,
canTransition,
} from './evaluation-transition';

// Hợp đồng workflow độc lập với bảng implementation: thêm cạnh ngoài ý muốn phải làm test fail.
const allowed = new Set([
  'draft>submitted',
  'rejected>submitted',
  'submitted>class_leader_approved',
  'class_leader_approved>class_approved',
  'class_approved>faculty_approved',
  'faculty_approved>finalized',
  'submitted>rejected',
  'class_leader_approved>rejected',
  'faculty_approved>rejected',
]);
const statuses = Object.values(FormStatus);

describe('central evaluation state machine', () => {
  it.each(
    statuses.flatMap((current) =>
      statuses.map((target) => [current, target] as const),
    ),
  )('%s → %s follows the workflow contract', (current, target) => {
    const valid = allowed.has(`${current}>${target}`);
    expect(canTransition(current, target)).toBe(valid);
    if (valid) expect(() => assertTransition(current, target)).not.toThrow();
    else
      expect(() => assertTransition(current, target)).toThrow(
        ConflictException,
      );
  });

  it.each(statuses)(
    'keeps reopen from %s separate from the normal workflow',
    (current) => {
      expect(() => assertTransition(current, FormStatus.draft)).toThrow(
        ConflictException,
      );
      if (current === FormStatus.draft)
        expect(() => assertReopenTransition(current)).toThrow(
          ConflictException,
        );
      else expect(() => assertReopenTransition(current)).not.toThrow();
    },
  );

  it('returns a conflict with the actual source and target for invalid transitions', () => {
    expect(() =>
      assertTransition(FormStatus.submitted, FormStatus.finalized),
    ).toThrow('Không thể chuyển phiếu từ submitted sang finalized');
    expect(canTransition('unknown' as FormStatus, FormStatus.submitted)).toBe(
      false,
    );
  });
});
