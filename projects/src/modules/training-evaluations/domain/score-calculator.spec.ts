import { BadRequestException } from '@nestjs/common';
import {
calculateActivityScore,
calculateClassification,
calculateCommunityScore,
calculateDisciplineScore,
calculateRoleScore,
calculateScoreResult,
calculateStudyScore,
} from './score-calculator';

describe('score calculator', () => {
  it.each([
    [0, 'poor'],
    [34, 'poor'],
    [35, 'weak'],
    [49, 'weak'],
    [50, 'average'],
    [64, 'average'],
    [65, 'fair'],
    [79, 'fair'],
    [80, 'good'],
    [89, 'good'],
    [90, 'excellent'],
    [100, 'excellent'],
  ])('classifies boundary %i as %s', (score, rank) => {
    expect(calculateClassification(Number(score))).toBe(rank);
  });

  it('caps the total at 100 without changing section inputs', () => {
    const input = Object.freeze({
      studyScore: 30,
      disciplineScore: 30,
      activityScore: 30,
      communityScore: 30,
      roleScore: 10,
    });
    expect(calculateScoreResult(input)).toEqual({
      totalScore: 100,
      rank: 'excellent',
    });
  });

  it('counts only checked study activities and retains the full activity payload', () => {
    const dto = {
      regularScoreLevel: 'GTE_9',
      academicRank: 'EXCELLENT',
      activities: [
        { code: 'ACADEMIC_EVENT_PARTICIPATION', checked: true },
        { code: 'SCIENTIFIC_PUBLICATION_OR_CONTEST', checked: false },
      ],
    } as const;
    const result = calculateStudyScore({
      ...dto,
      activities: [...dto.activities],
    });
    expect(result.score).toBe(16);
    expect(result.activities).toEqual([
      { code: 'ACADEMIC_EVENT_PARTICIPATION', checked: true, score: 2 },
      { code: 'SCIENTIFIC_PUBLICATION_OR_CONTEST', checked: false, score: 2 },
    ]);
  });

  it('clamps disciplinary deductions at zero', () => {
    const result = calculateDisciplineScore({
      baseScore: 25,
      violations: [{ code: 'test', count: 3, deductScore: 10 }],
    });
    expect(result.score).toBe(0);
    expect(result.violations).toHaveLength(1);
  });

  it('retains the activity and community scoring tables', () => {
    expect(
      calculateActivityScore({
        politicalActivityLevel: 'GOOD_PARTICIPATION',
        cultureSportLevel: 'FULL_EFFECTIVE_PARTICIPATION',
        clubActivityLevel: 'FULL_EFFECTIVE_PARTICIPATION',
        socialPreventionLevel: 'MULTIPLE_ACTIVITIES_OR_REPORTING',
        rewardScore: 2,
      }),
    ).toBe(20);
    expect(
      calculateCommunityScore({
        lawComplianceLevel: 'GOOD_WITH_REWARD',
        volunteerActivityLevel: 'ACTIVE_WITH_REWARD',
        communityRelationshipLevel: 'GOOD',
      }),
    ).toBe(25);
  });

  it('keeps normal student and officer scoring rules distinct', () => {
    expect(
      calculateRoleScore({
        studentRoleType: 'NORMAL_STUDENT',
        normalStudentActivityScore: 3,
        specialAchievementLevel: 'SCHOOL_LEVEL_OR_HIGHER',
      }),
    ).toBe(10);
    expect(
      calculateRoleScore({
        studentRoleType: 'CLASS_OFFICER',
        positionGroup: 'LEADER_GROUP',
        taskCompletionLevel: 'EXCELLENT',
        managementSkillLevel: 'HEAD_POSITION',
        specialAchievementLevel: 'SCHOOL_LEVEL_OR_HIGHER',
      }),
    ).toBe(10);
    expect(() =>
      calculateRoleScore({ studentRoleType: 'CLASS_OFFICER' }),
    ).toThrow(BadRequestException);
  });
});
