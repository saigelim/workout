// 사용자 데이터 저장소 (휴대폰 안의 IndexedDB)
// 시트(테이블)마다 '어떤 항목으로 찾을지'만 적어둡니다. 나머지 항목은 자유롭게 저장돼요.
import Dexie from './vendor/dexie.mjs';

export const SCHEMA_VERSION = 2;

export const db = new Dexie('fitapp');

db.version(1).stores({
  profile: 'id',                       // 설정 (한 줄, id = 'me')
  program: 'id',                       // 프로그램 (한 줄, id = 'current')
  routines: 'id',                      // 내 루틴
  sessions: 'id, date, routineId',     // 운동 기록
  progress: 'exerciseId',              // 운동별 다음 목표
  cycles: 'startDate',                 // 생리 기록
  overrides: 'date',                   // 일정 예외 (미루기·추가·건너뛰기)
  meta: 'key'                          // 앱 정보 (schemaVersion 등)
});

// 버전 2: 운동 DB 사용 여부 · 내가 추가한 운동
db.version(2).stores({
  exercisePrefs: 'id',                 // { id, disabled: true } 사용 안 함으로 체크한 동작
  customExercises: 'id'                // 내가 추가한 동작 (기본 동작과 같은 항목 구조)
});

const TABLES = ['profile', 'program', 'routines', 'sessions', 'progress', 'cycles', 'overrides', 'exercisePrefs', 'customExercises'];

export async function initDB() {
  await db.open();
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  // 브라우저가 저장공간 정리할 때 데이터를 지우지 않도록 요청
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (e) { /* 무시 */ }
  }
}

export async function counts() {
  const out = {};
  for (const t of TABLES) out[t] = await db[t].count();
  return out;
}

// 백업: 모든 사용자 데이터를 JSON 하나로
export async function exportAll() {
  const data = { app: 'fitapp', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of TABLES) data.tables[t] = await db[t].toArray();
  return data;
}

// 복원: 백업 파일 내용으로 전부 교체
export async function importAll(data) {
  if (!data || data.app !== 'fitapp' || !data.tables) throw new Error('이 앱의 백업 파일이 아니에요.');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error('더 새로운 버전의 앱에서 만든 백업이에요.');
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) {
      await db[t].clear();
      const rows = data.tables[t] || [];
      if (rows.length) await db[t].bulkPut(rows);
    }
  });
}

export async function wipeAll() {
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    for (const t of TABLES) await db[t].clear();
  });
}
