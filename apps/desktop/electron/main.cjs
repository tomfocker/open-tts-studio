const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const {
  chooseFrontendTarget,
  createBackendSupervisor,
  createDesktopPaths,
  isBackendHealthy,
  loadFrontend,
  migrateLegacyManagedModelAssets,
  openLegadoImportUrl,
  openLocalPath,
  revealLocalItem,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveFfmpegPath,
  saveSettingsBackup,
  saveTranscriptionExport,
  saveVoicePackage,
  selectDirectory,
  selectModelArchive,
  selectSettingsBackup,
  selectTranscriptionMedia,
  selectReferenceAudio,
  selectVoicePackage,
  spawnBackendProcess,
  terminateProcessTree
} = require("./desktop-runtime.cjs");
const { BilibiliSamplerService } = require("./bilibili-sampler-runtime.cjs");
const { createUpdateService } = require("./updater-runtime.cjs");

let mainWindow;
let backendProcess;
let backendSupervisor;
const selectedPreviewAudioPaths = new Set();
const backendToken = app.isPackaged ? randomUUID() : null;
const packagedWorkspaceRoot = app.isPackaged ? path.join(process.resourcesPath, "workspace") : undefined;
const packagedDataRoot = app.isPackaged ? path.join(app.getPath("userData"), "data") : undefined;
const packagedModelStoreRoot = app.isPackaged ? path.join(app.getPath("userData"), "models") : undefined;
// The renderer bundle is part of app.asar, while API files are copied to
// resources/workspace. Keep those roots separate in packaged builds.
const packagedAppRoot = app.isPackaged ? path.resolve(__dirname, "..") : undefined;
const paths = createDesktopPaths(__dirname, packagedWorkspaceRoot, {
  dataRoot: packagedDataRoot,
  modelStoreRoot: packagedModelStoreRoot,
  apiPython: app.isPackaged ? path.join(process.resourcesPath, "workspace", "runtime", "python", "python.exe") : undefined,
  desktopDir: packagedAppRoot,
  resourcesRoot: app.isPackaged ? process.resourcesPath : undefined,
  distIndex: packagedAppRoot ? path.join(packagedAppRoot, "dist", "index.html") : undefined
});
let desktopSettings = resolveDesktopSettings(paths, { backendToken });
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

function configureBackend() {
  desktopSettings = resolveDesktopSettings(paths, { backendToken });
  process.env.OPEN_TTS_API_BASE = desktopSettings.apiBase;
  process.env.OPEN_TTS_APP_VERSION = app.getVersion();
}

function getBackendSupervisor() {
  if (backendSupervisor) {
    return backendSupervisor;
  }
  const healthUrl = `${desktopSettings.apiBase}/v1/health`;
  backendSupervisor = createBackendSupervisor({
    healthUrl,
    isHealthy: () => isBackendHealthy(healthUrl, desktopSettings.backendToken),
    spawnBackend: () => spawnBackendProcess(paths, desktopSettings)
  });
  return backendSupervisor;
}

async function ensureLocalBackend() {
  const result = await getBackendSupervisor().ensureOnline();
  backendProcess = result.process;
  return result;
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
  // v0.7.1 moves mutable ASR assets out of the application installation. This
  // one-time copy preserves older local runtime installs without touching
  // user-selected external model directories.
  try {
    migrateLegacyManagedModelAssets(paths);
  } catch (error) {
    console.warn("OpenTTS managed-model migration skipped:", error instanceof Error ? error.message : String(error));
  }
  configureBackend();
  await createWindow();
  void ensureLocalBackend();
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

ipcMain.handle("file:reveal-in-folder", (_event, targetPath) => revealLocalItem(targetPath, shell));

ipcMain.handle("external:open-legado-import", (_event, targetUrl) => openLegadoImportUrl(targetUrl, shell));

ipcMain.handle("file:select-reference-audio", async () => {
  const selectedPath = await selectReferenceAudio(dialog);
  if (selectedPath) {
    selectedPreviewAudioPaths.add(path.resolve(selectedPath));
  }
  return selectedPath;
});

ipcMain.handle("file:select-transcription-media", () => (
  selectTranscriptionMedia(dialog, fs, path.join(paths.dataRoot, "transcriptions", "inputs"))
));

ipcMain.handle("file:save-transcription-export", (_event, content, defaultName, extension) => (
  saveTranscriptionExport(dialog, fs, content, defaultName, extension)
));

ipcMain.handle("file:read-selected-audio", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("Audio path is required");
  }
  const normalizedPath = path.resolve(targetPath);
  if (!selectedPreviewAudioPaths.has(normalizedPath)) {
    throw new Error("请先通过应用选择参考音频");
  }
  const info = await fs.stat(normalizedPath);
  if (!info.isFile() || info.size > 200 * 1024 * 1024) {
    throw new Error("参考音频无效或超过 200 MB");
  }
  return fs.readFile(normalizedPath);
});

ipcMain.handle("file:read-managed-reference-audio", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("Audio path is required");
  }
  const managedRoot = await fs.realpath(path.join(paths.dataRoot, "voices"));
  const normalizedPath = path.resolve(targetPath);
  const resolvedPath = await fs.realpath(normalizedPath);
  const relativePath = path.relative(managedRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("只能裁切音色库托管的参考音频");
  }
  const info = await fs.stat(resolvedPath);
  if (!info.isFile() || info.size > 200 * 1024 * 1024) {
    throw new Error("参考音频无效或超过 200 MB");
  }
  return fs.readFile(resolvedPath);
});

ipcMain.handle("file:select-voice-package", () => selectVoicePackage(dialog));

ipcMain.handle("file:save-voice-package", (_event, sourcePath, defaultName) => saveVoicePackage(dialog, fs, sourcePath, defaultName));

ipcMain.handle("file:select-directory", () => selectDirectory(dialog));

ipcMain.handle("file:select-model-archive", () => selectModelArchive(dialog));

ipcMain.handle("file:save-settings-backup", (_event, content) => {
  const date = new Date().toISOString().slice(0, 10);
  return saveSettingsBackup(dialog, fs, content, `OpenTTS-Studio-settings-${date}.json`);
});

ipcMain.handle("file:select-settings-backup", () => selectSettingsBackup(dialog, fs));

ipcMain.handle("backend:ensure-online", async () => {
  const result = await ensureLocalBackend();
  return {
    ready: result.ready,
    status: result.status,
    message: result.error ?? null
  };
});

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

ipcMain.handle("bilibili-sampler:download-video", (_event, payload) => {
  return bilibiliSamplerService.downloadVideo(payload);
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
  if (backendSupervisor) {
    backendSupervisor.stop();
  } else {
    terminateProcessTree(backendProcess);
  }
});
