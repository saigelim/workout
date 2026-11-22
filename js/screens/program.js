// 프로그램: 루틴 보기 · 운동 교체/추가/삭제/순서 · 세트·횟수·무게 · 타바타 블록 (바꾸면 바로 저장)
import { db } from '../db.js';
import { catalog, alternativesFor, SLOT_LABEL } from '../catalog.js';
import { paramsFor, makeItem, tabataBlock } from '../generator.js';
import { getProfile, getProgram, saveRoutine, progressMap } from '../store.js';
import { esc, toast } from '../ui.js';

let ui = { sel: 0, picker: null, q: '' }; // picker: { mode: 'swap'|'add'|'tabata', index }

const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function itemCard(it, i, total) {
  const { byId } = catalog();
  const e = byId[it.exerciseId];
  if (!e) return '';
  const hasWeight = e.loadType === 'weight' || e.loadType === 'assisted';
  const repLabel = e.loadType === 'time' ? '시간(초)' : '횟수';
  return `
    <div class="card item" data-index="${i}">
      <div class="head-row">
        <div>
          <h2>${esc(e.name)}${e.enabled ? '' : ' <span class="tag">사용 안 함</span>'}</h2>
          <p class="muted">${esc(SLOT_LABEL[e.slot] || '')} · ${esc(e.equipment)}</p>
        </div>
        <button type="button" class="btn small" data-act="swap">교체</button>
      </div>
      <div class="grid3">
        <label class="field">세트<input data-f="sets" type="number" inputmode="numeric" min="1" max="10" value="${it.sets}"></label>
        <label class="field">${repLabel}<input data-f="reps" type="number" inputmode="numeric" min="1" max="300" value="${it.reps}"></label>
        ${hasWeight ? `<label class="field">${e.loadType === 'assisted' ? '보조(kg)' : '무게(kg)'}<input data-f="weight" type="number" inputmode="decimal" min="0" step="0.5" value="${it.weight ?? ''}" placeholder="첫 운동 때"></label>` : '<span></span>'}
      </div>
      <div class="row tools">
        <button type="button" class="btn small" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="위로">↑</button>
        <button type="button" class="btn small" data-act="down" ${i === total - 1 ? 'disabled' : ''} aria-label="아래로">↓</button>
        <button type="button" class="btn small pin" data-act="pin" aria-pressed="${!!it.pinned}">${it.pinned ? '📌 고정됨' : '고정'}</button>
        <button type="button" class="btn small danger" data-act="del">삭제</button>
      </div>
    </div>
    ${ui.picker && ui.picker.mode === 'swap' && ui.picker.index === i ? pickerHtml() : ''}`;
}

function pickerHtml() {
  const { active, byId } = catalog();
  const { mode, index, routine, profile } = ui.picker;
  const inRoutine = new Set(routine.items.map((x) => x.exerciseId));
  const q = ui.q.trim();
  let rec = [];
  let pool = active.filter((e) => !inRoutine.has(e.id));
  let title = '운동 추가';
  if (mode === 'swap') {
    const cur = routine.items[index].exerciseId;
    const p = paramsFor(profile);
    rec = alternativesFor(cur, { maxLevel: p.maxLevel, avoid: profile.avoid }).filter((e) => !inRoutine.has(e.id));
    title = `${byId[cur]?.name} → 교체`;
  }
  if (mode === 'tabata') {
    const ids = new Set(routine.tabata?.exerciseIds || []);
    pool = active.filter((e) => e.tabataOk && !ids.has(e.id));
    title = '타바타 동작 추가';
  }
  const btn = (e) => `<button type="button" class="pick" data-pick="${esc(e.id)}" data-name="${esc(e.name)}"><span>${esc(e.name)}</span><span class="muted">${esc(e.equipment)} · Lv${e.level}</span></button>`;
  return `
    <div class="card picker">
      <div class="head-row"><h2>${esc(title)}</h2><button type="button" class="btn small" data-act="close">닫기</button></div>
      ${rec.length ? `<div class="rec"><p class="muted">같은 분류 추천</p>${rec.map(btn).join('')}</div>` : ''}
      <input class="search" type="search" placeholder="전체에서 이름으로 찾기" value="${esc(q)}" aria-label="동작 이름 검색">
      <div class="pick-list">${pool.map(btn).join('')}</div>
      <p class="muted none" hidden>찾는 동작이 없어요. 설정 › 운동 DB 관리에서 추가할 수 있어요.</p>
    </div>`;
}

