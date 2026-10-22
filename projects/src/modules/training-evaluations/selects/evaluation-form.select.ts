import { Prisma } from '../../../generated/prisma/client';

// Mốc hạn chỉ dùng nội bộ policy; mapper tiếp tục giữ hợp đồng response hiện có.
export const evaluationDeadlineSelect = {
  studentDeadline: true,
  classDeadline: true,
  facultyDeadline: true,
} satisfies Prisma.SemesterSelect;
const evaluationSemesterSelect = {
  year: true,
  semester: true,
  isActive: true,
  ...evaluationDeadlineSelect,
} satisfies Prisma.SemesterSelect;

// ─── Shared base cho section scores ──────────────────────────────────────────
const sectionBase = {
  id: true,
  version: true,
  studentScore: true,
  rank: true,
} satisfies Prisma.EvaluationFormSelect;

// ─── Dùng bởi tất cả update-score methods để fetch current scores ─────────────
export const evaluationAllScoresSelect = {
  id: true,
  version: true,
  status: true,
  studyScore: true,
  disciplineScore: true,
  activityScore: true,
  communityScore: true,
  roleScore: true,
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /me – danh sách phiếu ────────────────────────────────────────────────
export const evaluationListSelect = {
  id: true,
  version: true,
  studentId: true,
  status: true,
  isLocked: true,
  lockedAt: true,
  studentScore: true,
  rank: true,
  updatedAt: true,
  semester: { select: evaluationSemesterSelect },
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /:id – chi tiết phiếu ────────────────────────────────────────────────
export const evaluationDetailSelect = {
  ...evaluationListSelect,
  note: true,
  classScore: true,
  finalScore: true,
  studyScore: true,
  studyData: true,
  disciplineBaseScore: true,
  disciplineScore: true,
  disciplineData: true,
  activityScore: true,
  activityData: true,
  communityScore: true,
  communityData: true,
  roleScore: true,
  roleData: true,
  student: { select: { phone: true } },
  submittedAt: true,
  classLeaderReviewedAt: true,
  classReviewedAt: true,
  adminFinalizedAt: true,
  // Minh chứng được FE upload lên cloud: trả imageUrl để admin xem ảnh trực tiếp.
  evidences: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      studentId: true,
      evaluationFormId: true,
      criterionId: true,
      imageUrl: true,
      publicId: true,
      createdAt: true,
      updatedAt: true,
      criterion: { select: { id: true, code: true, title: true } },
    },
  },
  // File đính kèm truyền thống nếu hệ thống có lưu qua bảng form_attachments.
  attachments: {
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      criteriaId: true,
      originalName: true,
      storageKey: true,
      mimeType: true,
      fileSizeBytes: true,
      isApproved: true,
      rejectReason: true,
      uploadedAt: true,
      criteria: { select: { id: true, code: true, title: true } },
    },
  },
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /admin/training-evaluations – danh sách cho admin (đa lớp/khoa) ──────
export const evaluationAdminListSelect = {
  id: true,
  version: true,
  status: true,
  submittedAt: true,
  classLeaderReviewedAt: true,
  classReviewedAt: true,
  studentScore: true,
  classScore: true,
  finalScore: true,
  rank: true,
  student: { select: { id: true, fullName: true, email: true } },
  class: {
    select: {
      id: true,
      code: true,
      name: true,
      major: {
        select: { faculty: { select: { id: true, code: true, name: true } } },
      },
    },
  },
  semester: { select: evaluationSemesterSelect },
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /admin/evaluations – danh sách duyệt cuối cho admin ────────────────
export const evaluationAdminApprovalListSelect = {
  id: true,
  version: true,
  status: true,
  submittedAt: true,
  classLeaderReviewedAt: true,
  classReviewedAt: true,
  classScore: true,
  rank: true,
  student: { select: { id: true, fullName: true, email: true } },
  class: {
    select: {
      id: true,
      code: true,
      name: true,
      major: {
        select: { faculty: { select: { id: true, code: true, name: true } } },
      },
    },
  },
  semester: { select: evaluationSemesterSelect },
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /:id/status – approval trail ─────────────────────────────────────────
export const evaluationStatusSelect = {
  id: true,
  version: true,
  status: true,
  isLocked: true,
  lockedAt: true,
  semester: { select: { isActive: true } },
  submittedAt: true,
  classLeaderReviewedAt: true,
  classReviewedAt: true,
  adminFinalizedAt: true,
  updatedAt: true,
} satisfies Prisma.EvaluationFormSelect;

// ─── GET /:id/summary + POST /:id/submit ──────────────────────────────────────
export const evaluationScoreSummarySelect = {
  ...evaluationStatusSelect,
  studentId: true,
  studentScore: true,
  classScore: true,
  finalScore: true,
  rank: true,
  studyScore: true,
  disciplineScore: true,
  activityScore: true,
  communityScore: true,
  roleScore: true,
  semester: { select: evaluationSemesterSelect },
} satisfies Prisma.EvaluationFormSelect;

// ─── Section score selects ────────────────────────────────────────────────────
export const studyScoreSelect = {
  ...sectionBase,
  studyScore: true,
  studyData: true,
} satisfies Prisma.EvaluationFormSelect;

export const disciplineScoreSelect = {
  ...sectionBase,
  disciplineBaseScore: true,
  disciplineScore: true,
  disciplineData: true,
} satisfies Prisma.EvaluationFormSelect;

export const activityScoreSelect = {
  ...sectionBase,
  activityScore: true,
  activityData: true,
} satisfies Prisma.EvaluationFormSelect;

export const communityScoreSelect = {
  ...sectionBase,
  communityScore: true,
  communityData: true,
} satisfies Prisma.EvaluationFormSelect;

export const roleScoreSelect = {
  ...sectionBase,
  roleScore: true,
  roleData: true,
} satisfies Prisma.EvaluationFormSelect;

// ─── Inferred record types ────────────────────────────────────────────────────
export type EvaluationAllScoresRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationAllScoresSelect;
}>;
export type EvaluationListRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationListSelect;
}>;
export type EvaluationDetailRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationDetailSelect;
}>;
export type EvaluationStatusRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationStatusSelect;
}>;
export type EvaluationScoreSummaryRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationScoreSummarySelect;
}>;
export type EvaluationAdminListRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof evaluationAdminListSelect;
}>;
export type EvaluationAdminApprovalListRecord =
  Prisma.EvaluationFormGetPayload<{
    select: typeof evaluationAdminApprovalListSelect;
  }>;
export type StudyScoreRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof studyScoreSelect;
}>;
export type DisciplineScoreRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof disciplineScoreSelect;
}>;
export type ActivityScoreRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof activityScoreSelect;
}>;
export type CommunityScoreRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof communityScoreSelect;
}>;
export type RoleScoreRecord = Prisma.EvaluationFormGetPayload<{
  select: typeof roleScoreSelect;
}>;
