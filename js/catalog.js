// 운동 데이터 모음
// - 앱에 포함된 기본 데이터: 운동 DB, 루틴 템플릿, 규칙표 (data/*.json, 읽기 전용)
// - 사용자 데이터: '사용 안 함' 체크, 내가 추가한 운동 (db)
// 두 가지를 합쳐서 화면과 추천 로직에 넘겨줍니다.
import { db } from './db.js';

export const SLOT_LABEL = {
  squat: '하체 · 스쿼트', lunge: '하체 · 런지', quad_iso: '하체 · 앞벅지',
  hinge: '하체 · 힌지', glute: '하체 · 엉덩이', ham_iso: '하체 · 뒷벅지',
  push_h: '상체 · 가슴', push_v: '상체 · 어깨 프레스', shoulder_iso: '상체 · 어깨',
  arm: '상체 · 팔', pull_v: '상체 · 등(위에서 당기기)', pull_h: '상체 · 등(앞에서 당기기)',
  core: '코어', cardio: '전신 · 유산소'
};

export const SLOT_BODYPART = {
  squat: '하체', lunge: '하체', quad_iso: '하체', hinge: '하체', glute: '하체', ham_iso: '하체',
  push_h: '상체', push_v: '상체', shoulder_iso: '상체', arm: '상체', pull_v: '상체', pull_h: '상체',
  core: '코어', cardio: '전신'
};

export const EQUIPMENT = ['머신', '덤벨', '바벨', '케이블', '케틀벨', '맨몸', '밴드', '기타'];
export const AVOID_PARTS = ['무릎', '허리', '어깨', '손목'];
export const LOAD_TYPES = { weight: '무게 × 횟수', bodyweight: '횟수만 (맨몸)', time: '시간 (초)', assisted: '보조 무게 × 횟수' };

let base = null;    // 기본 데이터 (파일)
let merged = null;  // 기본 + 사용자 데이터

export async function loadCatalog() {
  if (!base) {
    const [exercises, templates, rules] = await Promise.all([
      fetch('data/exercises.json').then((r) => r.json()),
      fetch('data/templates.json').then((r) => r.json()),
      fetch('data/rules.json').then((r) => r.json())
    ]);
    base = { exercises, templates, rules };
  }
  return refreshCatalog();
}

// '사용 안 함'이나 '내 운동'이 바뀔 때마다 다시 합치기
export async function refreshCatalog() {
  const [prefs, customs] = await Promise.all([db.exercisePrefs.toArray(), db.customExercises.toArray()]);
  const disabled = new Set(prefs.filter((p) => p.disabled).map((p) => p.id));
  const exercises = [
    ...base.exercises.map((e) => ({ ...e, custom: false })),
    ...customs.map((e) => ({ ...e, custom: true }))
  ].map((e) => ({ ...e, enabled: !disabled.has(e.id) }));

  merged = {
    exercises,                                        // 전체 (사용 안 함 포함)
    active: exercises.filter((e) => e.enabled),       // 추천에 쓰는 동작
    byId: Object.fromEntries(exercises.map((e) => [e.id, e])),
    templates: base.templates,
    rules: base.rules
  };
  return merged;
}

export function catalog() {
  if (!merged) throw new Error('catalog not loaded');
  return merged;
}

export async function setEnabled(id, enabled) {
  if (enabled) await db.exercisePrefs.delete(id);
  else await db.exercisePrefs.put({ id, disabled: true });
  await refreshCatalog();
}

export async function saveCustomExercise(ex) {
  await db.customExercises.put(ex);
  await refreshCatalog();
}

// 기록이나 루틴에 쓰인 동작인지 (쓰였으면 지우지 않고 '사용 안 함'으로)
export async function isExerciseUsed(id) {
  const routines = await db.routines.toArray();
  if (routines.some((r) => (r.items || []).some((i) => i.exerciseId === id) ||
      (r.tabata?.exerciseIds || []).includes(id))) return true;
  const sessions = await db.sessions.toArray();
  return sessions.some((s) => (s.exercises || []).some((x) => x.exerciseId === id) ||
    (s.tabata?.exerciseIds || []).includes(id));
}

export async function deleteCustomExercise(id) {
  if (await isExerciseUsed(id)) {
    await setEnabled(id, false);
    return 'disabled';
  }
  await db.customExercises.delete(id);
  await db.exercisePrefs.delete(id);
  await refreshCatalog();
  return 'deleted';
}

// 같은 빈칸(slot)에 들어갈 수 있는 동작 = 교체 후보 (사용 중인 동작만)
export function alternativesFor(exerciseId, { maxLevel = 3, avoid = [] } = {}) {
  const { active, byId } = catalog();
  const me = byId[exerciseId];
  if (!me) return [];
  return active.filter((e) =>
    e.id !== me.id &&
    e.slot === me.slot &&
    e.level <= maxLevel &&
    !e.avoidFor.some((a) => avoid.includes(a))
  );
}
