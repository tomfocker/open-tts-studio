const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { randomUUID } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, safeStorage, screen, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const {
  chooseFrontendTarget,
  createBackendSupervisor,
  createDesktopPaths,
  isBackendHealthy,
  loadFrontend,
  openLegadoImportUrl,
  openLocalPath,
  revealLocalItem,
  resolveBilibiliInputsDirectory,
  resolveBilibiliOutputDirectory,
  resolveDesktopSettings,
  resolvePreferredStorageRoot,
  resolveFfmpegPath,
  saveSettingsBackup,
  saveTranscriptionExport,
  saveVoicePackage,
  selectDirectory,
  selectPythonExecutable,
  selectModelArchive,
  selectSettingsBackup,
  selectAudioEnhancementMedia,
  selectAudioSeparationMedia,
  selectTranscriptionMedia,
  selectReferenceAudio,
  selectVoicePackage,
  spawnBackendProcess,
  stageManagedMediaFile,
  terminateProcessTree
} = require("./desktop-runtime.cjs");
const { BilibiliSamplerService } = require("./bilibili-sampler-runtime.cjs");
const { LOCAL_MEDIA_SCHEME, createLocalMediaRegistry, parseByteRange } = require("./local-media-runtime.cjs");
const { createUpdateService } = require("./updater-runtime.cjs");
const { createRealtimeSettingsStore } = require("./realtime-settings-runtime.cjs");
const { createLlmSettingsStore } = require("./llm-settings-runtime.cjs");

protocol.registerSchemesAsPrivileged([{
  scheme: LOCAL_MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true
  }
}]);

let mainWindow;
let backendProcess;
let backendSupervisor;
let windowStateSaveTimer;
const selectedPreviewAudioPaths = new Set();
const localMediaRegistry = createLocalMediaRegistry();
const backendToken = app.isPackaged ? randomUUID() : null;
const packagedWorkspaceRoot = app.isPackaged ? path.join(process.resourcesPath, "workspace") : undefined;
const managedStorageRoot = resolvePreferredStorageRoot({
  env: process.env,
  platform: process.platform
});
// Keep Chromium's cache, cookies and renderer local storage beside the
// managed application data as well. This must run before app.whenReady().
if (process.platform === "win32") {
  app.setPath("userData", path.join(managedStorageRoot, "data", "electron"));
}
// The renderer bundle is part of app.asar, while API files are copied to
// resources/workspace. Keep those roots separate in packaged builds.
const packagedAppRoot = app.isPackaged ? path.resolve(__dirname, "..") : undefined;
const paths = createDesktopPaths(__dirname, packagedWorkspaceRoot, {
  dataRoot: path.join(managedStorageRoot, "data"),
  modelStoreRoot: path.join(managedStorageRoot, "models"),
  storageRoot: managedStorageRoot,
  settingsFile: path.join(managedStorageRoot, "data", "config", "user-settings.json"),
  apiPython: app.isPackaged ? path.join(process.resourcesPath, "workspace", "runtime", "python", "python.exe") : undefined,
  desktopDir: packagedAppRoot,
  resourcesRoot: app.isPackaged ? process.resourcesPath : undefined,
  distIndex: packagedAppRoot ? path.join(packagedAppRoot, "dist", "index.html") : undefined
});
const windowStateFile = path.join(paths.dataRoot, "config", "window-state.json");
const defaultWindowBounds = {
  width: 1600,
  height: 960,
  minWidth: 1120,
  minHeight: 700
};
let desktopSettings = resolveDesktopSettings(paths, { backendToken });
const bilibiliSamplerService = new BilibiliSamplerService({
  app,
  userDataRoot: path.join(paths.dataRoot, "bilibili"),
  defaultOutputDirectory: resolveBilibiliOutputDirectory(paths),
  getFfmpegPath: () => resolveFfmpegPath(paths)
});
const updateService = createUpdateService({
  app,
  autoUpdater,
  enabled: app.isPackaged && process.env.OPEN_TTS_DISABLE_AUTO_UPDATE !== "1"
});
const realtimeSettingsStore = createRealtimeSettingsStore({
  fs,
  safeStorage,
  getUserDataPath: () => path.join(paths.dataRoot, "config")
});
const llmSettingsStore = createLlmSettingsStore({
  fs,
  safeStorage,
  getUserDataPath: () => path.join(paths.dataRoot, "config"),
  loadLegacySettings: async () => {
    const legacy = await realtimeSettingsStore.load();
    return {
      enabled: true,
      baseUrl: legacy.llmBaseUrl,
      model: legacy.llmModel,
      apiKey: legacy.llmApiKey,
      systemPrompt: legacy.systemPrompt,
      temperature: 0.7,
      maxTokens: 512
    };
  }
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

function normalizeWindowState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || width < defaultWindowBounds.minWidth || height < defaultWindowBounds.minHeight
    || width > 10000 || height > 10000) {
    return null;
  }

  const state = {
    width: Math.round(width),
    height: Math.round(height),
    isMaximized: value.isMaximized === true
  };
  const x = Number(value.x);
  const y = Number(value.y);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 50000 && Math.abs(y) <= 50000) {
    state.x = Math.round(x);
    state.y = Math.round(y);
  }
  return state;
}

