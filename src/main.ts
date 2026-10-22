import './styles.css';
import { parseScoreFile, serializeScores } from './storage';
import {
  Achievement,
  ATTENDANCE_MAX_SCORE,
  AssessmentInput,
  AUTONOMOUS_ACTIVITY_MAX_SCORE,
  CLUB_ACTIVITY_MAX_SCORE,
  InputMode,
  SEMESTERS,
  SemesterInput,
  SemesterInputMode,
  SubjectCategory,
  SubjectInput,
  VOLUNTEER_ACTIVITY_MAX_SCORE,
  calculateAttendanceScore,
  calculateAssessmentRawScore,
  calculateFinalScore,
  calculateForecast,
  roundToThree,
  scoreSubject
} from './scoring';
import type {
  AutonomousActivityScores,
  ClubActivityScores,
  VolunteerActivityBonuses,
  VolunteerActivityScores
} from './storage';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('앱을 렌더링할 영역을 찾을 수 없습니다.');
}

const appRoot = app;

const GENERAL_ACHIEVEMENTS: Achievement[] = ['A', 'B', 'C', 'D', 'E'];
const ARTS_ACHIEVEMENTS: Achievement[] = ['A', 'B', 'C'];
const DEFAULT_SUBJECTS: Record<string, string[]> = {
  '1': ['국어', '사회', '도덕', '수학', '과학', '기술·가정', '영어', '체육', '음악', '미술'],
  '2': ['국어', '역사', '도덕', '수학', '과학', '정보', '영어', '한문', '체육', '음악', '미술'],
  '3': ['국어', '사회', '역사', '수학', '과학', '기술·가정', '영어', '진로와 직업', '과제탐구', '체육', '음악', '미술']
};
const ARTS_SUBJECTS = new Set(['체육', '음악', '미술']);
const PERFORMANCE_ONLY_SUBJECTS = new Set(['도덕', '기술·가정', '한문', '진로와 직업', '과제탐구']);

let nextSubjectId = 1;
let nextAssessmentId = 1;
const expandedAssessmentSubjects = new Set<string>();
const expandedSemesters = new Set<string>();
let state: SemesterInput[] = createDefaultState();
let unexcusedAbsenceDays: number | undefined = 0;
let autonomousActivityScores: AutonomousActivityScores = [3, 3, 3];
let clubActivityScores: ClubActivityScores = [3, 3, 3];
let volunteerActivityScores: VolunteerActivityScores = [4, 4, 4];
let volunteerActivityBonuses: VolunteerActivityBonuses = [false, false, false];

function createDefaultState(): SemesterInput[] {
  return SEMESTERS.map((semester) => ({
    key: semester.key,
    mode: semester.key === '1-1' ? 'free' : 'subjects',
    subjects: DEFAULT_SUBJECTS[semester.key[0]].map((name) => createSubject({
      name,
      category: ARTS_SUBJECTS.has(name) ? 'arts' : 'general',
      inputMode: ARTS_SUBJECTS.has(name) ? 'achievement' : 'raw'
    }))
  }));
}

function createSubject(overrides: Partial<SubjectInput> = {}): SubjectInput {
  return {
    id: `subject-${nextSubjectId++}`,
    name: '',
    category: 'general',
    inputMode: 'raw',
    rawScore: undefined,
    achievement: undefined,
    ...overrides
  };
}

function createAssessment(name: string, weight: number): AssessmentInput {
  return {
    id: `assessment-${nextAssessmentId++}`,
    name,
    weight,
    maxScore: 100,
    excused: false
  };
}

function createDefaultAssessments(subject: SubjectInput): AssessmentInput[] {
  if (subject.category === 'arts' || PERFORMANCE_ONLY_SUBJECTS.has(subject.name.trim())) {
    return [createAssessment('수행평가 1', 50), createAssessment('수행평가 2', 50)];
  }
  if (subject.name.trim() === '정보') {
    return [
      createAssessment('2회고사 (기말고사)', 40),
      createAssessment('수행평가 1', 30),
      createAssessment('수행평가 2', 30)
    ];
  }
  if (subject.name.trim() === '영어') {
    return [
      createAssessment('1회고사 (중간고사)', 30),
      createAssessment('2회고사 (기말고사)', 30),
      createAssessment('영어듣기평가', 10),
      createAssessment('수행평가', 30)
    ];
  }
  return [
    createAssessment('1회고사 (중간고사)', 30),
    createAssessment('2회고사 (기말고사)', 30),
    createAssessment('수행평가 1', 20),
    createAssessment('수행평가 2', 20)
  ];
}

