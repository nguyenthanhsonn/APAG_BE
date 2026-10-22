import {
  EvalRank,
  FormStatus,
  SemesterNo,
} from '../../src/generated/prisma/client';
import { UserRole } from '../../src/common/shared';
import type { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';
import type { EvaluationDetailRecord } from '../../src/modules/training-evaluations/selects/evaluation-form.select';

export function evaluationFixture(
  overrides: Partial<EvaluationDetailRecord & { classId: string }> = {},
) {
  return {
    id: 'form',
    version: 0,
    studentId: 'student',
    classId: 'class',
    status: FormStatus.draft,
    isLocked: false,
    lockedAt: null,
    studentScore: 80,
    rank: EvalRank.good,
    classScore: null,
    finalScore: null,
    studyScore: 20,
    disciplineScore: 25,
    activityScore: 15,
    communityScore: 15,
    roleScore: 5,
    studyData: {},
    disciplineBaseScore: 25,
    disciplineData: {},
    activityData: {},
    communityData: {},
    roleData: {},
    note: null,
    submittedAt: null,
    classLeaderReviewedAt: null,
    classReviewedAt: null,
    adminFinalizedAt: null,
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    semester: {
      semester: SemesterNo.SEMESTER_1,
      year: 2026,
      isActive: true,
      studentDeadline: null,
      classDeadline: null,
      facultyDeadline: null,
    },
    student: { phone: null },
    evidences: [],
    attachments: [],
    ...overrides,
  };
}

export function reviewerFixture(
  role: UserRole = UserRole.Advisor,
): AuthenticatedUser {
  return {
    id: 'reviewer',
    username: 'reviewer',
    email: 'reviewer@example.test',
    fullName: 'Reviewer',
    role,
    isActive: true,
    accessTokenId: 'access-token-id',
  };
}

/** Mock ghi dùng cho test use case; test PostgreSQL riêng kiểm chứng CAS/rollback thật. */
export function evaluationWriteMocks(form = evaluationFixture()) {
  const row: Record<string, unknown> = { ...form };
  return {
    updateMany: jest
      .fn()
      .mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          for (const [key, value] of Object.entries(data)) {
            row[key] =
              value && typeof value === 'object' && 'increment' in value
                ? Number(row[key] ?? 0) + Number(value.increment)
                : value;
          }
          return { count: 1 };
        },
      ),
    findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...row })),
  };
}
