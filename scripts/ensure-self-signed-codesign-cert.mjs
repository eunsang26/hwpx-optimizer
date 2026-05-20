import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnFile } from "./lib/spawn-file.mjs";

const certDir = join(".tmp", "codesign");
const keyPath = join(certDir, "hwpx-optimizer-selfsigned.key");
const certPath = join(certDir, "hwpx-optimizer-selfsigned.crt");
const pfxPath = join(certDir, "hwpx-optimizer-selfsigned.pfx");
const passwordPath = join(certDir, "hwpx-optimizer-selfsigned.password");
const subject = "/CN=Han River Basin Waterworks Support Center - Eun Sang Cho/O=Han River Basin Waterworks Support Center";

await mkdir(certDir, { recursive: true });

if (!(await exists(passwordPath))) {
  const password = randomPassword();
  await writeFile(passwordPath, `${password}\n`, { mode: 0o600 });
}

const password = (await readFile(passwordPath, "utf8")).trim();

if (!(await exists(pfxPath))) {
  await spawnFile("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-sha256",
    "-days",
    "825",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-subj",
    subject,
    "-addext",
    "extendedKeyUsage=codeSigning"
  ]);

  await spawnFile("openssl", [
    "pkcs12",
    "-export",
    "-out",
    pfxPath,
    "-inkey",
    keyPath,
    "-in",
    certPath,
    "-passout",
    `pass:${password}`
  ]);
}

console.log(pfxPath);

function randomPassword() {
  return randomBytes(32).toString("base64url");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
