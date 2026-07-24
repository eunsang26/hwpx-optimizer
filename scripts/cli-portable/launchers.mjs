const CRLF = "\r\n";

function joinLines(lines) {
  return lines.join(CRLF) + CRLF;
}

/**
 * Batch files must stay ASCII-only in executable lines.
 * UTF-8 Korean inside .bat (without OEM/CP949) breaks cmd.exe parsing on
 * many Windows installs — the window flashes and closes before `pause`.
 * Put Korean docs in 사용법.txt instead.
 */
export function renderDropHereBat() {
  return joinLines([
    "@echo off",
    "setlocal EnableExtensions",
    'set "ROOT=%~dp0"',
    'set "NODE_OPTIONS="',
    'set "CLI=%ROOT%app\\cli\\dist\\index.js"',
    'set "NODE=%ROOT%node\\node.exe"',
    "echo HWPX Optimizer portable CLI",
    "echo.",
    'if not exist "%NODE%" (',
    "  echo [ERROR] Missing node.exe:",
    '  echo   %NODE%',
    "  goto :end",
    ")",
    'if not exist "%CLI%" (',
    "  echo [ERROR] Missing CLI:",
    '  echo   %CLI%',
    "  goto :end",
    ")",
    'if "%~1"=="" (',
    "  echo Usage: drag and drop an HWPX file or folder onto this bat.",
    "  echo Korean help: open the usage .txt file in this folder.",
    "  goto :end",
    ")",
    "set /a N=0",
    ":loop",
    'if "%~1"=="" goto :done',
    "set /a N+=1",
    'if exist "%~1\\" (',
    "  echo.",
    "  echo === batch folder: %~1 ===",
    '  "%NODE%" "%CLI%" batch "%~1" --mode balanced',
    '  if errorlevel 1 set "FAILED=1"',
    ") else (",
    "  echo.",
    "  echo === optimize file: %~1 ===",
    '  call :optimize_file "%~1"',
    ")",
    "shift",
    "goto :loop",
    ":done",
    "if defined FAILED (",
    "  echo.",
    "  echo Finished with errors.",
    "  goto :end",
    ")",
    "echo.",
    "echo Done.",
    "goto :end",
    "",
    ":optimize_file",
    'set "RPT=%TEMP%\\hwpx-opt-%RANDOM%-%N%.report.json"',
    '"%NODE%" "%CLI%" optimize "%~1" --mode balanced --report "%RPT%"',
    'if errorlevel 1 set "FAILED=1"',
    "exit /b 0",
    "",
    ":end",
    'if /i "%HWPX_OPT_NO_PAUSE%"=="1" goto :eof',
    "echo.",
    "pause"
  ]);
}

export function renderHwpxOptCmd() {
  return joinLines([
    "@echo off",
    "setlocal EnableExtensions",
    'set "ROOT=%~dp0"',
    'set "NODE_OPTIONS="',
    'if "%~1"=="" (',
    "  echo HWPX Optimizer CLI",
    "  echo Usage: hwpx-opt.cmd optimize file.hwpx --mode balanced",
    "  echo Korean help: open the usage .txt file in this folder.",
    '  if /i not "%HWPX_OPT_NO_PAUSE%"=="1" pause',
    "  exit /b 1",
    ")",
    '"%ROOT%node\\node.exe" "%ROOT%app\\cli\\dist\\index.js" %*',
    'set "EC=%ERRORLEVEL%"',
    'if /i "%HWPX_OPT_NO_PAUSE%"=="1" exit /b %EC%',
    "echo.",
    "pause",
    "exit /b %EC%"
  ]);
}

export function renderUsageTxt() {
  return [
    "HWPX Optimizer — Windows 휴대용 CLI 사용법",
    "",
    "■ 빠른 시작",
    "  1) 이 ZIP을 폴더에 압축 해제합니다 (ZIP 안에서 바로 실행하지 마세요).",
    "  2) HWPX 파일 또는 폴더를 drop-here.bat 위로 끌어다 놓으세요.",
    "  3) 검은 창이 뜨면 진행 로그가 보이고, 끝나면 '계속하려면...' 에서 아무 키나 누르세요.",
    "  기본 최적화 모드는 balanced 입니다.",
    "",
    "■ drop-here.bat 만 더블클릭하면?",
    "  사용법 안내가 잠깐 뜨고 키 입력을 기다립니다. 창이 바로 닫히면",
    "  압축을 풀었는지, drop-here.bat 이 node 폴더와 같은 위치에 있는지 확인하세요.",
    "",
    "■ 출력 위치",
    "  • 단일 파일: 원본과 같은 폴더에 .optimized.hwpx 로 저장됩니다.",
    "  • 폴더 배치: 해당 폴더 아래 optimized\\ 하위에 결과가 저장됩니다.",
    "  원본 파일은 절대 덮어쓰지 않습니다.",
    "",
    "■ hwpx-opt.cmd (고급)",
    "  명령 프롬프트에서 hwpx-opt.cmd analyze, optimize, batch 등 CLI 하위 명령을 직접 실행합니다.",
    "  CLI 기본 모드는 safe 이므로, balanced 또는 aggressive 를 쓰려면 --mode 를 명시하세요.",
    "  예: hwpx-opt.cmd optimize 문서.hwpx --mode balanced",
    "",
    "■ 시스템 요구 사항",
    "  Windows 10 이상 64비트(x64). 인터넷 연결 없이 로컬에서만 동작합니다.",
    "",
    "■ 보안·배포 안내",
    "  처음 실행 시 Windows SmartScreen 경고가 뜰 수 있습니다.",
    "  조직 PC에서는 IT 관리자에게 이 폴더 또는 zip 파일을 허용 목록에 추가해 달라고 요청하세요.",
    "",
    "■ 약관",
    "  자세한 이용 약관은 TERMS.txt 를 참고하세요."
  ].join("\n") + "\n";
}
