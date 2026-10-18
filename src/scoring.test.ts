import { describe, expect, it } from 'vitest';
import {
  SEMESTERS,
  SemesterInput,
  calculateFinalScore,
  scoreArtsAchievement,
  scoreGeneralRaw
} from './scoring';

function averageSemesters(score: number): SemesterInput[] {
  return SEMESTERS.map((semester) => ({
    key: semester.key,
    mode: 'average',
    averageScore: score,
    subjects: []
  }));
}

describe('scoring', () => {
  it('calculates the perfect score as 240.000', () => {
    const outcome = calculateFinalScore(averageSemesters(5));

    expect(outcome.errors).toEqual([]);
    expect(outcome.result?.finalScore).toBe(240);
  });

  it('calculates the lowest average score as 124.800', () => {
    const outcome = calculateFinalScore(averageSemesters(1));

    expect(outcome.errors).toEqual([]);
    expect(outcome.result?.finalScore).toBe(124.8);
  });

  it('maps general raw score boundaries', () => {
    expect(scoreGeneralRaw(90)).toBe(5);
    expect(scoreGeneralRaw(80)).toBe(4);
    expect(scoreGeneralRaw(70)).toBe(3);
    expect(scoreGeneralRaw(60)).toBe(2);
    expect(scoreGeneralRaw(59.99)).toBe(1);
  });

  it('maps arts achievements without raw scores', () => {
    expect(scoreArtsAchievement('A')).toBe(5);
    expect(scoreArtsAchievement('B')).toBe(4);
    expect(scoreArtsAchievement('C')).toBe(3);
  });

  it('reports an error when a semester average is missing', () => {
    const [first, ...rest] = averageSemesters(5);
    const outcome = calculateFinalScore([{ ...first, averageScore: undefined }, ...rest]);

    expect(outcome.result).toBeUndefined();
    expect(outcome.errors[0]?.message).toContain('평균 환산점수');
  });
});
