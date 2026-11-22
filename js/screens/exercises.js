// 운동 DB 관리: 동작별 사용 여부 체크 · 내 운동 추가/수정
import { catalog, setEnabled, SLOT_LABEL } from '../catalog.js';
import { esc, toast } from '../ui.js';

let filter = 'all'; // all | on | off | custom

const FILTERS = { all: '전체', on: '사용 중', off: '사용 안 함', custom: '내가 추가한' };

function visible(e) {
  if (filter === 'on') return e.enabled;
  if (filter === 'off') return !e.enabled;
  if (filter === 'custom') return e.custom;
  return true;
}

function row(e) {
  return `
    <div class="ex-row ${e.enabled ? '' : 'is-off'}">
      <label class="switch">
        <input type="checkbox" data-toggle="${esc(e.id)}" ${e.enabled ? 'checked' : ''} aria-label="${esc(e.name)} 사용">
        <span class="switch-ui" aria-hidden="true"></span>
      </label>
      <details class="ex-detail">
        <summary>
          <span class="ex-name">${esc(e.name)}${e.tabataOk ? ' ⏱' : ''}${e.tabataOk && e.lowImpact ? '🌿' : ''}${e.custom ? ' <span class="tag">내 운동</span>' : ''}</span>
          <span class="muted">${esc(e.equipment)} · Lv${e.level}</span>
        </summary>
        <ul class="muted tips">
          ${(e.tips || []).map((t) => `<li>${esc(t)}</li>`).join('')}
          ${e.avoidFor.length ? `<li>주의 부위: ${esc(e.avoidFor.join(', '))}</li>` : ''}
        </ul>
        ${e.custom ? `<a class="btn" href="#/exercises/edit/${encodeURIComponent(e.id)}">수정</a>` : ''}
      </details>
    </div>`;
}

export async function render(el) {
  const { exercises } = catalog();
  const onCount = exercises.filter((e) => e.enabled).length;

  const groups = {};
  for (const e of exercises) (groups[e.slot] ||= []).push(e);

  const sections = Object.entries(SLOT_LABEL).map(([slot, label]) => {
    const all = groups[slot] || [];
    const list = all.filter(visible);
    if (!list.length) return '';
    const noneOn = all.length && !all.some((e) => e.enabled);
    return `
      <section class="card">
        <h2>${esc(label)}</h2>
        ${noneOn ? '<p class="warn">이 분류에 사용 중인 동작이 없어요. 추천에서 이 칸이 빠져요.</p>' : ''}
        ${list.map(row).join('')}
      </section>`;
  }).join('');

  el.innerHTML = `
    <a href="#/settings" class="back">← 설정</a>
    <div class="head-row">
      <h1>운동 DB</h1>
      <a class="btn primary" href="#/exercises/new">+ 내 운동</a>
    </div>
    <p class="muted">사용 중 ${onCount} / 전체 ${exercises.length} · 끈 동작은 추천과 교체 목록에서 빠져요.</p>
    <div class="chips" role="group" aria-label="보기">
      ${Object.entries(FILTERS).map(([k, v]) =>
        `<button class="chip" data-filter="${k}" aria-pressed="${filter === k}">${v}</button>`).join('')}
    </div>
    ${sections || '<div class="card"><p class="muted">해당하는 동작이 없어요.</p></div>'}
    <p class="muted">⏱ 타바타 가능 · 🌿 저강도 · Lv 1 초급 ~ 3 상급</p>
  `;

  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    render(el);
  }));

  el.querySelectorAll('[data-toggle]').forEach((input) => input.addEventListener('change', async () => {
    const y = window.scrollY;
    await setEnabled(input.dataset.toggle, input.checked);
    toast(input.checked ? '사용으로 바꿨어요' : '사용 안 함으로 바꿨어요', 1400);
    await render(el);
    window.scrollTo(0, y);
  }));
}
