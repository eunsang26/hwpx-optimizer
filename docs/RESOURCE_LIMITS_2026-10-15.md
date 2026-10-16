# 처리 한도와 메모리 측정

2026-10-15 / OPT-014. ZIP 사전 검사 변경은 `764310e`에 있다. 이미지와 캐시·동시성 변경은 동일 PR #9에서 이어간다. 모든 입력은 자체 생성한 합성 문서다. 문서·결과·화면은 로컬에 보관하고 외부로 전송하지 않는다.

## 적용 한도

| 경계 | 적용 한도와 동작 |
| --- | --- |
| 호스트 입력 | CLI/desktop의 기본 입력 파일 한도 512MiB. core는 호출자가 이미 확보한 Buffer를 받는다. |
| ZIP metadata | 기본 전체 record 20,000개. 폴더도 센다. 정상 ZIP64 end/locator·entry extra를 해석하고 unsafe integer, 누락·잘린 필드, 범위 불일치와 과다 항목을 metadata loader 전에 거부한다. |
| ZIP 해제 | 기본 항목 512MiB, 합계 2GiB. 실제 청크를 누적하기 전에 항목·남은 합계·알려진 선언 크기를 검사한다. 전체 항목 생성 후의 검사 및 불필요한 Buffer 재복사를 제거했다. |
| 이미지 | 24,000,000 pixel. 한도 초과 시 원본 바이트를 보존하며 분석에 이유를 남긴다. BMP는 RGB buffer 할당 전에 확인하고 Sharp 파이프라인에도 입력 pixel limit를 설정한다. |
| raw cache | 작업당 64MiB·최대 64개 ready slot. source와 raw의 backing buffer 크기를 포함한다. budget보다 큰 결과는 반환하되 저장하지 않는다. LRU로 내보내며 성공·실패 모두 scope를 폐기한다. |
| 이미지 동시성 | core mapper 기본 2, 명시적 요청도 최대 4. CLI batch는 worker당 1로 고정한다. |
| CLI worker | 최대 4개. 요청 수는 보존하고 실제 수를 별도로 보고한다. `--jobs 12`도 실제 4개까지 실행한다. 입력이 없으면 실제 worker 수는 0이다. |
| 미리보기 | 최대 12쌍, thumbnail/sample edge 최대 1024. 한 쌍씩 처리하며 한 쌍 안의 두 thumbnail 및 두 quality sample은 함께 실행할 수 있다. |

ZIP64 extensible end record는 설치된 JSZip 3.x의 파싱 문제 때문에 loader 전에 명확하게 거부한다. 일반적인 44-byte ZIP64 end record 및 작은 유효 ZIP64, ZIP 앞에 prefix가 있는 읽기 호환성은 검사했다. 위조된 작은 선언값과 Unicode extra에 따른 이름 변경도 실제 해제 한도를 우회하지 못한다.

캐시는 분석→최적화 사이에 결과를 재사용하는 세션 인코딩 캐시가 아니다. Buffer 분석·최적화·원본 대비 검증은 각 작업 scope를 사용하며, 내부 중첩 호출은 기존 scope를 공유한다. scope 종료 후 늦은 callback이 캐시를 다시 채울 수도 없다. 단독 이미지 helper는 별도의 동일 상한 cache를 쓰고 `clearDecodedImageCache()`로 해제할 수 있다. 사용자 코드가 반환받아 보관한 raw buffer는 캐시 해제로 제거할 수 없다.

## 합성 측정 방법

`npm run build` 후 `node scripts/bench/measure-resource-limits.mjs`를 실행한다. 결과는 `.tmp/resource-limit-measurement.json`이다. fixture를 만든 뒤 각 case를 새 Node 프로세스에서 실행한다. worker case는 실제 WorkerPool과 core balanced 최적화를 사용하며 worker별 imageConcurrency·Sharp concurrency를 1로 둔다. core의 실제 보존·품질 검증을 수행하고 원본 SHA-256 불변, 캐시 상한·해제와 결과 저장을 검사한다. 실패를 건너뛰지 않고 전체 측정 실패로 처리한다.

