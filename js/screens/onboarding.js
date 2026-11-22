// 온보딩 (처음 실행 · 설정에서 수정)
// 1 목표·경험 → 2 일정 → 3 피할 부위 → 4 생리 주기 → (수정일 때) 5 프로그램 다시 추천할지
import { catalog, AVOID_PARTS } from '../catalog.js';
import { getProfile, getProgram, saveProfile, saveCycleStart } from '../store.js';
import { db } from '../db.js';
import { esc, toast, todayStr } from '../ui.js';

const GOALS = [
  ['fatloss', '체지방 감량', '땀 흘리며 가볍게, 타바타 자주'],
  ['shape', '체형', '원하는 부위를 탄탄하게'],
  ['strength', '근력', '무게를 늘려가며 힘 키우기'],
  ['fitness', '체력', '덜 지치는 몸 만들기']
];
const FOCUS = [['lower_glute', '하체·엉덩이'], ['upper_line', '상체·라인'], ['balance', '균형 있게']];
const EXPERIENCE = [[1, '처음이에요', '기구 사용법부터 알려드려요'], [2, '조금 해봤어요', '몇 달 정도'], [3, '1년 이상', '대부분의 기구를 써봤어요']];
const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

let state = null; // { step, editing, hadProgram, d: draft }

function defaults() {
  const { templates } = catalog();
  return {
    goal: null, focus: 'balance', experience: null,
    daysPerWeek: 3, minutes: 45, preferredDays: [...templates.defaultDays['3']],
    avoid: [], cycleStart: '', cycleLength: 28, periodLength: 5, cycleSkipped: false,
    cycleSuggestions: true,
    tabataDefault: { work: 20, rest: 10, rounds: 8, sets: 1, prep: 10, setRest: 60 },
    sound: true, vibration: true
  };
}

function choice(name, value, label, sub, checked) {
  return `
    <label class="choice ${checked ? 'on' : ''}">
      <input type="radio" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}>
      <span><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    </label>`;
}

