import { BadRequestException } from '@nestjs/common';
import { EvalRank } from '../../../generated/prisma/client';
import {
ACADEMIC_RANK_POINTS,
CLUB_ACTIVITY_POINTS,
COMMUNITY_RELATIONSHIP_POINTS,
CULTURE_SPORT_POINTS,
LAW_COMPLIANCE_POINTS,
LEADER_TASK_COMPLETION_POINTS,
MANAGEMENT_SKILL_POINTS,
MEMBER_TASK_COMPLETION_POINTS,
POLITICAL_ACTIVITY_POINTS,
REGULAR_SCORE_POINTS,
SOCIAL_PREVENTION_POINTS,
SPECIAL_ACHIEVEMENT_POINTS,
STUDY_ACTIVITY_POINTS,
VOLUNTEER_ACTIVITY_POINTS,
} from '../constants/score-points.constant';
import type { UpdateActivityScoreDto } from '../dto/update-activity-score.dto';
import type { UpdateCommunityScoreDto } from '../dto/update-community-score.dto';
import type { UpdateDisciplineScoreDto } from '../dto/update-discipline-score.dto';
import type {
PositionGroup,
TaskCompletionLevel,
UpdateRoleScoreDto,
} from '../dto/update-role-score.dto';
import type { UpdateStudyScoreDto } from '../dto/update-study-score.dto';

/** Đầu vào cho việc tính tổng điểm rèn luyện */
export type ScoreInput = {
  studyScore: number;
  disciplineScore: number;
  activityScore: number;
  communityScore: number;
  roleScore: number;
};

/** Kết quả sau khi tính điểm: tổng điểm và xếp loại */
export type ScoreResult = {
  totalScore: number;
  rank: EvalRank;
};

/**
 * Tính tổng điểm rèn luyện từ 5 mục thành phần và trả về xếp loại tương ứng.
 * Tổng điểm được giới hạn tối đa 100 điểm.
 *
 * @param scores - Điểm từng mục (I đến V)
 * @returns Tổng điểm và xếp loại rèn luyện
 */
export function calculateScoreResult(scores: ScoreInput): ScoreResult {
  const totalScore = Math.min(
    100,
    scores.studyScore +
      scores.disciplineScore +
      scores.activityScore +
      scores.communityScore +
      scores.roleScore,
  );

  return {
    totalScore,
    rank: calculateClassification(totalScore),
  };
}

/**
 * Phân loại kết quả rèn luyện dựa trên tổng điểm theo QĐ 4185/QĐ-HCQG:
 * - Xuất sắc: ≥ 90
 * - Tốt:      80 – 89
 * - Khá:      65 – 79
 * - Trung bình: 50 – 64
 * - Yếu:      35 – 49
 * - Kém:      < 35
 */
export function calculateClassification(totalScore: number): EvalRank {
  if (totalScore >= 90) return EvalRank.excellent;
  if (totalScore >= 80) return EvalRank.good;
  if (totalScore >= 65) return EvalRank.fair;
  if (totalScore >= 50) return EvalRank.average;
  if (totalScore >= 35) return EvalRank.weak;

  return EvalRank.poor;
}

/**
 * Tính điểm Mục V – Vai trò BCS lớp / BCH tổ chức (tối đa 10 điểm).
 *
 * Có hai nhánh tính:
 * - NORMAL_STUDENT: điểm hoạt động thông thường + thành tích đặc biệt
 * - Cán bộ lớp/BCH: điểm hoàn thành nhiệm vụ + kỹ năng quản lý nếu có
 *
 * @throws BadRequestException nếu là cán bộ mà thiếu các trường bắt buộc
 */
