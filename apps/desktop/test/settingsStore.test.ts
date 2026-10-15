import { createHash } from "node:crypto";
import { link, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/settingsStore.js";
import { defaultDesktopSettings, normalizeDesktopSettings, persistentDesktopSettingsPatch } from "../src/shared/desktopSettings.js";
import { customLimitBytesFromMb, MAX_CUSTOM_LIMIT_BYTES, MIB } from "../src/shared/submissionLimits.js";

let directory: string;
let path: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hwpx-settings-")); path = join(directory, "settings.json"); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const seed = async () => {
  const bytes = Buffer.from(JSON.stringify({ ...defaultDesktopSettings, saveReport: true }));
  await writeFile(path, bytes); return bytes;
};

describe("bounded settings values and privacy", () => {
  it.each([undefined, null, NaN, Infinity, -Infinity, 0, -1, 0.5, MAX_CUSTOM_LIMIT_BYTES + 1, "40"])(
    "rejects malformed custom bytes %s instead of retaining an unlimited custom target", value => {
      const patch = { submissionLimit: { id: "custom", customBytes: value } };
      expect(persistentDesktopSettingsPatch(patch)).toEqual({});
      expect(normalizeDesktopSettings(patch).submissionLimit).toEqual({ id: "mb40" });
    }
  );
  it.each([1, 0.5 * MIB, MAX_CUSTOM_LIMIT_BYTES])("retains valid exact byte limit %s", value => {
    expect(normalizeDesktopSettings({ submissionLimit: { id: "custom", customBytes: value } }).submissionLimit)
      .toEqual({ id: "custom", customBytes: value });
    expect(customLimitBytesFromMb(String(value / MIB))).toBe(value);
  });
  it("strips private paths and unknown properties at both object depths", () => {
    const next = normalizeDesktopSettings({ settingsVersion: 3, saveReport: true, recentFiles: ["private.hwpx"],
      submissionLimit: { id: "mb40", customBytes: Infinity, privatePath: "private.hwpx" },
      outputDirectory: "private-folder", settingsNotice: { message: "private" } });
    expect(next.submissionLimit).toEqual({ id: "mb40" });
    expect(JSON.stringify(next)).not.toContain("private");
    expect(next.saveReport).toBe(true);
  });
  it.each([undefined, 1, 2])("normalizes legacy version %s while retaining intentional preservation settings", version => {
    expect(normalizeDesktopSettings({ settingsVersion: version, defaultMode: "safe", preservationPreference: "recommended" }).defaultMode).toBe("balanced");
    expect(normalizeDesktopSettings({ settingsVersion: version, defaultMode: "safe", preservationPreference: "preserve" }).defaultMode).toBe("safe");
  });
  it.each(["", "0", "-1", "1e309", "1048577", "0.00000001", "0.0000006"])("rejects invalid MB draft %s", value => {
    expect(customLimitBytesFromMb(value)).toBeUndefined();
  });
});

