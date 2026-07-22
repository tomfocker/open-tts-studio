const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { createUpdateService, normalizeReleaseNotes } = require("./updater-runtime.cjs");

test("normalizeReleaseNotes accepts the formats emitted by electron-updater", () => {
  assert.equal(normalizeReleaseNotes("  修复启动问题  "), "修复启动问题");
  assert.equal(normalizeReleaseNotes([{ note: "修复 A" }, { note: "修复 B" }]), "修复 A\n修复 B");
  assert.equal(normalizeReleaseNotes(null), null);
});

test("update service reports a download-ready update before installation", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => updater.emit("update-available", { version: "0.2.0", releaseNotes: "新增音色包" });
  updater.downloadUpdate = async () => {
    updater.emit("download-progress", { percent: 45 });
    updater.emit("update-downloaded", { version: "0.2.0", releaseNotes: "新增音色包" });
  };
  let installed = false;
  updater.quitAndInstall = () => { installed = true; };
  const service = createUpdateService({ app: { getVersion: () => "0.1.0" }, autoUpdater: updater, enabled: true });

  await service.check();
  assert.equal(service.getState().status, "available");
  assert.equal(service.getState().availableVersion, "0.2.0");

  await service.download();
  assert.equal(service.getState().status, "downloaded");
  assert.equal(service.getState().progressPercent, 100);

  service.install();
  assert.equal(installed, true);
});

test("update service remains unavailable for local development", async () => {
  const service = createUpdateService({ app: { getVersion: () => "0.1.0" }, autoUpdater: new EventEmitter(), enabled: false });

  await service.check();

  assert.equal(service.getState().status, "unavailable");
});
