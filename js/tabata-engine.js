// 타바타 타이머 엔진
// 시간을 '1초씩 세는' 대신 '시작한 시각'을 기준으로 계산해요.
// 그래서 화면이 꺼지거나 다른 앱을 봐도, 돌아왔을 때 정확한 위치에서 이어져요.

// 설정 → 구간(phase) 목록: 준비 → (운동·휴식) × 라운드 → 세트 사이 휴식 → ...
export function buildPhases({ work, rest, rounds, sets, prep = 10, setRest = 60, exerciseIds = [] }) {
  const phases = [];
  if (prep > 0) phases.push({ type: 'prep', dur: prep, round: 0, set: 1 });
  let n = 0;
  for (let s = 1; s <= sets; s++) {
    for (let r = 1; r <= rounds; r++) {
      const ex = exerciseIds.length ? exerciseIds[n % exerciseIds.length] : null;
      n++;
      phases.push({ type: 'work', dur: work, round: r, set: s, exId: ex });
      const lastInSet = r === rounds;
      if (!lastInSet && rest > 0) phases.push({ type: 'rest', dur: rest, round: r, set: s });
    }
    if (s < sets && setRest > 0) phases.push({ type: 'setrest', dur: setRest, round: rounds, set: s });
  }
  let t = 0;
  for (const p of phases) { p.start = t; t += p.dur; }
  return { phases, total: t };
}

export class TabataClock {
  constructor(config, { onPhase, onBeep, onDone } = {}) {
    this.config = config;
    Object.assign(this, buildPhases(config));
    this.onPhase = onPhase; this.onBeep = onBeep; this.onDone = onDone;
    this.startAt = 0; this.pausedAt = 0; this.offset = 0; // offset: 앞/뒤로 건너뛴 시간 + 멈춘 시간
    this.running = false; this.done = false;
    this.lastPhase = -1; this.lastBeep = '';
  }
  start() { this.startAt = Date.now(); this.running = true; this.tick(); }
  elapsed() {
    if (!this.startAt) return 0;
    const now = this.running ? Date.now() : this.pausedAt;
    return Math.max(0, (now - this.startAt) / 1000 + this.offset);
  }
  pause() { if (this.running && !this.done) { this.pausedAt = Date.now(); this.running = false; } }
  resume() { if (!this.running && !this.done) { this.offset -= (Date.now() - this.pausedAt) / 1000; this.running = true; } }
  jumpTo(sec) {
    const target = Math.max(0, Math.min(this.total, sec));
    this.offset += target - this.elapsed();
    this.lastBeep = '';
  }
  skip() { const i = this.index(); const p = this.phases[i]; if (p) this.jumpTo(p.start + p.dur); }
  back() {
    const i = this.index(); const p = this.phases[i];
    if (!p) return;
    // 구간 시작 후 2초가 지났으면 그 구간 처음으로, 아니면 이전 구간으로
    if (this.elapsed() - p.start > 2 || i === 0) this.jumpTo(p.start);
    else this.jumpTo(this.phases[i - 1].start);
  }
  index(t = this.elapsed()) {
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      if (t < p.start + p.dur) return i;
    }
    return this.phases.length;
  }
  // 끝난 운동 구간 수 = 완료한 라운드
  roundsDone(t = this.elapsed()) {
    return this.phases.filter((p) => p.type === 'work' && t >= p.start + p.dur - 0.05).length;
  }
  totalRounds() { return this.phases.filter((p) => p.type === 'work').length; }

  // 화면이 매번 부르는 함수: 현재 상태를 돌려주고, 소리·진동 시점을 알려줌
  tick() {
    const t = this.elapsed();
    const i = this.index(t);
    if (i >= this.phases.length) {
      if (!this.done) { this.pausedAt = Date.now(); this.done = true; this.running = false; this.onBeep?.('end'); this.onDone?.(); }
      return { done: true, roundsDone: this.roundsDone(t), total: this.totalRounds() };
    }
    const p = this.phases[i];
    const left = Math.ceil(p.start + p.dur - t - 1e-6);
    if (i !== this.lastPhase) {
      this.lastPhase = i;
      this.onPhase?.(p, i);
      if (this.running && this.startAt) this.onBeep?.(p.type === 'work' ? 'go' : 'rest');
    }
    const key = `${i}:${left}`;
    if (this.running && left <= 3 && left >= 1 && key !== this.lastBeep) { this.lastBeep = key; this.onBeep?.('count'); }
    const next = this.phases.slice(i + 1).find((x) => x.type === 'work');
    return { done: false, phase: p, index: i, left, next, roundsDone: this.roundsDone(t), total: this.totalRounds(), elapsed: t };
  }
}

// 소리: 별도 파일 없이 브라우저에서 '삐' 소리 만들기
let ctx = null;
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { ctx = null; }
}
export function beep(kind) {
  if (!ctx) return;
  const spec = { count: [660, 0.12], go: [990, 0.45], rest: [440, 0.45], end: [880, 0.9] }[kind] || [660, 0.12];
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = spec[0];
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + spec[1]);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + spec[1] + 0.05);
}

// 화면 꺼짐 방지 (지원하는 브라우저에서만)
let lock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch (e) { lock = null; }
}
