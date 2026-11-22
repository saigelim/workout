// 일정 계산 — 날짜마다 저장하지 않고 규칙으로 계산해요.
// 규칙: 운동 요일(설정) + 예외(overrides: rest/workout/skip) + 프로그램 순서(nextIndex)
// 운동을 못 한 날이 있으면 순서가 넘어가지 않으니, 자연스럽게 다음 운동일로 이어져요.
import { db } from './db.js';
import { todayStr } from './ui.js';

export const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
export const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => new Date(s + 'T00:00:00');
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ds(d); };

export async function loadContext() {
  const [profile, program, overrides, sessions] = await Promise.all([
    db.profile.get('me'), db.program.get('current'), db.overrides.toArray(), db.sessions.toArray()
  ]);
  const ov = Object.fromEntries(overrides.map((o) => [o.date, o]));
  const byDate = {};
  for (const s of sessions) (byDate[s.date] ||= []).push(s);
  const routines = program ? Object.fromEntries((await db.routines.bulkGet(program.routineIds)).filter(Boolean).map((r) => [r.id, r])) : {};
  return { profile, program, ov, byDate, routines, today: todayStr() };
}

// 그날이 (규칙상) 운동일인지
export function isWorkoutDay(ctx, date) {
  const o = ctx.ov[date];
  if (o?.type === 'rest') return false;
  if (o?.type === 'workout') return true;
  return (ctx.profile?.preferredDays || []).includes(parse(date).getDay());
}

const programDone = (ctx, date) => (ctx.byDate[date] || []).find((s) => s.kind === 'program');

// 오늘부터 앞으로 n일의 계획: { date: { routineId } }
export function planAhead(ctx, n = 62) {
  const plan = {};
  const { program } = ctx;
  if (!program || !program.routineIds.length) return plan;
  let idx = program.nextIndex;
  for (let i = 0; i < n; i++) {
    const date = addDays(ctx.today, i);
    if (i === 0 && programDone(ctx, date)) continue; // 오늘 이미 했으면 내일부터
    if (isWorkoutDay(ctx, date)) {
      plan[date] = { routineId: program.routineIds[idx % program.routineIds.length] };
      idx++;
    }
  }
  return plan;
}

// 날짜 하나의 상태: done | planned | missed | skipped | rest | before(프로그램 시작 전)
export function dayStatus(ctx, date, plan) {
  const sessions = ctx.byDate[date] || [];
  if (sessions.length) return { status: 'done', sessions };
  if (date >= ctx.today) return plan[date] ? { status: 'planned', routineId: plan[date].routineId } : { status: 'rest' };
  const start = ctx.program?.createdAt ? ds(new Date(ctx.program.createdAt)) : ctx.today;
  if (date < start) return { status: 'before' };
  if (ctx.ov[date]?.type === 'skip') return { status: 'skipped' };
  return isWorkoutDay(ctx, date) ? { status: 'missed' } : { status: 'rest' };
}

// 지난 운동 이후 놓친 운동일 (가장 최근 것)
export async function lastMissed(ctx) {
  if (!ctx.program) return null;
  const ack = (await db.meta.get('missedAck'))?.value || '';
  const start = ds(new Date(ctx.program.createdAt));
  for (let i = 1; i <= 14; i++) {
    const date = addDays(ctx.today, -i);
    if (date < start || date <= ack) return null;
    if (programDone(ctx, date)) return null;
    if (ctx.ov[date]?.type === 'skip') return null;
    if (isWorkoutDay(ctx, date)) return date;
  }
  return null;
}

export async function setOverride(date, type) {
  if (!type) await db.overrides.delete(date);
  else await db.overrides.put({ date, type });
}

// 이번 주(월~일) 운동 수: 한 것 + 남은 계획
export function weekCount(ctx, plan) {
  const t = parse(ctx.today);
  const mon = addDays(ctx.today, -((t.getDay() + 6) % 7));
  let done = 0, planned = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i);
    if (programDone(ctx, d)) done++;
    else if (d >= ctx.today && plan[d]) planned++;
  }
  return { done, planned, mon };
}

// 오늘 미루기: 'tomorrow' | 'next' | 날짜(YYYY-MM-DD)
export async function postponeToday(ctx, how) {
  await setOverride(ctx.today, 'rest');
  const target = how === 'tomorrow' ? addDays(ctx.today, 1) : how === 'next' ? null : how;
  if (target && !isWorkoutDay({ ...ctx, ov: { ...ctx.ov, [ctx.today]: { type: 'rest' } } }, target)) {
    await setOverride(target, 'workout');
  }
}
