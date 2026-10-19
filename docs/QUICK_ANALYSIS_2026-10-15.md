# 빠른 분석과 상세 분석의 비용 및 표시 근거

OPT-013 / 2026-10-15. 자체 생성 HWPX만 사용하며, 문서와 화면은 로컬 `.tmp`에 보관한다.

## 변경 계약

기존 기본 분석은 inventory 진단만 quick으로 처리했고, 생략된 옵션이 후보 검사에서는 visual로 해석됐다. 구조 후보 검사도 픽셀 중복을 검사했으며 balanced/aggressive 후보 크기를 모두 실제 인코딩했다. Desktop은 첫 분석에 deep을 요청했다.

이제 core `analyzeHwpxBuffer`의 옵션 생략과 명시적 `analysisMode: "quick"`이 같다. Desktop 자동 가져오기와 batch 초기 분석도 quick이다. 빠른 분석은 이미지 헤더, 바이트 해시, 문서 구조로 검사하고 JPEG/PNG/BMP/TIFF 크기는 추정한다. 정확한 픽셀 중복 및 유사 이미지 해시, 후보 이미지 재인코딩은 실행하지 않는다. 바이트가 같은 중복과 보존 대상 리소스는 계속 보고한다.

`analysisMode: "deep"`은 상세 픽셀·유사 이미지 진단과 두 압축 프로필의 실제 후보 인코딩을 요청한다. CLI의 `--analysis-mode deep` 및 Desktop 단일 파일의 「세부 분석 보기 → 상세 분석」으로 실행한다. 상세 분석은 자동 최적화나 유사 이미지 자동 병합을 수행하지 않는다. 실제 최적화에서 필요한 이미지 처리와 검증은 유지한다.

보고서의 선택적 `analysis` 필드는 mode, 이미지 크기의 estimated/encoded 근거, visualDuplicatesChecked를 전달한다. 기존 보고서나 최적화 결과에서 필드가 없으면 분석 범위를 추측하지 않는다. Desktop 예상 용량 옆과 세부 분석에서 추정·미검사 여부를 표시한다. 빠른 batch에도 추정 및 유사 이미지 미검사를 표시한다. CLI 텍스트 보고서도 분석 방식과 크기 근거를 적고 quick의 미검사를 0건으로 표시하지 않는다. 상세 분석이 실패하거나 취소되면 이전 보고서와 사용자 선택을 유지한다.

측정한 이미지 후보 크기도 최종 ZIP 실측값이 아니다. 최종 용량·수동 품질 예측과 ZIP overhead 정합성은 OPT-015에서 계속 개선한다. 입력 해제 후 raw cache 및 이미지 동시성의 메모리 한도는 OPT-014에 남아 있다.

## 비용 측정

재현 명령은 `npm run build` 후 `node scripts/bench/measure-analysis-modes.mjs`다. 이미지 1·8·24개, 512×384 JPEG/PNG/TIFF를 자체 생성하고 각 모드를 별도 Node 프로세스에서 실행한다. 처리 중 프로세스 시작과 fixture 생성 시간은 제외한다. 결과 JSON은 `.tmp/analysis-mode-measurement.json`에 저장한다. 분석 실패, inventory 수 불일치 또는 quick의 픽셀·인코딩 실행은 측정 실패로 처리한다.

카운터는 Sharp의 metadata 호출, raw 출력 `toBuffer` 요청, 이미지 인코딩 출력 `toBuffer` 요청이다. raw 출력은 픽셀 디코드/샘플링 요청의 관측치이며 libvips 내부 디코더 실행 횟수 전체가 아니다. 인코딩 내부의 입력 디코드와 BMP의 자체 디코더를 이 수치로 세지 않는다. 이번 측정 fixture에는 BMP가 없고 혼합 포맷 테스트에서 별도로 검사한다. 측정은 한 번의 합성 실행이며 모든 사용자 문서의 속도를 보증하지 않는다.

Linux / Node 24.13.0 측정:

| 이미지 수 | 모드 | 시간(ms) | metadata | raw 출력 | 인코딩 출력 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | default | 38.7 | 2 | 0 | 0 |
| 1 | quick | 43.3 | 2 | 0 | 0 |
| 1 | deep | 76.6 | 3 | 2 | 2 |
| 8 | default | 110.7 | 16 | 0 | 0 |
| 8 | quick | 101.6 | 16 | 0 | 0 |
| 8 | deep | 875.5 | 24 | 16 | 16 |
| 24 | default | 233.1 | 48 | 0 | 0 |
| 24 | quick | 219.6 | 48 | 0 | 0 |
| 24 | deep | 2,209.3 | 72 | 48 | 48 |

