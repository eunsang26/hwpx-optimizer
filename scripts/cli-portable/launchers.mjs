const CRLF = "\r\n";

function joinLines(lines) {
  return lines.join(CRLF) + CRLF;
}

export function renderDropHereBat() {
  return joinLines([
    "@echo off",
    "setlocal EnableExtensions",
    "chcp 65001 >nul",
    'set "ROOT=%~dp0"',
    'set "NODE_OPTIONS="',
    'set "CLI=%ROOT%app\\cli\\dist\\index.js"',
    'set "NODE=%ROOT%node\\node.exe"',
    'if not exist "%NODE%" (',
    "  echo [오류] node.exe 가 없습니다: %NODE%",
    "  goto :end",
    ")",
    'if not exist "%CLI%" (',
    "  echo [오류] CLI 가 없습니다: %CLI%",
    "  goto :end",
    ")",
    'if "%~1"=="" (',
    "  echo 사용법: HWPX 파일 또는 폴더를 이 배치 파일에 끌어다 놓으세요.",
    "  goto :end",
    ")",
    "set /a N=0",
    ":loop",
    'if "%~1"=="" goto :done',
    "set /a N+=1",
    'if exist "%~1\\" (',
    "  echo.",
    "  echo === 폴더 배치: %~1 ===",
    '  "%NODE%" "%CLI%" batch "%~1" --mode balanced',
    '  if errorlevel 1 set "FAILED=1"',
    ") else (",
    "  echo.",
    "  echo === 파일 최적화: %~1 ===",
    '  set "RPT=%TEMP%\\hwpx-opt-%RANDOM%-%N%.report.json"',
    '  "%NODE%" "%CLI%" optimize "%~1" --mode balanced --report "%RPT%"',
    '  if errorlevel 1 set "FAILED=1"',
    ")",
    "shift",
    "goto :loop",
    ":done",
    "if defined FAILED exit /b 1",
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
    "chcp 65001 >nul",
    'set "ROOT=%~dp0"',
    'set "NODE_OPTIONS="',
    '"%ROOT%node\\node.exe" "%ROOT%app\\cli\\dist\\index.js" %*',
    'set "EC=%ERRORLEVEL%"',
    'if /i "%HWPX_OPT_NO_PAUSE%"=="1" exit /b %EC%',
    'if not "%EC%"=="0" pause',
    "exit /b %EC%"
  ]);
}

export function renderUsageTxt() {
  return [
    "HWPX Optimizer — Windows 휴대용 CLI 사용법",
    "",
    "■ 빠른 시작",
    "  drop-here.bat 을 더블클릭하거나, HWPX 파일·폴더를 drop-here.bat 위로 끌어다 놓으세요.",
    "  기본 최적화 모드는 balanced 입니다.",
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
