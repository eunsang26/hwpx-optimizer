import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { removeOwnedArtifact } from "@hwpx-optimizer/io";
import type { OwnedArtifact } from "@hwpx-optimizer/io";
import {
  CURRENT_SETTINGS_VERSION, invalidSettingsFields, normalizeDesktopSettings,
  persistentDesktopSettingsPatch, settingsRecord
} from "../shared/desktopSettings.js";
import type { DesktopSettingsSnapshot, SettingsNotice } from "../shared/desktopSettings.js";

const MAX_SETTINGS_FILE_BYTES = 64 * 1024;
const notices: Record<SettingsNotice["kind"], string> = {
  recovered: "저장된 설정이 손상되었거나 지원 범위를 벗어나 기본값으로 복구했습니다. 설정을 확인하고 변경하면 새 설정이 저장됩니다.",
  migrated: "이전 버전의 설정을 현재 형식으로 불러왔습니다. 다음 설정 변경 시 새 형식으로 저장됩니다.",
  "read-error": "설정 파일을 읽지 못해 기본값으로 실행합니다. 저장 위치의 접근 권한을 확인한 뒤 다시 시도하세요.",
  "newer-version": "더 새 버전에서 만든 설정입니다. 원래 설정은 유지하며 기본값으로 실행합니다. 설정 저장은 해당 버전의 앱에서 진행하세요."
};
type ReadResult = { settings: DesktopSettingsSnapshot; writable: boolean };
type FileOperations = {
  read?: (path: string) => Promise<string>;
  write?: (handle: FileHandle, text: string) => Promise<void>;
  sync?: (handle: FileHandle) => Promise<void>;
  promote?: typeof rename;
};

function fallback(kind: SettingsNotice["kind"], writable: boolean): ReadResult {
  return { settings: { ...normalizeDesktopSettings(undefined), settingsNotice: { kind, message: notices[kind] } }, writable };
}

/** Serializes this app's patches and publishes complete snapshots by same-directory rename. */
export class DesktopSettingsStore {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private closed = false;
  constructor(private readonly settingsPath: string | (() => string), private readonly files: FileOperations = {}) {}
  private path(): string { return typeof this.settingsPath === "function" ? this.settingsPath() : this.settingsPath; }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("앱을 종료하는 중에는 설정을 변경할 수 없습니다."));
    this.pending += 1;
    const result = this.queue.then(task).finally(() => { this.pending -= 1; });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  get busy(): boolean { return this.pending > 0; }
  close(): Promise<void> { this.closed = true; return this.queue; }

  load(): Promise<DesktopSettingsSnapshot> { return this.enqueue(async () => (await this.read()).settings); }

  save(patch: unknown): Promise<DesktopSettingsSnapshot> {
    return this.enqueue(async () => {
      if (invalidSettingsFields(patch).length) throw new Error("지원하지 않는 설정값입니다. 사용자 지정 용량과 설정 항목을 확인한 뒤 다시 시도하세요.");
      const current = await this.read();
      if (!current.writable) throw new Error(current.settings.settingsNotice!.message);
      const next = normalizeDesktopSettings({ ...current.settings, ...persistentDesktopSettingsPatch(patch) });
      try { await this.publish(JSON.stringify(next, null, 2)); }
      catch (error) {
        throw new Error("설정을 저장하지 못했습니다. 이전에 저장된 설정은 유지됩니다. 디스크 공간과 접근 권한을 확인한 뒤 다시 시도하세요.", { cause: error });
      }
      return next;
    });
  }

  private async read(): Promise<ReadResult> {
    let raw: string;
    try {
      const entry = await lstat(this.path());
      if (!entry.isFile() || entry.isSymbolicLink()) return fallback("read-error", false);
      if (entry.size > MAX_SETTINGS_FILE_BYTES) return fallback("recovered", true);
      raw = await (this.files.read ?? (path => readFile(path, "utf8")))(this.path());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: normalizeDesktopSettings(undefined), writable: true };
      return fallback("read-error", false);
    }
    try {
      const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
      if (!settingsRecord(parsed)) return fallback("recovered", true);
      const version = parsed.settingsVersion;
      const currentVersion = CURRENT_SETTINGS_VERSION;
      if (typeof version === "number" && Number.isSafeInteger(version) && version > currentVersion) return fallback("newer-version", false);
      if (version !== undefined && (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0)) return fallback("recovered", true);
      const settings = normalizeDesktopSettings(parsed);
      if (invalidSettingsFields(parsed).length) return { settings: { ...settings,
        settingsNotice: { kind: "recovered", message: notices.recovered } }, writable: true };
      if (version !== currentVersion || (parsed.submissionLimit as { id?: unknown } | undefined)?.id === "mb41") {
        settings.settingsVersion = currentVersion;
        return { settings: { ...settings, settingsNotice: { kind: "migrated", message: notices.migrated } }, writable: true };
      }
      return { settings, writable: true };
    } catch { return fallback("recovered", true); }
  }

  private async publish(text: string): Promise<void> {
    const target = this.path();
    const directory = dirname(target);
    await mkdir(directory, { recursive: true });
    const stage = join(directory, `.settings-${randomUUID()}.tmp`);
    let handle: FileHandle | undefined;
    let owned: OwnedArtifact | undefined;
    let committed = false;
    try {
      handle = await open(stage, "wx", 0o600);
      try {
        await (this.files.write ?? ((file, content) => file.writeFile(content, "utf8")))(handle, text);
        await (this.files.sync ?? (file => file.sync()))(handle);
      } finally {
        const info = await handle.stat({ bigint: true });
        owned = { path: stage, dev: String(info.dev), ino: String(info.ino), birthtimeNs: String(info.birthtimeNs),
          mtimeNs: String(info.mtimeNs), size: String(info.size) };
        await handle.close(); handle = undefined;
      }
      // Never follow a replaced symlink or remove a directory to make promotion work.
      try {
        const current = await lstat(target);
        if (!current.isFile() || current.isSymbolicLink()) throw new Error("Settings target is not a regular file.");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await (this.files.promote ?? rename)(stage, target);
      committed = true;
    } finally {
      await handle?.close();
      if (!committed && owned) await removeOwnedArtifact(owned);
    }
  }
}
