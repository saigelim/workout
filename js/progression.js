// 점진적 과부하: 운동 후 난이도 평가 → 다음 목표 (무게·횟수)
import { catalog } from './catalog.js';

const ACCESSORY = new Set(['quad_iso', 'ham_iso', 'shoulder_iso', 'arm', 'core', 'cardio']);

function repRange(e, profile) {
  const { rules } = catalog();
  const [lo, hi] = (rules.goals[profile.goal] || rules.goals.shape).repRange;
  if (ACCESSORY.has(e.slot)) return [Math.max(lo, 10), Math.max(hi, 15)];
  return [lo, hi];
}

const roundTo = (x, step) => (step > 0 ? Math.round(x / step) * step : Math.round(x * 2) / 2);

// cur: { weight, reps, hardStreak }  /  done: 실제로 한 세트들 [{weight, reps, done}]
// 반환: { weight, reps, hardStreak, note }
export function nextTarget(e, cur, done, rating, profile) {
  const { rules } = catalog();
  const pr = rules.progression;
  const [lo, hi] = repRange(e, profile);
  const doneSets = done.filter((s) => s.done);
  // 무게를 처음 정했거나 계획과 다르게 했으면, 실제로 든 무게를 기준으로
  const usedW = doneSets.map((s) => Number(s.weight)).filter((w) => Number.isFinite(w) && w > 0);
  let weight = usedW.length ? Math.max(...usedW) : (cur.weight ?? null);
  let reps = cur.reps ?? lo;
  let hardStreak = cur.hardStreak || 0;
  const inc = e.increment || 0;
  const hasWeight = (e.loadType === 'weight' || e.loadType === 'assisted') && weight != null && inc > 0;
  let note = '';

  if (!rating || !doneSets.length) return { weight, reps, hardStreak, note: '그대로 유지' };

  if (e.loadType === 'time') {
    if (rating === 'hard') { hardStreak++; if (hardStreak >= pr.hard.streakToDeload) { reps = Math.max(15, reps - 10); hardStreak = 0; } }
    else { reps += rating === 'easy' ? 10 : 5; hardStreak = 0; }
    return { weight: null, reps, hardStreak, note: `다음엔 ${reps}초` };
  }

  if (rating === 'hard') {
    hardStreak++;
    if (hardStreak >= pr.hard.streakToDeload) {
      hardStreak = 0;
      if (hasWeight && e.loadType === 'weight') { weight = Math.max(inc, roundTo(weight * pr.hard.deloadRatio, inc)); note = `2번 연속 힘들어서 ${weight}kg로 낮출게요`; }
      else if (hasWeight && e.loadType === 'assisted') { weight = weight + inc; note = `보조 무게를 ${weight}kg로 올릴게요`; }
      else { reps = Math.max(lo, reps - 2); note = `${reps}회로 줄일게요`; }
    } else note = '다음에도 같은 목표로 해요';
    return { weight, reps, hardStreak, note };
  }

  hardStreak = 0;
  reps += rating === 'easy' ? pr.easy.reps : pr.ok.reps;
  if (reps > hi && hasWeight) {
    reps = lo;
    if (e.loadType === 'assisted') weight = Math.max(0, weight - inc);
    else weight = roundTo(weight + inc, inc);
    note = e.loadType === 'assisted' ? `보조 ${weight}kg × ${reps}회로 (더 어렵게)` : `${weight}kg × ${reps}회로 무게를 올려요`;
  } else {
    if (e.loadType === 'bodyweight') reps = Math.min(reps, hi + 10); // 맨몸은 횟수로 계속 늘리기
    else reps = Math.min(reps, hi);
    note = `다음엔 ${weight != null && e.loadType !== 'bodyweight' ? `${weight}kg × ` : ''}${reps}회`;
  }
  return { weight, reps, hardStreak, note };
}
