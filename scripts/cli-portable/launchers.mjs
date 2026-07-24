const CRLF = "\r\n";

function joinLines(lines) {
  return lines.join(CRLF) + CRLF;
}

/**
 * Batch files must stay ASCII-only in executable lines.
 * UTF-8 Korean inside .bat (without OEM/CP949) breaks cmd.exe parsing on
 * many Windows installs — the window flashes and closes before `pause`.
 * Put Korean docs in 사용법.txt instead.
 *
 * Paths with parentheses (common in Korean Hangul filenames) also break
 * cmd.exe when expanded unquoted inside `(...)` blocks. Keep this bat as a
 * thin wrapper that forwards `%*` to a Node runner without echoing paths.
 */
export function renderDropHereBat() {
  return joinLines([
    "@echo off",
    "setlocal EnableExtensions",
    'set "ROOT=%~dp0"',
    'set "NODE_OPTIONS="',
    'set "NODE=%ROOT%node\\node.exe"',
    'set "RUN=%ROOT%app\\drop-here.mjs"',
    'set "EC=0"',
    "echo HWPX Optimizer portable CLI",
    "echo.",
    'if not exist "%NODE%" (',
    "  echo [ERROR] Missing node.exe:",
    '  echo   %NODE%',
    "  set \"EC=1\"",
    "  goto :end",
    ")",
    'if not exist "%RUN%" (',
    "  echo [ERROR] Missing drop-here runner:",
    '  echo   %RUN%',
    "  set \"EC=1\"",
    "  goto :end",
    ")",
    'if "%~1"=="" (',
    "  echo Usage: drag and drop an HWPX file or folder onto this bat.",
    "  echo Korean help: open the usage .txt file in this folder.",
    "  set \"EC=1\"",
    "  goto :end",
    ")",
    '"%NODE%" "%RUN%" %*',
    'set "EC=%ERRORLEVEL%"',
    ":end",
    'if /i "%HWPX_OPT_NO_PAUSE%"=="1" exit /b %EC%',
    "echo.",
    "pause",
    "exit /b %EC%"
  ]);
}

/** Node drop runner — handles Unicode paths and parentheses safely. */
export function renderDropHereMjs() {
  return `import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeExe = join(root, "node", "node.exe");
const cli = join(root, "app", "cli", "dist", "index.js");
const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.log("Usage: drag and drop an HWPX file or folder onto drop-here.bat.");
  process.exit(1);
}

let failed = false;
let index = 0;
for (const target of targets) {
  index += 1;
  let isDir = false;
  try {
    isDir = statSync(target).isDirectory();
  } catch {
    console.error(\`[ERROR] Path not found: \${target}\`);
    failed = true;
    continue;
  }

  if (isDir) {
    console.log("");
    console.log(\`=== batch folder (\${index}): \${target} ===\`);
    const result = spawnSync(nodeExe, [cli, "batch", target, "--mode", "balanced"], {
      stdio: "inherit",
      windowsHide: true
    });
    if ((result.status ?? 1) !== 0) failed = true;
    continue;
  }

  console.log("");
  console.log(\`=== optimize file (\${index}): \${target} ===\`);
  const report = join(tmpdir(), \`hwpx-opt-\${process.pid}-\${index}.report.json\`);
  const result = spawnSync(
    nodeExe,
    [cli, "optimize", target, "--mode", "balanced", "--report", report],
    { stdio: "inherit", windowsHide: true }
  );
  if ((result.status ?? 1) !== 0) failed = true;
}

if (failed) {
  console.log("");
  console.log("Finished with errors.");
  process.exit(1);
}
console.log("");
console.log("Done.");
`;
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
    "■ 파일명에 괄호 ( ) 가 있어도 됩니다",
    "  drop-here.bat 은 Node 런너로 경로를 넘기므로 한글·괄호 파일명을 지원합니다.",
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
