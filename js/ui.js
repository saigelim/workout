// 화면을 그릴 때 쓰는 작은 도구들

// 화면을 옮겨도 잠깐 전달할 메시지 (예: 운동 저장 결과)
export const flash = {};

// 사용자가 입력한 글자를 화면에 넣을 때 HTML로 해석되지 않게 막기
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function koreanDate(d = new Date()) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`;
}

// 아직 안 만든 단계의 화면
export function comingSoon(title, step, items) {
  return `
    <h1>${esc(title)}</h1>
    <div class="card">
      <p><b>${esc(step)}</b>에서 만들어요.</p>
      <ul class="muted" style="margin:0;padding-left:18px;line-height:1.8">
        ${items.map((i) => `<li>${esc(i)}</li>`).join('')}
      </ul>
    </div>`;
}
