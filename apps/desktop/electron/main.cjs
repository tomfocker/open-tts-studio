const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
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
  saveVoicePackage,
  selectDirectory,
  selectModelArchive,
  selectSettingsBackup,
  selectReferenceAudio,
  selectVoicePackage,
  spawnBackendProcess,
  terminateProcessTree
} = require("./desktop-runtime.cjs");
const { BilibiliSamplerService } = require("./bilibili-sampler-runtime.cjs");
const { createUpdateService } = require("./updater-runtime.cjs");

let mainWindow;
let backendProcess;
const packagedWorkspaceRoot = app.isPackaged ? path.join(process.resourcesPath, "workspace") : undefined;
const packagedDataRoot = app.isPackaged ? path.join(app.getPath("userData"), "data") : undefined;
const packagedModelStoreRoot = app.isPackaged ? path.join(app.getPath("userData"), "models") : undefined;
const paths = createDesktopPaths(__dirname, packagedWorkspaceRoot, {
  dataRoot: packagedDataRoot,
  modelStoreRoot: packagedModelStoreRoot,
  apiPython: app.isPackaged ? path.join(process.resourcesPath, "workspace", "runtime", "python", "python.exe") : undefined
});
let desktopSettings = resolveDesktopSettings(paths);
const bilibiliSamplerService = new BilibiliSamplerService({
  app,
  defaultOutputDirectory: resolveBilibiliInputsDirectory(paths),
  getFfmpegPath: () => resolveFfmpegPath(paths)
});
const updateService = createUpdateService({
  app,
  autoUpdater,
  enabled: app.isPackaged && process.env.OPEN_TTS_DISABLE_AUTO_UPDATE !== "1"
});

updateService.subscribe((state) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("app-update:state-changed", state);
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
  if (app.isPackaged) {
    setTimeout(() => void updateService.check(), 3500);
  }
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

ipcMain.handle("file:select-voice-package", () => selectVoicePackage(dialog));

ipcMain.handle("file:save-voice-package", (_event, sourcePath, defaultName) => saveVoicePackage(dialog, fs, sourcePath, defaultName));

ipcMain.handle("file:select-directory", () => selectDirectory(dialog));

ipcMain.handle("file:select-model-archive", () => selectModelArchive(dialog));

ipcMain.handle("file:save-settings-backup", (_event, content) => {
  const date = new Date().toISOString().slice(0, 10);
  return saveSettingsBackup(dialog, fs, content, `OpenTTS-Studio-settings-${date}.json`);
});

ipcMain.handle("file:select-settings-backup", () => selectSettingsBackup(dialog, fs));

ipcMain.handle("app-update:get-state", () => updateService.getState());

ipcMain.handle("app-update:check", () => updateService.check());

ipcMain.handle("app-update:download", () => updateService.download());

ipcMain.handle("app-update:install", () => updateService.install());

ipcMain.handle("clipboard:write-text", (_event, content) => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Clipboard text is required");
  }
  if (content.length > 256 * 1024) {
    throw new Error("Clipboard text is too large");
  }
  clipboard.writeText(content);
});

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
