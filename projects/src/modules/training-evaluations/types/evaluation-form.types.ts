// ─── Semester ─────────────────────────────────────────────────────────────────
export type ApiSemester = 'HK1' | 'HK2' | 'SUMMER';

// ─── Internal ─────────────────────────────────────────────────────────────────
export type ScoreParts = {
  studyScore: number;
  disciplineScore: number;
  activityScore: number;
  communityScore: number;
  roleScore: number;
};

// ─── List & Detail ────────────────────────────────────────────────────────────
export type EvaluationListResponse = {
  version: number;
  id: string;
  studentId: string;
  semester: ApiSemester;
  academicYear: string;
  status: string;
  isLocked: boolean;
  lockedAt: Date | null;
  semesterIsActive: boolean;
  totalScore: number;
  classification: string | null;
};

export type EvaluationDetailResponse = EvaluationListResponse & {
  phone: string | null;
  note: string | null;
  statusLabel: string;
  classScore: number | null;
  finalScore: number | null;
  studyScore: number;
  disciplineScore: number;
  activityScore: number;
  communityScore: number;
  roleScore: number;
  sectionScores: ScoreParts;
  review: EvaluationStatusResponse;
  sections: {
    study: StudyScoreResponse;
    discipline: DisciplineScoreResponse;
    activity: ActivityScoreResponse;
    community: CommunityScoreResponse;
    role: RoleScoreResponse;
  };
  evidences: EvaluationEvidenceResponse[];
  attachments: EvaluationAttachmentResponse[];
};

export type EvaluationEvidenceResponse = {
  id: string;
  studentId: string;
  evaluationFormId: string;
  criterionId: string;
  criterion: { id: string; code: string; title: string };
  imageUrl: string;
  publicId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EvaluationAttachmentResponse = {
  id: string;
  criteriaId: string;
  criterion: { id: string; code: string; title: string };
  originalName: string;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  isApproved: boolean | null;
  rejectReason: string | null;
  uploadedAt: Date;
};

// ─── Admin: danh sách toàn hệ thống ───────────────────────────────────────────
export type EvaluationAdminListItem = {
  version: number;
  id: string;
  status: string;
  workflowStatus?: string;
  submissionStatus?: string;
  statusLabel: string;
  submissionStatusLabel?: string;
  submittedAt: Date | null;
  classLeaderReviewedAt?: Date | null;
  classReviewedAt?: Date | null;
  student: { id: string; fullName: string; email: string };
  class: { id: string; code: string; name: string };
  faculty: { id: string; code: string; name: string };
  semester: ApiSemester;
  academicYear: string;
  studentScore: number | null;
  classScore: number | null;
  finalScore: number | null;
  classification: string | null;
};

export type EvaluationAdminApprovalListItem = {
  version: number;
  id: string;
  status: string;
  workflowStatus?: string;
  submissionStatus?: string;
  statusLabel: string;
  submissionStatusLabel?: string;
  submittedAt: Date | null;
  classLeaderReviewedAt?: Date | null;
  classReviewedAt?: Date | null;
  student: { id: string; fullName: string; email: string };
  class: { id: string; code: string; name: string };
  faculty: { id: string; code: string; name: string };
  semester: ApiSemester;
  academicYear: string;
  classScore: number | null;
  rank: string | null;
};

// ─── Status / review steps ────────────────────────────────────────────────────
export type ReviewStepStatus = 'pending' | 'current' | 'completed' | 'rejected';

export type ReviewStepResponse = {
  key: string;
  label: string;
  status: ReviewStepStatus;
  completedAt: Date | null;
};

export type EvaluationStatusResponse = {
  version: number;
  evaluationId: string;
  status: string;
  statusLabel: string;
  isLocked: boolean;
  lockedAt: Date | null;
  semesterIsActive: boolean;
  currentStep: string;
  submittedAt: Date | null;
  classLeaderReviewedAt: Date | null;
  classReviewedAt: Date | null;
  steps: ReviewStepResponse[];
};

// ─── Score summary ────────────────────────────────────────────────────────────
export type EvaluationScoreSummaryResponse = EvaluationListResponse & {
  statusLabel: string;
  classScore: number | null;
  finalScore: number | null;
  sectionScores: ScoreParts;
  review: EvaluationStatusResponse;
};

// ─── Section: Mục I – Học tập (max 20đ) ──────────────────────────────────────
export type StudyActivityResponse = {
  code: string;
  checked: boolean;
  score: number;
};

export type StudyScoreResponse = {
  version: number;
  evaluationId: string;
  regularScoreLevel: string | null;
  academicRank: string | null;
  activities: StudyActivityResponse[];
  score: number;
  maxScore: 20;
  totalScore: number;
  classification: string | null;
};

// ─── Section: Mục II – Kỷ luật (max 25đ) ────────────────────────────────────
export type DisciplineViolationResponse = {
  code: string;
  count: number;
  deductScore: number;
};

export type DisciplineScoreResponse = {
  version: number;
  evaluationId: string;
  baseScore: number;
  violations: DisciplineViolationResponse[];
  deductedScore: number;
  score: number;
  maxScore: 25;
  totalScore: number;
  classification: string | null;
};

// ─── Section: Mục III – Hoạt động (max 20đ) ──────────────────────────────────
export type ActivityScoreResponse = {
  version: number;
  evaluationId: string;
  politicalActivityLevel: string | null;
  cultureSportLevel: string | null;
  clubActivityLevel: string | null;
  socialPreventionLevel: string | null;
  rewardScore: number;
  score: number;
  maxScore: 20;
  totalScore: number;
  classification: string | null;
};

// ─── Section: Mục IV – Cộng đồng (max 25đ) ───────────────────────────────────
export type CommunityScoreResponse = {
  version: number;
  evaluationId: string;
  lawComplianceLevel: string | null;
  volunteerActivityLevel: string | null;
  communityRelationshipLevel: string | null;
  score: number;
  maxScore: 25;
  totalScore: number;
  classification: string | null;
};

// ─── Section: Mục V – Vai trò BCS/BCH (max 10đ) ─────────────────────────────
export type RoleScoreResponse = {
  version: number;
  evaluationId: string;
  studentRoleType: string | null;
  positionGroup: string | null;
  taskCompletionLevel: string | null;
  managementSkillLevel: string | null;
  normalStudentActivityScore: number | null;
  specialAchievementLevel: string | null;
  score: number;
  maxScore: 10;
  totalScore: number;
  classification: string | null;
};
