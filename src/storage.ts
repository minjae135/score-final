import { SEMESTERS, SemesterInput, SubjectInput } from './scoring';

const FILE_FORMAT = 'middle-school-score';
const FILE_VERSION = 1;

export function serializeScores(semesters: SemesterInput[]): string {
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    semesters
  }, null, 2);
}

export function parseScores(text: string): SemesterInput[] {
  const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!isRecord(data) || data.format !== FILE_FORMAT || data.version !== FILE_VERSION ||
      !Array.isArray(data.semesters) || data.semesters.length !== SEMESTERS.length) {
    throw new Error('이 계산기에서 저장한 성적 파일을 선택해 주세요.');
  }

  const semesters = data.semesters;
  return SEMESTERS.map((config) => {
    const matches = semesters.filter((item: unknown) => isRecord(item) && item.key === config.key);
    const semester: unknown = matches[0];
    if (matches.length !== 1 || !isRecord(semester) ||
        (semester.mode !== 'subjects' && semester.mode !== 'average' && semester.mode !== 'forecast') ||
        !isOptionalNumber(semester.averageScore) || !Array.isArray(semester.subjects)) {
      throw new Error(`${config.label} 저장 정보를 확인해 주세요.`);
    }

    const subjects: SubjectInput[] = semester.subjects.map((subject: unknown, index: number) => {
      if (!isRecord(subject) || typeof subject.name !== 'string' ||
          (subject.category !== 'general' && subject.category !== 'arts') ||
          (subject.inputMode !== 'raw' && subject.inputMode !== 'achievement') ||
          !isOptionalNumber(subject.rawScore) ||
          (subject.achievement !== undefined &&
            (typeof subject.achievement !== 'string' ||
              !['A', 'B', 'C', 'D', 'E'].includes(subject.achievement))) ||
          (subject.category === 'arts' && (subject.inputMode !== 'achievement' ||
            (subject.achievement !== undefined && !['A', 'B', 'C'].includes(String(subject.achievement)))))) {
        throw new Error(`${config.label} ${index + 1}번째 과목의 저장 정보를 확인해 주세요.`);
      }

      return {
        id: `loaded-${config.key}-${index}`,
        name: subject.name,
        category: subject.category,
        inputMode: subject.inputMode,
        rawScore: subject.rawScore,
        achievement: subject.achievement as SubjectInput['achievement']
      };
    });

    return { key: config.key, mode: semester.mode, averageScore: semester.averageScore, subjects };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}