async function loadWindowState() {
  try {
    const raw = await fs.readFile(windowStateFile, "utf8");
    return normalizeWindowState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isWindowStateVisible(state) {
  if (!Number.isFinite(state?.x) || !Number.isFinite(state?.y)) {
    return false;
  }
  try {
    return screen.getAllDisplays().some(({ workArea }) => (
      state.x < workArea.x + workArea.width
      && state.x + Math.min(state.width, workArea.width) > workArea.x
      && state.y < workArea.y + workArea.height
      && state.y + Math.min(state.height, workArea.height) > workArea.y
    ));
  } catch {
    // A display query can briefly fail during startup or monitor hot-plugging.
    // Keeping the validated state is safer than aborting the application.
    return true;
  }
}

function getWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: mainWindow.isMaximized()
  };
}

function saveWindowState() {
  const state = getWindowState();
  if (!state) {
    return;
  }
  try {
    fsSync.mkdirSync(path.dirname(windowStateFile), { recursive: true });
    fsSync.writeFileSync(windowStateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Window geometry should never prevent the desktop application from closing.
  }
}

function scheduleWindowStateSave() {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = undefined;
    saveWindowState();
  }, 300);
}

async function createWindow() {
  const restoredWindowState = await loadWindowState();
  const initialWindowState = restoredWindowState && isWindowStateVisible(restoredWindowState)
    ? restoredWindowState
    : null;
  const frontendTarget = await chooseFrontendTarget(paths, {
    preferDevServer: process.env.OPEN_TTS_DESKTOP_FORCE_DIST === "1" ? false : !app.isPackaged
  });
  mainWindow = new BrowserWindow({
    width: initialWindowState?.width ?? defaultWindowBounds.width,
    height: initialWindowState?.height ?? defaultWindowBounds.height,
    minWidth: defaultWindowBounds.minWidth,
    minHeight: defaultWindowBounds.minHeight,
    ...(initialWindowState?.x !== undefined && initialWindowState?.y !== undefined
      ? { x: initialWindowState.x, y: initialWindowState.y }
      : {}),
    show: false,
    title: "OpenTTS Studio",
    frame: false,
    backgroundColor: "#e7edf2",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.once("ready-to-show", () => {
    // Avoid showing the first frame while the responsive header is still
    // measuring its navigation width on high-DPI displays.
    if (initialWindowState?.isMaximized) {
      mainWindow?.maximize();
    }
    mainWindow?.show();
  });

  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", () => {
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = undefined;
    }
    saveWindowState();
  });

  await loadFrontend(mainWindow, frontendTarget);
}

