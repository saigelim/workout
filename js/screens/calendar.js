// 캘린더: 운동 완료·계획·놓침·휴식 · 생리 기간/예정 · 날짜별 기록 · 휴식일/운동일 바꾸기 · 생리 기록
import { db } from '../db.js';
import { catalog } from '../catalog.js';
import { cycleInfo } from '../cycle.js';
import { saveCycleStart } from '../store.js';
import { loadContext, planAhead, dayStatus, setOverride, isWorkoutDay, addDays, parse, ds, DAY } from '../schedule.js';
import { esc, toast } from '../ui.js';

let view = null;   // { y, m }
let sel = null;    // 선택한 날짜

export function reset() { /* 보던 달·날짜는 유지 */ }

async function periodDays(info) {
  const logs = await db.cycles.toArray();
  const real = new Set();
  for (const l of logs) {
    for (let d = l.startDate; d <= (l.endDate || l.startDate); d = addDays(d, 1)) real.add(d);
  }
  const predicted = new Set();
  if (info?.nextStart) {
    let start = ds(info.nextStart);
    for (let k = 0; k < 3; k++) { // 앞으로 3번까지 예측
      for (let i = 0; i < info.periodLength; i++) predicted.add(addDays(start, i));
      start = addDays(start, info.cycleLength);
    }
  }
  return { real, predicted, logs };
}

function summarize(s, byId) {
  const lines = s.exercises.filter((x) => !x.skipped).map((x) => {
    const e = byId[x.exerciseId];
    const sets = x.sets.map((t) => (t.weight != null && e?.loadType !== 'bodyweight' && e?.loadType !== 'time' ? `${t.weight}kg×${t.reps}` : `${t.reps}${e?.loadType === 'time' ? '초' : '회'}`)).join(' · ');
    const rate = { easy: '쉬움', ok: '적당', hard: '힘듦' }[x.rating] || '';
    return `<li><b>${esc(x.name)}</b> ${esc(sets)}${rate ? ` <span class="muted">· ${rate}</span>` : ''}</li>`;
  });
  if (s.tabata) lines.push(`<li><b>타바타</b> ${s.tabata.roundsDone} / ${s.tabata.roundsPlanned}라운드${s.tabata.names?.length ? ` <span class="muted">· ${esc(s.tabata.names.join(', '))}</span>` : ''}</li>`);
  const mins = Math.max(1, Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000));
  const kind = s.kind === 'extra' ? ' (추가)' : s.kind === 'free' ? '' : '';
  return `<div class="day-session"><p><b>${esc(s.routineName)}${kind}</b> <span class="muted">${mins}분</span></p><ul class="tips">${lines.join('')}</ul></div>`;
}

