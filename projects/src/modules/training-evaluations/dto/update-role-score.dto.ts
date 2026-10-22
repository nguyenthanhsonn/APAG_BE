import { ExpectedVersionDto } from './expected-version.dto';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export const STUDENT_ROLE_TYPES = [
  'CLASS_OFFICER',
  'UNION_OFFICER',
  'CLUB_OFFICER',
  'NORMAL_STUDENT',
] as const;
export type StudentRoleType = (typeof STUDENT_ROLE_TYPES)[number];

export const POSITION_GROUPS = ['LEADER_GROUP', 'MEMBER_GROUP'] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const TASK_COMPLETION_LEVELS = [
  'EXCELLENT',
  'GOOD',
  'COMPLETED',
  'POOR',
] as const;
export type TaskCompletionLevel = (typeof TASK_COMPLETION_LEVELS)[number];

export const MANAGEMENT_SKILL_LEVELS = [
  'HEAD_POSITION',
  'DEPUTY_POSITION',
  'MEMBER_POSITION',
] as const;
export type ManagementSkillLevel = (typeof MANAGEMENT_SKILL_LEVELS)[number];

export const SPECIAL_ACHIEVEMENT_LEVELS = [
  'SCHOOL_LEVEL_OR_HIGHER',
  'FACULTY_LEVEL',
  'NONE',
] as const;
export type SpecialAchievementLevel =
  (typeof SPECIAL_ACHIEVEMENT_LEVELS)[number];

export class UpdateRoleScoreDto extends ExpectedVersionDto {
  @IsIn(STUDENT_ROLE_TYPES)
  studentRoleType: StudentRoleType;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsIn(POSITION_GROUPS)
  positionGroup?: PositionGroup | null;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsIn(TASK_COMPLETION_LEVELS)
  taskCompletionLevel?: TaskCompletionLevel | null;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsIn(MANAGEMENT_SKILL_LEVELS)
  managementSkillLevel?: ManagementSkillLevel | null;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  normalStudentActivityScore?: number | null;

  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @IsIn(SPECIAL_ACHIEVEMENT_LEVELS)
  specialAchievementLevel?: SpecialAchievementLevel | null;
}
