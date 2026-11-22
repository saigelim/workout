// 앱 시작점: 데이터 준비 → 화면 전환(라우터) → 오프라인 준비
import { initDB } from './db.js';
import { loadCatalog } from './catalog.js';
import * as today from './screens/today.js';
import * as program from './screens/program.js';
import * as timer from './screens/timer.js';
import * as calendar from './screens/calendar.js';
import * as settings from './screens/settings.js';
import * as exercises from './screens/exercises.js';
import * as exerciseForm from './screens/exercise-form.js';
import * as onboarding from './screens/onboarding.js';
import * as workout from './screens/workout.js';

const SCREENS = { today, program, timer, calendar, settings, exercises, onboarding, workout };
// 탭이 아닌 화면은 어느 탭에 속하는지
const PARENT_TAB = { exercises: 'settings' };
const screenEl = document.getElementById('screen');
let lastName = null;

async function route() {
  const parts = location.hash.replace(/^#\//, '').split('/').filter(Boolean);
  const name = SCREENS[parts[0]] ? parts[0] : 'today';
  const params = parts.slice(1);
  let screen = SCREENS[name];
  if (name === 'exercises' && params.length) screen = exerciseForm;
  // 다른 화면으로 옮기면 이전 화면의 임시 상태(열린 패널 등)를 비우기
  if (lastName && lastName !== name) SCREENS[lastName].reset?.();
  lastName = name;
  document.body.classList.toggle('no-tabbar', name === 'onboarding' || name === 'workout' || (name === 'timer' && params.length > 0));
  const tab = PARENT_TAB[name] || name;
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    await screen.render(screenEl, params);
  } catch (err) {
    console.error(err);
    screenEl.innerHTML = `<h1>문제가 생겼어요</h1><p class="muted">${String(err.message || err)}</p>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  await initDB();
  await loadCatalog();
  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); }
    catch (e) { console.warn('오프라인 준비 실패', e); }
  }
}

start().catch((err) => {
  console.error(err);
  screenEl.innerHTML = `<h1>앱을 열 수 없어요</h1><p class="muted">${String(err.message || err)}</p>`;
});
