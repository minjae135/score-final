import { AssessmentInput, SEMESTERS, SemesterInput, SubjectInput } from './scoring';

const FILE_FORMAT = 'middle-school-score';
const FILE_VERSION = 8;

export type GradeActivityScores = [number, number, number];
export type AutonomousActivityScores = GradeActivityScores;
export type ClubActivityScores = GradeActivityScores;
export type VolunteerActivityScores = [number | undefined, number | undefined, number | undefined];
export type VolunteerActivityBonuses = [boolean, boolean, boolean];

export interface ParsedScoreFile {
  semesters: SemesterInput[];
  unexcusedAbsenceDays?: number;
  autonomousActivityScores: AutonomousActivityScores;
  clubActivityScores: ClubActivityScores;
  volunteerActivityScores: VolunteerActivityScores;
  volunteerActivityBonuses: VolunteerActivityBonuses;
}

export function serializeScores(
  semesters: SemesterInput[],
  unexcusedAbsenceDays?: number,
  autonomousActivityScores: AutonomousActivityScores = [3, 3, 3],
  clubActivityScores: ClubActivityScores = [3, 3, 3],
  volunteerActivityScores: VolunteerActivityScores = [undefined, undefined, undefined],
  volunteerActivityBonuses: VolunteerActivityBonuses = [false, false, false]
): string {
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    unexcusedAbsenceDays,
    autonomousActivityScores,
    clubActivityScores,
    volunteerActivityScores,
    volunteerActivityBonuses,
    semesters
  }, null, 2);
}

export function parseScoreFile(text: string): ParsedScoreFile {
  const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!isRecord(data) || data.format !== FILE_FORMAT ||
      typeof data.version !== 'number' || ![1, 2, 3, 4, 5, 6, 7, FILE_VERSION].includes(data.version) || !Array.isArray(data.semesters) ||
      (data.version === 1 ? data.semesters.length !== SEMESTERS.length - 1 : data.semesters.length !== SEMESTERS.length) ||
      (data.unexcusedAbsenceDays !== undefined &&
        (!Number.isInteger(data.unexcusedAbsenceDays) || Number(data.unexcusedAbsenceDays) < 0)) ||
      (data.autonomousActivityScores !== undefined && !isGradeActivityScores(data.autonomousActivityScores)) ||
      (data.clubActivityScores !== undefined && !isGradeActivityScores(data.clubActivityScores)) ||
      (data.volunteerActivityScores !== undefined && !isVolunteerActivityScores(data.volunteerActivityScores)) ||
      (data.volunteerActivityBonus !== undefined && typeof data.volunteerActivityBonus !== 'boolean') ||
      (data.volunteerActivityBonuses !== undefined && !isVolunteerActivityBonuses(data.volunteerActivityBonuses))) {
    throw new Error('이 계산기에서 저장한 성적 파일을 선택해 주세요.');
  }

  const semesters = data.version === 1
    ? [{ key: '1-1', mode: 'free', subjects: [] }, ...data.semesters]
    : data.semesters;
  const parsedSemesters = SEMESTERS.map((config) => {
    const matches = semesters.filter((item: unknown) => isRecord(item) && item.key === config.key);
    const semester: unknown = matches[0];
    if (matches.length !== 1 || !isRecord(semester) ||
        (semester.mode !== 'subjects' && semester.mode !== 'average' && semester.mode !== 'forecast' &&
          !(config.key === '1-1' && semester.mode === 'free')) ||
        !isOptionalNumber(semester.averageScore) || !Array.isArray(semester.subjects)) {
      throw new Error(`${config.label} 저장 정보를 확인해 주세요.`);
    }

    const subjects: SubjectInput[] = semester.subjects.map((subject: unknown, index: number) => {
      if (!isRecord(subject) || typeof subject.name !== 'string' ||
          (subject.category !== 'general' && subject.category !== 'arts') ||
          (subject.inputMode !== 'raw' && subject.inputMode !== 'achievement' && subject.inputMode !== 'assessment') ||
          !isOptionalNumber(subject.rawScore) ||
          (subject.achievement !== undefined &&
            (typeof subject.achievement !== 'string' ||
              !['A', 'B', 'C', 'D', 'E'].includes(subject.achievement))) ||
          (subject.category === 'arts' &&
            (subject.achievement !== undefined && !['A', 'B', 'C'].includes(String(subject.achievement)))) ||
          (subject.assessments !== undefined && (!Array.isArray(subject.assessments) ||
            !subject.assessments.every(isAssessmentInput))) ||
          (subject.inputMode === 'assessment' && !Array.isArray(subject.assessments))) {
        throw new Error(`${config.label} ${index + 1}번째 과목의 저장 정보를 확인해 주세요.`);
      }

      const assessments: AssessmentInput[] | undefined = Array.isArray(subject.assessments)
        ? subject.assessments.map((assessment: AssessmentInput, assessmentIndex: number) => ({
            ...assessment,
            id: `loaded-${config.key}-${index}-assessment-${assessmentIndex}`
          }))
        : undefined;

      return {
        id: `loaded-${config.key}-${index}`,
        name: subject.name,
        category: subject.category,
        inputMode: subject.inputMode,
        rawScore: subject.rawScore,
        achievement: subject.achievement as SubjectInput['achievement'],
        assessments
      };
    });

    return {
      key: config.key,
      mode: semester.mode as SemesterInput['mode'],
      averageScore: semester.averageScore,
      subjects
    };
  });

  return {
    semesters: parsedSemesters,
    unexcusedAbsenceDays: (data.unexcusedAbsenceDays as number | undefined) ?? 0,
    autonomousActivityScores: isGradeActivityScores(data.autonomousActivityScores)
      ? data.autonomousActivityScores
      : [3, 3, 3],
    clubActivityScores: isGradeActivityScores(data.clubActivityScores)
      ? data.clubActivityScores
      : [3, 3, 3],
    volunteerActivityScores: parseVolunteerActivityScores(data.volunteerActivityScores),
    volunteerActivityBonuses: isVolunteerActivityBonuses(data.volunteerActivityBonuses)
      ? data.volunteerActivityBonuses
      : data.version === 6 && data.volunteerActivityBonus === true
        ? [true, false, false]
        : [false, false, false]
  };
}

export function parseScores(text: string): SemesterInput[] {
  return parseScoreFile(text).semesters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isAssessmentInput(value: unknown): value is AssessmentInput {
  return isRecord(value) && typeof value.name === 'string' &&
    isOptionalNumber(value.weight) &&
    isOptionalNumber(value.score) && isOptionalNumber(value.maxScore) &&
    (value.excused === undefined || typeof value.excused === 'boolean');
}

function isGradeActivityScores(value: unknown): value is GradeActivityScores {
  return Array.isArray(value) && value.length === 3 &&
    value.every((score) => Number.isInteger(score) && score >= 2 && score <= 4);
}

function isVolunteerActivityScores(value: unknown): value is [number | null | undefined, number | null | undefined, number | null | undefined] {
  return Array.isArray(value) && value.length === 3 &&
    value.every((score) => score === null || score === undefined ||
      (Number.isInteger(score) && score >= 2 && score <= 4));
}

function parseVolunteerActivityScores(value: unknown): VolunteerActivityScores {
  if (value === undefined || !isVolunteerActivityScores(value)) return [4, 4, 4];
  return [value[0] ?? undefined, value[1] ?? undefined, value[2] ?? undefined];
}

function isVolunteerActivityBonuses(value: unknown): value is VolunteerActivityBonuses {
  return Array.isArray(value) && value.length === 3 && value.every((bonus) => typeof bonus === 'boolean');
}
