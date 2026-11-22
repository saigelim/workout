// 생리 주기 계산: 기록과 설정으로 '오늘의 단계'를 추정
import { db } from './db.js';
import { catalog } from './catalog.js';

const DAY = 86400000;
const parse = (s) => new Date(s + 'T00:00:00');

export async function cycleInfo(profile, date = new Date()) {
  const { rules } = catalog();
  const c = rules.cycle;
  const logs = (await db.cycles.orderBy('startDate').toArray());
  if (!logs.length) return null;

  // 평균 주기: 최근 기록들의 시작일 간격 평균 (기록이 1개면 설정값)
  const starts = logs.map((l) => parse(l.startDate));
  const gaps = [];
  for (let i = 1; i < starts.length; i++) gaps.push(Math.round((starts[i] - starts[i - 1]) / DAY));
  const recent = gaps.filter((g) => g >= 18 && g <= 50).slice(-c.averageOf);
  const cycleLength = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : (profile?.cycleLength || c.defaultCycleLength);
  const periodLength = profile?.periodLength || c.defaultPeriodLength;

  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const last = [...starts].reverse().find((s) => s <= today);
  if (!last) return null;
  const dayIdx = Math.round((today - last) / DAY);
  if (dayIdx > cycleLength * 1.5) return { key: null, cycleLength, periodLength, day: dayIdx + 1 }; // 기록이 오래돼서 추정 안 함

  const ovu = cycleLength - c.lutealLength;
  const key = dayIdx < periodLength ? 'menstrual'
    : Math.abs(dayIdx - ovu) <= 1 ? 'ovulation'
    : dayIdx < ovu ? 'follicular' : 'luteal';
  const next = new Date(last.getTime() + cycleLength * DAY);
  return { key, ...c.phases[key], day: dayIdx + 1, cycleLength, periodLength, nextStart: next };
}
