# 오늘의 운동 (PWA)

헬스장 초보 여성을 위한 운동 앱. 설치 없이 크롬에서 "홈 화면에 추가"로 쓰는 웹앱입니다.

## 폴더 구조

```
index.html              앱의 뼈대 (하단 탭 메뉴)
manifest.webmanifest    앱 이름·아이콘 (홈 화면 추가용)
sw.js                   오프라인 지원 (수정 후 VERSION 숫자 올리기)
css/app.css             색·글꼴·레이아웃
icons/                  앱 아이콘
data/                   앱에 포함된 읽기 전용 데이터
  exercises.json          운동 DB (동작 43개)
  templates.json          루틴 템플릿 · 주 횟수별 분할
  rules.json              목표·경험·주기별 규칙 숫자
js/
  app.js                  시작점 · 화면 전환
  db.js                   사용자 데이터 저장소 (IndexedDB) · 백업
  catalog.js              data/ 파일 읽기 · 교체 후보 찾기
  ui.js                   화면용 작은 도구
  screens/                탭별 화면
  vendor/dexie.mjs        저장소 라이브러리 (Dexie 4.0.11)
