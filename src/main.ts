import './styles.css';
import { parseScores, serializeScores } from './storage';
import {
  Achievement,
  InputMode,
  SEMESTERS,
  SemesterInput,
  SemesterInputMode,
  SubjectCategory,
  SubjectInput,
  calculateFinalScore,
  calculateForecast
} from './scoring';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('앱을 렌더링할 영역을 찾을 수 없습니다.');
}

const appRoot = app;

const GENERAL_ACHIEVEMENTS: Achievement[] = ['A', 'B', 'C', 'D', 'E'];
const ARTS_ACHIEVEMENTS: Achievement[] = ['A', 'B', 'C'];
const DEFAULT_SUBJECTS: Record<string, string[]> = {
  '1': ['국어', '사회', '도덕', '수학', '과학', '기술·가정', '영어', '체육', '음악', '미술'],
  '2': ['국어', '사회', '도덕', '수학', '과학', '정보', '영어', '한문', '체육', '음악', '미술'],
  '3': ['국어', '사회', '역사', '수학', '과학', '기술·가정', '영어', '진로와 직업', '과제탐구', '체육', '음악', '미술']
};
const ARTS_SUBJECTS = new Set(['체육', '음악', '미술']);

let nextSubjectId = 1;
let state: SemesterInput[] = createDefaultState();

