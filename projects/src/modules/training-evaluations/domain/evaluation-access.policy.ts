import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../../common/shared';

export type EvaluationActor = { id: string; role: UserRole };
export type EvaluationAccessFacts = {
  studentId?: string;
  assignedToClass?: boolean;
  facultyId?: string;
  assignedFacultyId?: string;
  facultyAvailable?: boolean;
};

/** Một nơi khai báo role của từng capability; controller dùng cùng bảng này. */
export const EVALUATION_ACCESS_ROLES = {
  read: [
    UserRole.Student,
    UserRole.ClassLeader,
    UserRole.Advisor,
    UserRole.Faculty,
    UserRole.Admin,
    UserRole.TrainingDepartment,
  ],
  edit: [UserRole.Student],
  review: [UserRole.ClassLeader, UserRole.Advisor],
  reviewDecision: [UserRole.ClassLeader, UserRole.Advisor, UserRole.Admin],
  submitClass: [UserRole.ClassLeader, UserRole.Advisor],
  approveFaculty: [UserRole.Faculty],
  finalize: [UserRole.Admin, UserRole.TrainingDepartment],
} as const;
export type EvaluationCapability = keyof typeof EVALUATION_ACCESS_ROLES;

/**
 * Chỉ quyết định authorization từ dữ kiện đã đọc, không query DB.
 * Không xét status/lock/deadline ở can*(): sai quyền là 403, sai workflow là 409.
 * Scope chưa xác định phải bị từ chối, không mặc định cho mọi role đọc theo ID.
 */
export class EvaluationAccessPolicy {
  private static hasRole(
    action: EvaluationCapability,
    actor: EvaluationActor,
    requiredRole?: UserRole,
  ): boolean {
    return (
      (EVALUATION_ACCESS_ROLES[action] as readonly UserRole[]).includes(
        actor.role,
      ) &&
      (requiredRole === undefined || actor.role === requiredRole)
    );
  }
  static assertRole(
    action: EvaluationCapability,
    actor: EvaluationActor,
    requiredRole?: UserRole,
  ): void {
    assertEvaluationAccess(this.hasRole(action, actor, requiredRole));
  }
  static canRead(
    actor: EvaluationActor,
    facts: EvaluationAccessFacts,
  ): boolean {
    if (!this.hasRole('read', actor)) return false;
    if (this.canFinalize(actor)) return true;
    if (actor.role === UserRole.Student) return actor.id === facts.studentId;
    if (actor.role === UserRole.Faculty)
      return this.canApproveFaculty(actor, facts);
    return facts.assignedToClass === true;
  }
  static canEdit(
    actor: EvaluationActor,
    facts: EvaluationAccessFacts,
  ): boolean {
    return this.hasRole('edit', actor) && actor.id === facts.studentId;
  }
  static canReview(
    actor: EvaluationActor,
    facts: EvaluationAccessFacts,
  ): boolean {
    return this.hasRole('review', actor) && facts.assignedToClass === true;
  }
  static canSubmitClass(
    actor: EvaluationActor,
    facts: EvaluationAccessFacts,
    requiredRole?: UserRole,
  ): boolean {
    return (
      this.hasRole('submitClass', actor, requiredRole) &&
      facts.assignedToClass === true
    );
  }
  static canApproveFaculty(
    actor: EvaluationActor,
    facts: EvaluationAccessFacts,
  ): boolean {
    return (
      this.hasRole('approveFaculty', actor) &&
      Boolean(facts.assignedFacultyId) &&
      facts.assignedFacultyId === facts.facultyId &&
      facts.facultyAvailable !== false
    );
  }
  static canFinalize(actor: EvaluationActor): boolean {
    return this.hasRole('finalize', actor);
  }
}

export function assertEvaluationAccess(
  allowed: unknown,
  message = 'Bạn không có quyền thực hiện thao tác này',
): asserts allowed {
  if (!allowed) throw new ForbiddenException(message);
}

/** Giữ 404 cho phiếu người khác của student; scope các cấp còn lại được kiểm tra sau SELECT. */
export function evaluationReadScope(
  userId: string,
  role: UserRole,
  id: string,
) {
  return role === UserRole.Student ? { id, studentId: userId } : { id };
}

export function facultyEvaluationScope(
  assignedFacultyId: string | undefined,
  requestedFacultyId?: string,
) {
  assertEvaluationAccess(
    assignedFacultyId,
    'Tài khoản khoa chưa được gán khoa quản lý',
  );
  assertEvaluationAccess(
    EvaluationAccessPolicy.canRead(
      { id: '', role: UserRole.Faculty },
      {
        facultyId: requestedFacultyId ?? assignedFacultyId,
        assignedFacultyId,
      },
    ),
    'Bạn không có quyền xem dữ liệu của khoa khác',
  );
  return { facultyId: assignedFacultyId };
}

export function assertClassListAccess(
  role: UserRole,
  classId?: string,
): asserts classId is string {
  EvaluationAccessPolicy.assertRole('submitClass', { id: '', role });
  if (!classId) throw new BadRequestException('Vui lòng chọn lớp cần xem');
}