function tabataCard(r) {
  const { byId } = catalog();
  if (!r.tabata) {
    return `<button type="button" class="btn" data-act="tabata-add">+ 타바타 블록 추가</button>`;
  }
  const t = r.tabata;
  return `
    <div class="card">
      <div class="head-row"><h2>타바타 마무리</h2>
        <div class="row tools"><button type="button" class="btn small pin" data-act="tabata-pin" aria-pressed="${!!t.pinned}">${t.pinned ? '📌 고정됨' : '고정'}</button><button type="button" class="btn small danger" data-act="tabata-del">빼기</button></div></div>
      <div class="chips">
        ${t.exerciseIds.map((id) => `<span class="chip static">${esc(byId[id]?.name || id)}<button type="button" class="x" data-rm="${esc(id)}" aria-label="${esc(byId[id]?.name || id)} 빼기">×</button></span>`).join('')}
        <button type="button" class="chip" data-act="tabata-pick">+ 동작</button>
      </div>
      <div class="grid4">
        <label class="field">운동(초)<input data-t="work" type="number" inputmode="numeric" min="5" max="120" value="${t.work}"></label>
        <label class="field">휴식(초)<input data-t="rest" type="number" inputmode="numeric" min="0" max="120" value="${t.rest}"></label>
        <label class="field">라운드<input data-t="rounds" type="number" inputmode="numeric" min="1" max="20" value="${t.rounds}"></label>
        <label class="field">세트<input data-t="sets" type="number" inputmode="numeric" min="1" max="5" value="${t.sets}"></label>
      </div>
      <p class="muted">라운드마다 동작이 번갈아 나와요.</p>
    </div>
    ${ui.picker && ui.picker.mode === 'tabata' ? pickerHtml() : ''}`;
}

