const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  chooseFrontendTarget,
  createDesktopPaths,
  ensureBackend,
  loadFrontend,
  openLocalPath,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveFfmpegPath,
  saveSettingsBackup,
  selectDirectory,
  selectModelArchive,
  selectSettingsBackup,
  selectReferenceAudio,
  spawnBackendProcess,
  terminateProcessTree
} = require("./desktop-runtime.cjs");
const { BilibiliSamplerService } = require("./bilibili-sampler-runtime.cjs");

let mainWindow;
let backendProcess;
const paths = createDesktopPaths(__dirname);
let desktopSettings = resolveDesktopSettings(paths);
const bilibiliSamplerService = new BilibiliSamplerService({
  app,
  defaultOutputDirectory: resolveBilibiliInputsDirectory(paths),
  getFfmpegPath: () => resolveFfmpegPath(paths)
});

async function prepareBackend() {
  desktopSettings = resolveDesktopSettings(paths);
  process.env.OPEN_TTS_API_BASE = desktopSettings.apiBase;
  const healthUrl = `${desktopSettings.apiBase}/v1/health`;
  const result = await ensureBackend({
    healthUrl,
    spawnBackend: () => spawnBackendProcess(paths, desktopSettings)
  });
  backendProcess = result.process;
}

async function createWindow() {
  const frontendTarget = await chooseFrontendTarget(paths, {
    preferDevServer: process.env.OPEN_TTS_DESKTOP_FORCE_DIST === "1" ? false : !app.isPackaged
  });
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "OpenTTS Studio",
    frame: false,
    backgroundColor: "#e7edf2",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  await loadFrontend(mainWindow, frontendTarget);
}

app.whenReady().then(async () => {
  await prepareBackend();
  await createWindow();
});

ipcMain.on("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window:maximize", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("file:open-path", (_event, targetPath) => openLocalPath(targetPath, shell));

ipcMain.handle("file:select-reference-audio", () => selectReferenceAudio(dialog));

ipcMain.handle("file:select-directory", () => selectDirectory(dialog));

ipcMain.handle("file:select-model-archive", () => selectModelArchive(dialog));

ipcMain.handle("file:save-settings-backup", (_event, content) => {
  const date = new Date().toISOString().slice(0, 10);
  return saveSettingsBackup(dialog, fs, content, `OpenTTS-Studio-settings-${date}.json`);
});

ipcMain.handle("file:select-settings-backup", () => selectSettingsBackup(dialog, fs));

ipcMain.handle("bilibili-sampler:get-session", () => bilibiliSamplerService.loadSession());

ipcMain.handle("bilibili-sampler:start-login", () => bilibiliSamplerService.bootstrapQrLogin());

ipcMain.handle("bilibili-sampler:poll-login", () => bilibiliSamplerService.pollLogin());

ipcMain.handle("bilibili-sampler:logout", () => bilibiliSamplerService.logout());

ipcMain.handle("bilibili-sampler:parse-link", (_event, link) => {
  return bilibiliSamplerService.parseLink({ url: link });
});

ipcMain.handle("bilibili-sampler:load-audio-options", (_event, payload) => {
  return bilibiliSamplerService.loadAudioOptions(payload);
});

ipcMain.handle("bilibili-sampler:extract-sample", (_event, payload) => {
  return bilibiliSamplerService.extractSample(payload);
});

ipcMain.handle("bilibili-sampler:cancel-extract", () => bilibiliSamplerService.cancelExtract());

bilibiliSamplerService.onStateChanged((state) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("bilibili-sampler:state-changed", state);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  terminateProcessTree(backendProcess);
});
