// 여러 시트를 함께 바꾸는 작업 모음
import { db } from './db.js';
import { generateProgram } from './generator.js';
import { catalog } from './catalog.js';
import { pickTabata, rotateRoutine } from './generator.js';
import { nextTarget } from './progression.js';
import { todayStr } from './ui.js';

export async function getProfile() { return db.profile.get('me'); }
export async function getProgram() { return db.program.get('current'); }

export async function progressMap() {
  const rows = await db.progress.toArray();
  return Object.fromEntries(rows.map((r) => [r.exerciseId, r]));
}

// 프로필 저장 + (원하면) 프로그램 새로 추천
export async function saveProfile(profile, { regenerate }) {
  if (!regenerate) { await db.profile.put(profile); return; }
  const { program, routines } = generateProgram(profile, await progressMap());
  await db.transaction('rw', db.profile, db.program, db.routines, async () => {
    await db.profile.put(profile);
    await db.routines.clear();
    await db.routines.bulkPut(routines);
    await db.program.put(program);
  });
}

// 생리 시작일 기록 (같은 날짜면 덮어쓰기)
export async function saveCycleStart(startDate, periodLength) {
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + Math.max(1, periodLength) - 1);
  const p = (n) => String(n).padStart(2, '0');
  const endDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  await db.cycles.put({ startDate, endDate });
}

export async function saveRoutine(routine) {
  await db.routines.put(routine);
  // 목표 무게·횟수를 바꾸면 다른 루틴의 같은 동작에도 다음 추천값으로 쓰이도록 저장
  for (const it of routine.items) {
    const prev = await db.progress.get(it.exerciseId);
    await db.progress.put({ ...(prev || { hardStreak: 0 }), exerciseId: it.exerciseId, weight: it.weight, reps: it.reps, sets: it.sets });
  }
}

// ───────── 4단계: 운동 세션 ─────────

export async function getActive() { return (await db.meta.get('active'))?.value || null; }
export async function saveActive(a) { await db.meta.put({ key: 'active', value: a }); }
export async function discardActive() { await db.meta.delete('active'); }

// 컨디션·생리 주기를 반영해서 오늘 할 내용 만들기
export function planAdjust(profile, condition, phase) {
  const { rules } = catalog();
  const c = rules.condition[condition] || rules.condition.normal;
  const usePhase = profile.cycleSuggestions && phase?.key;
  const delta = Math.min(c.setsDelta || 0, usePhase ? (phase.setsDelta || 0) : 0);
  const lowTabata = c.tabata === 'low' || (usePhase && phase.tabata === 'low');
  return { delta, lowTabata };
}

export async function startSession(routine, profile, condition, phase, kind = 'program') {
  const { byId, templates } = catalog();
  const { delta, lowTabata } = planAdjust(profile, condition, phase);
  const exercises = routine.items.filter((it) => byId[it.exerciseId]).map((it) => ({
    exerciseId: it.exerciseId,
    slot: it.slot || byId[it.exerciseId].slot,
    targetReps: it.reps, targetWeight: it.weight, restSec: it.restSec,
    sets: Array.from({ length: Math.max(1, it.sets + delta) }, () => ({ weight: it.weight, reps: it.reps, done: false })),
    rating: null
  }));
  let tabata = routine.tabata ? { ...routine.tabata, roundsDone: null } : null;
  if (tabata && lowTabata) {
    const focus = templates.routines[routine.templateId]?.tabataFocus || 'full';
    tabata.exerciseIds = pickTabata(profile, focus, 'low', tabata.exerciseIds.length || 2);
  }
  const active = {
    id: `s_${Date.now().toString(36)}`,
    kind, routineId: routine.id, routineName: routine.name,
    date: todayStr(), startedAt: new Date().toISOString(),
    condition, cyclePhase: phase?.key || null, adjusted: { delta, lowTabata },
    stage: 'run', current: 0, exercises, tabata
  };
  await saveActive(active);
  return active;
}

export async function finishSession(active, profile) {
  const { byId } = catalog();
  const progress = await progressMap();
  const notes = [];
  for (const x of active.exercises) {
    const e = byId[x.exerciseId];
    if (!e || !x.sets.some((s) => s.done)) continue;
    const cur = progress[x.exerciseId] || { weight: x.targetWeight, reps: x.targetReps, hardStreak: 0 };
    const t = nextTarget(e, { ...cur, reps: x.targetReps ?? cur.reps, weight: cur.weight ?? x.targetWeight }, x.sets, x.rating, profile);
    progress[x.exerciseId] = {
      ...cur, exerciseId: x.exerciseId, weight: t.weight, reps: t.reps, hardStreak: t.hardStreak,
      lastDoneAt: active.date, timesDone: (cur.timesDone || 0) + 1, lastRating: x.rating
    };
    notes.push([e.name, t.note]);
  }
  if (active.tabata && active.tabata.roundsDone > 0) {
    for (const id of active.tabata.exerciseIds) {
      const cur = progress[id] || { exerciseId: id, hardStreak: 0 };
      progress[id] = { ...cur, exerciseId: id, lastDoneAt: active.date, timesDone: (cur.timesDone || 0) + 1 };
    }
  }

  const session = {
    id: active.id, date: active.date, startedAt: active.startedAt, endedAt: new Date().toISOString(),
    kind: active.kind || 'program', routineId: active.routineId, routineName: active.routineName,
    condition: active.condition, cyclePhase: active.cyclePhase,
    exercises: active.exercises.map((x) => ({
      exerciseId: x.exerciseId, name: byId[x.exerciseId]?.name || x.exerciseId,
      sets: x.sets.filter((s) => s.done).map(({ weight, reps }) => ({ weight, reps })),
      rating: x.rating, skipped: !x.sets.some((s) => s.done)
    })),
    tabata: active.tabata ? {
      exerciseIds: active.tabata.exerciseIds, names: active.tabata.exerciseIds.map((id) => byId[id]?.name || id),
      work: active.tabata.work, rest: active.tabata.rest, roundsPlanned: active.tabata.rounds * active.tabata.sets,
      roundsDone: active.tabata.roundsDone || 0, sets: active.tabata.sets
    } : null
  };

  const program = await getProgram();
  const routine = await db.routines.get(active.routineId);
  let changes = [];
  await db.transaction('rw', db.sessions, db.progress, db.program, db.routines, db.meta, async () => {
    await db.sessions.put(session);
    await db.progress.bulkPut(Object.values(progress));
    if (program && active.kind !== 'extra') {
      const idx = program.routineIds.indexOf(active.routineId);
      program.nextIndex = ((idx >= 0 ? idx : program.nextIndex) + 1) % program.routineIds.length;
      await db.program.put(program);
    }
    if (routine) {
      const r = rotateRoutine(routine, profile, progress);
      changes = r.changes;
      await db.routines.put(r.routine);
    }
    await db.meta.delete('active');
  });
  return { session, notes, changes };
}

// 이번 순서 건너뛰기 (놓친 운동을 하지 않고 다음 루틴으로)
export async function skipNext(missedDate) {
  const program = await getProgram();
  if (!program) return;
  program.nextIndex = (program.nextIndex + 1) % program.routineIds.length;
  await db.program.put(program);
  if (missedDate) await db.overrides.put({ date: missedDate, type: 'skip' });
}
