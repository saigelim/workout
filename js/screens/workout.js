// 운동 진행 · 기록 (#/workout)
// run: 동작별 세트 기록(무게·횟수 수정, 세트 추가/삭제, 휴식 타이머) → review: 난이도 평가 · 수정 · 저장
import { catalog, alternativesFor } from '../catalog.js';
import { getActive, saveActive, getProfile, finishSession, progressMap } from '../store.js';
import { paramsFor } from '../generator.js';
import { nextTarget } from '../progression.js';
import { unlockAudio } from '../tabata-engine.js';
import { esc, toast, flash } from '../ui.js';

let restTimer = null;   // setInterval id
let restUntil = 0;      // 휴식 끝나는 시각(ms) — 시계 기준이라 화면을 껐다 켜도 정확
let swapOpen = false;

const RATING = { easy: '쉬웠어요', ok: '적당해요', hard: '힘들었어요' };

function clearRest() { if (restTimer) clearInterval(restTimer); restTimer = null; }
export function reset() { clearRest(); swapOpen = false; }

const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export async function render(el) {
  const a = await getActive();
  if (!a) { location.hash = '#/today'; return; }
  const profile = await getProfile();
  if (a.stage === 'review') return renderReview(el, a, profile);
  return renderRun(el, a, profile);
}

