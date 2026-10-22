import { ExpectedVersionDto } from './expected-version.dto';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const REGULAR_SCORE_LEVELS = [
  'GTE_9',
  'FROM_7_TO_UNDER_9',
  'FROM_5_TO_UNDER_7',
  'FROM_4_TO_UNDER_5',
  'FROM_1_TO_UNDER_4',
] as const;
export type RegularScoreLevel = (typeof REGULAR_SCORE_LEVELS)[number];

export const ACADEMIC_RANKS = [
  'EXCELLENT',
  'GOOD',
  'FAIR',
  'AVERAGE',
  'WEAK_NO_WARNING',
  'WEAK_WARNING_FIRST',
] as const;
export type AcademicRank = (typeof ACADEMIC_RANKS)[number];

export const STUDY_ACTIVITY_CODES = [
  'ACADEMIC_EVENT_PARTICIPATION',
  'SCIENTIFIC_PUBLICATION_OR_CONTEST',
  'SCIENTIFIC_AWARD',
] as const;
export type StudyActivityCode = (typeof STUDY_ACTIVITY_CODES)[number];

export class StudyActivityDto {
  @IsIn(STUDY_ACTIVITY_CODES)
  code: StudyActivityCode;

  @IsBoolean()
  checked: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  score?: number;
}

export class UpdateStudyScoreDto extends ExpectedVersionDto {
  @IsIn(REGULAR_SCORE_LEVELS)
  regularScoreLevel: RegularScoreLevel;

  @IsIn(ACADEMIC_RANKS)
  academicRank: AcademicRank;

  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => StudyActivityDto)
  activities: StudyActivityDto[];
}