export async function render(el) {
  const ctx = await loadContext();
  const { byId } = catalog();
  const { today, routines, profile } = ctx;
  if (!view) { const t = parse(today); view = { y: t.getFullYear(), m: t.getMonth() }; }
  if (!sel) sel = today;

  const plan = planAhead(ctx, 120);
  const info = profile ? await cycleInfo(profile) : null;
  const { real, predicted, logs } = await periodDays(info);

  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // 월요일 시작
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  let monthDone = 0;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let n = 1; n <= daysInMonth; n++) {
    const d = ds(new Date(view.y, view.m, n));
    const st = dayStatus(ctx, d, plan);
    if (st.status === 'done' && st.sessions.some((s) => s.kind === 'program')) monthDone++;
    const bar = real.has(d) ? 'period' : predicted.has(d) && d > today ? 'predicted' : '';
    cells.push(`
      <button type="button" class="cal-day ${st.status} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}" data-d="${d}" aria-label="${view.m + 1}월 ${n}일 ${{ done: '운동 완료', planned: '운동 계획', missed: '놓침', skipped: '건너뜀', rest: '휴식', before: '' }[st.status]}${bar === 'period' ? ', 생리' : bar === 'predicted' ? ', 생리 예정' : ''}">
        <span class="num">${n}</span><span class="bar ${bar}"></span>
      </button>`);
  }

  // 선택한 날짜 상세
  const st = dayStatus(ctx, sel, plan);
  const selD = parse(sel);
  const isStart = logs.find((l) => l.startDate === sel);
  const inPeriodOf = logs.find((l) => sel > l.startDate && sel <= addDays(l.startDate, 10));
  let detail = '';
  if (st.status === 'done') detail = st.sessions.map((s) => summarize(s, byId)).join('');
  else if (st.status === 'planned') detail = `<p>계획: <b>${esc(routines[st.routineId]?.name || '')}</b></p>`;
  else if (st.status === 'missed') detail = '<p class="muted">운동을 못 한 날이에요. 빠진 운동은 다음 운동일로 이어졌어요.</p>';
  else if (st.status === 'skipped') detail = '<p class="muted">건너뛴 날이에요.</p>';
  else if (st.status === 'rest') detail = '<p class="muted">휴식일</p>';
  else detail = '<p class="muted">프로그램 시작 전</p>';

  const canToggle = sel >= today && ctx.program && !(st.status === 'done');
  const workoutDay = isWorkoutDay(ctx, sel);
  const actions = `
    <div class="row">
      ${canToggle ? `<button type="button" class="btn" id="toggle-day">${workoutDay ? '휴식일로 바꾸기' : '운동일로 바꾸기'}</button>` : ''}
      ${sel <= today ? (isStart
        ? '<button type="button" class="btn period-btn" id="cycle-del">생리 시작 기록 지우기</button>'
        : `<button type="button" class="btn period-btn" id="cycle-add">생리 시작 기록</button>`) : ''}
    </div>
    ${inPeriodOf && !isStart && sel <= today ? `<button type="button" class="btn small" id="cycle-end">이날까지 생리였어요</button>` : ''}
    ${ctx.ov[sel] && sel >= today ? '<button type="button" class="btn small" id="clear-ov">원래 일정으로 되돌리기</button>' : ''}`;

  el.innerHTML = `
    <div class="head-row">
      <button type="button" class="btn small" id="prev" aria-label="이전 달">‹</button>
      <h1>${view.y}년 ${view.m + 1}월</h1>
      <button type="button" class="btn small" id="next" aria-label="다음 달">›</button>
    </div>
    <div class="card cal">
      <div class="cal-grid cal-head">${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>
    <div class="legend">
      <span><i class="lg done"></i>운동 완료</span><span><i class="lg planned"></i>계획</span><span><i class="lg missed"></i>놓침</span>
      <span><i class="lg-bar period"></i>생리</span><span><i class="lg-bar predicted"></i>생리 예정</span>
    </div>
    <p class="muted">이번 달 운동 ${monthDone}회${info?.nextStart ? ` · 다음 생리 예정 ${info.nextStart.getMonth() + 1}/${info.nextStart.getDate()} (평균 ${info.cycleLength}일 주기)` : ''}</p>
    <div class="card">
      <h2>${selD.getMonth() + 1}월 ${selD.getDate()}일 (${DAY[selD.getDay()]})${sel === today ? ' · 오늘' : ''}</h2>
      ${detail}
      ${actions}
    </div>`;

  const again = async () => { const y = scrollY; await render(el); scrollTo(0, y); };
  el.querySelector('#prev').addEventListener('click', () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } again(); });
  el.querySelector('#next').addEventListener('click', () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } again(); });
  el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.d; again(); }));
  el.querySelector('#toggle-day')?.addEventListener('click', async () => {
    const usual = (profile.preferredDays || []).includes(selD.getDay());
    const want = workoutDay ? 'rest' : 'workout';
    // 원래 그 요일 규칙과 같아지면 예외를 지우고, 다르면 예외로 저장
    await setOverride(sel, (want === 'workout') === usual ? null : want);
    toast(want === 'rest' ? '휴식일로 바꿨어요. 이후 일정이 밀려요' : '운동일로 바꿨어요. 이후 일정이 당겨져요', 2500);
    again();
  });
  el.querySelector('#clear-ov')?.addEventListener('click', async () => { await setOverride(sel, null); again(); });
  el.querySelector('#cycle-add')?.addEventListener('click', async () => {
    await saveCycleStart(sel, profile?.periodLength || 5); toast('생리 시작을 기록했어요'); again();
  });
  el.querySelector('#cycle-del')?.addEventListener('click', async () => { await db.cycles.delete(sel); toast('지웠어요'); again(); });
  el.querySelector('#cycle-end')?.addEventListener('click', async () => {
    await db.cycles.put({ ...inPeriodOf, endDate: sel }); toast('생리 기간을 고쳤어요'); again();
  });
}