describe("settings file recovery and migration", () => {
  it("starts from defaults without warning on first use and persists a complete current snapshot", async () => {
    const store = new DesktopSettingsStore(path);
    expect(await store.load()).toEqual(defaultDesktopSettings);
    await store.save({ saveReport: true });
    const disk = JSON.parse(await readFile(path, "utf8"));
    expect(disk).toEqual({ ...defaultDesktopSettings, saveReport: true });
    expect(await readdir(directory)).toEqual(["settings.json"]);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
  it.each(["{broken", "null", "[]", '{"submissionLimit":{"id":"custom","customBytes":1e309},"saveReport":true}'])(
    "discloses invalid saved settings while preserving original bytes until an explicit save", async content => {
      await writeFile(path, content);
      const store = new DesktopSettingsStore(path);
      const loaded = await store.load();
      expect(loaded.settingsNotice?.kind).toBe("recovered");
      expect(loaded.submissionLimit).toEqual({ id: "mb40" });
      expect(await readFile(path, "utf8")).toBe(content);
      const saved = await store.save({ preventOverwrite: false });
      expect(saved.settingsNotice).toBeUndefined();
      expect(JSON.parse(await readFile(path, "utf8")).preventOverwrite).toBe(false);
      expect(await readdir(directory)).toEqual(["settings.json"]);
    }
  );
  it("migrates legacy defaults and limits and removes nested/private fields on the next explicit save", async () => {
    const legacy = { defaultMode: "safe", preservationPreference: "recommended", submissionLimit: { id: "mb41", path: "private" }, outputDirectory: "private" };
    await writeFile(path, JSON.stringify(legacy));
    const store = new DesktopSettingsStore(path);
    const loaded = await store.load();
    expect(loaded.settingsNotice?.kind).toBe("migrated");
    expect(loaded.defaultMode).toBe("balanced");
    expect(loaded.submissionLimit).toEqual({ id: "mb40" });
    await store.save({ saveReport: true });
    const disk = await readFile(path, "utf8");
    expect(disk).not.toContain("private");
    expect(disk).not.toContain("settingsNotice");
    expect(JSON.parse(disk).settingsVersion).toBe(3);
  });
  it("preserves newer-version settings and refuses to downgrade them", async () => {
    const future = JSON.stringify({ settingsVersion: 4, saveReport: true, futureField: "keep" });
    await writeFile(path, future);
    const store = new DesktopSettingsStore(path);
    expect((await store.load()).settingsNotice?.kind).toBe("newer-version");
    await expect(store.save({ saveReport: false })).rejects.toThrow("더 새 버전");
    expect(await readFile(path, "utf8")).toBe(future);
  });
  it("does not replace unreadable settings with defaults", async () => {
    const original = await seed();
    const store = new DesktopSettingsStore(path, { read: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } });
    expect((await store.load()).settingsNotice?.kind).toBe("read-error");
    await expect(store.save({ saveReport: false })).rejects.toThrow("읽지 못해");
    expect(hash(await readFile(path))).toBe(hash(original));
  });
  it("does not truncate an unrelated file hardlinked to the damaged settings path", async () => {
    const document = join(directory, "original.hwpx"); const original = Buffer.from("synthetic input bytes");
    await writeFile(document, original); await link(document, path);
    const store = new DesktopSettingsStore(path);
    expect((await store.load()).settingsNotice?.kind).toBe("recovered");
    await store.save({ saveReport: true });
    expect(hash(await readFile(document))).toBe(hash(original));
    expect(JSON.parse(await readFile(path, "utf8")).saveReport).toBe(true);
  });
});

describe("atomic publication and ordered patches", () => {
  it.each(["write", "sync", "promote"] as const)("retains exact prior bytes and removes the owned stage after %s failure", async phase => {
    const original = await seed();
    const store = new DesktopSettingsStore(path, {
      ...(phase === "write" ? { write: async (handle, text) => { await handle.writeFile(text.slice(0, 12)); throw new Error("disk full"); } } : {}),
      ...(phase === "sync" ? { sync: async () => { throw new Error("flush failed"); } } : {}),
      ...(phase === "promote" ? { promote: async () => { throw new Error("rename failed"); } } : {})
    });
    await expect(store.save({ saveReport: false })).rejects.toThrow("설정을 저장하지 못했습니다");
    expect(hash(await readFile(path))).toBe(hash(original));
    expect(await readdir(directory)).toEqual(["settings.json"]);
  });
  it("keeps the old snapshot visible until same-directory promotion and serializes readers and later patches", async () => {
    const original = await seed();
    let reached!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const store = new DesktopSettingsStore(path, { promote: async (from, to) => {
      expect(dirname(String(from))).toBe(dirname(String(to)));
      expect(JSON.parse(await readFile(from, "utf8")).settingsVersion).toBe(3);
      if (first) { first = false; reached(); await resume; }
      await rename(from, to);
    } });
    const saving = store.save({ saveReport: false });
    await ready;
    try {
      expect(hash(await readFile(path))).toBe(hash(original));
      let readSettled = false;
      const queuedRead = store.load().then(value => { readSettled = true; return value; });
      const nextSave = store.save({ preventOverwrite: false });
      await new Promise(resolve => setImmediate(resolve));
      expect(readSettled).toBe(false);
      release(); await saving;
      expect((await queuedRead).saveReport).toBe(false);
      await nextSave;
      const disk = JSON.parse(await readFile(path, "utf8"));
      expect(disk.saveReport).toBe(false); expect(disk.preventOverwrite).toBe(false);
      expect(await readdir(directory)).toEqual(["settings.json"]);
    } finally { release(); await saving; }
  });
  it("continues after a rejected patch and preserves concurrent disjoint updates", async () => {
    const store = new DesktopSettingsStore(path);
    const bad = expect(store.save({ submissionLimit: { id: "custom", customBytes: NaN } })).rejects.toThrow("설정");
    const updates = [store.save({ saveReport: true }), store.save({ preventOverwrite: false }),
      store.save({ batchTargetMode: "aggregate" }), store.save({ submissionLimit: { id: "custom", customBytes: 1 } })];
    await bad; await Promise.all(updates);
    expect(await store.load()).toEqual({ ...defaultDesktopSettings, saveReport: true, preventOverwrite: false,
      batchTargetMode: "aggregate", submissionLimit: { id: "custom", customBytes: 1 } });
    expect(await readdir(directory)).toEqual(["settings.json"]);
  });
  it("finishes accepted saves before close resolves and rejects subsequent mutations", async () => {
    let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const store = new DesktopSettingsStore(path, { promote: async (from, to) => {
      entered(); await resume; await rename(from, to);
    } });
    const saving = store.save({ saveReport: true });
    await ready;
    try {
      expect(store.busy).toBe(true);
      let closed = false;
      const closing = store.close().then(() => { closed = true; });
      await new Promise(resolve => setImmediate(resolve));
      expect(closed).toBe(false);
      await expect(store.save({ saveReport: false })).rejects.toThrow("종료하는 중");
      release(); await saving; await closing;
      expect(store.busy).toBe(false);
      expect(JSON.parse(await readFile(path, "utf8")).saveReport).toBe(true);
      expect(await readdir(directory)).toEqual(["settings.json"]);
    } finally { release(); await saving; }
  });
});
