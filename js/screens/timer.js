// 타바타 타이머
// #/timer          설정 화면 (기본값 수정, 동작 고르기)
// #/timer/run      타이머만 따로 하기
// #/timer/session  운동 중 타바타 블록과 연결 (끝나면 완료 라운드가 운동 기록에 들어감)
import { db } from '../db.js';
import { catalog } from '../catalog.js';
import { getProfile, getActive, saveActive } from '../store.js';
import { TabataClock, buildPhases, unlockAudio, beep, keepAwake } from '../tabata-engine.js';
import { esc, toast, todayStr } from '../ui.js';

const FALLBACK = { work: 20, rest: 10, rounds: 8, sets: 1, prep: 10, setRest: 60, sound: true, vibration: true };
let cfg = null;        // 설정 화면 값
let picking = false;
let clock = null, ticker = null, summary = null;

const fmt = (s) => (s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}`);

function stop() {
  if (ticker) clearInterval(ticker); ticker = null;
  document.removeEventListener('visibilitychange', onVisible);
  keepAwake(false);
}
function onVisible() { if (document.visibilityState === 'visible' && clock?.running) keepAwake(true); }
export function reset() { stop(); clock = null; summary = null; picking = false; }

async function loadCfg() {
  const p = await getProfile();
  const d = { ...FALLBACK, ...(p?.tabataDefault || {}), sound: p?.sound ?? true, vibration: p?.vibration ?? true };
  return { ...d, exerciseIds: cfg?.exerciseIds || [] };
}

export async function render(el, params = []) {
  const mode = params[0];
  if (mode === 'run' || mode === 'session') return renderRun(el, mode);
  return renderSetup(el);
}

// ───────── 설정 ─────────
async function renderSetup(el) {
  if (!cfg) cfg = await loadCfg();
  const { byId, active } = catalog();
  const { total } = buildPhases(cfg);
  const field = (k, label, min, max) =>
    `<label class="field">${label}<input data-k="${k}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${cfg[k]}"></label>`;

  el.innerHTML = `
    <h1>타바타 타이머</h1>
    <div class="card">
      <div class="grid4">
        ${field('work', '운동(초)', 5, 120)}${field('rest', '휴식(초)', 0, 120)}${field('rounds', '라운드', 1, 20)}${field('sets', '세트', 1, 5)}
      </div>
      <div class="grid3">
        ${field('prep', '준비(초)', 0, 30)}${field('setRest', '세트 사이(초)', 0, 300)}<span></span>
      </div>
      <p class="muted">총 ${fmt(total)}</p>
    </div>
    <div class="card">
      <h2>동작 (선택)</h2>
      <p class="muted">고르면 라운드마다 동작 이름이 번갈아 나와요.</p>
      <div class="chips">
        ${cfg.exerciseIds.map((id) => `<span class="chip static">${esc(byId[id]?.name || id)}<button type="button" class="x" data-rm="${esc(id)}" aria-label="${esc(byId[id]?.name || id)} 빼기">×</button></span>`).join('')}
        ${cfg.exerciseIds.length < 4 ? '<button type="button" class="chip" id="pick">+ 동작</button>' : ''}
      </div>
      ${picking ? `<div class="pick-list">${active.filter((e) => e.tabataOk && !cfg.exerciseIds.includes(e.id)).map((e) =>
        `<button type="button" class="pick" data-add="${esc(e.id)}"><span>${esc(e.name)}${e.lowImpact ? ' 🌿' : ''}</span><span class="muted">Lv${e.level}</span></button>`).join('')}</div>` : ''}
    </div>
    <div class="card">
      <label class="check"><input type="checkbox" id="sound" ${cfg.sound ? 'checked' : ''}> 소리 (3·2·1 비프음)</label>
      <label class="check"><input type="checkbox" id="vib" ${cfg.vibration ? 'checked' : ''}> 진동</label>
    </div>
    <div class="row">
      <button type="button" class="btn" id="save-default">기본값으로 저장</button>
      <button type="button" class="btn primary" id="start">시작</button>
    </div>
    <p class="muted">타이머 중에는 화면이 꺼지지 않아요. 다른 앱을 봤다 와도 시간은 정확하게 이어져요.</p>`;

  const keep = async () => { const y = scrollY; await renderSetup(el); scrollTo(0, y); };
  const lim = { work: [5, 120], rest: [0, 120], rounds: [1, 20], sets: [1, 5], prep: [0, 30], setRest: [0, 300] };
  el.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const [lo, hi] = lim[inp.dataset.k];
    cfg[inp.dataset.k] = Math.max(lo, Math.min(hi, Number(inp.value) || 0)); keep();
  }));
  el.querySelector('#pick')?.addEventListener('click', () => { picking = !picking; keep(); });
  el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { cfg.exerciseIds.push(b.dataset.add); picking = false; keep(); }));
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { cfg.exerciseIds = cfg.exerciseIds.filter((x) => x !== b.dataset.rm); keep(); }));
  el.querySelector('#sound').addEventListener('change', (e) => { cfg.sound = e.target.checked; });
  el.querySelector('#vib').addEventListener('change', (e) => { cfg.vibration = e.target.checked; });
  el.querySelector('#save-default').addEventListener('click', async () => {
    const p = await getProfile();
    if (!p) return toast('온보딩을 마치면 기본값을 저장할 수 있어요');
    const { work, rest, rounds, sets, prep, setRest } = cfg;
    await db.profile.put({ ...p, tabataDefault: { work, rest, rounds, sets, prep, setRest }, sound: cfg.sound, vibration: cfg.vibration });
    toast('기본값으로 저장했어요');
  });
  el.querySelector('#start').addEventListener('click', () => { unlockAudio(); location.hash = '#/timer/run'; });
}

// ───────── 실행 ─────────
async function renderRun(el, mode) {
  const { byId } = catalog();
  let run;
  if (mode === 'session') {
    const a = await getActive();
    if (!a?.tabata) { location.hash = '#/workout'; return; }
    const base = await loadCfg();
    run = { ...base, work: a.tabata.work, rest: a.tabata.rest, rounds: a.tabata.rounds, sets: a.tabata.sets, exerciseIds: a.tabata.exerciseIds };
  } else {
    if (!cfg) cfg = await loadCfg();
    run = { ...cfg };
  }

  if (summary) return renderSummary(el, mode, run);

  el.innerHTML = `
    <div class="tb" data-type="prep">
      <div class="tb-top">
        <button type="button" class="tb-btn" id="end">종료</button>
        <span id="tb-set"></span>
      </div>
      <div class="tb-label"><span id="tb-type">준비</span><b id="tb-ex"></b></div>
      <div class="tb-num" id="tb-num" aria-live="off">10</div>
      <div class="tb-info">
        <div class="tb-bars" id="tb-bars"></div>
        <div class="tb-row"><b id="tb-round"></b><span id="tb-next"></span></div>
      </div>
      <div class="tb-ctrl">
        <button type="button" class="tb-btn" id="back">이전</button>
        <button type="button" class="tb-btn main" id="pause">일시정지</button>
        <button type="button" class="tb-btn" id="skip">건너뛰기</button>
      </div>
    </div>`;

  const $ = (id) => el.querySelector(id);
  const LABEL = { prep: '준비', work: '운동', rest: '휴식', setrest: '세트 휴식' };
  const total = run.rounds * run.sets;
  $('#tb-bars').innerHTML = Array.from({ length: total }, () => '<span></span>').join('');
  const bars = [...$('#tb-bars').children];

  if (!clock) {
    clock = new TabataClock(run, {
      onBeep: (k) => { if (run.sound) beep(k); if (run.vibration && navigator.vibrate) navigator.vibrate(k === 'count' ? 60 : k === 'end' ? [300, 100, 300] : 250); }
    });
    clock.start();
  }

  const paint = () => {
    const s = clock.tick();
    if (s.done) return finish(true);
    const p = s.phase;
    el.querySelector('.tb').dataset.type = p.type;
    $('#tb-type').textContent = LABEL[p.type];
    $('#tb-ex').textContent = p.type === 'work' && p.exId ? byId[p.exId]?.name || '' : '';
    $('#tb-num').textContent = s.left;
    const roundNo = p.type === 'prep' ? 0 : (p.set - 1) * run.rounds + p.round;
    $('#tb-round').textContent = p.type === 'prep' ? `${total}라운드` : `라운드 ${p.round} / ${run.rounds}`;
    $('#tb-set').textContent = run.sets > 1 ? `세트 ${p.set} / ${run.sets}` : '';
    $('#tb-next').textContent = s.next ? `다음: ${s.next.exId ? byId[s.next.exId]?.name : '운동'}` : '마지막이에요!';
    bars.forEach((b, k) => { b.className = k < s.roundsDone ? 'done' : (k === roundNo - 1 && p.type === 'work') ? 'cur' : ''; });
    $('#pause').textContent = clock.running ? '일시정지' : '계속';
  };

  const finish = async (natural) => {
    stop();
    const rounds = clock.roundsDone();
    summary = { rounds, total: clock.totalRounds(), secs: Math.round(clock.elapsed()), natural };
    if (mode === 'session') {
      const a = await getActive();
      if (a?.tabata) {
        a.tabata.roundsDone = rounds;
        if (natural) a.stage = 'review';
        await saveActive(a);
      }
      reset();
      toast(`타바타 ${rounds}라운드 완료`);
      location.hash = '#/workout';
      return;
    }
    renderSummary(el, mode, run);
  };

  $('#pause').addEventListener('click', () => { unlockAudio(); clock.running ? clock.pause() : clock.resume(); paint(); });
  $('#skip').addEventListener('click', () => { clock.skip(); paint(); });
  $('#back').addEventListener('click', () => { clock.back(); paint(); });
  $('#end').addEventListener('click', () => finish(false));

  unlockAudio();
  keepAwake(true);
  document.addEventListener('visibilitychange', onVisible);
  if (ticker) clearInterval(ticker);
  ticker = setInterval(paint, 100);
  paint();
}

function renderSummary(el, mode, run) {
  const s = summary;
  el.innerHTML = `
    <h1>${s.natural ? '타바타 완료!' : '타바타 종료'}</h1>
    <div class="card">
      <p class="big-stat">${s.rounds} / ${s.total} 라운드</p>
      <p class="muted">${fmt(s.secs)} · ${run.work}초 운동 / ${run.rest}초 휴식</p>
    </div>
    <button type="button" class="btn primary" id="save" ${s.rounds ? '' : 'disabled'}>기록 남기기</button>
    <div class="row">
      <button type="button" class="btn" id="again">다시 하기</button>
      <a class="btn" href="#/timer" id="close">닫기</a>
    </div>
    <p class="muted">따로 한 타바타는 기록만 남고, 프로그램 순서는 바뀌지 않아요.</p>`;

  el.querySelector('#close').addEventListener('click', () => { summary = null; clock = null; });
  el.querySelector('#again').addEventListener('click', () => { summary = null; clock = null; unlockAudio(); renderRun(el, mode); });
  el.querySelector('#save').addEventListener('click', async () => {
    const { byId } = catalog();
    const now = new Date();
    const id = `s_${Date.now().toString(36)}`;
    await db.sessions.put({
      id, date: todayStr(), startedAt: new Date(now - s.secs * 1000).toISOString(), endedAt: now.toISOString(),
      kind: 'free', routineId: null, routineName: '타바타', condition: null, cyclePhase: null, exercises: [],
      tabata: { exerciseIds: run.exerciseIds, names: run.exerciseIds.map((x) => byId[x]?.name || x), work: run.work, rest: run.rest,
        roundsPlanned: s.total, roundsDone: s.rounds, sets: run.sets }
    });
    for (const x of run.exerciseIds) {
      const cur = await db.progress.get(x);
      await db.progress.put({ ...(cur || { hardStreak: 0 }), exerciseId: x, lastDoneAt: todayStr(), timesDone: (cur?.timesDone || 0) + 1 });
    }
    summary = null; clock = null;
    toast('기록했어요');
    location.hash = '#/timer';
  });
}
