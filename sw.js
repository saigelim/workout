// 오프라인 지원: 앱 파일을 휴대폰에 저장해 두고, 인터넷이 없어도 열리게 합니다.
// 앱을 수정해서 다시 올릴 때는 VERSION 숫자를 올려주세요. 그래야 새 파일로 바뀌어요.
const VERSION = 'v10';
const CACHE = `fitapp-${VERSION}`;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/catalog.js',
  'js/ui.js',
  'js/vendor/dexie.mjs',
  'js/screens/today.js',
  'js/screens/program.js',
  'js/screens/timer.js',
  'js/screens/calendar.js',
  'js/screens/settings.js',
  'js/screens/exercises.js',
  'js/screens/exercise-form.js',
  'js/screens/onboarding.js',
  'js/generator.js',
  'js/store.js',
  'js/progression.js',
  'js/cycle.js',
  'js/schedule.js',
  'js/tabata-engine.js',
  'js/screens/workout.js',
  'data/exercises.json',
  'data/templates.json',
  'data/rules.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 저장해 둔 파일이 있으면 그걸 쓰고, 없으면 인터넷에서 받아오기
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request))
  );
});