// ───────── 운동 중 ─────────
async function renderRun(el, a, profile) {
  const { byId } = catalog();
  const total = a.exercises.length + (a.tabata ? 1 : 0);
  const i = Math.min(a.current, total - 1);
  const isTabata = a.tabata && i === a.exercises.length;
  const progress = await progressMap();
  const elapsed = Math.floor((Date.now() - new Date(a.startedAt)) / 60000);

  const nav = `
    <div class="head-row">
      <button type="button" class="btn small" id="leave">← 나가기</button>
      <span class="muted">${esc(a.routineName)} · ${i + 1} / ${total} · ${elapsed}분</span>
    </div>
    <div class="dots" aria-hidden="true">${Array.from({ length: total }, (_, k) => {
      const x = a.exercises[k];
      const done = x ? x.sets.every((s) => s.done) : (a.tabata?.roundsDone > 0);
      return `<span class="${k === i ? 'cur' : done ? 'done' : ''}"></span>`;
    }).join('')}</div>`;

  if (isTabata) {
    const t = a.tabata;
    el.innerHTML = `${nav}
      <h1>타바타 마무리</h1>
      <div class="card">
        <p><b>${t.exerciseIds.map((id) => esc(byId[id]?.name || id)).join(' · ')}</b></p>
        <p class="muted">${t.work}초 운동 / ${t.rest}초 휴식 × ${t.rounds}라운드 × ${t.sets}세트 · 라운드마다 동작이 번갈아 나와요</p>
        <button type="button" class="btn primary" id="tabata-go">타이머로 하기</button>
        <label class="field">타이머 없이 했다면, 완료한 라운드 수 (전체 ${t.rounds * t.sets})
          <input id="rounds" type="number" inputmode="numeric" min="0" max="${t.rounds * t.sets}" value="${t.roundsDone ?? ''}" placeholder="${t.rounds * t.sets}">
        </label>
      </div>
      <div class="row bottom-row">
        <button type="button" class="btn" id="prev">이전</button>
        <button type="button" class="btn primary" id="finish">운동 끝내기</button>
      </div>`;
    bindCommon(el, a, total);
    el.querySelector('#tabata-go').addEventListener('click', () => { unlockAudio(); location.hash = '#/timer/session'; });
    el.querySelector('#rounds').addEventListener('change', async (ev) => {
      a.tabata.roundsDone = Math.max(0, Math.min(t.rounds * t.sets, Number(ev.target.value) || 0));
      await saveActive(a);
    });
    el.querySelector('#finish').addEventListener('click', async () => {
      if (a.tabata.roundsDone == null) a.tabata.roundsDone = t.rounds * t.sets;
      a.stage = 'review'; await saveActive(a); clearRest(); render(el);
    });
    return;
  }

  const x = a.exercises[i];
  const e = byId[x.exerciseId];
  const hasWeight = e.loadType === 'weight' || e.loadType === 'assisted';
  const repLabel = e.loadType === 'time' ? '초' : '횟수';
  const tipsMode = paramsFor(profile).exp.tips;
  const timesDone = progress[e.id]?.timesDone || 0;
  const openTips = tipsMode === 'always' || (tipsMode === 'first2' && timesDone < 2);
  const firstTime = hasWeight && x.targetWeight == null;
  const alts = swapOpen ? alternativesFor(e.id, { maxLevel: 3, avoid: profile.avoid }).filter((c) => !a.exercises.some((y) => y.exerciseId === c.id)) : [];

  el.innerHTML = `${nav}
    <div>
      <h1>${esc(e.name)}</h1>
      <p class="muted">${esc(e.equipment)}${timesDone ? ` · ${timesDone}번째 이후` : ' · 처음 해보는 동작'}</p>
    </div>
    <details class="card tipcard" ${openTips ? 'open' : ''}>
      <summary><b>자세 팁</b></summary>
      <ul class="tips">${e.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </details>
    ${firstTime ? '<p class="warn">처음이라 무게를 비워뒀어요. 편하게 목표 횟수를 할 수 있는 무게를 적어주세요.</p>' : ''}
    <div class="card sets">
      <div class="set-row head ${hasWeight ? '' : 'no-w'}"><span>세트</span>${hasWeight ? `<span>${e.loadType === 'assisted' ? '보조(kg)' : '무게(kg)'}</span>` : ''}<span>${repLabel}</span><span>완료</span></div>
      ${x.sets.map((s, k) => `
        <div class="set-row ${s.done ? 'is-done' : ''} ${hasWeight ? '' : 'no-w'}">
          <b>${k + 1}</b>
          ${hasWeight ? `<input data-w="${k}" type="number" inputmode="decimal" step="0.5" min="0" value="${s.weight ?? ''}" placeholder="kg" aria-label="${k + 1}세트 무게">` : ''}
          <input data-r="${k}" type="number" inputmode="numeric" min="0" value="${s.reps ?? ''}" aria-label="${k + 1}세트 ${repLabel}">
          <button type="button" class="check-btn" data-done="${k}" aria-pressed="${s.done}" aria-label="${k + 1}세트 완료">${s.done ? '✓' : ''}</button>
        </div>`).join('')}
      <div class="row">
        <button type="button" class="btn small dashed" id="add-set">+ 세트</button>
        <button type="button" class="btn small dashed" id="del-set" ${x.sets.length <= 1 ? 'disabled' : ''}>− 세트</button>
      </div>
    </div>
    <div class="rest card dark" id="rest" hidden><span>휴식</span><b id="rest-left">00:00</b><button type="button" class="btn small" id="rest-skip">건너뛰기</button></div>
    ${swapOpen ? `
      <div class="card picker">
        <div class="head-row"><h2>기구가 사용 중이면</h2><button type="button" class="btn small" id="swap-close">닫기</button></div>
        ${alts.length ? alts.map((c) => `<button type="button" class="pick" data-swap="${esc(c.id)}"><span>${esc(c.name)}</span><span class="muted">${esc(c.equipment)}</span></button>`).join('') : '<p class="muted">같은 분류의 다른 동작이 없어요.</p>'}
        <p class="muted">오늘 기록에서만 바뀌어요.</p>
      </div>` : ''}
    <div class="row bottom-row">
      ${i > 0 ? '<button type="button" class="btn" id="prev">이전</button>' : ''}
      <button type="button" class="btn" id="swap">운동 교체</button>
      <button type="button" class="btn primary" id="next">${i === total - 1 ? '운동 끝내기' : '다음 운동'}</button>
    </div>`;

  bindCommon(el, a, total);

  el.querySelectorAll('[data-w]').forEach((inp) => inp.addEventListener('change', async () => {
    const k = Number(inp.dataset.w);
    const v = inp.value === '' ? null : Math.max(0, Number(inp.value));
    x.sets[k].weight = v;
    // 첫 세트 무게를 바꾸면 아직 안 한 다음 세트들도 같이
    for (let j = k + 1; j < x.sets.length; j++) if (!x.sets[j].done) x.sets[j].weight = v;
    await saveActive(a); rerenderKeep(el);
  }));
  el.querySelectorAll('[data-r]').forEach((inp) => inp.addEventListener('change', async () => {
    x.sets[Number(inp.dataset.r)].reps = inp.value === '' ? null : Math.max(0, Number(inp.value));
    await saveActive(a);
  }));
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
    const s = x.sets[Number(b.dataset.done)];
    s.done = !s.done;
    await saveActive(a);
    if (s.done) restUntil = Date.now() + (x.restSec || 60) * 1000;
    rerenderKeep(el);
  }));
  el.querySelector('#add-set').addEventListener('click', async () => {
    const last = x.sets[x.sets.length - 1];
    x.sets.push({ weight: last?.weight ?? null, reps: last?.reps ?? x.targetReps, done: false });
    await saveActive(a); rerenderKeep(el);
  });
  el.querySelector('#del-set').addEventListener('click', async () => {
    if (x.sets.length > 1) { x.sets.pop(); await saveActive(a); rerenderKeep(el); }
  });
  el.querySelector('#swap').addEventListener('click', () => { swapOpen = !swapOpen; rerenderKeep(el); });
  el.querySelector('#swap-close')?.addEventListener('click', () => { swapOpen = false; rerenderKeep(el); });
  el.querySelectorAll('[data-swap]').forEach((b) => b.addEventListener('click', async () => {
    const n = byId[b.dataset.swap];
    const p = progress[n.id];
    const w = (n.loadType === 'weight' || n.loadType === 'assisted') ? (p?.weight ?? null) : null;
    const r = p?.reps ?? x.targetReps;
    a.exercises[i] = { ...x, exerciseId: n.id, slot: n.slot, targetReps: r, targetWeight: w,
      sets: x.sets.map(() => ({ weight: w, reps: r, done: false })), rating: null };
    swapOpen = false; await saveActive(a); toast(`${n.name}(으)로 바꿨어요`); rerenderKeep(el);
  }));
  el.querySelector('#next').addEventListener('click', async () => {
    clearRest(); restUntil = 0; swapOpen = false;
    if (i === total - 1) { a.stage = 'review'; } else a.current = i + 1;
    await saveActive(a); render(el); window.scrollTo(0, 0);
  });

  startRestTicker(el);
}

