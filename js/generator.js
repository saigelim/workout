// 프로그램 자동 생성 (규칙 기반 '빈칸 채우기')
// 프로필(목표·경험·횟수·시간·피할 부위) → 루틴 템플릿의 빈칸을 운동 DB의 동작으로 채움
import { catalog } from './catalog.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// 프로필에서 숫자 규칙 뽑기
export function paramsFor(profile) {
  const { rules } = catalog();
  const goal = rules.goals[profile.goal] || rules.goals.shape;
  const exp = rules.experience[String(profile.experience)] || rules.experience['1'];
  const extra = rules.minutesToExercises[String(profile.minutes)] ?? 0;
  return {
    goal, exp,
    exerciseCount: clamp(exp.exercises + extra, 3, 6),
    sets: clamp(exp.sets + (profile.experience >= 2 ? goal.setsBonus : 0), 2, 4),
    reps: goal.repRange[0],
    rest: goal.rest,
    maxLevel: exp.maxLevel
  };
}

function allowed(e, profile, maxLevel) {
  return e.level <= maxLevel && !e.avoidFor.some((a) => (profile.avoid || []).includes(a));
}

// 빈칸 하나에 들어갈 동작 고르기: 다른 루틴에서 덜 쓴 것 → 경험 수준에 가까운 난이도 → 데이터 순서
function pickForSlot(slot, profile, maxLevel, usedHere, usedCount) {
  const { active } = catalog();
  const cands = active.filter((e) => e.slot === slot && !usedHere.has(e.id) && allowed(e, profile, maxLevel));
  if (!cands.length) return null;
  const order = new Map(active.map((e, i) => [e.id, i]));
  cands.sort((a, b) =>
    (usedCount.get(a.id) || 0) - (usedCount.get(b.id) || 0) ||
    (maxLevel - a.level) - (maxLevel - b.level) ||
    order.get(a.id) - order.get(b.id));
  return cands[0];
}

function defaultTarget(e, params, progress) {
  const p = progress[e.id];
  if (e.loadType === 'time') return { reps: p?.reps ?? 30, weight: null };
  if (e.loadType === 'bodyweight') return { reps: p?.reps ?? params.reps, weight: null };
  return { reps: p?.reps ?? params.reps, weight: p?.weight ?? null }; // 무게 모르면 비워두기 (첫 운동 때 정함)
}

// 보조 운동(고립·코어·팔 등)은 무겁게 적게 하지 않고 10회 이상, 최대 3세트
const ACCESSORY = new Set(['quad_iso', 'ham_iso', 'shoulder_iso', 'arm', 'core', 'cardio']);

export function makeItem(e, params, progress = {}) {
  const t = defaultTarget(e, params, progress);
  let { reps } = t;
  let sets = params.sets;
  if (ACCESSORY.has(e.slot)) {
    sets = Math.min(sets, 3);
    if (e.loadType !== 'time' && !progress[e.id]) reps = Math.max(reps, e.slot === 'core' ? 12 : 10);
  }
  return { exerciseId: e.id, slot: e.slot, sets, reps, weight: t.weight, restSec: params.rest, pinned: false };
}

// 타바타 동작 고르기
// recency: { 동작id: 마지막으로 한 날짜 } → 오래 안 한 동작 먼저 / exclude: 이번엔 피할 동작
export function pickTabata(profile, focus, intensity, count = 2, { recency = {}, exclude = [] } = {}) {
  const { active } = catalog();
  const { maxLevel } = paramsFor(profile);
  let pool = active.filter((e) => e.tabataOk && allowed(e, profile, maxLevel));
  if (intensity === 'low') pool = pool.filter((e) => e.lowImpact);
  else if (intensity !== 'high') pool = pool.filter((e) => !e.highImpact);
  const prefer = {
    lower: ['squat', 'lunge', 'glute', 'cardio'],
    upper: ['push_h', 'core', 'cardio'],
    full: ['cardio', 'squat', 'core', 'push_h']
  }[focus] || [];
  if (pool.filter((e) => !exclude.includes(e.id)).length >= count) pool = pool.filter((e) => !exclude.includes(e.id));
  const lv = intensity === 'high' ? -1 : 1; // 고강도면 어려운 동작 먼저
  pool.sort((a, b) => {
    const ra = recency[a.id] || '', rb = recency[b.id] || '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    const ia = prefer.indexOf(a.slot), ib = prefer.indexOf(b.slot);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || lv * (a.level - b.level);
  });
  const out = [];
  const seenSlot = new Set();
  for (const e of pool) { if (!seenSlot.has(e.slot)) { out.push(e.id); seenSlot.add(e.slot); } if (out.length >= count) break; }
  for (const e of pool) { if (out.length >= count) break; if (!out.includes(e.id)) out.push(e.id); }
  return out;
}

