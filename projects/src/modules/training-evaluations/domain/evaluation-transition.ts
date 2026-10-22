import { EvaluationAccessPolicy } from './evaluation-access.policy';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../common/shared';
import { FormStatus } from '../../../generated/prisma/client';

/**
 * Nguồn duy nhất khai báo các cạnh được phép của vòng đời phiếu.
 * from/target ở application chỉ tham chiếu bảng này; quyền, khóa và deadline
 * vẫn là policy riêng, không được suy luận chỉ từ một cạnh hợp lệ.
 */
export const EVALUATION_TRANSITIONS = {
  submit: {
    from: [FormStatus.draft, FormStatus.rejected],
    target: FormStatus.submitted,
  },
  classLeaderApproval: {
    from: [FormStatus.submitted],
    target: FormStatus.class_leader_approved,
  },
  advisorApproval: {
    from: [FormStatus.class_leader_approved],
    target: FormStatus.class_approved,
  },
  facultyApproval: {
    from: [FormStatus.class_approved],
    target: FormStatus.faculty_approved,
  },
  finalize: {
    from: [FormStatus.faculty_approved],
    target: FormStatus.finalized,
  },
  // Giữ các nhánh trả về đã có ở review của lớp trưởng, CVHT và admin.
  reject: {
    from: [
      FormStatus.submitted,
      FormStatus.class_leader_approved,
      FormStatus.faculty_approved,
    ],
    target: FormStatus.rejected,
  },
  // Ngoại lệ quản trị hiện có, được kiểm tra riêng bởi assertReopenTransition.
  reopen: {
    from: [
      FormStatus.submitted,
      FormStatus.class_leader_approved,
      FormStatus.class_approved,
      FormStatus.faculty_approved,
      FormStatus.finalized,
      FormStatus.rejected,
    ],
    target: FormStatus.draft,
  },
} as const;

export function canTransition(
  current: FormStatus,
  target: FormStatus,
): boolean {
  return Object.values(EVALUATION_TRANSITIONS).some(
    (transition) =>
      transition !== EVALUATION_TRANSITIONS.reopen &&
      transition.target === target &&
      (transition.from as readonly FormStatus[]).includes(current),
  );
}

/** Chỉ cho chuyển đúng một cạnh workflow; self-transition và nhảy cấp trả HTTP 409. */
export function assertTransition(
  current: FormStatus,
  target: FormStatus,
): void {
  if (!canTransition(current, target)) {
    throw new ConflictException(
      `Không thể chuyển phiếu từ ${current} sang ${target}`,
    );
  }
}

/** Admin có thể mở lại phiếu; không làm finalized → draft thành cạnh workflow thông thường. */
export function assertReopenTransition(current: FormStatus): void {
  if (
    !(EVALUATION_TRANSITIONS.reopen.from as readonly FormStatus[]).includes(
      current,
    )
  ) {
    throw new ConflictException(
      'Phiếu đang ở trạng thái nháp, không cần mở lại',
    );
  }
}

type ReviewTransition = 'classLeaderApproval' | 'advisorApproval' | 'finalize';
const REVIEW_STAGES: Partial<
  Record<UserRole, { transition: ReviewTransition; notePrefix: string }>
> = {
  [UserRole.ClassLeader]: {
    transition: 'classLeaderApproval',
    notePrefix: '[Lớp trả về]',
  },
  [UserRole.Advisor]: {
    transition: 'advisorApproval',
    notePrefix: '[CVHT trả về]',
  },
  [UserRole.Admin]: { transition: 'finalize', notePrefix: '[Học viện trả về]' },
};

export type ReviewStageConfig = {
  requiredStatus: FormStatus;
  nextApprovedStatus: FormStatus;
  notePrefix: string;
};

/** Role chỉ chọn bước; trạng thái nguồn/đích luôn lấy từ bảng chuyển chung. */
export function resolveReviewStage(
  role: UserRole,
  current: FormStatus,
): ReviewStageConfig {
  EvaluationAccessPolicy.assertRole('reviewDecision', { id: '', role });
  const stage = REVIEW_STAGES[role];
  if (!stage)
    throw new ForbiddenException(
      'Vai trò này không có quyền duyệt phiếu đánh giá',
    );
  const transition = EVALUATION_TRANSITIONS[stage.transition];
  assertTransition(current, transition.target);
  return {
    requiredStatus: transition.from[0],
    nextApprovedStatus: transition.target,
    notePrefix: stage.notePrefix,
  };
}

export type LockableForm = { isLocked: boolean };
export function assertNotLocked(form: LockableForm): void {
  if (form.isLocked)
    throw new ConflictException('Biểu mẫu rèn luyện đã bị khóa vĩnh viễn!');
}

/** Sửa nháp không đổi trạng thái; nguồn được phép sửa chính là nguồn được nộp. */
export function assertEditable(status: FormStatus): void {
  if (!canTransition(status, EVALUATION_TRANSITIONS.submit.target)) {
    throw new ConflictException(
      'Chỉ phiếu nháp hoặc phiếu bị trả về mới được cập nhật',
    );
  }
}

/** Chấm/xác nhận chỉ thực hiện tại bước của người duyệt, chưa chuyển phiếu ngay. */
export function assertReviewScoresEditable(
  role: UserRole,
  status: FormStatus,
): void {
  EvaluationAccessPolicy.assertRole('review', { id: '', role });
  const transition =
    role === UserRole.ClassLeader
      ? EVALUATION_TRANSITIONS.classLeaderApproval
      : EVALUATION_TRANSITIONS.advisorApproval;
  assertTransition(status, transition.target);
}
