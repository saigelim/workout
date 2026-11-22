// 오늘: 오늘 할 운동 · 컨디션 · 일정 미루기 · 휴식일/추가 운동 · 놓친 운동 안내 · 이번 주
import { db } from '../db.js';
import { catalog } from '../catalog.js';
import { getActive, discardActive, startSession, planAdjust, skipNext } from '../store.js';
import { cycleInfo } from '../cycle.js';
import { loadContext, planAhead, dayStatus, lastMissed, setOverride, weekCount, postponeToday, addDays, parse, DAY } from '../schedule.js';
import { esc, koreanDate, flash, toast } from '../ui.js';

let condition = 'normal';
let discardArmed = false;
let panel = null; // 'postpone' | 'pick'
export function reset() { discardArmed = false; panel = null; }

const COND = [['good', '좋음'], ['normal', '보통'], ['bad', '안 좋음']];
const md = (s) => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]})`; };

function routineCard(r, delta, byId, extraButtons) {
  return `
    <div class="card dark">
      <div class="head-row"><h2>${esc(r.name)}</h2><span class="muted-inv">${r.items.length}개 운동${r.tabata ? ' + 타바타' : ''}</span></div>
      ${r.items.map((it) => {
        const e = byId[it.exerciseId];
        const unit = e?.loadType === 'time' ? '초' : '회';
        return `<div class="line"><span>${it.pinned ? '📌 ' : ''}${esc(e?.name || it.exerciseId)}</span><span>${Math.max(1, it.sets + delta)}×${it.reps}${unit}${it.weight != null ? ` · ${it.weight}kg` : ''}</span></div>`;
      }).join('')}
      ${r.tabata ? `<div class="line"><span>타바타</span><span>${r.tabata.rounds * r.tabata.sets}라운드</span></div>` : ''}
      ${extraButtons}
    </div>`;
}

export async function render(el) {
  const ctx = await loadContext();
  const { profile, program, routines, today } = ctx;
  const { byId } = catalog();
  if (!profile) {
    el.innerHTML = `
      <p class="muted">${esc(koreanDate())}</p>
      <h1>반가워요!</h1>
      <div class="card">
        <p>헬스장에서 뭘 해야 할지 막막했다면, 몇 가지 질문에 답해 주세요. 나에게 맞는 운동 프로그램을 짜드릴게요.</p>
        <a class="btn primary" href="#/onboarding">시작하기 (1분)</a>
      </div>`;
    return;
  }

  const active = await getActive();
  const plan = planAhead(ctx, 21);
  const todayPlan = plan[today];
  const doneToday = (ctx.byDate[today] || []).filter((s) => s.kind === 'program');
  const r = todayPlan ? routines[todayPlan.routineId] : null;
  const nextR = program ? routines[program.routineIds[program.nextIndex % program.routineIds.length]] : null;
  const phase = await cycleInfo(profile);
  const { delta, lowTabata } = planAdjust(profile, condition, phase);
  const missed = active ? null : await lastMissed(ctx);
  const wk = weekCount(ctx, plan);
  const recent = await db.sessions.orderBy('date').reverse().limit(3).toArray();
  const nextPlanned = Object.keys(plan).filter((d) => d > today).sort()[0];

  // 방금 저장한 운동 결과
  const result = flash.lastResult; delete flash.lastResult;
  const resultCard = result ? `
    <div class="card ok-card">
      <h2>저장했어요!</h2>
      ${result.changes.length ? `<p class="muted">다음 ${esc(result.routineName)}는 새 동작으로 바뀌어요</p>
        <ul class="tips">${result.changes.map(([a, b]) => `<li>${esc(a)} → <b>${esc(b)}</b></li>`).join('')}</ul>` : ''}
      ${result.unrated ? `<p class="muted">난이도를 안 고른 운동 ${result.unrated}개는 목표를 그대로 뒀어요.</p>` : ''}
    </div>` : '';

  const missedCard = missed && nextR ? `
    <div class="card warn-card">
      <h2>${md(missed)} 운동을 못 했어요</h2>
      <p class="muted">빠진 ${esc(nextR.name)}부터 이어서 하도록 남은 일정을 하나씩 뒤로 밀었어요.</p>
      <div class="row">
        ${!todayPlan && !doneToday.length ? '<button type="button" class="btn primary" id="m-today">오늘 할래요</button>' : ''}
        <button type="button" class="btn" id="m-skip">건너뛰기</button>
        <button type="button" class="btn" id="m-ok">확인</button>
      </div>
    </div>` : '';

  const adjustNote = delta < 0 || lowTabata
    ? `<p class="muted">${condition === 'bad' ? '컨디션이 안 좋아서' : '생리 기간이라'} 세트를 하나씩 줄이고${r?.tabata ? ', 타바타는 저강도 동작으로 바꿀게요' : ''}.</p>` : '';

  // 미루기 패널
  const postponePanel = panel === 'postpone' ? `
    <div class="card picker">
      <div class="head-row"><h2>언제로 미룰까요?</h2><button type="button" class="btn small" data-close>닫기</button></div>
      <button type="button" class="pick" data-pp="tomorrow"><span>내일 (${md(addDays(today, 1))})</span></button>
      <button type="button" class="pick" data-pp="next"><span>다음 운동일${nextPlanned ? ` (${md(nextPlanned)})` : ''}</span><span class="muted">이후 일정이 하나씩 밀려요</span></button>
      <label class="field">날짜 고르기<input type="date" id="pp-date" min="${addDays(today, 1)}" max="${addDays(today, 30)}"></label>
      <p class="muted">이번 주 목표 ${program.weeklyGoal}회 중 ${wk.done}회 했고, ${wk.planned}회 남았어요.</p>
    </div>` : '';

  // 휴식일/추가 운동 패널
  const pickPanel = panel === 'pick' ? `
    <div class="card picker">
      <div class="head-row"><h2>어떤 루틴을 할까요?</h2><button type="button" class="btn small" data-close>닫기</button></div>
      ${program.routineIds.map((id) => routines[id]).filter(Boolean).map((x) => `<button type="button" class="pick" data-extra="${esc(x.id)}"><span>${esc(x.name)}</span><span class="muted">${x.items.length}개 운동</span></button>`).join('')}
      <p class="muted">추가 운동은 기록만 남고 프로그램 순서는 그대로예요.</p>
    </div>` : '';

  const extraCard = `
    <div class="card">
      <h2>+ 추가 운동</h2>
      ${!doneToday.length && nextR ? `<button type="button" class="pick" id="pull"><span><b>다음 순서 당겨 하기 · ${esc(nextR.name)}</b><br><small class="muted">이후 일정이 하루씩 앞당겨져요</small></span></button>` : ''}
      <a class="pick" href="#/timer"><span><b>타바타만</b><br><small class="muted">기록만 남고 일정은 그대로예요</small></span></a>
      <button type="button" class="pick" id="pick-routine"><span><b>다른 루틴 골라 하기</b><br><small class="muted">기록만 남고 일정은 그대로예요</small></span></button>
    </div>
    ${pickPanel}`;

  let main = '';
  if (active) {
    main = `
      <div class="card">
        <h2>진행 중인 운동 · ${esc(active.routineName)}</h2>
        <p class="muted">${active.exercises.reduce((n, x) => n + x.sets.filter((s) => s.done).length, 0)}세트 완료</p>
        <div class="row">
          <button type="button" class="btn" id="discard">${discardArmed ? '한 번 더 누르면 버려요' : '기록 버리기'}</button>
          <a class="btn primary" href="#/workout">이어하기</a>
        </div>
      </div>`;
  } else if (r) {
    const pulled = ctx.ov[today]?.type === 'workout' && !(profile.preferredDays || []).includes(parse(today).getDay());
    main = `
      <div class="card">
        <p><b>오늘 컨디션은 어때요?</b></p>
        <div class="seg">${COND.map(([v, l]) => `<button type="button" class="chip" data-cond="${v}" aria-pressed="${condition === v}">${l}</button>`).join('')}</div>
        ${adjustNote}
      </div>
      ${routineCard(r, delta, byId, `
        <button type="button" class="btn primary" id="start">운동 시작</button>
        <div class="row">
          <a class="btn" href="#/program">운동 수정</a>
          <button type="button" class="btn" id="postpone">일정 미루기</button>
        </div>
        ${pulled ? '<button type="button" class="btn small" id="undo-pull">원래 휴식일이에요 · 되돌리기</button>' : ''}`)}
      ${postponePanel}`;
  } else if (doneToday.length) {
    main = `
      <div class="card ok-card"><h2>오늘 운동 완료!</h2><p class="muted">${doneToday.map((s) => esc(s.routineName)).join(', ')} · 잘했어요. 푹 쉬어요.</p></div>
      ${extraCard}`;
  } else {
    main = `
      <div class="card"><h2>오늘은 휴식일</h2><p class="muted">다음 운동: ${nextPlanned ? `${md(nextPlanned)} ${esc(routines[plan[nextPlanned].routineId]?.name || '')}` : '없음'}</p></div>
      ${extraCard}`;
  }

  // 이번 주
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(wk.mon, i);
    const st = dayStatus(ctx, d, plan);
    const label = st.status === 'done' ? '✓' : st.status === 'planned' ? esc((routines[st.routineId]?.name || '').slice(0, 2)) : st.status === 'missed' ? '놓침' : st.status === 'skipped' ? '패스' : '휴';
    return `<div class="wk"><span class="muted">${DAY[parse(d).getDay()]}</span><span class="wk-dot ${st.status} ${d === today ? 'today' : ''}">${label}</span></div>`;
  }).join('');

  el.innerHTML = `
    <p class="muted">${esc(koreanDate())}</p>
    <h1>오늘의 운동</h1>
    ${resultCard}
    ${missedCard}
    ${main}
    <div class="card">
      <div class="head-row"><h2>이번 주</h2><span class="muted">목표 ${program?.weeklyGoal || 0}회 중 ${wk.done}회</span></div>
      <div class="week">${week}</div>
    </div>
    ${recent.length ? `
      <div class="card">
        <h2>최근 기록</h2>
        ${recent.map((s) => {
          const mins = Math.max(1, Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000));
          const what = s.kind === 'free' ? `${s.tabata?.roundsDone || 0}라운드` : `${s.exercises.filter((x) => !x.skipped).length}개`;
          return `<div class="line"><span>${md(s.date)} ${esc(s.routineName)}${s.kind === 'extra' ? ' (추가)' : ''}</span><span class="muted">${what} · ${mins}분</span></div>`;
        }).join('')}
        <a class="btn small" href="#/calendar">캘린더에서 보기</a>
      </div>` : ''}
  `;

  const again = () => render(el);
  el.querySelectorAll('[data-cond]').forEach((b) => b.addEventListener('click', () => { condition = b.dataset.cond; again(); }));
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { panel = null; again(); }));
  el.querySelector('#start')?.addEventListener('click', async () => {
    await startSession(r, profile, condition, phase);
    condition = 'normal';
    location.hash = '#/workout';
  });
  el.querySelector('#discard')?.addEventListener('click', async () => {
    if (!discardArmed) { discardArmed = true; return again(); }
    await discardActive(); discardArmed = false; toast('진행 중이던 기록을 버렸어요'); again();
  });
  el.querySelector('#postpone')?.addEventListener('click', () => { panel = panel === 'postpone' ? null : 'postpone'; again(); });
  el.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', async () => {
    await postponeToday(ctx, b.dataset.pp); panel = null;
    toast(b.dataset.pp === 'tomorrow' ? '내일로 미뤘어요' : '다음 운동일로 미뤘어요'); again();
  }));
  el.querySelector('#pp-date')?.addEventListener('change', async (ev) => {
    if (!ev.target.value) return;
    await postponeToday(ctx, ev.target.value); panel = null; toast(`${md(ev.target.value)}로 미뤘어요`); again();
  });
  el.querySelector('#undo-pull')?.addEventListener('click', async () => { await setOverride(today, null); again(); });
  el.querySelector('#pull')?.addEventListener('click', async () => { await setOverride(today, 'workout'); toast('오늘 운동으로 당겼어요'); again(); });
  el.querySelector('#pick-routine')?.addEventListener('click', () => { panel = panel === 'pick' ? null : 'pick'; again(); });
  el.querySelectorAll('[data-extra]').forEach((b) => b.addEventListener('click', async () => {
    panel = null;
    await startSession(routines[b.dataset.extra], profile, 'normal', phase, 'extra');
    location.hash = '#/workout';
  }));
  el.querySelector('#m-today')?.addEventListener('click', async () => { await setOverride(today, 'workout'); await db.meta.put({ key: 'missedAck', value: missed }); again(); });
  el.querySelector('#m-skip')?.addEventListener('click', async () => { await skipNext(missed); toast(`${nextR.name}는 건너뛰고 다음 순서로 가요`); again(); });
  el.querySelector('#m-ok')?.addEventListener('click', async () => { await db.meta.put({ key: 'missedAck', value: missed }); again(); });
}
