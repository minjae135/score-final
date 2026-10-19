export type Achievement = 'A' | 'B' | 'C' | 'D' | 'E';
export type ArtsAchievement = Extract<Achievement, 'A' | 'B' | 'C'>;
export type SubjectCategory = 'general' | 'arts';
export type InputMode = 'raw' | 'achievement';
export type SemesterInputMode = 'subjects' | 'average' | 'forecast' | 'free';
export type SemesterKey = '1-1' | '1-2' | '2-1' | '2-2' | '3-1' | '3-2';

export interface SubjectInput {
  id: string;
  name: string;
  category: SubjectCategory;
  inputMode: InputMode;
  rawScore?: number;
  achievement?: Achievement;
}

export interface SemesterInput {
  key: SemesterKey;
  mode: SemesterInputMode;
  averageScore?: number;
  subjects: SubjectInput[];
}

export interface SemesterResult {
  key: SemesterKey;
  label: string;
  averageScore: number;
  weightedScore: number;
  subjectCount?: number;
  isForecast?: boolean;
}

export interface CalculationResult {
  baseScore: number;
  reflectedScore: number;
  finalScore: number;
  semesters: SemesterResult[];
}

export interface ScoringError {
  field: string;
  message: string;
}

export interface ScoringOutcome {
  result?: CalculationResult;
  errors: ScoringError[];
}

export const BASE_SCORE = 96;
export const ATTENDANCE_MAX_SCORE = 21;
export const ATTENDANCE_MIN_SCORE = 12;
export const AUTONOMOUS_ACTIVITY_MAX_SCORE = 12;
export const CLUB_ACTIVITY_MAX_SCORE = 12;
export const VOLUNTEER_ACTIVITY_MAX_SCORE = 15;

export function calculateAttendanceScore(unexcusedAbsenceDays: number): number {
  if (!Number.isInteger(unexcusedAbsenceDays) || unexcusedAbsenceDays < 0) {
    throw new Error('미인정 결석 일수는 0 이상의 정수여야 합니다.');
  }

  return Math.max(ATTENDANCE_MIN_SCORE, ATTENDANCE_MAX_SCORE - Math.ceil(unexcusedAbsenceDays / 2));
}

export const SEMESTERS: Array<{
  key: SemesterKey;
  label: string;
  weight: number;
}> = [
  { key: '1-1', label: '1학년 1학기', weight: 0 },
  { key: '1-2', label: '1학년 2학기', weight: 2.88 },
  { key: '2-1', label: '2학년 1학기', weight: 5.76 },
  { key: '2-2', label: '2학년 2학기', weight: 5.76 },
  { key: '3-1', label: '3학년 1학기', weight: 7.2 },
  { key: '3-2', label: '3학년 2학기', weight: 7.2 }
];

const FORECAST_FALLBACKS: Record<SemesterKey, SemesterKey[]> = {
  '1-1': ['1-2', '2-1', '2-2', '3-1', '3-2'],
  '1-2': ['2-2', '2-1', '3-2', '3-1', '1-1'],
  '2-1': ['2-2', '3-1', '3-2', '1-1', '1-2'],
  '2-2': ['2-1', '3-2', '3-1', '1-2', '1-1'],
  '3-1': ['3-2', '2-1', '2-2', '1-1', '1-2'],
  '3-2': ['3-1', '2-2', '2-1', '1-2', '1-1']
};

export function scoreGeneralRaw(rawScore: number): number {
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100) {
    throw new Error('일반교과 원점수는 0~100 사이여야 합니다.');
  }

  if (rawScore >= 90) return 5;
  if (rawScore >= 80) return 4;
  if (rawScore >= 70) return 3;
  if (rawScore >= 60) return 2;
  return 1;
}

export function scoreGeneralAchievement(achievement: Achievement): number {
  return {
    A: 5,
    B: 4,
    C: 3,
    D: 2,
    E: 1
  }[achievement];
}

export function scoreArtsAchievement(achievement: ArtsAchievement): number {
  return {
    A: 5,
    B: 4,
    C: 3
  }[achievement];
}

export function scoreSubject(subject: SubjectInput): number {
  if (subject.category === 'arts') {
    if (!subject.achievement) {
      throw new Error('체육·예술 성취도를 입력해 주세요.');
    }
    if (!isArtsAchievement(subject.achievement)) {
      throw new Error('체육·예술 과목은 A/B/C 성취도만 입력할 수 있습니다.');
    }
    return scoreArtsAchievement(subject.achievement);
  }

  if (subject.inputMode === 'raw') {
    if (typeof subject.rawScore !== 'number') {
      throw new Error('일반교과 원점수를 입력해 주세요.');
    }
    return scoreGeneralRaw(subject.rawScore);
  }

  if (!subject.achievement) {
    throw new Error('일반교과 성취도를 입력해 주세요.');
  }
  return scoreGeneralAchievement(subject.achievement);
}

