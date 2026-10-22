import {
  EvalRank,
  FormStatus,
  Prisma,
  SemesterNo,
} from '../../../generated/prisma/client';
import { CLASSIFICATION_LABELS } from '../constants/score-points.constant';
import type { TrainingEvaluationSemester } from '../dto/create-training-evaluation.dto';
import type {
  ActivityScoreRecord,
  EvaluationAdminApprovalListRecord,
  CommunityScoreRecord,
  DisciplineScoreRecord,
  EvaluationAdminListRecord,
  EvaluationDetailRecord,
  EvaluationListRecord,
  EvaluationScoreSummaryRecord,
  EvaluationStatusRecord,
  RoleScoreRecord,
  StudyScoreRecord,
} from '../selects/evaluation-form.select';
import type {
  ActivityScoreResponse,
  CommunityScoreResponse,
  DisciplineScoreResponse,
  DisciplineViolationResponse,
  EvaluationAdminApprovalListItem,
  EvaluationAdminListItem,
  EvaluationDetailResponse,
  EvaluationListResponse,
  EvaluationScoreSummaryResponse,
  EvaluationStatusResponse,
  ReviewStepStatus,
  RoleScoreResponse,
  StudyActivityResponse,
  StudyScoreResponse,
} from '../types/evaluation-form.types';
// StudyActivityResponse được import từ types, không cần định nghĩa lại bên dưới

// ─── Mapper chính: response dạng danh sách ────────────────────────────────────

/**
 * Chuyển đổi record phiếu đánh giá sang response dạng danh sách (GET /me, POST /).
 * Bao gồm thông tin cơ bản: mã phiếu, sinh viên, học kỳ, trạng thái, điểm tổng, xếp loại.
 */
