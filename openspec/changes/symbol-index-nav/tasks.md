## 1. 선언 인덱스 빌더

- [ ] 1.1 *이름 추출형* 선언 패턴(기존 `definitionMatchers` 휴리스틱을 baked-name 대신 capture-group으로 일반화; 한 소스에서 per-name/추출형 둘 다 생성해 일관 유지)
- [ ] 1.2 전 임베드 소스 파일 1회 스캔 → `Map<name, [{path, lineIndex, column}]>` 빌드(현재 파일 우선 정렬 헬퍼 포함)
- [ ] 1.3 로드 후 `requestIdleCallback`(폴백 `setTimeout`)로 빌드 — 메인 스레드 블록 없음, 빌드 완료 플래그

## 2. 조회 & 네비게이션

- [ ] 2.1 `findSymbolDefinition`을 인덱스 우선(현재 파일 우선) + 인덱스 미스/미완성 시 기존 전수 스캔 폴백으로 변경
- [ ] 2.2 `Cmd/Ctrl+B` keydown 추가 → 소스 뷰에서 `goToSymbolUnderCursor`(기존 `Cmd/Ctrl+Down` 유지)
- [ ] 2.3 입력 포커스(`input`/`textarea`/`select`) 시 억제 — 기존 캐럿 키 가드와 일관

## 3. 검증

- [ ] 3.1 `npm run build` + 임베드 `<script>` `node --check`(String.raw 백틱 함정 주의 — 인덱스 코드는 diffScript 안)
- [ ] 3.2 jsdom: 인덱스가 함수/클래스/const 선언을 잡고 `Cmd+B`/`Cmd+Down`이 선언 줄로 이동; 인덱스에 없는 심볼은 폴백 스캔; 인덱스 미완성 시 폴백; 입력 포커스 시 억제
- [ ] 3.3 `mo` 스모크: 파일 많은 repo에서 즉각 점프 + 로드 시 블록 없음