export function calculateSemesterAverage(semester: SemesterInput): {
  averageScore?: number;
  subjectCount?: number;
  errors: ScoringError[];
} {
  const label = getSemesterLabel(semester.key);

  if (semester.mode === 'free') {
    return { errors: [] };
  }

  if (semester.mode === 'forecast') {
    return { errors: [{ field: `${semester.key}.forecast`, message: `${label}을(를) 대체할 입력 완료 학기 성적이 없습니다.` }] };
  }

  if (semester.mode === 'average') {
    if (typeof semester.averageScore !== 'number' || !Number.isFinite(semester.averageScore)) {
      return { errors: [{ field: `${semester.key}.average`, message: `${label} 평균 환산점수를 입력해 주세요.` }] };
    }

    if (semester.averageScore < 1 || semester.averageScore > 5) {
      return { errors: [{ field: `${semester.key}.average`, message: `${label} 평균 환산점수는 1~5 사이여야 합니다.` }] };
    }

    return { averageScore: semester.averageScore, errors: [] };
  }

  if (semester.subjects.length === 0) {
    return { errors: [{ field: `${semester.key}.subjects`, message: `${label} 과목을 1개 이상 입력해 주세요.` }] };
  }

  const errors: ScoringError[] = [];
  let total = 0;

  semester.subjects.forEach((subject, index) => {
    const subjectLabel = subject.name.trim() || `${index + 1}번째 과목`;
    try {
      total += scoreSubject(subject);
    } catch (error) {
      errors.push({
        field: `${semester.key}.subjects.${subject.id}`,
        message: `${label} ${subjectLabel}: ${error instanceof Error ? error.message : '입력값을 확인해 주세요.'}`
      });
    }
  });

  if (errors.length > 0) {
    return { errors };
  }

  return {
    averageScore: total / semester.subjects.length,
    subjectCount: semester.subjects.length,
    errors: []
  };
}

export function calculateForecast(semesters: SemesterInput[], targetKey: SemesterKey): {
  averageScore?: number;
  sourceKey?: SemesterKey;
} {
  for (const sourceKey of FORECAST_FALLBACKS[targetKey]) {
    const semester = semesters.find((item) => item.key === sourceKey);
    if (!semester || semester.mode === 'forecast') continue;
    const result = calculateSemesterAverage(semester);
    if (result.errors.length === 0 && result.averageScore !== undefined) {
      return { averageScore: result.averageScore, sourceKey };
    }
  }
  return {};
}

export function calculateFinalScore(semesters: SemesterInput[]): ScoringOutcome {
  const byKey = new Map(semesters.map((semester) => [semester.key, semester]));
  const errors: ScoringError[] = [];
  const semesterResults: SemesterResult[] = [];

  SEMESTERS.filter((config) => config.weight > 0).forEach((config) => {
    const semester = byKey.get(config.key);
    if (!semester) {
      errors.push({ field: config.key, message: `${config.label} 입력 정보가 없습니다.` });
      return;
    }

    const forecast = semester.mode === 'forecast' ? calculateForecast(semesters, semester.key) : undefined;
    const semesterAverage = forecast?.averageScore !== undefined
      ? { averageScore: forecast.averageScore, subjectCount: undefined, errors: [] }
      : calculateSemesterAverage(semester);
    if (semesterAverage.errors.length > 0 || typeof semesterAverage.averageScore !== 'number') {
      errors.push(...semesterAverage.errors);
      return;
    }

    semesterResults.push({
      key: config.key,
      label: config.label,
      averageScore: semesterAverage.averageScore,
      weightedScore: semesterAverage.averageScore * config.weight,
      subjectCount: semesterAverage.subjectCount,
      isForecast: semester.mode === 'forecast'
    });
  });

  if (errors.length > 0) {
    return { errors };
  }

  const reflectedScore = semesterResults.reduce((sum, semester) => sum + semester.weightedScore, 0);
  const finalScore = roundToThree(BASE_SCORE + reflectedScore);

  return {
    errors: [],
    result: {
      baseScore: BASE_SCORE,
      reflectedScore: roundToThree(reflectedScore),
      finalScore,
      semesters: semesterResults.map((semester) => ({
        ...semester,
        averageScore: roundToThree(semester.averageScore),
        weightedScore: roundToThree(semester.weightedScore)
      }))
    }
  };
}

export function isArtsAchievement(value: Achievement): value is ArtsAchievement {
  return value === 'A' || value === 'B' || value === 'C';
}

export function roundToThree(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function getSemesterLabel(key: SemesterKey): string {
  return SEMESTERS.find((semester) => semester.key === key)?.label ?? key;
}