export function calculateRoleScore(dto: UpdateRoleScoreDto): number {
  const specialScore = dto.specialAchievementLevel
    ? SPECIAL_ACHIEVEMENT_POINTS[dto.specialAchievementLevel]
    : 0;

  if (dto.studentRoleType === 'NORMAL_STUDENT') {
    return Math.min(10, (dto.normalStudentActivityScore ?? 0) + specialScore);
  }

  const { positionGroup, taskCompletionLevel, managementSkillLevel } = dto;

  if (!positionGroup || !taskCompletionLevel) {
    throw new BadRequestException(
      'positionGroup và taskCompletionLevel là bắt buộc đối với cán bộ',
    );
  }

  const taskScore = getOfficerTaskScore(positionGroup, taskCompletionLevel);
  const managementSkillScore = managementSkillLevel
    ? MANAGEMENT_SKILL_POINTS[managementSkillLevel]
    : 0;

  return Math.min(10, taskScore + managementSkillScore);
}

/**
 * Lấy điểm hoàn thành nhiệm vụ cho cán bộ lớp/BCH.
 * - LEADER_GROUP (lớp trưởng, BT chi đoàn…): thang điểm tối đa 7
 * - MEMBER_GROUP (ủy viên BCH, TT/TP lớp…):  thang điểm tối đa 6
 */
function getOfficerTaskScore(
  positionGroup: PositionGroup,
  taskCompletionLevel: TaskCompletionLevel,
): number {
  if (positionGroup === 'LEADER_GROUP') {
    return LEADER_TASK_COMPLETION_POINTS[taskCompletionLevel];
  }

  return MEMBER_TASK_COMPLETION_POINTS[taskCompletionLevel];
}

/** Công thức mục I – học tập, thuần tính toán: không đọc/ghi DB hoặc đổi trạng thái. */
export function calculateStudyScore(dto: UpdateStudyScoreDto) {
  const activities = dto.activities.map((a) => ({
    code: a.code,
    checked: a.checked,
    score: STUDY_ACTIVITY_POINTS[a.code],
  }));
  const activityTotal = activities.reduce(
    (sum, a) => sum + (a.checked ? a.score : 0),
    0,
  );
  const score =
    REGULAR_SCORE_POINTS[dto.regularScoreLevel] +
    activityTotal +
    ACADEMIC_RANK_POINTS[dto.academicRank];

  return { score, activities };
}

/** Công thức mục II – kỷ luật, thuần tính toán: không đọc/ghi DB hoặc đổi trạng thái. */
export function calculateDisciplineScore(dto: UpdateDisciplineScoreDto) {
  const violations = (dto.violations ?? []).map((v) => ({
    code: v.code,
    count: v.count,
    deductScore: v.deductScore,
  }));
  const deductedScore = violations.reduce(
    (total, violation) => total + violation.count * violation.deductScore,
    0,
  );
  const score = Math.max(0, dto.baseScore - deductedScore);

  return { score, violations };
}

/** Công thức mục III – hoạt động, thuần tính toán: không đọc/ghi DB hoặc đổi trạng thái. */
export function calculateActivityScore(dto: UpdateActivityScoreDto) {
  const score = Math.min(
    20,
    POLITICAL_ACTIVITY_POINTS[dto.politicalActivityLevel] +
      CULTURE_SPORT_POINTS[dto.cultureSportLevel] +
      CLUB_ACTIVITY_POINTS[dto.clubActivityLevel] +
      SOCIAL_PREVENTION_POINTS[dto.socialPreventionLevel] +
      dto.rewardScore,
  );

  return score;
}

/** Công thức mục IV – cộng đồng, thuần tính toán: không đọc/ghi DB hoặc đổi trạng thái. */
export function calculateCommunityScore(dto: UpdateCommunityScoreDto) {
  const score = Math.min(
    25,
    LAW_COMPLIANCE_POINTS[dto.lawComplianceLevel] +
      VOLUNTEER_ACTIVITY_POINTS[dto.volunteerActivityLevel] +
      COMMUNITY_RELATIONSHIP_POINTS[dto.communityRelationshipLevel],
  );

  return score;
}
