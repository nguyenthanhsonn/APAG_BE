import { ExpectedVersionDto } from './expected-version.dto';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export const POLITICAL_ACTIVITY_LEVELS = [
  'GOOD_PARTICIPATION',
  'ABSENT_ONCE',
  'ABSENT_TWICE',
  'ABSENT_MORE_THAN_TWICE_OR_NOT_PARTICIPATED',
] as const;
export type PoliticalActivityLevel = (typeof POLITICAL_ACTIVITY_LEVELS)[number];

export const CULTURE_SPORT_LEVELS = [
  'FULL_EFFECTIVE_PARTICIPATION',
  'EFFECTIVE_PARTICIPATION_FROM_HALF',
  'ENCOURAGED_OTHERS',
  'ABSENT_OVER_HALF',
  'NOT_PARTICIPATED',
] as const;
export type CultureSportLevel = (typeof CULTURE_SPORT_LEVELS)[number];

export const CLUB_ACTIVITY_LEVELS = [
  'FULL_EFFECTIVE_PARTICIPATION',
  'ACTIVE_ONE_OR_MORE',
  'ACTIVE_SUPPORTER',
  'ABSENT_OVER_HALF',
  'NOT_PARTICIPATED',
] as const;
export type ClubActivityLevel = (typeof CLUB_ACTIVITY_LEVELS)[number];

export const SOCIAL_PREVENTION_LEVELS = [
  'MULTIPLE_ACTIVITIES_OR_REPORTING',
  'ONE_EFFECTIVE_ACTIVITY',
  'AWARENESS_OR_SUPPORT',
  'REMINDED_VIOLATION',
] as const;
export type SocialPreventionLevel = (typeof SOCIAL_PREVENTION_LEVELS)[number];

export class UpdateActivityScoreDto extends ExpectedVersionDto {
  @IsIn(POLITICAL_ACTIVITY_LEVELS)
  politicalActivityLevel: PoliticalActivityLevel;

  @IsIn(CULTURE_SPORT_LEVELS)
  cultureSportLevel: CultureSportLevel;

  @IsIn(CLUB_ACTIVITY_LEVELS)
  clubActivityLevel: ClubActivityLevel;

  @IsIn(SOCIAL_PREVENTION_LEVELS)
  socialPreventionLevel: SocialPreventionLevel;

  @IsInt()
  @Min(0)
  @Max(2)
  rewardScore: number;
}