24개 이미지의 기본 분석은 233.1ms, 명시적 quick은 219.6ms, deep은 2,209.3ms였다. 같은 fixture에서 quick은 raw·인코딩 출력 0회, deep은 각각 48회였다. 모드별 새 프로세스라 JS 객체별 분석/디코드 캐시를 이전 모드와 공유하지 않는다. OS 및 native cache 효과를 통제한 통계 벤치마크는 아니다.

## 검증

- core 혼합 JPEG/PNG/TIFF/BMP 테스트: 기본값과 명시적 quick의 보고서가 시간 필드를 제외하고 동일하고, Sharp raw/인코딩 호출이 없다. 바이트 중복을 보고하며 픽셀 중복은 상세 검사에서만 나온다. TIFF도 quick에서 인코딩하지 않는다.
- deep 테스트: 실제 raw·JPEG·PNG 출력 호출과 픽셀 동일 그룹, exact 후보를 검사한다.
- desktop 서비스 및 실제 production worker: 기본 quick과 명시적 deep을 전달하고 원본을 유지한다.
- Electron 스모크: CommonJS preload → IPC → worker를 통한 quick/deep 전달과 잘못된 mode 거부를 검사한다.
- 이전 exact 후보 크기에 의존한 두 회귀 테스트는 명시적 deep으로 요청한다. 나머지 quick 및 최적화 회귀 검증은 유지한다.

Linux 전체 83개 파일·620개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·합성 corpus 2/2·배포 audit·Electron 스모크가 통과했다. 배포 runtime moderate+ advisory는 0개이며 개발/빌드 도구 advisory 20개는 남아 있다.

실제 Electron과 승인된 로컬 Playwright로 quick 표시, 키보드 상세 분석, 실제 픽셀·유사 그룹, 옵션 유지, 완료·취소 후 포커스 복귀, 취소·오류 후 기존 계획 유지, 재시도·최적화·처음으로, batch quick 표시를 검증했다. 800×560과 720×520에서 새 제어 요소가 동작하고 가로 넘침이 없었다. 원본 해시 불변 및 page error 0건을 확인했다. 최종 화면 6개를 직접 확인했으며 캡처·접근성 트리·실행 기록은 `.tmp/ui-audit/analysis-modes-2026-10-15/`에만 보관한다. 화면 검증 시각은 2026-10-15 01:05:53 UTC다.

화면에서 확인한 추가 과제는 상세 분석의 영문 검토 이유(OPT-023), 아래로 스크롤한 상태에서 상단 오류 배너가 시야 밖에 놓이는 문제(OPT-024), 작은 글자와 정보 계층(OPT-025)다. 이번 분석 비용 개선만으로 전체 UX/HCI 완료를 주장하지 않는다.

## Windows 실행 근거

코드 커밋 `831bdba`, Node 24.21.0에서 [CLI ZIP/native 실행](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38663816515)과 [데스크톱 릴리즈 및 합성 측정](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38663816648)이 모두 통과했다. 양쪽 모두 83개 파일·620개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·배포 audit 통과다. CLI 배포 ZIP의 optimize·verify·batch 및 launcher를 실행했다. 데스크톱은 합성 corpus 2/2·Electron 스모크·NSIS 빌드·실제 ASAR runtime 존재 및 unpacked native 검사를 통과했다. 산출물 업로드는 모두 건너뛰었다. clean 기관 PC·한컴 수동 QA의 근거로 확대 해석하지 않는다.

동일 스크립트의 Windows 측정값:

| 이미지 수 | 모드 | 시간(ms) | metadata | raw 출력 | 인코딩 출력 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | default | 42.5 | 2 | 0 | 0 |
| 1 | quick | 42.5 | 2 | 0 | 0 |
| 1 | deep | 82.9 | 3 | 2 | 2 |
| 8 | default | 124.5 | 16 | 0 | 0 |
| 8 | quick | 118.7 | 16 | 0 | 0 |
| 8 | deep | 884.4 | 24 | 16 | 16 |
| 24 | default | 232.8 | 48 | 0 | 0 |
| 24 | quick | 231.5 | 48 | 0 | 0 |
| 24 | deep | 2,678.9 | 72 | 48 | 48 |

24개 이미지에서 기본/quick은 약 0.23초, deep은 약 2.68초였다. raw 및 인코딩 출력 요청 수는 Linux와 같았다.