export function tabataBlock(profile, focus) {
  const { exp } = paramsFor(profile);
  const d = profile.tabataDefault || { work: 20, rest: 10 };
  return {
    exerciseIds: pickTabata(profile, focus, exp.tabataIntensity),
    work: d.work, rest: d.rest, rounds: exp.tabataRounds, sets: exp.tabataSets
  };
}

// 전체 프로그램 만들기 → { program, routines }
export function generateProgram(profile, progress = {}) {
  const { templates } = catalog();
  const params = paramsFor(profile);
  const split = templates.splits[String(profile.daysPerWeek)] || templates.splits['3'];
  const extraSlot = profile.goal === 'shape' ? templates.focusExtraSlot[profile.focus] : null;

  // 타바타를 넣을 루틴: 매번이면 전부, 아니면 전신 → 상체 → 하체 순으로 주 N회
  const perWeek = params.goal.tabataPerWeek;
  const rank = { full: 0, upper: 1, lower: 2 };
  const withTabata = new Set(
    perWeek >= split.length ? split
      : [...split].sort((a, b) => rank[templates.routines[a].tabataFocus] - rank[templates.routines[b].tabataFocus]).slice(0, perWeek)
  );

  const usedCount = new Map();
  const routines = split.map((tid) => {
    const t = templates.routines[tid];
    let slots = [...t.slots];
    // 체형 집중 부위: 해당 부위가 아닌 날에도 한 칸 더
    if (extraSlot && !slots.slice(0, params.exerciseCount).includes(extraSlot)) slots.splice(2, 0, extraSlot);

    const usedHere = new Set();
    const items = [];
    for (const slot of slots) {
      if (items.length >= params.exerciseCount) break;
      const e = pickForSlot(slot, profile, params.maxLevel, usedHere, usedCount);
      if (!e) continue; // 이 칸에 쓸 동작이 없으면 건너뜀
      usedHere.add(e.id);
      usedCount.set(e.id, (usedCount.get(e.id) || 0) + 1);
      items.push(makeItem(e, params, progress));
    }
    return {
      id: tid, templateId: tid, name: t.name,
      items,
      tabata: withTabata.has(tid) ? tabataBlock(profile, t.tabataFocus) : null
    };
  });

  const program = {
    id: 'current',
    routineIds: routines.map((r) => r.id),
    nextIndex: 0,
    weeklyGoal: profile.daysPerWeek,
    createdAt: new Date().toISOString()
  };
  return { program, routines };
}

// 운동을 마친 뒤 루틴 돌리기: 고정(📌)하지 않은 동작을 같은 분류에서 '가장 오래 안 한 동작'으로 교체
export function rotateRoutine(routine, profile, progress = {}) {
  const { active, byId, templates } = catalog();
  const params = paramsFor(profile);
  const order = new Map(active.map((e, i) => [e.id, i]));
  const recency = Object.fromEntries(Object.values(progress).map((p) => [p.exerciseId, p.lastDoneAt || '']));
  const inRoutine = new Set(routine.items.filter((it) => it.pinned).map((it) => it.exerciseId));
  const changes = [];

  const items = routine.items.map((it) => {
    const cur = byId[it.exerciseId];
    const slot = it.slot || cur?.slot;
    if (it.pinned) {
      // 고정한 동작은 그대로, 목표 숫자만 최신 기록으로
      const p = progress[it.exerciseId];
      return p ? { ...it, reps: p.reps ?? it.reps, weight: p.weight ?? it.weight } : it;
    }
    const cands = active.filter((e) => e.slot === slot && !inRoutine.has(e.id) && allowed(e, profile, params.maxLevel));
    const others = cands.filter((e) => e.id !== it.exerciseId);
    const pool = others.length ? others : cands;
    pool.sort((a, b) =>
      (recency[a.id] || '').localeCompare(recency[b.id] || '') ||
      (params.maxLevel - a.level) - (params.maxLevel - b.level) ||
      order.get(a.id) - order.get(b.id));
    const e = pool[0] || cur;
    if (!e) return it;
    inRoutine.add(e.id);
    if (e.id !== it.exerciseId) changes.push([cur?.name, e.name]);
    return { ...makeItem(e, params, progress), slot, restSec: it.restSec };
  });

  let tabata = routine.tabata;
  if (tabata && !tabata.pinned) {
    const focus = templates.routines[routine.templateId]?.tabataFocus || 'full';
    tabata = { ...tabata, exerciseIds: pickTabata(profile, focus, params.exp.tabataIntensity, tabata.exerciseIds.length || 2, { recency, exclude: tabata.exerciseIds }) };
  }
  return { routine: { ...routine, items, tabata }, changes };
}