function bindCommon(el, a, total) {
  el.querySelector('#prev')?.addEventListener('click', async () => {
    clearRest(); restUntil = 0; swapOpen = false;
    a.current = Math.max(0, Math.min(a.current, total - 1) - 1); await saveActive(a); render(el); window.scrollTo(0, 0);
  });
  // 나가도 기록은 남아 있어요. 오늘 탭에서 이어하거나 버릴 수 있어요.
  el.querySelector('#leave').addEventListener('click', () => {
    const anyDone = a.exercises.some((x) => x.sets.some((s) => s.done));
    if (anyDone) toast('오늘 탭에서 이어할 수 있어요');
    location.hash = '#/today';
  });
}

async function rerenderKeep(el) { const y = window.scrollY; await render(el); window.scrollTo(0, y); }

function startRestTicker(el) {
  clearRest();
  const box = el.querySelector('#rest');
  if (!box || restUntil <= Date.now()) return;
  const left = el.querySelector('#rest-left');
  box.hidden = false;
  const tick = () => {
    const s = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000));
    left.textContent = fmt(s);
    if (s <= 0) {
      clearRest(); box.hidden = true; restUntil = 0;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      toast('휴식 끝! 다음 세트 해요');
    }
  };
  tick();
  restTimer = setInterval(tick, 250);
  el.querySelector('#rest-skip').addEventListener('click', () => { clearRest(); restUntil = 0; box.hidden = true; });
}