function createDefaultState(): SemesterInput[] {
  return SEMESTERS.map((semester) => ({
    key: semester.key,
    mode: 'subjects',
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

function render(): void {
  const outcome = calculateFinalScore(state);
  const result = outcome.result;

  appRoot.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">240점 만점</p>
        <h1>중학교 교과성적 환산 점수 계산기</h1>
      </div>
      <div class="score-panel ${result ? 'is-ready' : ''}">
        <span>${state.some((semester) => semester.mode === 'forecast') ? '예상 최종 점수' : '최종 점수'}</span>
        <strong>${result ? result.finalScore.toFixed(3) : '--.---'}</strong>
      </div>
    </header>

    <main>
      <section class="toolbar" aria-label="계산 도구">
        <button type="button" data-action="forecast-empty">미입력 학기 예상</button>
        <button type="button" data-action="save">저장</button>
        <button type="button" data-action="load">불러오기</button>
        <input type="file" accept=".json,application/json" data-file-input aria-label="성적 파일 선택" hidden />
        <button type="button" data-action="fill-example">예시 입력</button>
        <button type="button" data-action="reset">초기화</button>
      </section>
      <p class="file-status" data-file-status role="status" aria-live="polite"></p>

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

  if (!result) {
    return `
      <section class="summary-grid" aria-label="점수 요약">
        <div><span>기본점수</span><strong>96.000</strong></div>
        <div><span>실질 반영점수</span><strong>--.---</strong></div>
        <div><span>최종 환산점수</span><strong>--.---</strong></div>
      </section>
    `;
  }

  return `
    <section class="summary-grid" aria-label="점수 요약">
      <div><span>기본점수</span><strong>${result.baseScore.toFixed(3)}</strong></div>
      <div><span>실질 반영점수</span><strong>${result.reflectedScore.toFixed(3)}</strong></div>
      <div><span>${result.semesters.some((semester) => semester.isForecast) ? '예상 최종 환산점수' : '최종 환산점수'}</span><strong>${result.finalScore.toFixed(3)}</strong></div>
    </section>

    <section class="breakdown" aria-label="학기별 반영 점수">
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
                  <td>${semester.label}${semester.isForecast ? ' (예상)' : ''}</td>
                  <td>${semester.averageScore.toFixed(3)}</td>
                  <td>${semester.weightedScore.toFixed(3)}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `;
}

function renderErrors(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  if (errors.every((error) =>
    error.includes('입력해 주세요.') || error.includes('성취도만 입력할 수 있습니다.')
  )) {
    return `
      <section class="errors" aria-label="입력 안내">
        <p>미입력 항목 ${errors.length}개 · 성적을 입력하면 점수가 계산됩니다.</p>
      </section>
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
        <p>대체 학기에도 입력된 성적이 없으면 1·2학기 대체 규칙을 따라 다른 입력 완료 학기를 찾습니다. 예상으로 지정한 학기는 대체 기준으로 사용하지 않습니다. 계산기에 없는 1학년 1학기 성적은 같은 학년 2학기(1학년 2학기) 성적으로 대체합니다.</p>
      </div>
    </details>
  `;
}

function renderSemester(semester: SemesterInput): string {
  const config = SEMESTERS.find((item) => item.key === semester.key);
  const label = config?.label ?? semester.key;

  return `
    <section class="semester" data-semester="${semester.key}">
      <div class="semester-header">
        <h2>${label}</h2>
        <div class="mode-toggle" role="group" aria-label="${label} 입력 방식">
          ${renderModeButton(semester, 'subjects', '과목별')}
          ${renderModeButton(semester, 'average', '평균')}
          ${renderModeButton(semester, 'forecast', '예상')}
        </div>
      </div>

      ${
        semester.mode === 'forecast'
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
    </section>
  `;
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

  return `
    <div class="subject-row" data-subject="${subject.id}">
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

      ${
        isArts
          ? renderAchievementSelect(semester, subject, achievements, '성취도')
          : `
            <div class="general-input">
              <label>
                <span>방식</span>
                <select data-field="inputMode" data-semester="${semester.key}" data-subject="${subject.id}">
                  <option value="raw" ${subject.inputMode === 'raw' ? 'selected' : ''}>원점수</option>
                  <option value="achievement" ${subject.inputMode === 'achievement' ? 'selected' : ''}>성취도</option>
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
                  : renderAchievementSelect(semester, subject, achievements, '성취도')
              }
            </div>
          `
      }

      <button
        type="button"
        class="icon-button"
        title="삭제"
        aria-label="삭제"
        data-action="remove-subject"
        data-semester="${semester.key}"
        data-subject="${subject.id}"
      >×</button>
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
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[data-field], select[data-field]').forEach((input) => {
    input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', handleFieldChange);
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
  const scorePanel = appRoot.querySelector<HTMLElement>('.score-panel');
  const score = scorePanel?.querySelector('strong');
  const results = appRoot.querySelector<HTMLElement>('[data-results]');

  scorePanel?.classList.toggle('is-ready', Boolean(outcome.result));
  if (score) {
    score.textContent = outcome.result ? outcome.result.finalScore.toFixed(3) : '--.---';
  }
  if (results) {
    results.innerHTML = renderSummary() + renderErrors(outcome.errors.map((error) => error.message));
  }
  const scoreLabel = scorePanel?.querySelector('span');
  if (scoreLabel) {
    scoreLabel.textContent = state.some((semester) => semester.mode === 'forecast') ? '예상 최종 점수' : '최종 점수';
  }
  appRoot.querySelectorAll<HTMLElement>('[data-forecast]').forEach((element) => {
    const semester = state.find((item) => item.key === element.dataset.forecast);
    if (semester) element.textContent = renderForecastValue(semester);
  });

  // Keep the active field in place when the result or error sections change height.
  if (anchor && previousTop !== undefined) {
    window.scrollBy(0, anchor.getBoundingClientRect().top - previousTop);
  }
}

function handleFieldChange(event: Event): void {
  const target = event.currentTarget as HTMLInputElement | HTMLSelectElement;
  const field = target.dataset.field;
  const semesterKey = target.dataset.semester;
  const subjectId = target.dataset.subject;

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
  }

  if (field === 'rawScore') {
    subject.rawScore = parseOptionalNumber(target.value);
  }

  if (field === 'achievement') {
    subject.achievement = target.value === '' ? undefined : target.value as Achievement;
  }

  if (field === 'category' || field === 'inputMode') {
    const row = target.closest<HTMLElement>('.subject-row');
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

  if (action === 'forecast-empty') {
    let count = 0;
    state.forEach((semester) => {
      const isEmpty = semester.mode === 'average'
        ? semester.averageScore === undefined
        : semester.mode === 'subjects' && semester.subjects.every((subject) =>
          subject.category === 'general' && subject.inputMode === 'raw'
            ? subject.rawScore === undefined
            : subject.achievement === undefined);
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
  }

  render();
}

function saveFile(): void {
  let url: string | undefined;
  try {
    const blob = new Blob([serializeScores(state)], { type: 'application/json;charset=utf-8' });
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
    state = parseScores(await file.text());
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
  state.forEach((semester) => {
    semester.subjects.forEach((subject, index) => {
      if (subject.category === 'arts') {
        subject.achievement = index % 2 === 0 ? 'A' : 'B';
      } else {
        subject.rawScore = 85 + (index % 3) * 5;
      }
    });
  });
}

function resetState(): void {
  state = createDefaultState();
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
