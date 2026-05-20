import { createHash } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const releaseDir = "release";
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const productName = packageJson.build?.productName ?? packageJson.name;
const version = packageJson.version;
const artifacts = [`${productName}-${version}-x64.exe`, `${productName}-${version}-x64.zip`];
const generatedAt = new Date().toISOString();
const releaseNoticeFile = `RELEASE_NOTICE_${version}.txt`;
const portableExePath = join(releaseDir, `${productName}-${version}-x64.exe`);

const entries = [];
for (const artifact of artifacts) {
  const path = join(releaseDir, artifact);
  if (!(await exists(path))) continue;
  const data = await readFile(path);
  const fileStat = await stat(path);
  entries.push({
    file: basename(path),
    bytes: fileStat.size,
    sha256: createHash("sha256").update(data).digest("hex")
  });
}

if (entries.length === 0) {
  throw new Error("No release artifacts found.");
}

const manifest = {
  product: productName,
  version,
  generatedAt,
  artifacts: entries
};

await writeFile(join(releaseDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  join(releaseDir, "SHA256SUMS.txt"),
  `${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n")}\n`
);
await writeFile(
  join(releaseDir, releaseNoticeFile),
  releaseNoticeText({
    productName,
    version,
    generatedAt,
    entries,
    isSelfSigned: await hasAuthenticodeCertificateTable(portableExePath)
  })
);

console.log(`Wrote ${join(releaseDir, "release-manifest.json")}`);
console.log(`Wrote ${join(releaseDir, "SHA256SUMS.txt")}`);
console.log(`Wrote ${join(releaseDir, releaseNoticeFile)}`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function releaseNoticeText({ productName, version, generatedAt, entries, isSelfSigned }) {
  const signingText = isSelfSigned
    ? `- 현재 Windows 배포 파일은 공개 CA 인증서가 아닌 자체서명 코드서명 인증서로 서명된 배포본입니다.
- Windows에서 게시자를 신뢰하지 못한다는 경고가 표시될 수 있습니다.
- 실행 전 배포 파일의 SHA256 값을 이 공지, SHA256SUMS.txt, release-manifest.json과 대조해 확인하세요.
- 자체서명 인증서 또는 배포 파일이 교체된 경우 릴리즈 담당자가 서명 상태와 SHA256 값을 새 배포 기록에 다시 남겨야 합니다.`
    : `- 현재 Windows 배포 파일은 코드서명 인증서로 서명되지 않은 미서명 배포본입니다.
- 실행 전 배포 파일의 SHA256 값을 이 공지, SHA256SUMS.txt, release-manifest.json과 대조해 확인하세요.
- 코드서명 인증서가 준비된 경우 릴리즈 담당자가 서명 후 서명 상태와 SHA256 값을 새 배포 기록에 다시 남겨야 합니다.`;

  return `${productName} ${version} 배포 공지

제품: ${productName}
버전: ${version}
생성 시각: ${generatedAt}
제작/관리: 한강유역수도지원센터 조은상 과장

배포 파일
${entries.map((entry) => `- ${entry.file}\n  - bytes: ${entry.bytes}\n  - SHA256: ${entry.sha256}`).join("\n")}

코드서명 상태

${signingText}

사용 조건

- 비영리 목적의 개인 또는 기관 내부 사용은 허용됩니다.
- 사전 승인 없는 소프트웨어 수정, 변형, 파생물 제작, 실행 파일 또는 압축 파일의 무단 재배포, 영리 목적 이용, 제작자 또는 출처 표시 제거는 금지됩니다.

보증 부인 및 책임 제한

- 본 소프트웨어는 있는 그대로 제공됩니다.
- 사용자는 원본 문서를 보존하고, 생성된 결과물을 제출, 배포, 보관하기 전에 직접 열람하여 내용, 서식, 이미지, 표, 첨부 리소스 이상 여부를 확인해야 합니다.
- 본 소프트웨어의 사용 또는 사용 불능, 최적화 결과물의 오류, 문서 손상, 데이터 손실, 제출 지연, 업무상 손해 등으로 발생하는 문제에 대한 최종 확인 및 사용 책임은 사용자에게 있습니다.
	`;
}

async function hasAuthenticodeCertificateTable(path) {
  if (!(await exists(path))) return false;
  const data = await readFile(path);
  if (data.length < 0x100 || data.toString("ascii", 0, 2) !== "MZ") return false;
  const peOffset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") return false;
  const optionalHeaderOffset = peOffset + 24;
  const magic = data.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset =
    magic === 0x10b ? optionalHeaderOffset + 96 : magic === 0x20b ? optionalHeaderOffset + 112 : null;
  if (dataDirectoryOffset === null) return false;
  const securityDirectoryOffset = dataDirectoryOffset + 4 * 8;
  return data.readUInt32LE(securityDirectoryOffset + 4) > 0;
}