app.whenReady().then(async () => {
  // v0.9 is a clean D: installation: it never follows or mutates data left
  // by an older AppData-based installation. Every managed file is read from
  // the single storage root selected above.
  configureBackend();
  protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
    const fileUrl = localMediaRegistry.resolve(request.url);
    if (!fileUrl) {
      return new Response("Preview media was not found", { status: 404 });
    }
    let totalBytes;
    try {
      totalBytes = (await fs.stat(fileURLToPath(fileUrl))).size;
    } catch {
      return new Response("Preview media was not found", { status: 404 });
    }
    const range = parseByteRange(request.headers.get("range"), totalBytes);
    if (range?.unsatisfiable) {
      return new Response(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${totalBytes}`
        }
      });
    }
    const source = await net.fetch(fileUrl, { headers: request.headers });
    const headers = new Headers();
    for (const name of ["content-type", "last-modified", "etag"]) {
      const value = source.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }
    headers.set("accept-ranges", "bytes");
    headers.set("content-length", String(range?.length ?? totalBytes));
    if (range) {
      headers.set("content-range", `bytes ${range.start}-${range.end}/${totalBytes}`);
    }
    return new Response(source.body, { status: range ? 206 : 200, headers });
  });
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

ipcMain.handle("file:select-audio-enhancement-media", () => (
  selectAudioEnhancementMedia(dialog, fs, path.join(paths.dataRoot, "audio-enhancements", "inputs"))
));

ipcMain.handle("file:select-audio-separation-media", () => (
  selectAudioSeparationMedia(dialog, fs, path.join(paths.dataRoot, "audio-separations", "inputs"))
));

ipcMain.handle("file:save-transcription-export", (_event, content, defaultName, extension) => (
  saveTranscriptionExport(dialog, fs, content, defaultName, extension, resolveBilibiliOutputDirectory(paths))
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

ipcMain.handle("file:select-python-executable", () => selectPythonExecutable(dialog));

ipcMain.handle("file:select-model-archive", () => selectModelArchive(dialog));

ipcMain.handle("file:save-settings-backup", (_event, content) => {
  const date = new Date().toISOString().slice(0, 10);
  return saveSettingsBackup(dialog, fs, content, `OpenTTS-Studio-settings-${date}.json`);
});

ipcMain.handle("file:select-settings-backup", () => selectSettingsBackup(dialog, fs));

ipcMain.handle("realtime-settings:load", () => realtimeSettingsStore.load());

ipcMain.handle("realtime-settings:save", (_event, settings) => realtimeSettingsStore.save(settings));

ipcMain.handle("llm-settings:load", () => llmSettingsStore.load());

ipcMain.handle("llm-settings:save", (_event, settings) => llmSettingsStore.save(settings));

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

ipcMain.handle("bilibili-sampler:download-video", async (_event, payload) => {
  const result = await bilibiliSamplerService.downloadVideo(payload);
  if (result.success && result.data?.videoPath) {
    result.data.previewUrl = localMediaRegistry.register(result.data.videoPath);
  }
  return result;
});

ipcMain.handle("bilibili-sampler:list-history", () => ({
  success: true,
  data: bilibiliSamplerService.listVideoHistory()
}));

ipcMain.handle("bilibili-sampler:get-history-item", (_event, historyId) => {
  const entry = bilibiliSamplerService.getVideoHistoryEntry(historyId);
  if (!entry) {
    return { success: false, error: "未找到这条本地下载记录" };
  }
  if (!fsSync.existsSync(entry.videoPath)) {
    return { success: false, error: "原始视频文件已不存在，请从历史记录中移除后重新下载" };
  }
  return {
    success: true,
    data: {
      ...bilibiliSamplerService.toPublicVideoHistoryEntry(entry),
      exists: true,
      previewUrl: localMediaRegistry.register(entry.videoPath)
    }
  };
});

ipcMain.handle("bilibili-sampler:extract-history-sample", async (_event, historyId, payload) => {
  const entry = bilibiliSamplerService.getVideoHistoryEntry(historyId);
  if (!entry || !fsSync.existsSync(entry.videoPath)) {
    return { success: false, error: "原始视频文件已不存在，无法提取片段" };
  }
  return bilibiliSamplerService.extractLocalSample({
    inputPath: entry.videoPath,
    startSeconds: payload?.startSeconds,
    endSeconds: payload?.endSeconds,
    sampleName: payload?.sampleName,
    outputDirectory: resolveBilibiliOutputDirectory(paths)
  });
});

ipcMain.handle("bilibili-sampler:stage-transcription", async (_event, historyId) => {
  const entry = bilibiliSamplerService.getVideoHistoryEntry(historyId);
  if (!entry || !fsSync.existsSync(entry.videoPath)) {
    return { success: false, error: "原始视频文件已不存在，无法创建转写任务" };
  }
  try {
    const data = await stageManagedMediaFile(fs, entry.videoPath, path.join(paths.dataRoot, "transcriptions", "inputs"));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "无法准备本地转写媒体" };
  }
});

ipcMain.handle("bilibili-sampler:remove-history", async (_event, historyId) => ({
  success: await bilibiliSamplerService.removeVideoHistoryEntry(historyId)
}));

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
