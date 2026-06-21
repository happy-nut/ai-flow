## 1. size-conditional 토대

- [ ] 1.1 임계 판정(총 diff 코드 행 수 / 파일 수)을 `buildDiffReview`에서 계산해 메타(`lazy`)에 실어 렌더러로 전달; 초기값은 명백히 큰 repo만 잡히게(예: 행 > 4000 또는 파일 > 60)
- [ ] 1.2 임계 이하 경로는 현행 즉시 렌더 그대로(분기 추가만, 기존 코드 무수정) — 작은 repo·jsdom 회귀 불변 보장

## 2. Phase 1 — 지연 diff 머티리얼라이즈(프리즈 제거, IPC 불필요)

- [ ] 2.1 지연 모드에서 각 파일 diff2html HTML을 라이브 DOM 대신 비활성 `<script type="text/html" id="diff-<i>">` 섬으로 emit; 라이브 DOM에는 접힌 파일 헤더(경로·뱃지·stats)만
- [ ] 2.2 `ensureFileReady(path)` 단일 진입점: 파일의 diff 섬을 `container.innerHTML`로 머티리얼라이즈(이미 준비면 no-op). 펼침 클릭 + `IntersectionObserver` 스크롤 진입이 이를 호출
- [ ] 2.3 캐럿·코멘트·머지뷰·go-to-def의 파일 진입 경로가 모두 `ensureFileReady`를 거치도록 배선(무회귀 핵심)
- [ ] 2.4 (옵션) 라이브 행 수 상한 초과 시 멀어진 파일 de-materialize

## 3. Phase 2 — 지연 로드로 HTML 축소(80MB→수 MB)

- [ ] 3.1 소스 일괄 임베드(`source-files-data`) 제거 → 지연 모드에선 미임베드. 소스 뷰 열기 시 on-demand 로드
- [ ] 3.2 Electron: `preload.cts` 브리지 + `ipcMain.handle("monacori:get-file", {path, kind})` — app-main이 diff HTML·소스 반환(경로 화이트리스트)
- [ ] 3.3 browser-serve: `serveDiffWatch`에 `GET /file?path=&kind=diff|source`(+ 경로 탈출 차단). 렌더러는 `window.monacoriFile?.get ?? fetch(...)`로 두 transport 흡수
- [ ] 3.4 diff 섬도 미임베드 → `ensureFileReady`가 로드해서 머티리얼라이즈(완전 축소)
- [ ] 3.5 go-to-def 인덱스: 지연 모드에선 소스 보유 측에서 빌드 → Electron `monacori:symbol-index` 푸시 / serve `GET /symbol-index`. 비지연 모드는 현행 렌더러 Web Worker 유지(`symbol-index-nav`)

## 4. 검증

- [ ] 4.1 `npm run build` + 임베드 `<script>` `node --check`(String.raw 백틱 0)
- [ ] 4.2 jsdom 회귀(기존 10개) 그린 — 작은 repo 동작 불변 확인
- [ ] 4.3 지연 모드 jsdom 테스트(대형 픽스처): 초기 라이브 DOM이 작음(접힌 헤더만) + 파일 펼침/네비 시 머티리얼라이즈 + 지연 캐럿/코멘트/go-to-def 동작 + 입력 포커스 억제
- [ ] 4.4 `mo` 스모크(`zoobox`): 즉시 오픈 + 로드 시 블록 없음 + 처음부터 단축키 동작 + 초기 HTML 수 MB(Phase 2)
