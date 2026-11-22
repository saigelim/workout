import { db, counts, exportAll, importAll, SCHEMA_VERSION } from '../db.js';
import { cycleInfo } from '../cycle.js';
import { esc, toast, todayStr } from '../ui.js';
import { catalog } from '../catalog.js';
import { getProfile } from '../store.js';

const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const FOCUS = { lower_glute: '하체·엉덩이', upper_line: '상체·라인', balance: '균형' };

function profileCard(p) {
  if (!p) return `<div class="card"><h2>내 운동 설정</h2><p class="muted">아직 설정 전이에요.</p><a class="btn primary" href="#/onboarding">시작하기</a></div>`;
  const { rules } = catalog();
  const goal = rules.goals[p.goal]?.label + (p.goal === 'shape' && p.focus ? ` (${FOCUS[p.focus]})` : '');
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => p.preferredDays.includes(d)).map((d) => DAY[d]).join(' · ');
  const rows = [
    ['목표', goal], ['운동 경험', rules.experience[String(p.experience)]?.label],
    ['주 횟수 · 시간', `주 ${p.daysPerWeek}회 · ${p.minutes}분`], ['운동 요일', days],
    ['피하고 싶은 부위', p.avoid.length ? p.avoid.join(', ') : '없음']
  ];
  return `
    <a class="card link-card" href="#/onboarding">
      <h2>내 운동 설정</h2>
      ${rows.map(([k, v]) => `<div class="line"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
      <p class="muted">눌러서 수정 · 바꾸면 새로 추천받을지, 내 루틴을 유지할지 고를 수 있어요.</p>
    </a>`;
}

const LABEL = {
  profile: '설정', program: '프로그램', routines: '내 루틴', sessions: '운동 기록',
  progress: '다음 목표', cycles: '생리 기록', overrides: '일정 예외',
  exercisePrefs: '사용 안 함 동작', customExercises: '내가 추가한 운동'
};

export async function render(el) {
  const c = await counts();
  const profile = await getProfile();
  const cycleCount = await db.cycles.count();
  const lastCycle = await db.cycles.orderBy('startDate').last();
  const info = profile ? await cycleInfo(profile) : null;
  el.innerHTML = `
    <h1>설정</h1>
    ${profileCard(profile)}
    ${profile ? `
    <div class="card">
      <h2>생리 주기</h2>
      <div class="line"><span class="muted">최근 시작일</span><span>${esc(lastCycle?.startDate || '기록 없음')}</span></div>
      <div class="line"><span class="muted">평균 주기</span><span>${info ? `${info.cycleLength}일${cycleCount > 1 ? ' (기록으로 자동 계산)' : ''}` : `${profile.cycleLength || 28}일`}</span></div>
      <label class="field">생리 기간(일)<input id="period-len" type="number" inputmode="numeric" min="2" max="10" value="${profile.periodLength || 5}"></label>
      ${cycleCount <= 1 ? `<label class="field">평균 주기(일) · 기록이 2번 이상 쌓이면 자동으로 계산돼요<input id="cycle-len" type="number" inputmode="numeric" min="20" max="45" value="${profile.cycleLength || 28}"></label>` : ''}
      <label class="check"><input type="checkbox" id="cycle-sug" ${profile.cycleSuggestions !== false ? 'checked' : ''}> 주기에 맞춘 운동 제안 (생리 기간엔 강도 낮추기)</label>
      <a class="btn small" href="#/calendar">캘린더에서 생리 기록하기</a>
    </div>` : ''}

    <a class="card link-card" href="#/exercises">
      <h2>운동 DB 관리</h2>
      <p class="muted">동작별 사용 여부 체크 · 내 운동 추가</p>
    </a>

    <div class="card">
      <h2>저장된 데이터</h2>
      <p class="muted">모든 데이터는 이 휴대폰 안에만 저장돼요.</p>
      <div class="stat-list">
        ${Object.entries(LABEL).map(([k, v]) => `<div class="stat"><span class="muted">${esc(v)}</span><b>${c[k]}</b></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>기록 백업</h2>
      <p class="muted">휴대폰을 바꾸거나 브라우저 데이터를 지우기 전에 꼭 백업 파일을 저장해 두세요.</p>
      <div class="row">
        <button class="btn" id="export">내보내기</button>
        <label class="btn" for="import-file">가져오기</label>
      </div>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
    </div>

    <p class="muted">이 앱은 일반적인 운동 정보를 제공하며 의료 조언을 대신하지 않아요. 통증이 있거나 임신 중이거나 질환이 있다면 운동 전에 전문가와 상담하세요.</p>
    <p class="muted">데이터 구조 버전 ${SCHEMA_VERSION}</p>
  `;

  const saveP = async (patch, msg) => { await db.profile.put({ ...(await getProfile()), ...patch }); toast(msg, 1400); };
  el.querySelector('#period-len')?.addEventListener('change', (e) => saveP({ periodLength: Math.max(2, Math.min(10, Number(e.target.value) || 5)) }, '저장됨'));
  el.querySelector('#cycle-len')?.addEventListener('change', (e) => saveP({ cycleLength: Math.max(20, Math.min(45, Number(e.target.value) || 28)) }, '저장됨'));
  el.querySelector('#cycle-sug')?.addEventListener('change', (e) => saveP({ cycleSuggestions: e.target.checked }, e.target.checked ? '주기 제안을 켰어요' : '주기 제안을 껐어요'));

  el.querySelector('#export').addEventListener('click', async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `운동기록-백업-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('백업 파일을 저장했어요');
  });

  el.querySelector('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await importAll(data);
      toast('백업을 불러왔어요');
      render(el);
    } catch (err) {
      toast(err.message || '불러오지 못했어요');
    }
  });
}
