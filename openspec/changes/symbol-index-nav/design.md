## Context

기존 경로: `goToSymbolUnderCursor` → `wordAtCursor`(커서 단어) + `findSymbolDefinition(name)`(매번 `definitionMatchers(name)`로 per-name regex를 만들어 전 파일 line 스캔) + `openSourceAt`. 소스는 렌더러 메모리의 `sourceByPath` / `sourceFiles`에 이미 전부 있다(main의 `collectSourceFiles`가 수집해 HTML로 주입). `definitionMatchers`는 JS/TS·Kotlin·Python·Rust 등 다언어 선언 패턴(function/class/interface/const/fun/def …)을 커버한다.

## Goals / Non-Goals

**Goals**: 큰 repo에서도 즉각·블록 없는 go-to-definition; `Cmd/Ctrl+B`; 기존 정확도 무회귀(폴백).

**Non-Goals**: 정밀 파서/LSP/tree-sitter, cross-file 타입 해석, find-references, 다중 정의 disambiguation UI.

## Decisions

1. **"백그라운드 프로세스" 재해석 → 렌더러 idle 인덱싱(권장).** 소스가 이미 렌더러 메모리에 있으니 별도 프로세스/worker/IPC는 과하다(제1원칙: 가볍게). 로드 후 `requestIdleCallback`(폴백 `setTimeout`)로 인덱스를 1회 빌드 → 메인 스레드 블록 없음. *대안*: 수만 파일급 repo에서 idle 빌드가 느리면 main 프로세스나 worker thread로 승격(후속, 프로파일링 후). — 사용자가 말한 "백그라운드 프로세스"는 이 가벼운 형태로 충족된다고 본다.
2. **인덱스 = `Map<name, [{path, lineIndex, column}]>`.** 전 임베드 파일 1회 스캔, 각 줄에 *이름 추출형* 선언 패턴 적용(기존 `definitionMatchers`를 baked-name 대신 capture-group으로 일반화 — 한 곳에서 두 형태를 만들어 일관 유지).
3. **조회**: name → 후보 배열. 현재 파일 우선 정렬 후 첫 번째. 인덱스 미스/미완성이면 **기존 `findSymbolDefinition` 전수 스캔으로 폴백**.
4. **`Cmd/Ctrl+B`**: 소스 뷰에서 `goToSymbolUnderCursor`(= 기존 `Cmd/Ctrl+Down`). 입력 포커스 시 억제. diff 뷰 캐럿 단어 → 선언부는 선택(후속).
5. **신선도**: watch로 소스가 바뀌면 페이지가 리로드되며 인덱스도 새로 빌드(자동). 증분 갱신 불필요.

## Risks / Trade-offs

- 휴리스틱이라 거짓양성/음성 가능(기존과 동일 수준) — 폴백이 완화.
- 이름 추출형 패턴이 per-name보다 느슨해 인덱스에 잡음이 낄 수 있음 → 현재 파일 우선 + 폴백으로 완화.
- 매우 큰 repo는 idle 빌드 완료 전 조회가 발생 → 그 사이엔 폴백 스캔으로 동작(정확하지만 느릴 수 있음).

## Migration Plan

추가형. 기존 `Cmd/Ctrl+Down`·`findSymbolDefinition`은 유지(폴백). 데이터/포맷 마이그레이션 없음.

## Open Questions

- 이름 추출형 패턴과 per-name `definitionMatchers`를 한 소스에서 일관되게 생성하는 방식?
- diff 뷰에서도 `Cmd/Ctrl+B`를 지원할지?
- worker로 승격하는 repo 규모 기준(파일 수/총 라인)?