export function mapToListResponse(
  evaluation: EvaluationListRecord,
): EvaluationListResponse {
  return {
    id: evaluation.id,
    version: evaluation.version,
    studentId: evaluation.studentId,
    semester: toApiSemester(evaluation.semester.semester),
    academicYear: toAcademicYear(evaluation.semester.year),
    status: evaluation.status,
    isLocked: evaluation.isLocked,
    lockedAt: evaluation.lockedAt,
    semesterIsActive: evaluation.semester.isActive,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

/**
 * Chuyển đổi record phiếu sang response chi tiết (GET /:id).
 * Kế thừa dữ liệu từ mapToListResponse, thêm SĐT, ghi chú, review và dữ liệu đủ 5 mục điểm.
 */
export function mapToDetailResponse(
  evaluation: EvaluationDetailRecord,
): EvaluationDetailResponse {
  return {
    ...mapToListResponse(evaluation),
    phone: evaluation.student.phone,
    note: evaluation.note,
    statusLabel: toStatusLabel(evaluation.status),
    classScore: evaluation.classScore,
    finalScore: evaluation.finalScore,
    studyScore: evaluation.studyScore,
    disciplineScore: evaluation.disciplineScore,
    activityScore: evaluation.activityScore,
    communityScore: evaluation.communityScore,
    roleScore: evaluation.roleScore,
    sectionScores: {
      studyScore: evaluation.studyScore,
      disciplineScore: evaluation.disciplineScore,
      activityScore: evaluation.activityScore,
      communityScore: evaluation.communityScore,
      roleScore: evaluation.roleScore,
    },
    review: mapToStatusResponse(evaluation),
    sections: {
      study: mapToStudyScoreResponse(evaluation),
      discipline: mapToDisciplineScoreResponse(evaluation),
      activity: mapToActivityScoreResponse(evaluation),
      community: mapToCommunityScoreResponse(evaluation),
      role: mapToRoleScoreResponse(evaluation),
    },
    evidences: evaluation.evidences.map((evidence) => ({
      id: evidence.id,
      studentId: evidence.studentId,
      evaluationFormId: evidence.evaluationFormId,
      criterionId: evidence.criterionId,
      criterion: evidence.criterion,
      imageUrl: evidence.imageUrl,
      publicId: evidence.publicId,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
    })),
    attachments: evaluation.attachments.map((attachment) => ({
      id: attachment.id,
      criteriaId: attachment.criteriaId,
      criterion: attachment.criteria,
      originalName: attachment.originalName,
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
      fileSizeBytes: attachment.fileSizeBytes,
      isApproved: attachment.isApproved,
      rejectReason: attachment.rejectReason,
      uploadedAt: attachment.uploadedAt,
    })),
  };
}

/**
 * Chuyển đổi record phiếu sang 1 dòng trong danh sách admin (GET /admin/training-evaluations).
 * Khác với mapToListResponse: kèm thông tin sinh viên/lớp/khoa để admin lọc và nhận diện,
 * không kèm điểm 5 mục chi tiết vì danh sách chỉ cần điểm tổng.
 */
export function mapToAdminListItem(
  evaluation: EvaluationAdminListRecord,
): EvaluationAdminListItem {
  const submissionStatus = toSubmissionStatus(evaluation.status);

  return {
    id: evaluation.id,
    version: evaluation.version,
    status: evaluation.status,
    workflowStatus: evaluation.status,
    submissionStatus,
    statusLabel: toStatusLabel(evaluation.status),
    submissionStatusLabel: toSubmissionStatusLabel(submissionStatus),
    submittedAt: evaluation.submittedAt,
    classLeaderReviewedAt: evaluation.classLeaderReviewedAt ?? null,
    classReviewedAt: evaluation.classReviewedAt ?? null,
    student: evaluation.student,
    class: {
      id: evaluation.class.id,
      code: evaluation.class.code,
      name: evaluation.class.name,
    },
    faculty: evaluation.class.major.faculty,
    semester: toApiSemester(evaluation.semester.semester),
    academicYear: toAcademicYear(evaluation.semester.year),
    studentScore: evaluation.studentScore,
    classScore: evaluation.classScore,
    finalScore: evaluation.finalScore,
    classification: toClassificationLabel(evaluation.rank),
  };
}

export function mapToAdminApprovalListItem(
  evaluation: EvaluationAdminApprovalListRecord,
): EvaluationAdminApprovalListItem {
  const submissionStatus = toSubmissionStatus(evaluation.status);

  return {
    id: evaluation.id,
    version: evaluation.version,
    status: evaluation.status,
    workflowStatus: evaluation.status,
    submissionStatus,
    statusLabel: toStatusLabel(evaluation.status),
    submissionStatusLabel: toSubmissionStatusLabel(submissionStatus),
    submittedAt: evaluation.submittedAt,
    classLeaderReviewedAt: evaluation.classLeaderReviewedAt ?? null,
    classReviewedAt: evaluation.classReviewedAt ?? null,
    student: evaluation.student,
    class: {
      id: evaluation.class.id,
      code: evaluation.class.code,
      name: evaluation.class.name,
    },
    faculty: evaluation.class.major.faculty,
    semester: toApiSemester(evaluation.semester.semester),
    academicYear: toAcademicYear(evaluation.semester.year),
    classScore: evaluation.classScore,
    rank: evaluation.rank,
  };
}

type SubmissionStatus = 'SUBMITTED' | 'NOT_SUBMITTED';

function toSubmissionStatus(status: FormStatus): SubmissionStatus {
  if (
    status === FormStatus.submitted ||
    status === FormStatus.class_leader_approved ||
    status === FormStatus.class_approved ||
    status === FormStatus.faculty_approved ||
    status === FormStatus.finalized
  ) {
    return 'SUBMITTED';
  }

  return 'NOT_SUBMITTED';
}

function toSubmissionStatusLabel(status: SubmissionStatus): string {
  return status === 'SUBMITTED' ? 'Đã nộp' : 'Chưa nộp';
}

/**
 * Chuyển đổi record phiếu sang response tóm tắt điểm (GET /:id/summary, POST /:id/submit).
 * Bao gồm toàn bộ thông tin: điểm lớp, điểm cuối, điểm từng mục và trạng thái duyệt.
 */
export function mapToScoreSummaryResponse(
  evaluation: EvaluationScoreSummaryRecord,
): EvaluationScoreSummaryResponse {
  return {
    ...mapToListResponse(evaluation),
    statusLabel: toStatusLabel(evaluation.status),
    classScore: evaluation.classScore,
    finalScore: evaluation.finalScore,
    sectionScores: {
      studyScore: evaluation.studyScore,
      disciplineScore: evaluation.disciplineScore,
      activityScore: evaluation.activityScore,
      communityScore: evaluation.communityScore,
      roleScore: evaluation.roleScore,
    },
    review: mapToStatusResponse(evaluation),
  };
}

/**
 * Chuyển đổi record phiếu sang response lịch sử duyệt (GET /:id/status).
 * Hiển thị timeline duyệt: SV nộp → Lớp trưởng → CVHT → Học viện, kèm thời gian hoàn thành.
 */
export function mapToStatusResponse(
  evaluation: EvaluationStatusRecord,
): EvaluationStatusResponse {
  const { status } = evaluation;

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    status,
    statusLabel: toStatusLabel(status),
    isLocked: evaluation.isLocked,
    lockedAt: evaluation.lockedAt,
    semesterIsActive: evaluation.semester.isActive,
    currentStep: toCurrentReviewStep(status),
    submittedAt: evaluation.submittedAt,
    classLeaderReviewedAt: evaluation.classLeaderReviewedAt,
    classReviewedAt: evaluation.classReviewedAt,
    steps: [
      {
        key: 'student_submit',
        label: 'Sinh viên nộp phiếu',
        status: evaluation.submittedAt ? 'completed' : 'current',
        completedAt: evaluation.submittedAt,
      },
      {
        key: 'class_leader_review',
        label: 'Lớp trưởng gửi lên CVHT',
        status: toReviewStepStatus(
          status,
          FormStatus.submitted,
          Boolean(evaluation.classLeaderReviewedAt),
        ),
        completedAt: evaluation.classLeaderReviewedAt,
      },
      {
        key: 'advisor_review',
        label: 'CVHT duyệt',
        status: toReviewStepStatus(
          status,
          FormStatus.class_leader_approved,
          Boolean(evaluation.classReviewedAt),
        ),
        completedAt: evaluation.classReviewedAt,
      },
      {
        key: 'faculty_review',
        label: 'Khoa gửi PĐT',
        status: toReviewStepStatus(
          status,
          FormStatus.class_approved,
          status === FormStatus.faculty_approved ||
            status === FormStatus.finalized,
        ),
        completedAt:
          status === FormStatus.faculty_approved ||
          status === FormStatus.finalized
            ? evaluation.updatedAt
            : null,
      },
      {
        key: 'admin_finalization',
        label: 'PĐT phê duyệt',
        status: toReviewStepStatus(
          status,
          FormStatus.faculty_approved,
          Boolean(evaluation.adminFinalizedAt),
        ),
        completedAt: evaluation.adminFinalizedAt,
      },
    ],
  };
}

// ─── Mapper theo từng mục điểm ────────────────────────────────────────────────

/**
 * Chuyển đổi record sang response Mục I – Ý thức học tập (tối đa 20 điểm).
 * Bao gồm: mức điểm thường xuyên, xếp loại học tập, danh sách hoạt động học thuật đã check.
 */
export function mapToStudyScoreResponse(
  evaluation: StudyScoreRecord,
): StudyScoreResponse {
  const data = readJsonObject(evaluation.studyData);
  const activities = readStudyActivities(data.activities);

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    regularScoreLevel: readNullableString(data.regularScoreLevel),
    academicRank: readNullableString(data.academicRank),
    activities,
    score: evaluation.studyScore,
    maxScore: 20,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

/**
 * Chuyển đổi record sang response Mục II – Ý thức chấp hành kỷ luật (tối đa 25 điểm).
 * Bao gồm: điểm cơ sở (25), danh sách vi phạm, tổng điểm bị trừ và điểm còn lại.
 */
export function mapToDisciplineScoreResponse(
  evaluation: DisciplineScoreRecord,
): DisciplineScoreResponse {
  const data = readJsonObject(evaluation.disciplineData);
  const violations = readDisciplineViolations(data.violations);
  const deductedScore = violations.reduce(
    (total, v) => total + v.count * v.deductScore,
    0,
  );

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    baseScore: evaluation.disciplineBaseScore,
    violations,
    deductedScore,
    score: evaluation.disciplineScore,
    maxScore: 25,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

/**
 * Chuyển đổi record sang response Mục III – Hoạt động chính trị, VH, thể thao (tối đa 20 điểm).
 * Bao gồm mức tham gia của từng tiêu chí và điểm khen thưởng.
 */
export function mapToActivityScoreResponse(
  evaluation: ActivityScoreRecord,
): ActivityScoreResponse {
  const data = readJsonObject(evaluation.activityData);

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    politicalActivityLevel: readNullableString(data.politicalActivityLevel),
    cultureSportLevel: readNullableString(data.cultureSportLevel),
    clubActivityLevel: readNullableString(data.clubActivityLevel),
    socialPreventionLevel: readNullableString(data.socialPreventionLevel),
    rewardScore: readNumber(data.rewardScore) ?? 0,
    score: evaluation.activityScore,
    maxScore: 20,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

/**
 * Chuyển đổi record sang response Mục IV – Ý thức công dân trong cộng đồng (tối đa 25 điểm).
 * Bao gồm: mức chấp hành pháp luật, hoạt động tình nguyện, quan hệ cộng đồng.
 */
export function mapToCommunityScoreResponse(
  evaluation: CommunityScoreRecord,
): CommunityScoreResponse {
  const data = readJsonObject(evaluation.communityData);

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    lawComplianceLevel: readNullableString(data.lawComplianceLevel),
    volunteerActivityLevel: readNullableString(data.volunteerActivityLevel),
    communityRelationshipLevel: readNullableString(
      data.communityRelationshipLevel,
    ),
    score: evaluation.communityScore,
    maxScore: 25,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

/**
 * Chuyển đổi record sang response Mục V – Vai trò BCS lớp / BCH tổ chức (tối đa 10 điểm).
 * Phân biệt hai nhánh: sinh viên thường và cán bộ lớp/BCH.
 */
export function mapToRoleScoreResponse(
  evaluation: RoleScoreRecord,
): RoleScoreResponse {
  const data = readJsonObject(evaluation.roleData);

  return {
    evaluationId: evaluation.id,
    version: evaluation.version,
    studentRoleType: readNullableString(data.studentRoleType),
    positionGroup: readNullableString(data.positionGroup),
    taskCompletionLevel: readNullableString(data.taskCompletionLevel),
    managementSkillLevel: readNullableString(data.managementSkillLevel),
    normalStudentActivityScore: readNumber(data.normalStudentActivityScore),
    specialAchievementLevel: readNullableString(data.specialAchievementLevel),
    score: evaluation.roleScore,
    maxScore: 10,
    totalScore: evaluation.studentScore ?? 0,
    classification: toClassificationLabel(evaluation.rank),
  };
}

// ─── Helpers chuyển đổi giá trị ────────────────────────────────────────────────

/**
 * Chuyển giá trị SemesterNo từ DB sang chuỗi học kỳ API (HK1 / HK2 / SUMMER).
 */
export function toApiSemester(
  semester: SemesterNo,
): TrainingEvaluationSemester {
  const map: Record<SemesterNo, TrainingEvaluationSemester> = {
    [SemesterNo.SEMESTER_1]: 'HK1',
    [SemesterNo.SEMESTER_2]: 'HK2',
    [SemesterNo.summer]: 'SUMMER',
  };

  return map[semester];
}

/**
 * Chuyển năm bắt đầu năm học (số nguyên) sang chuỗi "YYYY-YYYY".
 * Ví dụ: 2024 → "2024-2025"
 */
export function toAcademicYear(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

/**
 * Chuyển xếp loại rèn luyện (EvalRank) sang nhãn tiếng Việt.
 * Trả về null nếu chưa có xếp loại (phiếu chưa tính điểm).
 */
export function toClassificationLabel(rank: EvalRank | null): string | null {
  return rank ? CLASSIFICATION_LABELS[rank] : null;
}

/**
 * Chuyển trạng thái phiếu (FormStatus) sang nhãn tiếng Việt để hiển thị UI.
 */
export function toStatusLabel(status: FormStatus): string {
  const labels: Partial<Record<FormStatus, string>> = {
    [FormStatus.draft]: 'Nháp',
    [FormStatus.submitted]: 'Đã nộp',
    [FormStatus.class_leader_approved]: 'Lớp trưởng đã gửi lên CVHT',
    [FormStatus.class_approved]: 'CVHT đã duyệt, chờ Khoa',
    [FormStatus.faculty_approved]: 'Khoa đã gửi lên Phòng Đào tạo',
    [FormStatus.finalized]: 'Đã phê duyệt',
    [FormStatus.rejected]: 'Bị trả về',
  };

  return labels[status] ?? 'Không xác định';
}

/**
 * Xác định bước duyệt hiện tại trong luồng phê duyệt dựa theo trạng thái phiếu.
 * Dùng cho trường `currentStep` trong response trạng thái.
 */
export function toCurrentReviewStep(status: FormStatus): string {
  const stepMap: Partial<Record<FormStatus, string>> = {
    [FormStatus.draft]: 'student_draft',
    [FormStatus.submitted]: 'class_leader_review',
    [FormStatus.class_leader_approved]: 'advisor_review',
    [FormStatus.class_approved]: 'faculty_review',
    [FormStatus.faculty_approved]: 'admin_finalization',
    [FormStatus.finalized]: 'completed',
    [FormStatus.rejected]: 'student_revision',
  };

  return stepMap[status] ?? 'unknown';
}

/**
 * Xác định trạng thái hiển thị của từng bước trong timeline duyệt phiếu.
 *
 * Quy tắc:
 * - isCompleted = true → 'completed'
 * - phiếu đã finalized → mọi bước đều 'completed'
 * - phiếu bị rejected → bước đang duyệt là 'rejected'
 * - đang ở đúng bước activeStatus → 'current'
 * - còn lại → 'pending'
 */
export function toReviewStepStatus(
  currentStatus: FormStatus,
  activeStatus: FormStatus,
  isCompleted: boolean,
): ReviewStepStatus {
  if (isCompleted) return 'completed';
  if (currentStatus === FormStatus.finalized) return 'completed';
  if (currentStatus === FormStatus.rejected) return 'rejected';
  if (currentStatus === activeStatus) return 'current';

  return 'pending';
}

// ─── Helpers đọc JSON từ cột dữ liệu động ────────────────────────────────────

/**
 * Ép kiểu JsonValue về JsonObject an toàn.
 * Trả về {} nếu giá trị null, mảng, hoặc kiểu nguyên thủy.
 */
export function readJsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

/**
 * Đọc chuỗi từ một trường trong JsonObject.
 * Trả về null nếu trường không tồn tại hoặc không phải string.
 */
export function readNullableString(
  value: Prisma.JsonValue | undefined,
): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Đọc số từ một trường trong JsonObject.
 * Trả về null nếu trường không tồn tại hoặc không phải number.
 */
export function readNumber(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * Đọc và validate mảng hoạt động học thuật từ cột studyData (Mục I).
 * Lọc bỏ các phần tử không hợp lệ (thiếu code/checked/score).
 */
export function readStudyActivities(
  value: Prisma.JsonValue | undefined,
): StudyActivityResponse[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

    const record = item as Record<string, Prisma.JsonValue>;
    if (
      typeof record.code !== 'string' ||
      typeof record.checked !== 'boolean' ||
      typeof record.score !== 'number'
    ) {
      return [];
    }

    return [
      { code: record.code, checked: record.checked, score: record.score },
    ];
  });
}

/**
 * Đọc và validate mảng vi phạm kỷ luật từ cột disciplineData (Mục II).
 * Lọc bỏ các phần tử không hợp lệ (thiếu code/count/deductScore).
 */
export function readDisciplineViolations(
  value: Prisma.JsonValue | undefined,
): DisciplineViolationResponse[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

    const record = item as Record<string, Prisma.JsonValue>;
    if (
      typeof record.code !== 'string' ||
      typeof record.count !== 'number' ||
      typeof record.deductScore !== 'number'
    ) {
      return [];
    }

    return [
      {
        code: record.code,
        count: record.count,
        deductScore: record.deductScore,
      },
    ];
  });
}