export async function render(el) {
  const profile = await getProfile();
  const program = await getProgram();
  if (!profile || !program) {
    el.innerHTML = `<h1>프로그램</h1><div class="card"><p>아직 프로그램이 없어요.</p><a class="btn primary" href="#/onboarding">몇 가지 질문에 답하고 시작하기</a></div>`;
    return;
  }
  const routines = (await db.routines.bulkGet(program.routineIds)).filter(Boolean);
  ui.sel = Math.min(ui.sel, routines.length - 1);
  const r = routines[ui.sel];
  if (ui.picker) ui.picker.routine = r;
  const next = routines[program.nextIndex % routines.length];

  el.innerHTML = `
    <h1>프로그램</h1>
    <p class="muted">주 ${program.weeklyGoal}회 · 순서대로 돌아가요 · 다음 운동: <b>${esc(next?.name || '')}</b></p>
    <div class="chips" role="group" aria-label="루틴">
      ${routines.map((x, i) => `<button type="button" class="chip" data-sel="${i}" aria-pressed="${i === ui.sel}">${i + 1}. ${esc(x.name)}</button>`).join('')}
    </div>
    ${r.items.map((it, i) => itemCard(it, i, r.items.length)).join('')}
    ${ui.picker && ui.picker.mode === 'add' ? pickerHtml() : '<button type="button" class="btn dashed" data-act="add">+ 운동 추가</button>'}
    ${tabataCard(r)}
    <p class="muted">운동을 마칠 때마다 고정하지 않은 동작은 같은 분류의 다른 동작으로 바뀌어요. 직접 교체·추가한 동작은 자동으로 고정돼요. 바꾼 내용은 바로 저장돼요. 요일·목표를 바꾸거나 새로 추천받으려면 설정 › 내 운동 설정으로 가세요.</p>
  `;

  const save = async (msg) => { await saveRoutine(r); if (msg) toast(msg, 1300); };
  const rerender = async () => { const y = window.scrollY; await render(el); window.scrollTo(0, y); };

  el.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
    ui = { sel: Number(b.dataset.sel), picker: null, q: '' }; rerender();
  }));

  // 항목 입력
  el.querySelectorAll('.item').forEach((card) => {
    const i = Number(card.dataset.index);
    const it = r.items[i];
    card.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.dataset.f;
      if (f === 'sets') it.sets = num(inp.value, 1, 10, it.sets);
      if (f === 'reps') it.reps = num(inp.value, 1, 300, it.reps);
      if (f === 'weight') it.weight = inp.value === '' ? null : num(inp.value, 0, 500, it.weight);
      inp.value = it[f] ?? '';
      await save('저장됨');
    }));
    card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        [r.items[i], r.items[j]] = [r.items[j], r.items[i]];
        ui.picker = null; await save(); return rerender();
      }
      if (act === 'del') {
        if (r.items.length <= 1) return toast('운동이 하나는 있어야 해요');
        const name = catalog().byId[it.exerciseId]?.name;
        r.items.splice(i, 1); ui.picker = null; await save(`${name} 삭제`); return rerender();
      }
      if (act === 'pin') { it.pinned = !it.pinned; await save(it.pinned ? '고정했어요. 매번 바뀌지 않아요' : '고정을 풀었어요'); return rerender(); }
      if (act === 'swap') { ui.picker = { mode: 'swap', index: i, routine: r, profile }; ui.q = ''; return rerender(); }
    }));
  });

  el.querySelector('[data-act=add]')?.addEventListener('click', () => {
    ui.picker = { mode: 'add', index: -1, routine: r, profile }; ui.q = ''; rerender();
  });

  // 타바타
  el.querySelector('[data-act=tabata-add]')?.addEventListener('click', async () => {
    const t = catalog().templates.routines[r.templateId];
    r.tabata = tabataBlock(profile, t?.tabataFocus || 'full');
    await save('타바타 블록 추가'); rerender();
  });
  el.querySelector('[data-act=tabata-del]')?.addEventListener('click', async () => {
    r.tabata = null; ui.picker = null; await save('타바타 블록 뺌'); rerender();
  });
  el.querySelector('[data-act=tabata-pin]')?.addEventListener('click', async () => {
    r.tabata.pinned = !r.tabata.pinned; await save(r.tabata.pinned ? '타바타 동작을 고정했어요' : '고정을 풀었어요'); rerender();
  });
  el.querySelector('[data-act=tabata-pick]')?.addEventListener('click', () => {
    ui.picker = { mode: 'tabata', index: -1, routine: r, profile }; ui.q = ''; rerender();
  });
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (r.tabata.exerciseIds.length <= 1) return toast('동작이 하나는 있어야 해요');
    r.tabata.exerciseIds = r.tabata.exerciseIds.filter((x) => x !== b.dataset.rm); r.tabata.pinned = true;
    await save(); rerender();
  }));
  el.querySelectorAll('[data-t]').forEach((inp) => inp.addEventListener('change', async () => {
    const lim = { work: [5, 120], rest: [0, 120], rounds: [1, 20], sets: [1, 5] }[inp.dataset.t];
    r.tabata[inp.dataset.t] = num(inp.value, lim[0], lim[1], r.tabata[inp.dataset.t]);
    inp.value = r.tabata[inp.dataset.t];
    await save('저장됨');
  }));

  // 동작 고르기 패널
  const picker = el.querySelector('.picker');
  if (picker) {
    picker.querySelector('[data-act=close]').addEventListener('click', () => { ui.picker = null; rerender(); });
    // 화면을 다시 그리지 않고 목록만 걸러요 (한글 입력이 끊기지 않게)
    const search = picker.querySelector('.search');
    const filterList = () => {
      ui.q = search.value.trim();
      let shown = 0;
      picker.querySelectorAll('.pick-list .pick').forEach((b) => {
        const ok = !ui.q || b.dataset.name.includes(ui.q);
        b.hidden = !ok; if (ok) shown++;
      });
      const rec = picker.querySelector('.rec'); if (rec) rec.hidden = !!ui.q;
      picker.querySelector('.none').hidden = shown > 0;
    };
    search.addEventListener('input', filterList);
    filterList();
    picker.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
      const e = catalog().byId[b.dataset.pick];
      const params = paramsFor(profile);
      const progress = await progressMap();
      const { mode, index } = ui.picker;
      if (mode === 'swap') {
        const old = r.items[index];
        r.items[index] = { ...makeItem(e, params, progress), sets: old.sets, restSec: old.restSec, slot: old.slot || e.slot, pinned: true };
        toast(`${e.name}(으)로 교체`, 1300);
      } else if (mode === 'add') {
        r.items.push({ ...makeItem(e, params, progress), pinned: true });
        toast(`${e.name} 추가`, 1300);
      } else if (mode === 'tabata') {
        r.tabata.exerciseIds.push(e.id); r.tabata.pinned = true;
      }
      ui.picker = null; ui.q = '';
      await saveRoutine(r); rerender();
    }));
  }
}

export function reset() { ui = { sel: ui.sel, picker: null, q: '' }; }