function progressBar(step, total) {
  return `<div class="steps" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<span class="${i < step ? 'on' : ''}"></span>`).join('')}</div>
    <p class="muted">${step} / ${total}</p>`;
}

function stepGoal(d) {
  return `
    <h1>어떤 운동을 원하세요?</h1>
    <fieldset class="field"><legend>목표</legend>
      <div class="choices">${GOALS.map(([v, l, s]) => choice('goal', v, l, s, d.goal === v)).join('')}</div>
    </fieldset>
    ${d.goal === 'shape' ? `
    <fieldset class="field"><legend>집중하고 싶은 부위</legend>
      <div class="chips">${FOCUS.map(([v, l]) => `<label class="check chip-check"><input type="radio" name="focus" value="${v}" ${d.focus === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    </fieldset>` : ''}
    <fieldset class="field"><legend>운동 경험</legend>
      <div class="choices">${EXPERIENCE.map(([v, l, s]) => choice('experience', v, l, s, d.experience === v)).join('')}</div>
    </fieldset>`;
}

function stepSchedule(d) {
  const { templates } = catalog();
  const split = templates.splits[String(d.preferredDays.length)];
  const days = WEEK_ORDER.filter((x) => d.preferredDays.includes(x));
  const preview = split ? days.map((day, i) => `${DAY_LABEL[day]} ${templates.routines[split[i]].name}`).join(' · ') : '';
  return `
    <h1>일주일에 몇 번, 얼마나 할 수 있나요?</h1>
    <fieldset class="field"><legend>주 몇 회</legend>
      <div class="seg">${[2, 3, 4, 5].map((n) => `<button type="button" class="chip" data-count="${n}" aria-pressed="${d.preferredDays.length === n}">${n}회</button>`).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>운동할 요일 (눌러서 바꿀 수 있어요)</legend>
      <div class="seg days">${WEEK_ORDER.map((x) => `<button type="button" class="chip" data-day="${x}" aria-pressed="${d.preferredDays.includes(x)}">${DAY_LABEL[x]}</button>`).join('')}</div>
      <p class="warn" id="day-msg" hidden></p>
    </fieldset>
    <fieldset class="field"><legend>회당 시간</legend>
      <div class="seg">${[30, 45, 60].map((n) => `<button type="button" class="chip" data-min="${n}" aria-pressed="${d.minutes === n}">${n}분</button>`).join('')}</div>
    </fieldset>
    <div class="card">
      <p class="muted">이렇게 짜드릴게요</p>
      <p><b>${esc(preview)}</b></p>
      <p class="muted">나머지 날은 휴식일이에요. 운동을 못 한 날이 있으면 다음 운동일로 이어져요.</p>
    </div>`;
}

function stepAvoid(d) {
  return `
    <h1>불편한 부위가 있나요?</h1>
    <p class="muted">고른 부위에 부담이 가는 동작은 추천하지 않아요.</p>
    <div class="chips">
      ${AVOID_PARTS.map((p) => `<label class="check chip-check"><input type="checkbox" name="avoid" value="${p}" ${d.avoid.includes(p) ? 'checked' : ''}> ${p}</label>`).join('')}
    </div>
    <p class="muted">없으면 아무것도 고르지 않고 다음으로 넘어가세요.</p>`;
}

function stepCycle(d) {
  return `
    <h1>생리 주기를 알려주세요</h1>
    <p class="muted">주기에 맞춰 운동 강도를 제안해 드려요. 정보는 이 휴대폰에만 저장돼요.</p>
    <label class="field">최근 생리 시작일
      <input type="date" name="cycleStart" max="${todayStr()}" value="${esc(d.cycleStart)}">
    </label>
    <div class="row">
      <label class="field">평균 주기(일)
        <input type="number" name="cycleLength" inputmode="numeric" min="20" max="45" value="${esc(d.cycleLength)}">
      </label>
      <label class="field">생리 기간(일)
        <input type="number" name="periodLength" inputmode="numeric" min="2" max="10" value="${esc(d.periodLength)}">
      </label>
    </div>
    <p class="muted">잘 모르면 기본값 그대로 두세요. 기록이 쌓이면 자동으로 맞춰져요.</p>
    <button type="button" class="btn" id="skip-cycle">지금은 건너뛰기</button>`;
}

function stepRegen() {
  return `
    <h1>프로그램을 어떻게 할까요?</h1>
    <div class="choices">
      ${choice('regen', 'yes', '새 프로그램으로 다시 추천', '바뀐 설정에 맞춰 루틴을 새로 짜요. 지난 기록과 무게는 그대로 남아요.', state.regen === 'yes')}
      ${choice('regen', 'no', '내가 수정한 루틴 유지', '설정만 저장하고 루틴은 그대로 둬요.', state.regen === 'no')}
    </div>`;
}

function canNext(step, d) {
  if (step === 1) return d.goal && d.experience;
  if (step === 2) return d.preferredDays.length >= 2 && d.preferredDays.length <= 5;
  if (step === 5) return !!state.regen;
  return true;
}

export async function render(el) {
  if (!state) {
    const profile = await getProfile();
    const program = await getProgram();
    const d = { ...defaults(), ...(profile || {}) };
    if (profile) {
      const last = await db.cycles.orderBy('startDate').last();
      d.cycleStart = last?.startDate || '';
    }
    state = { step: 1, editing: !!profile, hadProgram: !!program, regen: null, d };
  }
  const { d } = state;
  const total = state.editing && state.hadProgram ? 5 : 4;
  const step = state.step;
  const body = [null, stepGoal, stepSchedule, stepAvoid, stepCycle, stepRegen][step](d);
  const last = step === total;

  el.innerHTML = `
    ${state.editing ? '<a href="#/settings" class="back" id="cancel">← 취소</a>' : ''}
    ${progressBar(step, total)}
    <form class="onb" novalidate>
      ${body}
      <div class="row nav-row">
        ${step > 1 ? '<button type="button" class="btn" id="prev">이전</button>' : ''}
        <button type="submit" class="btn primary" ${canNext(step, d) ? '' : 'disabled'}>${last ? (state.editing ? '저장' : '프로그램 만들기') : '다음'}</button>
      </div>
    </form>`;

  const form = el.querySelector('form');
  const rerender = () => render(el);

  form.querySelectorAll('input[name=goal]').forEach((i) => i.addEventListener('change', () => { d.goal = i.value; rerender(); }));
  form.querySelectorAll('input[name=focus]').forEach((i) => i.addEventListener('change', () => { d.focus = i.value; }));
  form.querySelectorAll('input[name=experience]').forEach((i) => i.addEventListener('change', () => { d.experience = Number(i.value); rerender(); }));
  form.querySelectorAll('input[name=regen]').forEach((i) => i.addEventListener('change', () => { state.regen = i.value; rerender(); }));
  form.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.count);
    d.preferredDays = [...catalog().templates.defaultDays[String(n)]];
    d.daysPerWeek = n; rerender();
  }));
  form.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    const x = Number(b.dataset.day);
    const next = d.preferredDays.includes(x) ? d.preferredDays.filter((y) => y !== x) : [...d.preferredDays, x];
    const msg = el.querySelector('#day-msg');
    if (next.length < 2 || next.length > 5) {
      msg.textContent = next.length < 2 ? '최소 주 2회는 골라주세요.' : '주 5회까지 고를 수 있어요.';
      msg.hidden = false; return;
    }
    d.preferredDays = next; d.daysPerWeek = next.length; rerender();
  }));
  form.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => { d.minutes = Number(b.dataset.min); rerender(); }));
  form.querySelectorAll('input[name=avoid]').forEach((i) => i.addEventListener('change', () => {
    d.avoid = [...form.querySelectorAll('input[name=avoid]:checked')].map((x) => x.value);
  }));

  const readCycle = () => {
    if (!form.cycleStart) return;
    d.cycleStart = form.cycleStart.value;
    d.cycleLength = Math.min(45, Math.max(20, Number(form.cycleLength.value) || 28));
    d.periodLength = Math.min(10, Math.max(2, Number(form.periodLength.value) || 5));
  };

  el.querySelector('#prev')?.addEventListener('click', () => { readCycle(); state.step--; rerender(); });
  el.querySelector('#cancel')?.addEventListener('click', () => { state = null; });
  el.querySelector('#skip-cycle')?.addEventListener('click', () => {
    d.cycleStart = ''; d.cycleSkipped = true;
    if (last) finish(); else { state.step++; rerender(); }
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    readCycle();
    if (step === 4 && d.cycleStart) d.cycleSkipped = false;
    if (!canNext(step, d)) return;
    if (last) finish(); else { state.step++; rerender(); }
  });
}

async function finish() {
  const { d, editing, hadProgram } = state;
  const regenerate = !(editing && hadProgram) || state.regen === 'yes';
  const { cycleStart, cycleSkipped, ...rest } = d;
  const profile = {
    ...rest, id: 'me',
    daysPerWeek: d.preferredDays.length,
    focus: d.goal === 'shape' ? d.focus : null,
    cycleSkipped: !!cycleSkipped && !cycleStart,
    onboardedAt: d.onboardedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveProfile(profile, { regenerate });
  if (cycleStart) await saveCycleStart(cycleStart, d.periodLength);
  state = null;
  toast(regenerate ? '프로그램을 만들었어요' : '설정을 저장했어요');
  location.hash = regenerate ? '#/program' : '#/settings';
}

// 다른 화면으로 나갔다 오면 처음부터
export function reset() { state = null; }