// ───────── 운동 완료 · 난이도 평가 ─────────
async function renderReview(el, a, profile) {
  const { byId } = catalog();
  const progress = await progressMap();
  const mins = Math.max(1, Math.round((Date.now() - new Date(a.startedAt)) / 60000));
  const done = a.exercises.map((x, k) => ({ x, k })).filter(({ x }) => x.sets.some((s) => s.done));
  const skipped = a.exercises.filter((x) => !x.sets.some((s) => s.done));

  const preview = (x) => {
    const e = byId[x.exerciseId];
    const cur = progress[x.exerciseId] || { weight: x.targetWeight, reps: x.targetReps, hardStreak: 0 };
    return nextTarget(e, { ...cur, reps: x.targetReps ?? cur.reps, weight: cur.weight ?? x.targetWeight }, x.sets, x.rating, profile).note;
  };
  const summary = (x) => {
    const e = byId[x.exerciseId];
    const unit = e.loadType === 'time' ? '초' : '회';
    return x.sets.filter((s) => s.done).map((s) => (s.weight != null && e.loadType !== 'bodyweight' && e.loadType !== 'time' ? `${s.weight}kg×${s.reps}` : `${s.reps}${unit}`)).join(' · ');
  };

  el.innerHTML = `
    <div>
      <p class="muted">${esc(a.routineName)} · ${mins}분</p>
      <h1>운동 완료!</h1>
      <p class="muted">운동별로 난이도를 알려주세요. 다음 목표에 반영돼요.</p>
    </div>
    ${done.map(({ x, k }) => `
      <div class="card">
        <div class="head-row"><h2>${esc(byId[x.exerciseId].name)}</h2><button type="button" class="btn small" data-edit="${k}">기록 수정</button></div>
        <p class="muted">${esc(summary(x))}</p>
        <div class="seg">${Object.entries(RATING).map(([v, l]) => `<button type="button" class="chip" data-rate="${k}" data-v="${v}" aria-pressed="${x.rating === v}">${l}</button>`).join('')}</div>
        ${x.rating ? `<p class="ok-note">${esc(preview(x))}</p>` : ''}
      </div>`).join('')}
    ${skipped.length ? `<p class="muted">건너뛴 운동: ${skipped.map((x) => esc(byId[x.exerciseId]?.name)).join(', ')}</p>` : ''}
    ${a.tabata ? `
      <div class="card">
        <h2>타바타</h2>
        <p class="muted">${a.tabata.exerciseIds.map((id) => esc(byId[id]?.name || id)).join(' · ')}</p>
        <div class="grid3">
          <label class="field">완료 라운드<input data-t="roundsDone" type="number" inputmode="numeric" min="0" max="${a.tabata.rounds * a.tabata.sets}" value="${a.tabata.roundsDone ?? 0}"></label>
          <label class="field">운동(초)<input data-t="work" type="number" inputmode="numeric" min="5" max="120" value="${a.tabata.work}"></label>
          <label class="field">휴식(초)<input data-t="rest" type="number" inputmode="numeric" min="0" max="120" value="${a.tabata.rest}"></label>
        </div>
      </div>` : ''}
    ${!done.length && !(a.tabata?.roundsDone > 0) ? '<p class="warn">완료한 세트가 없어요. 기록 수정에서 세트를 체크해 주세요.</p>' : ''}
    <button type="button" class="btn primary" id="save" ${done.length || a.tabata?.roundsDone > 0 ? '' : 'disabled'}>저장하고 마치기</button>
    <button type="button" class="btn" id="back">운동으로 돌아가기</button>`;

  el.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', async () => {
    const x = a.exercises[Number(b.dataset.rate)];
    x.rating = x.rating === b.dataset.v ? null : b.dataset.v;
    await saveActive(a); rerenderKeep(el);
  }));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    a.stage = 'run'; a.current = Number(b.dataset.edit); await saveActive(a); render(el); window.scrollTo(0, 0);
  }));
  el.querySelectorAll('[data-t]').forEach((inp) => inp.addEventListener('change', async () => {
    const k = inp.dataset.t;
    const lim = { roundsDone: [0, a.tabata.rounds * a.tabata.sets], work: [5, 120], rest: [0, 120] }[k];
    a.tabata[k] = Math.max(lim[0], Math.min(lim[1], Number(inp.value) || 0));
    inp.value = a.tabata[k]; await saveActive(a);
  }));
  el.querySelector('#back').addEventListener('click', async () => {
    a.stage = 'run'; await saveActive(a); render(el);
  });
  el.querySelector('#save').addEventListener('click', async () => {
    const unrated = done.filter(({ x }) => !x.rating).length;
    const res = await finishSession(a, profile);
    reset();
    flash.lastResult = { routineName: a.routineName, changes: res.changes, unrated };
    location.hash = '#/today';
  });
}