function render(): void {
  const outcome = calculateFinalScore(state);
  const result = outcome.result;
  const attendanceScore = getAttendanceScore();
  const volunteerScore = getVolunteerActivityScore();
  const totalScore = result && attendanceScore !== undefined
    && volunteerScore !== undefined
    ? roundToThree(result.finalScore + attendanceScore + getAutonomousActivityScore() + getClubActivityScore() + volunteerScore)
    : undefined;

  appRoot.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">${240 + ATTENDANCE_MAX_SCORE + AUTONOMOUS_ACTIVITY_MAX_SCORE + CLUB_ACTIVITY_MAX_SCORE + VOLUNTEER_ACTIVITY_MAX_SCORE}점 만점</p>
        <h1>중학교 내신 성적 산출기</h1>
      </div>
      <div class="score-panel ${totalScore !== undefined ? 'is-ready' : ''}">
        <span>${result?.semesters.some((semester) => semester.isForecast || semester.isProvisional) ? '예상 총점' : '총점'}</span>
        <strong>${totalScore !== undefined ? totalScore.toFixed(3) : '--.---'}</strong>
      </div>
    </header>

    <main>
      <section class="toolbar" aria-label="계산 도구">
        <button type="button" data-action="feedback">버그 제보 / 기능 건의</button>
        <button type="button" data-action="forecast-empty">미입력 학기 예상</button>
        <button type="button" data-action="save">저장</button>
        <button type="button" data-action="load">불러오기</button>
        <input type="file" accept=".json,application/json" data-file-input aria-label="성적 파일 선택" hidden />
        <button type="button" data-action="fill-example">예시 입력</button>
        <button type="button" data-action="reset">초기화</button>
      </section>
      <dialog class="feedback-dialog" data-feedback-dialog aria-labelledby="feedback-title">
        <div class="feedback-dialog-header">
          <h2 id="feedback-title">의견 보내기</h2>
          <button type="button" class="icon-button" data-action="close-feedback" aria-label="닫기" title="닫기">×</button>
        </div>
        <p>설문에서 버그 제보 또는 기능 건의를 선택해 주세요. 이름, 학교, 실제 성적 등 개인정보는 입력하지 말아 주세요.</p>
        <div class="feedback-links">
          <a href="https://forms.gle/arcCjYqjBYdytAzg8" target="_blank" rel="noopener noreferrer">
            <strong>제보 양식 열기</strong>
            <span>Google 설문에서 제보 종류를 선택할 수 있습니다.</span>
          </a>
        </div>
      </dialog>
      <p class="file-status" data-file-status role="status" aria-live="polite"></p>

      ${renderAttendanceInput(attendanceScore)}
      ${renderAutonomousActivityInput()}
      ${renderClubActivityInput()}
      ${renderVolunteerActivityInput()}

      ${renderForecastRules()}

      <div data-results>
        ${renderSummary()}
        ${renderErrors(outcome.errors.map((error) => error.message))}
      </div>

      <section class="semester-list" aria-label="학기별 입력">
        ${state.map(renderSemester).join('')}
      </section>
    </main>
  `;

  bindEvents();
}

function renderSummary(): string {
  const outcome = calculateFinalScore(state);
  const result = outcome.result;
  const attendanceScore = getAttendanceScore();
  const volunteerScore = getVolunteerActivityScore();
  const totalScore = result && attendanceScore !== undefined
    && volunteerScore !== undefined
    ? roundToThree(result.finalScore + attendanceScore + getAutonomousActivityScore() + getClubActivityScore() + volunteerScore)
    : undefined;

  return `
    <section class="summary-grid" aria-label="점수 요약">
      <div><span>교과 성적 · 240점</span><strong>${result ? result.finalScore.toFixed(3) : '--.---'}</strong></div>
      <div><span>출결 점수 · ${ATTENDANCE_MAX_SCORE}점</span><strong>${attendanceScore !== undefined ? attendanceScore.toFixed(3) : '--.---'}</strong></div>
      <div><span>자율활동 · ${AUTONOMOUS_ACTIVITY_MAX_SCORE}점</span><strong>${getAutonomousActivityScore().toFixed(3)}</strong></div>
      <div><span>동아리 활동 · ${CLUB_ACTIVITY_MAX_SCORE}점</span><strong>${getClubActivityScore().toFixed(3)}</strong></div>
      <div><span>봉사활동 · ${VOLUNTEER_ACTIVITY_MAX_SCORE}점</span><strong>${volunteerScore === undefined ? '--.---' : volunteerScore.toFixed(3)}</strong></div>
      <div><span>${result?.semesters.some((semester) => semester.isForecast || semester.isProvisional) ? '예상 총점' : '총점'} · ${240 + ATTENDANCE_MAX_SCORE + AUTONOMOUS_ACTIVITY_MAX_SCORE + CLUB_ACTIVITY_MAX_SCORE + VOLUNTEER_ACTIVITY_MAX_SCORE}점</span><strong>${totalScore !== undefined ? totalScore.toFixed(3) : '--.---'}</strong></div>
    </section>

    ${result ? `<section class="breakdown" aria-label="학기별 반영 점수">
      <table>
        <thead>
          <tr>
            <th>학기</th>
            <th>평균 환산점수</th>
            <th>반영 점수</th>
          </tr>
        </thead>
        <tbody>
          ${result.semesters
            .map(
              (semester) => `
                <tr>
                  <td>${semester.label}${semester.isForecast ? ' (예상)' : semester.isProvisional ? ' (임시)' : ''}</td>
                  <td>${semester.averageScore.toFixed(3)}</td>
                  <td>${semester.weightedScore.toFixed(3)}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </section>` : ''}
  `;
}

function renderAttendanceInput(attendanceScore?: number): string {
  return `
    <section class="attendance-entry" aria-label="출결 점수 입력">
      <label>
        <span>미인정 결석 일수</span>
        <input type="number" inputmode="numeric" min="0" step="1" value="${unexcusedAbsenceDays ?? ''}" placeholder="0" data-attendance-field="unexcusedAbsenceDays" />
      </label>
      <p>출결 점수 <strong data-attendance-score>${attendanceScore === undefined ? '--' : attendanceScore} / ${ATTENDANCE_MAX_SCORE}</strong></p>
      <small>0일 21점, 이후 2일마다 1점 감점, 17일 이상은 12점입니다.</small>
    </section>
  `;
}

function getAttendanceScore(): number | undefined {
  return unexcusedAbsenceDays === undefined
    ? undefined
    : calculateAttendanceScore(unexcusedAbsenceDays);
}

function renderAutonomousActivityInput(): string {
  return `
    <section class="autonomous-entry" aria-label="자율활동 점수 입력">
      <div class="autonomous-heading">
        <h2>자율활동</h2>
        <strong>${getAutonomousActivityScore()} / ${AUTONOMOUS_ACTIVITY_MAX_SCORE}점</strong>
      </div>
      <div class="autonomous-grades">
        ${autonomousActivityScores.map((score, index) => `
          <label>
            <span>${index + 1}학년</span>
            <select data-activity-grade="${index}">
              <option value="2" ${score === 2 ? 'selected' : ''}>2점 · 감점</option>
              <option value="3" ${score === 3 ? 'selected' : ''}>3점 · 기본</option>
              <option value="4" ${score === 4 ? 'selected' : ''}>4점 · 가산</option>
            </select>
          </label>
        `).join('')}
      </div>
      <small>기본 3점. 4점은 정부반장·학급활동 유공자, 학생회 간부·학교 행사 유공자 중 적격자 또는 모범상 수상자, 2점은 선도처분 또는 징계 사실이 있는 경우입니다.</small>
    </section>
  `;
}

function getAutonomousActivityScore(): number {
  return autonomousActivityScores.reduce((sum, score) => sum + score, 0);
}

function renderClubActivityInput(): string {
  return `
    <section class="autonomous-entry" aria-label="동아리 활동 점수 입력">
      <div class="autonomous-heading club-heading">
        <h2>동아리 활동</h2>
        <strong>${getClubActivityScore()} / ${CLUB_ACTIVITY_MAX_SCORE}점</strong>
      </div>
      <div class="autonomous-grades">
        ${clubActivityScores.map((score, index) => `
          <label>
            <span>${index + 1}학년</span>
            <select data-club-grade="${index}">
              <option value="2" ${score === 2 ? 'selected' : ''}>2점 · 감점</option>
              <option value="3" ${score === 3 ? 'selected' : ''}>3점 · 기본</option>
              <option value="4" ${score === 4 ? 'selected' : ''}>4점 · 가산</option>
            </select>
          </label>
        `).join('')}
      </div>
      <small>기본 3점. 4점은 교내 동아리 관련 수상, 동아리 발표·전시회 우수 또는 유공, 모범상 외 교내상 수상자 중 해당자입니다. 동아리 활동 시간의 1/3 이상 무단이탈한 경우 2점으로 설정하세요.</small>
    </section>
  `;
}

function getClubActivityScore(): number {
  return clubActivityScores.reduce((sum, score) => sum + score, 0);
}

function renderVolunteerActivityInput(): string {
  const score = getVolunteerActivityScore();
  return `
    <section class="autonomous-entry volunteer-entry" aria-label="봉사활동 실적 입력">
      <div class="autonomous-heading volunteer-heading">
        <h2>봉사활동 실적</h2>
        <strong>${score === undefined ? '--' : score} / ${VOLUNTEER_ACTIVITY_MAX_SCORE}점</strong>
      </div>
      <div class="volunteer-grades">
        ${volunteerActivityScores.map((gradeScore, index) => `
          <div class="volunteer-grade">
            <label>
              <span>${index + 1}학년 기준시간 점수</span>
              <select data-volunteer-grade="${index}">
                <option value="" ${gradeScore === undefined ? 'selected' : ''}>선택</option>
                <option value="2" ${gradeScore === 2 ? 'selected' : ''}>2점 · 기준시수 절반 미만</option>
                <option value="3" ${gradeScore === 3 ? 'selected' : ''}>3점 · 기준시수 절반 이상</option>
                <option value="4" ${gradeScore === 4 ? 'selected' : ''}>4점 · 기준시수 충족</option>
              </select>
            </label>
            <label class="volunteer-bonus">
              <input type="checkbox" data-volunteer-bonus="${index}" ${volunteerActivityBonuses[index] ? 'checked' : ''} />
              <span>기본계획 가산 +1점</span>
            </label>
          </div>
        `).join('')}
      </div>
      <small>초·중·고 학생봉사활동 운영 기본계획에 따른 가산 대상이면 해당 학년을 체크하세요. 가산 여부는 학년별로 적용합니다.</small>
    </section>
  `;
}

function getVolunteerActivityScore(): number | undefined {
  if (volunteerActivityScores.some((score) => score === undefined)) return undefined;
  return volunteerActivityScores.reduce<number>((sum, score, index) =>
    sum + (score ?? 0) + (volunteerActivityBonuses[index] ? 1 : 0), 0);
}

function renderErrors(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  if (errors.every((error) =>
    error.includes('입력해 주세요.') || error.includes('추가해 주세요.') || error.includes('성취도만 입력할 수 있습니다.')
  )) {
    return `
      <section class="errors" aria-label="입력 안내">
        <p>미입력 항목 ${errors.length}개 · 성적을 입력하면 점수가 계산됩니다.</p>
      </section>
    `;
  }

  if (errors.length >= 5) {
    return `
      <details class="errors errors-collapsible" aria-label="입력 오류">
        <summary>오류 메시지 ${errors.length}개 · 눌러서 펼치기</summary>
        <div class="error-list">
          ${errors.map((error) => `<p>${escapeHtml(error)}</p>`).join('')}
        </div>
      </details>
    `;
  }

  return `
    <section class="errors" aria-label="입력 오류">
      ${errors.map((error) => `<p>${escapeHtml(error)}</p>`).join('')}
    </section>
  `;
}

function renderForecastRules(): string {
  return `
    <details class="forecast-rules">
      <summary>성적이 없는 학기 대체 기준</summary>
      <div class="forecast-rules-content">
        <table>
          <thead><tr><th>성적이 없는 학기·학년</th><th>대체 학기</th></tr></thead>
          <tbody>
            <tr><td>1학기</td><td>같은 학년 2학기</td></tr>
            <tr><td>2학기</td><td>같은 학년 1학기</td></tr>
            <tr><td>1학년</td><td>2학년 1학기 → 1학년 1학기<br />2학년 2학기 → 1학년 2학기</td></tr>
            <tr><td>2학년</td><td>3학년 1학기 → 2학년 1학기<br />3학년 2학기 → 2학년 2학기</td></tr>
            <tr><td>3학년</td><td>2학년 1학기 → 3학년 1학기<br />2학년 2학기 → 3학년 2학기</td></tr>
            <tr><td>1·2학년</td><td>3학년 1학기 → 1·2학년 1학기<br />3학년 2학기 → 1·2학년 2학기</td></tr>
            <tr><td>1·3학년</td><td>2학년 1학기 → 1·3학년 1학기<br />2학년 2학기 → 1·3학년 2학기</td></tr>
            <tr><td>2·3학년</td><td>1학년 1학기 → 2·3학년 1학기<br />1학년 2학기 → 2·3학년 2학기</td></tr>
          </tbody>
        </table>
        <p>대체 학기에도 입력된 성적이 없으면 1·2학기 대체 규칙을 따라 다른 입력 완료 학기를 찾습니다. 예상 학기와 자유학기는 대체 기준으로 사용하지 않습니다. 1학년 1학기는 자유학기 상태에서는 환산 점수에 반영되지 않으며, 성적이 있다면 과목별 또는 평균 입력으로 바꿔 대체 성적으로 사용할 수 있습니다.</p>
      </div>
    </details>
  `;
}

function renderSemester(semester: SemesterInput): string {
  const config = SEMESTERS.find((item) => item.key === semester.key);
  const label = config?.label ?? semester.key;

  return `
    <details class="semester" data-semester="${semester.key}" ${expandedSemesters.has(semester.key) ? 'open' : ''}>
      <summary class="semester-header">
        <span class="semester-title" role="heading" aria-level="2">${label}</span>
        <span class="semester-status" data-semester-summary="${semester.key}">${renderSemesterStatus(semester)}</span>
      </summary>
      <div class="semester-content">
        <div class="mode-toggle" role="group" aria-label="${label} 입력 방식">
          ${renderModeButton(semester, 'subjects', '과목별')}
          ${renderModeButton(semester, 'average', '평균')}
          ${renderModeButton(semester, 'forecast', '예상')}
          ${semester.key === '1-1' ? renderModeButton(semester, 'free', '자유학기') : ''}
        </div>
      </div>

      ${
        semester.mode === 'free'
          ? '<p class="free-semester-note">자유학기 성적은 환산 점수에 반영되지 않습니다.</p>'
          : semester.mode === 'forecast'
          ? `<div class="forecast-value" data-forecast="${semester.key}">${renderForecastValue(semester)}</div>`
          : semester.mode === 'average'
          ? renderAverageMode(semester)
          : `
            <div class="subject-table">
              <div class="subject-head" aria-hidden="true">
                <span>과목명</span>
                <span>구분</span>
                <span>입력</span>
                <span></span>
              </div>
              ${semester.subjects.map((subject) => renderSubjectRow(semester, subject)).join('')}
            </div>
            <button type="button" class="add-subject" data-action="add-subject" data-semester="${semester.key}">과목 추가</button>
          `
      }
      </div>
    </details>
  `;
}

function renderSemesterStatus(semester: SemesterInput): string {
  if (semester.mode === 'free') return '자유학기 · 산출 제외';
  if (semester.mode === 'forecast') return '예상 성적';
  if (semester.mode === 'average') {
    return semester.averageScore === undefined
      ? '평균 입력 · 미입력'
      : `평균 입력 · ${semester.averageScore.toFixed(3)}`;
  }
  const completed = semester.subjects.filter(subjectHasInput).length;
  return `과목별 · ${completed}/${semester.subjects.length}과목 입력`;
}

function renderForecastValue(semester: SemesterInput): string {
  const forecast = calculateForecast(state, semester.key);
  const source = SEMESTERS.find((item) => item.key === forecast.sourceKey);
  return forecast.averageScore === undefined
    ? '대체할 입력 완료 학기 성적이 없습니다.'
    : `예상 평균 환산점수 ${forecast.averageScore.toFixed(3)} · 대체 학기: ${source?.label ?? forecast.sourceKey}`;
}

function renderModeButton(semester: SemesterInput, mode: SemesterInputMode, label: string): string {
  const pressed = semester.mode === mode;

  return `
    <button
      type="button"
      data-action="set-semester-mode"
      data-semester="${semester.key}"
      data-mode="${mode}"
      aria-pressed="${pressed}"
      class="${pressed ? 'active' : ''}"
    >${label}</button>
  `;
}

function renderAverageMode(semester: SemesterInput): string {
  return `
    <label class="average-field">
      <span>평균 환산점수</span>
      <input
        type="number"
        inputmode="decimal"
        min="1"
        max="5"
        step="0.001"
        value="${semester.averageScore ?? ''}"
        data-field="averageScore"
        data-semester="${semester.key}"
      />
    </label>
  `;
}

function renderSubjectRow(semester: SemesterInput, subject: SubjectInput): string {
  const isArts = subject.category === 'arts';
  const achievements = isArts ? ARTS_ACHIEVEMENTS : GENERAL_ACHIEVEMENTS;
  const isExpanded = expandedAssessmentSubjects.has(subject.id);

  return `
    <div class="subject-entry" data-subject-entry="${subject.id}">
      <div class="subject-row">
        <label>
          <span>과목명</span>
          <input
            type="text"
            value="${escapeAttribute(subject.name)}"
            placeholder="${isArts ? '체육, 음악, 미술' : '국어, 수학, 영어'}"
            data-field="name"
            data-semester="${semester.key}"
            data-subject="${subject.id}"
          />
        </label>

        <label>
          <span>구분</span>
          <select data-field="category" data-semester="${semester.key}" data-subject="${subject.id}">
            <option value="general" ${subject.category === 'general' ? 'selected' : ''}>일반교과</option>
            <option value="arts" ${subject.category === 'arts' ? 'selected' : ''}>체육·예술</option>
          </select>
        </label>

        <div class="general-input">
          <label>
            <span>방식</span>
            <select data-field="inputMode" data-semester="${semester.key}" data-subject="${subject.id}">
              <option value="raw" ${subject.inputMode === 'raw' ? 'selected' : ''}>원점수</option>
              <option value="achievement" ${subject.inputMode === 'achievement' ? 'selected' : ''}>성취도</option>
              <option value="assessment" ${subject.inputMode === 'assessment' ? 'selected' : ''}>평가별</option>
            </select>
          </label>
          ${
            subject.inputMode === 'raw'
              ? `
                <label>
                  <span>원점수</span>
                  <input
                    type="number"
                    inputmode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value="${subject.rawScore ?? ''}"
                    data-field="rawScore"
                    data-semester="${semester.key}"
                    data-subject="${subject.id}"
                  />
                </label>
              `
              : subject.inputMode === 'achievement'
              ? renderAchievementSelect(semester, subject, achievements, '성취도')
              : `
                <div class="assessment-control">
                  <button
                    type="button"
                    class="assessment-toggle"
                    data-action="toggle-assessments"
                    data-semester="${semester.key}"
                    data-subject="${subject.id}"
                    aria-expanded="${isExpanded}"
                    aria-controls="assessment-details-${subject.id}"
                  >${isExpanded ? '세부 평가 접기' : '세부 평가 펼치기'}</button>
                  <span class="assessment-summary" data-assessment-summary="${subject.id}">${escapeHtml(renderAssessmentSummary(subject))}</span>
                </div>
              `
          }
        </div>

        <button
          type="button"
          class="icon-button"
          title="과목 삭제"
          aria-label="과목 삭제"
          data-action="remove-subject"
          data-semester="${semester.key}"
          data-subject="${subject.id}"
        >×</button>
      </div>
      ${subject.inputMode === 'assessment' ? renderAssessmentDetails(semester, subject, isExpanded) : ''}
    </div>
  `;
}

function renderAssessmentSummary(subject: SubjectInput): string {
  const result = calculateAssessmentRawScore(subject.assessments);
  if (result.rawScore === undefined) return result.errors[0] ?? '평가 점수를 입력하면 계산됩니다.';
  const score = scoreSubject(subject);
  const achievement = (subject.category === 'arts' ? ['', '', '', 'C', 'B', 'A'] : ['', 'E', 'D', 'C', 'B', 'A'])[score];
  return `원점수 ${result.rawScore}점 · 성취도 ${achievement}${result.provisional ? ' · 임시' : ''}`;
}

function renderAssessmentDetails(semester: SemesterInput, subject: SubjectInput, isExpanded: boolean): string {
  const assessments = subject.assessments ?? [];
  return `
    <section class="assessment-details" id="assessment-details-${subject.id}" aria-label="${escapeAttribute(subject.name || '과목')} 세부 평가" ${isExpanded ? '' : 'hidden'}>
      <p class="assessment-note">반영비율 합계 100% · 획득점수와 만점을 입력하세요. 인정 미응시는 남은 비율로 자동 환산하고, 미인정 미응시는 획득점수 0점으로 입력하세요.</p>
      <div class="assessment-list">
        ${assessments.map((assessment, index) => renderAssessmentItem(semester, subject, assessment, index, assessments.length)).join('')}
      </div>
      <button type="button" class="assessment-add" data-action="add-assessment" data-semester="${semester.key}" data-subject="${subject.id}">평가 추가</button>
    </section>
  `;
}

function renderAssessmentItem(
  semester: SemesterInput,
  subject: SubjectInput,
  assessment: AssessmentInput,
  index: number,
  count: number
): string {
  return `
    <div class="assessment-item" data-assessment-row="${assessment.id}">
      <div class="assessment-item-title">
        <strong>평가 ${index + 1}</strong>
        <div class="assessment-order-controls">
          <button type="button" class="icon-button" title="위로 이동" aria-label="${escapeAttribute(assessment.name || `평가 ${index + 1}`)} 위로 이동" data-action="move-assessment" data-direction="-1" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-button" title="아래로 이동" aria-label="${escapeAttribute(assessment.name || `평가 ${index + 1}`)} 아래로 이동" data-action="move-assessment" data-direction="1" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" ${index === count - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-button" title="평가 삭제" aria-label="${escapeAttribute(assessment.name || `평가 ${index + 1}`)} 평가 삭제" data-action="remove-assessment" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}">×</button>
        </div>
      </div>
      <label>
        <span>평가 이름</span>
        <input type="text" value="${escapeAttribute(assessment.name)}" data-field="assessmentName" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" />
      </label>
      <label>
        <span>반영비율 (%)</span>
        <input type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${assessment.weight ?? ''}" data-field="assessmentWeight" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" />
      </label>
      <label>
        <span>획득점수</span>
        <input type="number" inputmode="decimal" min="0" step="0.01" value="${assessment.score ?? ''}" data-assessment-input data-field="assessmentScore" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" ${assessment.excused ? 'disabled' : ''} />
      </label>
      <label>
        <span>만점</span>
        <input type="number" inputmode="decimal" min="0.01" step="0.01" value="${assessment.maxScore ?? ''}" data-assessment-input data-field="assessmentMaxScore" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" ${assessment.excused ? 'disabled' : ''} />
      </label>
      <label class="assessment-excused">
        <input type="checkbox" data-field="assessmentExcused" data-semester="${semester.key}" data-subject="${subject.id}" data-assessment="${assessment.id}" ${assessment.excused ? 'checked' : ''} />
        <span>인정 미응시</span>
      </label>
    </div>
  `;
}

function renderAchievementSelect(
  semester: SemesterInput,
  subject: SubjectInput,
  achievements: Achievement[],
  label: string
): string {
  return `
    <label>
      <span>${label}</span>
      <select data-field="achievement" data-semester="${semester.key}" data-subject="${subject.id}">
        <option value="" ${subject.achievement === undefined ? 'selected' : ''}>선택</option>
        ${achievements
          .map((achievement) => `<option value="${achievement}" ${subject.achievement === achievement ? 'selected' : ''}>${achievement}</option>`)
          .join('')}
      </select>
    </label>
  `;
}

function bindEvents(root: HTMLElement = appRoot): void {
  root.querySelector<HTMLInputElement>('[data-file-input]')?.addEventListener('change', handleFileLoad);
  root.querySelector<HTMLInputElement>('[data-attendance-field]')?.addEventListener('input', handleAttendanceChange);
  root.querySelectorAll<HTMLSelectElement>('[data-activity-grade]').forEach((select) => {
    select.addEventListener('change', handleAutonomousActivityChange);
  });
  root.querySelectorAll<HTMLSelectElement>('[data-club-grade]').forEach((select) => {
    select.addEventListener('change', handleClubActivityChange);
  });
  root.querySelectorAll<HTMLSelectElement>('[data-volunteer-grade]').forEach((select) => {
    select.addEventListener('change', handleVolunteerActivityChange);
  });
  root.querySelectorAll<HTMLInputElement>('[data-volunteer-bonus]').forEach((input) => {
    input.addEventListener('change', handleVolunteerBonusChange);
  });
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-field], select[data-field]').forEach((input) => {
    input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', handleFieldChange);
  });
  root.querySelectorAll<HTMLDetailsElement>('details.semester').forEach((details) => {
    details.addEventListener('toggle', () => {
      const key = details.dataset.semester;
      if (!key) return;
      if (details.open) expandedSemesters.add(key);
      else expandedSemesters.delete(key);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((button) => {
    button.addEventListener('click', handleAction);
  });
}

function updateResults(): void {
  const activeElement = document.activeElement;
  const anchor = activeElement instanceof HTMLElement && appRoot.contains(activeElement)
    ? activeElement
    : null;
  const previousTop = anchor?.getBoundingClientRect().top;
  const outcome = calculateFinalScore(state);
  const attendanceScore = getAttendanceScore();
  const volunteerScore = getVolunteerActivityScore();
  const totalScore = outcome.result && attendanceScore !== undefined
    && volunteerScore !== undefined
    ? roundToThree(outcome.result.finalScore + attendanceScore + getAutonomousActivityScore() + getClubActivityScore() + volunteerScore)
    : undefined;
  const scorePanel = appRoot.querySelector<HTMLElement>('.score-panel');
  const score = scorePanel?.querySelector('strong');
  const results = appRoot.querySelector<HTMLElement>('[data-results]');

  scorePanel?.classList.toggle('is-ready', totalScore !== undefined);
  if (score) {
    score.textContent = totalScore !== undefined ? totalScore.toFixed(3) : '--.---';
  }
  if (results) {
    results.innerHTML = renderSummary() + renderErrors(outcome.errors.map((error) => error.message));
  }
  const scoreLabel = scorePanel?.querySelector('span');
  if (scoreLabel) {
    scoreLabel.textContent = outcome.result?.semesters.some((semester) => semester.isForecast || semester.isProvisional) ? '예상 총점' : '총점';
  }
  const attendanceScoreElement = appRoot.querySelector<HTMLElement>('[data-attendance-score]');
  if (attendanceScoreElement) {
    attendanceScoreElement.textContent = `${attendanceScore === undefined ? '--' : attendanceScore} / ${ATTENDANCE_MAX_SCORE}`;
  }
  const volunteerScoreElement = appRoot.querySelector<HTMLElement>('.volunteer-heading > strong');
  if (volunteerScoreElement) {
    volunteerScoreElement.textContent = `${volunteerScore === undefined ? '--' : volunteerScore} / ${VOLUNTEER_ACTIVITY_MAX_SCORE}점`;
  }
  appRoot.querySelectorAll<HTMLElement>('[data-forecast]').forEach((element) => {
    const semester = state.find((item) => item.key === element.dataset.forecast);
    if (semester) element.textContent = renderForecastValue(semester);
  });
  appRoot.querySelectorAll<HTMLElement>('[data-semester-summary]').forEach((element) => {
    const semester = state.find((item) => item.key === element.dataset.semesterSummary);
    if (semester) element.textContent = renderSemesterStatus(semester);
  });
  appRoot.querySelectorAll<HTMLElement>('[data-assessment-summary]').forEach((element) => {
    const subjectId = element.dataset.assessmentSummary;
    const subject = subjectId ? state.flatMap((semester) => semester.subjects).find((item) => item.id === subjectId) : undefined;
    if (subject) element.textContent = renderAssessmentSummary(subject);
  });

  // Keep the active field in place when the result or error sections change height.
  if (anchor && previousTop !== undefined) {
    window.scrollBy(0, anchor.getBoundingClientRect().top - previousTop);
  }
}

function handleAttendanceChange(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const value = input.value.trim();
  const parsed = value === '' ? undefined : Number(value);
  unexcusedAbsenceDays = parsed !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : undefined;
  updateResults();
}

function handleAutonomousActivityChange(event: Event): void {
  const select = event.currentTarget as HTMLSelectElement;
  const gradeIndex = Number(select.dataset.activityGrade);
  const score = Number(select.value);
  if (Number.isInteger(gradeIndex) && gradeIndex >= 0 && gradeIndex < 3 && [2, 3, 4].includes(score)) {
    autonomousActivityScores[gradeIndex] = score;
    const total = appRoot.querySelector<HTMLElement>('.autonomous-heading > strong');
    if (total) total.textContent = `${getAutonomousActivityScore()} / ${AUTONOMOUS_ACTIVITY_MAX_SCORE}점`;
    updateResults();
  }
}

function handleClubActivityChange(event: Event): void {
  const select = event.currentTarget as HTMLSelectElement;
  const gradeIndex = Number(select.dataset.clubGrade);
  const score = Number(select.value);
  if (Number.isInteger(gradeIndex) && gradeIndex >= 0 && gradeIndex < 3 && [2, 3, 4].includes(score)) {
    clubActivityScores[gradeIndex] = score;
    const total = appRoot.querySelector<HTMLElement>('.club-heading > strong');
    if (total) total.textContent = `${getClubActivityScore()} / ${CLUB_ACTIVITY_MAX_SCORE}점`;
    updateResults();
  }
}

function handleVolunteerActivityChange(event: Event): void {
  const select = event.currentTarget as HTMLSelectElement;
  const gradeIndex = Number(select.dataset.volunteerGrade);
  const parsedScore = select.value === '' ? undefined : Number(select.value);
  const score = parsedScore !== undefined && [2, 3, 4].includes(parsedScore) ? parsedScore : undefined;
  if (Number.isInteger(gradeIndex) && gradeIndex >= 0 && gradeIndex < 3) {
    volunteerActivityScores[gradeIndex] = score;
    updateResults();
  }
}

function handleVolunteerBonusChange(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const gradeIndex = Number(input.dataset.volunteerBonus);
  if (Number.isInteger(gradeIndex) && gradeIndex >= 0 && gradeIndex < 3) {
    volunteerActivityBonuses[gradeIndex] = input.checked;
    updateResults();
  }
}

function handleFieldChange(event: Event): void {
  const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
  const field = target.dataset.field;
  const semesterKey = target.dataset.semester;
  const subjectId = target.dataset.subject;
  const assessmentId = target.dataset.assessment;

  if (!field || !semesterKey) {
    return;
  }

  const semester = state.find((item) => item.key === semesterKey);
  if (!semester) {
    return;
  }

  if (field === 'averageScore') {
    semester.averageScore = parseOptionalNumber(target.value);
    updateResults();
    return;
  }

  if (!subjectId) {
    return;
  }

  const subject = semester.subjects.find((item) => item.id === subjectId);
  if (!subject) {
    return;
  }

  if (field?.startsWith('assessment')) {
    const assessment = subject.assessments?.find((item) => item.id === assessmentId);
    if (!assessment) return;
    if (field === 'assessmentName') assessment.name = target.value;
    if (field === 'assessmentWeight') assessment.weight = parseOptionalNumber(target.value);
    if (field === 'assessmentScore') assessment.score = parseOptionalNumber(target.value);
    if (field === 'assessmentMaxScore') assessment.maxScore = parseOptionalNumber(target.value);
    if (field === 'assessmentExcused' && target instanceof HTMLInputElement) {
      assessment.excused = target.checked;
      const row = target.closest<HTMLElement>('.assessment-item');
      row?.querySelectorAll<HTMLInputElement>('[data-assessment-input]').forEach((input) => {
        input.disabled = target.checked;
      });
    }
    updateResults();
    return;
  }

  if (field === 'name') {
    subject.name = target.value;
  }

  if (field === 'category') {
    subject.category = target.value as SubjectCategory;
    if (subject.category === 'arts') {
      subject.inputMode = 'achievement';
      subject.rawScore = undefined;
      if (!ARTS_ACHIEVEMENTS.includes(subject.achievement ?? 'A')) {
        subject.achievement = undefined;
      }
    }
  }

  if (field === 'inputMode') {
    subject.inputMode = target.value as InputMode;
    if (subject.inputMode === 'assessment' && subject.assessments === undefined) {
      subject.assessments = createDefaultAssessments(subject);
    }
  }

  if (field === 'rawScore') {
    subject.rawScore = parseOptionalNumber(target.value);
  }

  if (field === 'achievement') {
    subject.achievement = target.value === '' ? undefined : target.value as Achievement;
  }

  if (field === 'category' || field === 'inputMode') {
    const row = target.closest<HTMLElement>('.subject-entry');
    if (row) {
      const previousTop = row.getBoundingClientRect().top;
      const template = document.createElement('template');
      template.innerHTML = renderSubjectRow(semester, subject);
      const replacement = template.content.firstElementChild as HTMLElement;
      row.replaceWith(replacement);
      bindEvents(replacement);
      replacement.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus({ preventScroll: true });
      window.scrollBy(0, replacement.getBoundingClientRect().top - previousTop);
    }
  }

  updateResults();
}

function handleAction(event: Event): void {
  const button = event.currentTarget as HTMLButtonElement;
  const action = button.dataset.action;
  const semesterKey = button.dataset.semester;
  const subjectId = button.dataset.subject;
  const assessmentId = button.dataset.assessment;

  if (action === 'feedback') {
    appRoot.querySelector<HTMLDialogElement>('[data-feedback-dialog]')?.showModal();
    return;
  }

  if (action === 'close-feedback') {
    appRoot.querySelector<HTMLDialogElement>('[data-feedback-dialog]')?.close();
    return;
  }

  if (action === 'forecast-empty') {
    let count = 0;
    state.forEach((semester) => {
      const isEmpty = semester.mode === 'average'
        ? semester.averageScore === undefined
        : semester.mode === 'subjects' && semester.subjects.every((subject) =>
          !subjectHasInput(subject));
      if (isEmpty && calculateForecast(state, semester.key).averageScore !== undefined) {
        semester.mode = 'forecast';
        count++;
      }
    });
    if (count > 0) {
      render();
      setFileStatus(`${count}개 미입력 학기를 예상했습니다.`);
    } else {
      setFileStatus('예상할 빈 학기가 없거나, 기준이 되는 이전 학기의 성적 입력이 완료되지 않았습니다.', true);
    }
    return;
  }

  if (action === 'save') {
    saveFile();
    return;
  }

  if (action === 'load') {
    appRoot.querySelector<HTMLInputElement>('[data-file-input]')?.click();
    return;
  }

  if (action === 'fill-example') {
    fillExample();
    render();
    return;
  }

  if (action === 'reset') {
    resetState();
    render();
    return;
  }

  if (!semesterKey) {
    return;
  }

  const semester = state.find((item) => item.key === semesterKey);
  if (!semester) {
    return;
  }

  if (action === 'set-semester-mode') {
    semester.mode = button.dataset.mode as SemesterInputMode;
  }

  if (action === 'add-subject') {
    semester.subjects.push(createSubject());
  }

  if (action === 'remove-subject' && subjectId) {
    semester.subjects = semester.subjects.filter((subject) => subject.id !== subjectId);
    expandedAssessmentSubjects.delete(subjectId);
  }

  if (subjectId && action === 'toggle-assessments') {
    if (expandedAssessmentSubjects.has(subjectId)) expandedAssessmentSubjects.delete(subjectId);
    else expandedAssessmentSubjects.add(subjectId);
    renderAtScrollPosition();
    return;
  }

  if (subjectId && action === 'add-assessment') {
    const subject = semester.subjects.find((item) => item.id === subjectId);
    if (subject) {
      subject.assessments ??= [];
      subject.assessments.push(createAssessment('새 평가', 0));
      expandedAssessmentSubjects.add(subjectId);
    }
  }

  if (subjectId && assessmentId && action === 'remove-assessment') {
    const subject = semester.subjects.find((item) => item.id === subjectId);
    if (subject) subject.assessments = (subject.assessments ?? []).filter((item) => item.id !== assessmentId);
  }

  if (subjectId && assessmentId && action === 'move-assessment') {
    const subject = semester.subjects.find((item) => item.id === subjectId);
    const assessments = subject?.assessments;
    const index = assessments?.findIndex((item) => item.id === assessmentId) ?? -1;
    const targetIndex = index + Number(button.dataset.direction ?? 0);
    if (assessments && index >= 0 && targetIndex >= 0 && targetIndex < assessments.length) {
      [assessments[index], assessments[targetIndex]] = [assessments[targetIndex], assessments[index]];
    }
  }

  renderAtScrollPosition();
}

function renderAtScrollPosition(): void {
  const scrollY = window.scrollY;
  render();
  window.scrollTo(0, scrollY);
}

function subjectHasInput(subject: SubjectInput): boolean {
  if (subject.inputMode === 'assessment') {
    return (subject.assessments ?? []).some((item) =>
      item.excused || item.score !== undefined
    );
  }
  return subject.inputMode === 'raw'
    ? subject.rawScore !== undefined
    : subject.achievement !== undefined;
}

function saveFile(): void {
  let url: string | undefined;
  try {
    const blob = new Blob([serializeScores(
      state,
      unexcusedAbsenceDays,
      autonomousActivityScores,
      clubActivityScores,
      volunteerActivityScores,
      volunteerActivityBonuses
    )], { type: 'application/json;charset=utf-8' });
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const now = new Date();
    const timestamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((value) => String(value).padStart(2, '0')).join('-');
    link.href = url;
    link.download = `school-scores-${timestamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setFileStatus('성적 파일 다운로드를 요청했습니다.');
  } catch {
    setFileStatus('성적 파일을 저장하지 못했습니다. 다시 시도해 주세요.', true);
  } finally {
    if (url) {
      const downloadUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  }
}

async function handleFileLoad(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setFileStatus('2MB 이하의 성적 파일을 선택해 주세요. 기존 입력은 유지됩니다.', true);
    return;
  }

  try {
    const parsed = parseScoreFile(await file.text());
    state = parsed.semesters;
    expandedAssessmentSubjects.clear();
    unexcusedAbsenceDays = parsed.unexcusedAbsenceDays;
    autonomousActivityScores = parsed.autonomousActivityScores;
    clubActivityScores = parsed.clubActivityScores;
    volunteerActivityScores = parsed.volunteerActivityScores;
    volunteerActivityBonuses = parsed.volunteerActivityBonuses;
    render();
    setFileStatus(`${file.name} 파일을 불러왔습니다.`);
  } catch (error) {
    const message = error instanceof SyntaxError
      ? 'JSON 파일 형식이 올바르지 않습니다.'
      : error instanceof Error ? error.message : '성적 파일을 불러오지 못했습니다.';
    setFileStatus(`${message} 기존 입력은 유지됩니다.`, true);
  }
}

function setFileStatus(message: string, isError = false): void {
  const status = appRoot.querySelector<HTMLElement>('[data-file-status]');
  if (status) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }
}

function fillExample(): void {
  state = createDefaultState();
  expandedAssessmentSubjects.clear();
  unexcusedAbsenceDays = 0;
  autonomousActivityScores = [3, 3, 3];
  clubActivityScores = [3, 3, 3];
  volunteerActivityScores = [4, 4, 4];
  volunteerActivityBonuses = [true, true, true];
  state.forEach((semester) => {
    if (semester.mode === 'free') return;
    semester.subjects.forEach((subject, index) => {
      if (subject.inputMode === 'assessment') {
        (subject.assessments ?? []).forEach((assessment) => {
          if (!assessment.excused) assessment.score = (assessment.maxScore ?? 100) * (0.85 + (index % 3) * 0.05);
        });
      } else if (subject.category === 'arts') {
        subject.achievement = index % 2 === 0 ? 'A' : 'B';
      } else {
        subject.rawScore = 85 + (index % 3) * 5;
      }
    });
  });
}

function resetState(): void {
  state = createDefaultState();
  expandedAssessmentSubjects.clear();
  expandedSemesters.clear();
  unexcusedAbsenceDays = 0;
  autonomousActivityScores = [3, 3, 3];
  clubActivityScores = [3, 3, 3];
  volunteerActivityScores = [4, 4, 4];
  volunteerActivityBonuses = [false, false, false];
}

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

render();