RSS 표는 **5ms 간격의 관측 peak**다. 짧은 순간의 spike를 놓칠 수 있다. JSON에는 OS high-water RSS도 함께 남기지만 실행/생성 이전의 high-water가 보일 수 있어 단계별 peak로 그대로 사용하지 않는다. 시간은 작업 생성 후 최적화·해시 검사·저장·worker 정리를 포함한다. fixture 생성과 case Node 프로세스 시작 비용은 제외하며 worker thread 생성은 포함한다. raw/retained 수치는 worker 하나의 cache가 소유한 바이트이며 RSS와 다르다.

Linux / Node 24.13.0:

| 입력 | 원본 바이트 | worker | 관측 peak RSS(MiB) | worker별 peak raw(MiB) | worker별 peak retained(MiB) | 종료 raw | 시간(ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1MP-font-1MiB · JPEG 3개 | 2,284,000 | 1 | 155.6 | 18.0 | 20.4 | 0 | 507.9 |
| 1MP-font-1MiB · JPEG 3개 | 2,284,000 | 2 | 232.1 | 18.0 | 20.4 | 0 | 762.4 |
| 1MP-font-1MiB · JPEG 3개 | 2,284,000 | 4 | 369.2 | 18.0 | 20.4 | 0 | 1,357.7 |
| 8MP-font-16MiB · JPEG 3개 | 25,907,497 | 1 | 375.2 | 53.8 | 59.8 | 0 | 2,789.4 |
| 8MP-font-16MiB · JPEG 3개 | 25,907,497 | 2 | 648.1 | 53.8 | 59.8 | 0 | 3,582.4 |
| 8MP-font-16MiB · JPEG 3개 | 25,907,497 | 4 | 1,142.1 | 53.8 | 59.8 | 0 | 6,661.1 |

8MP×3개·25.9MB 합성 입력에서 worker 1개는 관측 약 375MiB, 4개는 약 1,142MiB였다. 각 worker의 cache peak retained는 약 59.8MiB이고 작업 종료 raw는 모두 0이었다. raw cache가 64MiB라고 전체 프로세스가 64MiB 이하인 것은 아니다. 큰 문서가 여러 개면 `--jobs 1`로 낮춰 처리할 수 있다.

## 위조 압축 크기와 할당 검사

실제 해제 크기 32MiB 및 128MiB를 선언 64KiB로 바꾼 합성 ZIP을 64KiB entry limit로 읽었다. 둘 다 81,920-byte 누적 시점에 거부됐고, 가장 큰 최종 `Buffer.concat` 요청은 필수 metadata의 19바이트였다. 전체 32/128MiB 결과를 먼저 합친 뒤 거부하지 않는다. 관측 RSS는 각각 약 74.5→102.5MiB, 76.6→105.8MiB였다.

한도 검사는 청크가 생성된 다음, 저장 배열에 넣거나 전체 항목을 합치기 전에 실행한다. JSZip의 현재 압축 입력 블록은 pause/destroy 뒤에도 일부 처리될 수 있다. 따라서 한도 외 allocation이나 CPU 비용이 0이라는 주장은 아니다. 크기 한도는 허용할 전체 리소스의 크기를 제한하며 decompressor의 transient 메모리까지 같은 값으로 제한하지 않는다.

0바이트 선언도 별도로 검사한다. JSZip은 uncompressed size가 0이면 compressed object를 빈 파일로 바꿔 실제 바이트 검사를 생략한다. 실제 payload가 있는 STORE/DEFLATE 항목의 size를 0으로 바꾼 재현 테스트 2개가 수정 전 실패했다. 이제 compressed 범위가 있는 빈 선언은 loader 전에 검사하고, DEFLATE의 확인 출력은 `maxOutputLength: 1`로 제한해 nonempty 결과를 거부한다. 정상 빈 STORE, 빈 DEFLATE stream 및 기존 zero-length DEFLATE entry는 계속 읽는다.

## 자동 및 화면 검증

ZIP64·실제 streaming·Unicode 이름 경계, byte-budget eviction, pending decode 공유, 실패/동시 scope 격리·종료 후 재삽입 방지, 실제 oversized BMP의 RGB allocation 방지, oversized PNG의 분석/최적화 중 원본 보존, 불필요한 JPEG raw decode 제거, preview 출력 크기 제한, worker 실제 동시 실행과 CLI 요청/실제 수 보고를 검사한다.

실제 Electron/로컬 Playwright로 유효한 25MP PNG가 든 합성 문서를 열고 상세 분석 및 최적화 후 원본 이미지와 입력 해시를 보존하는지 검사했다. 한도 초과 이유는 한국어로 표시한다. 실제 크기 위조 ZIP은 거부하며 결과를 오표시하지 않고 다음 문서를 다시 열 수 있다. 완료 후 늦은 100% 진행 이벤트가 결과를 가리던 문제도 수정하고 Electron smoke와 실제 IPC 재전송으로 회귀 검증한다. 캡처·접근성 트리·실행 기록은 `.tmp/ui-audit/resource-limits-2026-10-15/`에만 있다.

Linux 최종 전체 85개 파일·661개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·합성 corpus 2/2·배포 audit·Electron 스모크 통과. 실제 화면 실행 시각은 2026-10-15 01:48:00 UTC이며 page error 0건이다. 세 화면을 직접 확인했다. Windows 최종 검증도 통과했으며 아래에 기록했다.

## Windows 검증

최종 코드 `4fc94c6`, Node 24.21.0에서 [CLI ZIP/native 실행](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38667916586)과 [데스크톱 릴리즈 및 합성 측정](https://github.com/eunsang26/hwpx-optimizer/actions/runs/38667916779)이 모두 통과했다. 두 실행 모두 85개 파일·661개 테스트 통과·1개 건너뛰기, 타입 검사·빌드·배포 audit 통과다. CLI는 실제 배포 ZIP의 optimize·verify·batch·launcher를 실행했다. 데스크톱은 합성 corpus 2/2·Electron 스모크·NSIS 빌드·실제 ASAR runtime 존재 및 unpacked native 검사를 통과했다. 0바이트 위조와 정상 빈 항목의 호환성 테스트도 포함한다. 산출물 업로드는 모두 건너뛰었다.

| 입력 | worker | 관측 peak RSS(MiB) | worker별 peak raw(MiB) | worker별 peak retained(MiB) | 종료 raw | 시간(ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1MP-font-1MiB | 1 | 127.1 | 18.0 | 20.4 | 0 | 636.3 |
| 1MP-font-1MiB | 2 | 189.3 | 18.0 | 20.4 | 0 | 808.4 |
| 1MP-font-1MiB | 4 | 309.5 | 18.0 | 20.4 | 0 | 1,349.2 |
| 8MP-font-16MiB | 1 | 267.5 | 53.8 | 59.8 | 0 | 3,733.6 |
| 8MP-font-16MiB | 2 | 468.2 | 53.8 | 59.8 | 0 | 4,362.0 |
| 8MP-font-16MiB | 4 | 815.2 | 53.8 | 59.8 | 0 | 7,267.2 |

Windows에서도 32/128MiB 위조 크기 ZIP을 64KiB 한도로 거부했고 최대 최종 concat은 19바이트였다. 큰 이미지 case의 cache peak retained는 59.8MiB·완료 후 raw 0바이트였다. 플랫폼·allocator·측정 시점에 따라 RSS가 달라지므로 Linux와 수치를 동일하다고 주장하지 않는다.

## 남은 한계

이 수치는 고정 RSS 보장, 모든 최대 크기 조합의 성공 보장 또는 clean 기관 PC·한컴 수동 QA를 대신하지 않는다. 기본 ZIP 한도 2GiB와 파일·이미지·worker 최대값을 동시에 사용할 때의 메모리 안전성을 모든 PC에서 입증한 것은 아니다. 외부 소비자가 독립적인 core 호출을 임의로 동시에 시작할 때의 전체 병렬도는 호출자가 관리해야 한다. active decode, source/output ZIP, native/allocator cache와 외부 소비자가 보관한 buffer는 별도 메모리다. 이미지의 품질·내용을 바꾸거나 한도 검사를 우회해 처리하지 않으며, 큰 이미지는 경고와 함께 원본을 보존한다. 문서 처리에 네트워크를 사용하지 않는다.
