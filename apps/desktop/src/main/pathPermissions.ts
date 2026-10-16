import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerDesktopInput } from "./desktopService.js";
import type { DesktopProtectedInput } from "./desktopService.js";

/** Session-scoped grants and original identities; independent of workers and IPC. */
export class DesktopPathPermissions {
  private readonly allowedInputPaths = new Set<string>();
  private readonly protectedInputIdentities = new Map<string, DesktopProtectedInput>();
  private readonly allowedOutputDirectories = new Set<string>();
  private readonly allowedGeneratedPaths = new Set<string>();

  get protectedInputs(): DesktopProtectedInput[] { return [...this.protectedInputIdentities.values()]; }

  async registerInput(filePath: string): Promise<string> {
    const normalized = await normalizeExistingFilePath(filePath);
    if (!/\.hwpx$/i.test(normalized)) {
      throw new Error("HWPX 파일만 선택할 수 있습니다.");
    }
    this.allowedInputPaths.add(normalized);
    this.protectedInputIdentities.set(normalized, await registerDesktopInput(normalized));
    this.allowedOutputDirectories.add(await normalizeExistingDirectoryPath(dirname(normalized)));
    return normalized;
  }

  async registerOutputDirectory(directoryPath: string): Promise<string> {
    const normalized = await normalizeExistingDirectoryPath(directoryPath);
    this.allowedOutputDirectories.add(normalized);
    return normalized;
  }

  async registerGenerated(filePath: string): Promise<string> {
    const normalized = await normalizeExistingFilePath(filePath);
    this.allowedGeneratedPaths.add(normalized);
    return normalized;
  }

  async requireInput(filePath: string): Promise<string> {
    const normalized = await normalizeExistingFilePath(filePath);
    if (!this.allowedInputPaths.has(normalized)) throw new Error("선택된 HWPX 파일만 처리할 수 있습니다.");
    return normalized;
  }

  async requireOutputDirectory(directoryPath: string): Promise<string> {
    const normalized = await normalizeExistingDirectoryPath(directoryPath);
    if (!this.allowedOutputDirectories.has(normalized)) throw new Error("선택된 저장 위치만 사용할 수 있습니다.");
    return normalized;
  }

  async requireGenerated(filePath: string): Promise<string> {
    const normalized = await normalizeExistingFilePath(filePath);
    if (!this.allowedGeneratedPaths.has(normalized)) throw new Error("이번 실행에서 생성된 결과 파일만 열 수 있습니다.");
    return normalized;
  }

  async requireKnownDocument(filePath: string): Promise<string> {
    const normalized = await normalizeExistingFilePath(filePath);
    if (!this.allowedInputPaths.has(normalized) && !this.allowedGeneratedPaths.has(normalized)) {
      throw new Error("이번 실행에서 선택 또는 생성된 문서만 검증할 수 있습니다.");
    }
    return normalized;
  }
}

async function normalizeExistingFilePath(filePath: string): Promise<string> {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("유효한 파일 경로가 아닙니다.");
  }
  const normalized = await realpath(resolve(filePath));
  const info = await stat(normalized);
  if (!info.isFile()) throw new Error("유효한 파일 경로가 아닙니다.");
  return normalized;
}

async function normalizeExistingDirectoryPath(directoryPath: string): Promise<string> {
  if (typeof directoryPath !== "string" || directoryPath.trim().length === 0) {
    throw new Error("유효한 폴더 경로가 아닙니다.");
  }
  const normalized = await realpath(resolve(directoryPath));
  const info = await stat(normalized);
  if (!info.isDirectory()) throw new Error("유효한 폴더 경로가 아닙니다.");
  return normalized;
}

