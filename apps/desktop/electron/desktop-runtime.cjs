const childProcess = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_API_PORT = 8765;
const DEFAULT_DEV_URL = "http://127.0.0.1:5173";
const DEFAULT_API_HOST = "127.0.0.1";
const MAX_TRANSCRIPTION_MEDIA_BYTES = 8 * 1024 * 1024 * 1024;
const TRANSCRIPTION_MEDIA_EXTENSIONS = [
  "wav", "mp3", "flac", "m4a", "aac", "ogg", "opus", "webm",
  "mp4", "mkv", "mov", "avi", "m4v", "ts", "mpeg", "mpg"
];
const LEGACY_MANAGED_MODEL_ASSETS = [
  "SenseVoiceSmall",
  "CapsWriter-Offline",
  "Qwen3-ASR-1.7B",
  "Qwen3-ForcedAligner-0.6B",
  "Qwen3-runtime",
  "Qwen3-runtime-cuda"
];

function createDesktopPaths(electronDir, workspaceRoot, options = {}) {
  const resolvedWorkspaceRoot = workspaceRoot || path.resolve(electronDir, "..", "..", "..");
  const apiDir = path.join(resolvedWorkspaceRoot, "apps", "api");
  const desktopDir = options.desktopDir || path.join(resolvedWorkspaceRoot, "apps", "desktop");
  const dataRoot = options.dataRoot || path.join(resolvedWorkspaceRoot, "data");
  const modelStoreRoot = options.modelStoreRoot || path.join(resolvedWorkspaceRoot, "models");
  const storageRoot = options.storageRoot || path.dirname(modelStoreRoot);
  const resourcesRoot = options.resourcesRoot || path.join(desktopDir, "resources");
  return {
    workspaceRoot: resolvedWorkspaceRoot,
    apiDir,
    apiPython: options.apiPython || path.join(apiDir, ".venv", "Scripts", "python.exe"),
    desktopDir,
    distIndex: options.distIndex || path.join(desktopDir, "dist", "index.html"),
    dataRoot,
    modelStoreRoot,
    storageRoot,
    settingsFile: options.settingsFile || path.join(dataRoot, "config", "user-settings.json"),
    resourcesRoot,
    logsDir: path.join(dataRoot, "logs")
  };
}

function buildBackendLaunchOptions(paths, port = DEFAULT_API_PORT) {
  const settings = typeof port === "object" ? port : resolveDesktopSettings(paths, { apiPort: port });
  return {
    filePath: paths.apiPython,
    args: [
      "-m",
      "uvicorn",
      "tts_api.main:app",
      "--host",
      settings.apiHost,
      "--port",
      String(settings.apiPort)
    ],
    cwd: paths.apiDir,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      OPEN_TTS_API_HOST: settings.apiHost,
      OPEN_TTS_API_PORT: String(settings.apiPort),
      ...(settings.backendToken ? { OPEN_TTS_BACKEND_TOKEN: settings.backendToken } : {}),
      OPEN_TTS_SETTINGS_FILE: settings.settingsFile,
      OPEN_TTS_STORAGE_ROOT: paths.storageRoot,
      OPEN_TTS_MODEL_STORE_ROOT: paths.modelStoreRoot,
      OPEN_TTS_OUTPUT_DIR: path.join(paths.dataRoot, "outputs"),
      OPEN_TTS_VOICE_LIBRARY_FILE: path.join(paths.dataRoot, "config", "voices.json"),
      OPEN_TTS_VOICE_ASSET_DIR: path.join(paths.dataRoot, "voices"),
      OPEN_TTS_VOICE_EXPORT_DIR: path.join(paths.dataRoot, "exports", "voices"),
      OPEN_TTS_PROJECTS_FILE: path.join(paths.dataRoot, "config", "projects.json"),
      OPEN_TTS_MODEL_PACKAGES_FILE: path.join(paths.dataRoot, "config", "model-packages.json"),
      OPEN_TTS_TASKS_FILE: path.join(paths.dataRoot, "config", "tasks.json"),
      OPEN_TTS_TASK_LOG_DIR: path.join(paths.dataRoot, "logs", "tasks"),
      OPEN_TTS_ALIGNMENT_JOBS_FILE: path.join(paths.dataRoot, "config", "alignments.json"),
      OPEN_TTS_ALIGNMENT_CACHE_DIR: path.join(paths.dataRoot, "alignments", "cache"),
      OPEN_TTS_ALIGNMENT_WORK_DIR: path.join(paths.dataRoot, "alignments", "work"),
      OPEN_TTS_QWEN_ASR_WORK_DIR: path.join(paths.dataRoot, "asr", "qwen3-work"),
      OPEN_TTS_TRANSCRIPTION_JOBS_FILE: path.join(paths.dataRoot, "config", "transcriptions.json"),
      OPEN_TTS_TRANSCRIPTION_INPUT_DIR: path.join(paths.dataRoot, "transcriptions", "inputs"),
      OPEN_TTS_AUDIO_ENHANCEMENT_JOBS_FILE: path.join(paths.dataRoot, "config", "audio-enhancements.json"),
      OPEN_TTS_AUDIO_ENHANCEMENT_INPUT_DIR: path.join(paths.dataRoot, "audio-enhancements", "inputs"),
      OPEN_TTS_AUDIO_ENHANCEMENT_WORK_DIR: path.join(paths.dataRoot, "audio-enhancements", "work"),
      // Separation imports are staged through Electron under the desktop data
      // root.  Do not derive this from output_dir: an upgraded user may retain
      // an older custom output directory, which would make the API look for
      // the opaque input ID in a different folder from the desktop importer.
      OPEN_TTS_AUDIO_SEPARATION_ROOT: path.join(paths.dataRoot, "audio-separations"),
      OPEN_TTS_DOUBAO_COOKIE_FILE: path.join(paths.dataRoot, "config", "doubao-cookies.json"),
      OPEN_TTS_DOUBAO_DATA_DIR: path.join(paths.dataRoot, "doubao"),
      OPEN_TTS_FFMPEG_PATH: resolveFfmpegPath(paths),
      OPEN_TTS_INDEXTTS2_ROOT: path.join(paths.modelStoreRoot, "IndexTTS2"),
      OPEN_TTS_VOXCPM2_ROOT: path.join(paths.modelStoreRoot, "VoxCPM2"),
      OPEN_TTS_GPTSOVITS_ROOT: path.join(paths.modelStoreRoot, "GPT-SoVITS")
    }
  };
}

function migrateLegacyManagedModelAssets(paths, options = {}) {
  const fsImpl = options.fs || fs;
  const sourceRoot = options.sourceRoot || path.join(paths.workspaceRoot, "models");
  const targetRoot = options.targetRoot || paths.modelStoreRoot;
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) {
    return [];
  }

  const migrated = [];
  for (const name of LEGACY_MANAGED_MODEL_ASSETS) {
    const source = path.join(sourceRoot, name);
    const target = path.join(targetRoot, name);
    if (!fsImpl.existsSync(source) || fsImpl.existsSync(target)) {
      continue;
    }
    fsImpl.mkdirSync(path.dirname(target), { recursive: true });
    fsImpl.cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
    migrated.push(name);
  }
  return migrated;
}

function normalizeApiPort(value, fallback = DEFAULT_API_PORT) {
  const port = Number(value);
  if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
    return port;
  }
  return fallback;
}

function normalizeApiHost(value) {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_API_HOST;
}

function readStoredDesktopSettings(settingsFile, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  const readFileSync = options.readFileSync || fs.readFileSync;
  if (!settingsFile || !existsSync(settingsFile)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(settingsFile, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function inferStorageRootFromLegacySettings(stored, pathImpl = path) {
  if (!stored || typeof stored !== "object") {
    return null;
  }
  const explicit = typeof stored.storage_root === "string" ? stored.storage_root.trim() : "";
  if (explicit) {
    return pathImpl.resolve(explicit);
  }

  const modelPaths = [
    stored.indextts2_root,
    stored.voxcpm2_root,
    stored.gptsovits_root,
    stored.sensevoice_model_dir,
    stored.qwen_asr_model_dir,
    stored.alignment_aligner_model_dir,
    stored.alignment_capswriter_root,
    stored.qwen_asr_capswriter_root,
    stored.deepfilternet3_root,
    stored.mossformer2_se_root,
    stored.audio_separation_root,
    stored.audio_enhancement_python,
    stored.audio_separation_python,
    stored.qwen_asr_python,
    stored.qwen_cuda_python,
    stored.alignment_python,
    stored.sensevoice_python
  ];
  for (const value of modelPaths) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    let cursor = pathImpl.resolve(value.trim());
    for (;;) {
      if (pathImpl.basename(cursor).toLowerCase() === "models") {
        return pathImpl.dirname(cursor);
      }
      const parent = pathImpl.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }

  const outputDirectory = typeof stored.output_dir === "string" ? stored.output_dir.trim() : "";
  if (outputDirectory) {
    const outputRoot = pathImpl.resolve(outputDirectory);
    if (pathImpl.basename(outputRoot).toLowerCase() === "outputs" && pathImpl.basename(pathImpl.dirname(outputRoot)).toLowerCase() === "data") {
      return pathImpl.dirname(pathImpl.dirname(outputRoot));
    }
  }
  return null;
}

function resolveManagedStorage(paths, options = {}) {
  const pathImpl = options.path || path;
  const settingsFile = options.settingsFile || paths.settingsFile || pathImpl.join(paths.dataRoot, "config", "user-settings.json");
  const stored = options.stored || readStoredDesktopSettings(settingsFile, options);
  const fallbackRoot = options.fallbackRoot || paths.storageRoot || pathImpl.dirname(paths.dataRoot);
  const storageRoot = inferStorageRootFromLegacySettings(stored, pathImpl) || pathImpl.resolve(fallbackRoot);
  return {
    storageRoot,
    dataRoot: pathImpl.join(storageRoot, "data"),
    modelStoreRoot: pathImpl.join(storageRoot, "models"),
    settingsFile
  };
}

function resolveDesktopSettings(paths, options = {}) {
  const settingsFile = options.settingsFile || paths.settingsFile || path.join(paths.dataRoot, "config", "user-settings.json");
  const stored = readStoredDesktopSettings(settingsFile, options);

  const apiHost = normalizeApiHost(options.apiHost ?? stored.api_host);
  const apiPort = normalizeApiPort(options.apiPort ?? stored.api_port);
  const backendToken = typeof options.backendToken === "string" && options.backendToken.trim() ? options.backendToken : null;

  return {
    apiBase: `http://${apiHost}:${apiPort}`,
    apiHost,
    apiPort,
    backendToken,
    settingsFile
  };
}

function resolveBilibiliInputsDirectory(paths) {
  return path.join(paths.dataRoot, "inputs", "bilibili");
}

function resolveFfmpegPath(paths, options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const requireFn = options.require || require;
  const explicitPath = typeof env.OPEN_TTS_FFMPEG_PATH === "string" ? env.OPEN_TTS_FFMPEG_PATH.trim() : "";

  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const packagedPath = path.join(paths.resourcesRoot, "ffmpeg", "ffmpeg.exe");
  if (existsSync(packagedPath)) {
    return packagedPath;
  }

  try {
    const staticPath = requireFn("ffmpeg-static");
    if (typeof staticPath === "string" && staticPath.trim()) {
      return staticPath;
    }
  } catch {
    // Fall back to PATH below.
  }

  return "ffmpeg";
}

async function isHttpOk(url, fetchImpl = fetch, timeoutMs = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function isBackendHealthy(url, expectedToken, fetchImpl = fetch, timeoutMs = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }
    if (!expectedToken) {
      return true;
    }
    const payload = await response.json().catch(() => null);
    return Boolean(payload && payload.instance_token === expectedToken);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackend(options) {
  const healthUrl = options.healthUrl;
  const isHealthy = options.isHealthy || ((url) => isHttpOk(url));
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(healthUrl)) {
      return true;
    }
    await sleep(intervalMs);
  }

  return false;
}

function spawnBackendProcess(paths, port = DEFAULT_API_PORT, spawnFn = childProcess.spawn) {
  const launchOptions = buildBackendLaunchOptions(paths, port);
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const stdout = fs.openSync(path.join(paths.logsDir, "desktop-api.out.log"), "a");
  const stderr = fs.openSync(path.join(paths.logsDir, "desktop-api.err.log"), "a");

  return spawnFn(launchOptions.filePath, launchOptions.args, {
    cwd: launchOptions.cwd,
    env: launchOptions.env,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr]
  });
}

async function ensureBackend(options) {
  const healthUrl = options.healthUrl;
  const isHealthy = options.isHealthy || ((url) => isHttpOk(url));

  if (await isHealthy(healthUrl)) {
    return { status: "reused", process: null };
  }

  const processHandle = options.spawnBackend();
  const ready = options.waitForReady
    ? await options.waitForReady()
    : await waitForBackend({ healthUrl, isHealthy });

  return { status: ready ? "started" : "starting", process: processHandle };
}

function createBackendSupervisor(options) {
  const isHealthy = options.isHealthy || (() => isHttpOk(options.healthUrl));
  const waitForReady = options.waitForReady || (() => waitForBackend({ healthUrl: options.healthUrl, isHealthy }));
  const spawnBackend = options.spawnBackend;
  const terminate = options.terminate || terminateProcessTree;
  const restartOnExit = options.restartOnExit ?? true;
  const restartDelayMs = options.restartDelayMs ?? 1200;
  const maxUnexpectedExitRetries = options.maxUnexpectedExitRetries ?? 2;
  let backendProcess = null;
  let recoveryPromise = null;
  let lastError = null;
  let stopped = false;
  let restartTimer = null;
  let unexpectedExitRetries = 0;

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function scheduleRecovery() {
    if (!restartOnExit || stopped || recoveryPromise || restartTimer || unexpectedExitRetries >= maxUnexpectedExitRetries) {
      return;
    }
    unexpectedExitRetries += 1;
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      const result = await ensureOnline();
      if (!result.ready) {
        scheduleRecovery();
      }
    }, restartDelayMs);
    restartTimer.unref?.();
  }

  function watchProcess(processHandle) {
    if (!processHandle || typeof processHandle.once !== "function") {
      return;
    }
    const clearProcess = () => {
      if (backendProcess === processHandle) {
        backendProcess = null;
        return true;
      }
      return false;
    };
    processHandle.once("exit", () => {
      if (clearProcess()) {
        scheduleRecovery();
      }
    });
    processHandle.once("error", (error) => {
      lastError = error instanceof Error ? error.message : "本地后端启动失败。";
      if (clearProcess()) {
        scheduleRecovery();
      }
    });
  }

  async function ensureOnline() {
    if (recoveryPromise) {
      return recoveryPromise;
    }

    recoveryPromise = (async () => {
      stopped = false;
      if (await isHealthy()) {
        lastError = null;
        unexpectedExitRetries = 0;
        return { ready: true, status: backendProcess ? "ready" : "reused", process: backendProcess };
      }

      if (backendProcess) {
        const processToTerminate = backendProcess;
        backendProcess = null;
        terminate(processToTerminate);
      }

      try {
        backendProcess = spawnBackend();
        watchProcess(backendProcess);
        const ready = await waitForReady();
        if (ready) {
          lastError = null;
          unexpectedExitRetries = 0;
          return { ready: true, status: "started", process: backendProcess };
        }
        lastError = "本地后端未在预期时间内恢复，请查看任务诊断。";
        return { ready: false, status: "unavailable", process: backendProcess, error: lastError };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "无法启动本地后端。";
        return { ready: false, status: "failed", process: backendProcess, error: lastError };
      }
    })();

    try {
      return await recoveryPromise;
    } finally {
      recoveryPromise = null;
    }
  }

  return {
    ensureOnline,
    getProcess: () => backendProcess,
    getLastError: () => lastError,
    stop: () => {
      stopped = true;
      clearRestartTimer();
      if (backendProcess) {
        const processToTerminate = backendProcess;
        backendProcess = null;
        terminate(processToTerminate);
      }
    }
  };
}

async function chooseFrontendTarget(paths, options = {}) {
  const devUrl = options.devUrl || process.env.OPEN_TTS_DESKTOP_DEV_URL || DEFAULT_DEV_URL;
  const preferDevServer = options.preferDevServer ?? true;
  const isDevServerAvailable = options.isDevServerAvailable || ((url) => isHttpOk(url));
  const fileExists = options.fileExists || fs.existsSync;

  if (preferDevServer && await isDevServerAvailable(devUrl)) {
    return { kind: "url", value: devUrl };
  }

  if (fileExists(paths.distIndex)) {
    return { kind: "file", value: paths.distIndex };
  }

  return { kind: "url", value: devUrl };
}

function loadFrontend(window, target) {
  if (target.kind === "file") {
    return window.loadFile(target.value);
  }
  return window.loadURL(target.value);
}

function terminateProcessTree(processHandle, options = {}) {
  if (!processHandle || !processHandle.pid) {
    return;
  }
  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  if (platform === "win32") {
    execFile("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], () => {});
    return;
  }
  processHandle.kill();
}

async function openLocalPath(targetPath, shellImpl) {
  const normalizedPath = typeof targetPath === "string" ? targetPath.trim() : "";
  if (!normalizedPath) {
    throw new Error("Path is required");
  }
  return shellImpl.openPath(normalizedPath);
}

function revealLocalItem(targetPath, shellImpl) {
  const normalizedPath = typeof targetPath === "string" ? targetPath.trim() : "";
  if (!normalizedPath) {
    throw new Error("Path is required");
  }
  shellImpl.showItemInFolder(normalizedPath);
}

function validateLegadoImportUrl(targetUrl) {
  if (typeof targetUrl !== "string" || !targetUrl.trim()) {
    throw new Error("Legado import URL is required");
  }
  if (targetUrl.length > 16 * 1024) {
    throw new Error("Legado import URL is too large");
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Legado import URL is invalid");
  }
  if (parsed.protocol !== "legado:" || parsed.hostname !== "import" || parsed.pathname !== "/httpTTS") {
    throw new Error("Only Legado HTTP TTS import links are allowed");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("Legado import URL contains unsupported credentials or fragments");
  }
  const source = parsed.searchParams.get("src");
  if (!source || parsed.searchParams.getAll("src").length !== 1 || [...parsed.searchParams.keys()].some((key) => key !== "src")) {
    throw new Error("Legado import URL must contain only one src parameter");
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(source);
  } catch {
    throw new Error("Legado import source URL is invalid");
  }
  if (!["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
    throw new Error("Legado import source must be an HTTP or HTTPS URL without credentials");
  }
  return parsed.toString();
}

async function openLegadoImportUrl(targetUrl, shellImpl) {
  const validated = validateLegadoImportUrl(targetUrl);
  await shellImpl.openExternal(validated);
  return validated;
}

async function selectReferenceAudio(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择参考音频",
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: ["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus", "webm"]
      }
    ]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function selectManagedMedia(dialogImpl, fsPromises, inputDirectory, title, idFactory = randomUUID) {
  const result = await dialogImpl.showOpenDialog({
    title,
    properties: ["openFile"],
    filters: [{ name: "Audio and video", extensions: TRANSCRIPTION_MEDIA_EXTENSIONS }]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return stageManagedMediaFile(fsPromises, result.filePaths[0], inputDirectory, idFactory);
}

async function stageManagedMediaFile(fsPromises, sourcePath, inputDirectory, idFactory = randomUUID) {
  const selectedPath = typeof sourcePath === "string" ? sourcePath.trim() : "";
  if (!selectedPath) {
    throw new Error("媒体文件路径无效");
  }
  const info = await fsPromises.stat(selectedPath);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_TRANSCRIPTION_MEDIA_BYTES) {
    throw new Error("媒体文件无效、为空或超过 8 GB");
  }
  const extension = path.extname(selectedPath).toLowerCase();
  if (!extension || extension.length > 16) {
    throw new Error("媒体文件扩展名无效");
  }
  const inputId = String(idFactory()).replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(inputId)) {
    throw new Error("无法创建安全的媒体导入标识");
  }
  await fsPromises.mkdir(inputDirectory, { recursive: true });
  const targetPath = path.join(inputDirectory, `${inputId}${extension}`);
  await fsPromises.copyFile(selectedPath, targetPath);
  return {
    id: inputId,
    fileName: path.basename(selectedPath),
    fileSizeBytes: info.size
  };
}

async function selectTranscriptionMedia(dialogImpl, fsPromises, inputDirectory, idFactory = randomUUID) {
  return selectManagedMedia(dialogImpl, fsPromises, inputDirectory, "选择要转写的音频或视频", idFactory);
}

async function selectAudioEnhancementMedia(dialogImpl, fsPromises, inputDirectory, idFactory = randomUUID) {
  return selectManagedMedia(dialogImpl, fsPromises, inputDirectory, "选择要降噪或增强的音频或视频", idFactory);
}

async function selectAudioSeparationMedia(dialogImpl, fsPromises, inputDirectory, idFactory = randomUUID) {
  return selectManagedMedia(dialogImpl, fsPromises, inputDirectory, "选择要分离人声与伴奏的音频或视频", idFactory);
}

async function saveTranscriptionExport(dialogImpl, fsPromises, content, defaultName, extension) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("没有可导出的转写内容");
  }
  const normalizedExtension = extension === "srt" ? "srt" : "txt";
  const safeName = path.basename(String(defaultName || `transcription.${normalizedExtension}`));
  const result = await dialogImpl.showSaveDialog({
    title: `导出 ${normalizedExtension.toUpperCase()}`,
    defaultPath: safeName.endsWith(`.${normalizedExtension}`) ? safeName : `${safeName}.${normalizedExtension}`,
    filters: [{ name: normalizedExtension.toUpperCase(), extensions: [normalizedExtension] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  await fsPromises.writeFile(result.filePath, content, "utf8");
  return result.filePath;
}

async function selectVoicePackage(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "导入音色包",
    properties: ["openFile"],
    filters: [{ name: "OpenTTS voice package", extensions: ["zip"] }]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function saveVoicePackage(dialogImpl, fsPromises, sourcePath, defaultName) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new Error("Voice package path is required");
  }
  const result = await dialogImpl.showSaveDialog({
    title: "导出音色包",
    defaultPath: defaultName || "OpenTTS-voice.zip",
    filters: [{ name: "OpenTTS voice package", extensions: ["zip"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  await fsPromises.copyFile(sourcePath, result.filePath);
  return result.filePath;
}

async function selectDirectory(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择目录",
    properties: ["openDirectory"]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function selectPythonExecutable(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择语音增强 Python 运行时",
    properties: ["openFile"],
    filters: [{ name: "Python executable", extensions: ["exe"] }]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function selectModelArchive(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择模型压缩包",
    properties: ["openFile"],
    filters: [
      {
        name: "Model archives",
        extensions: ["zip", "7z", "rar", "tar", "gz", "bz2", "xz"]
      }
    ]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

async function saveSettingsBackup(dialogImpl, fsPromises, content, defaultPath) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Backup content is required");
  }
  if (content.length > 1024 * 1024) {
    throw new Error("Backup content is too large");
  }
  const result = await dialogImpl.showSaveDialog({
    title: "导出设置备份",
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  await fsPromises.writeFile(result.filePath, content, "utf8");
  return result.filePath;
}

async function selectSettingsBackup(dialogImpl, fsPromises) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择设置备份",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  const selectedPath = result.filePaths[0];
  const content = await fsPromises.readFile(selectedPath, "utf8");
  if (content.length > 1024 * 1024) {
    throw new Error("Backup file is too large");
  }
  return { path: selectedPath, content };
}

module.exports = {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_DEV_URL,
  buildBackendLaunchOptions,
  chooseFrontendTarget,
  createDesktopPaths,
  createBackendSupervisor,
  ensureBackend,
  isBackendHealthy,
  isHttpOk,
  loadFrontend,
  migrateLegacyManagedModelAssets,
  openLegadoImportUrl,
  openLocalPath,
  revealLocalItem,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveManagedStorage,
  resolveFfmpegPath,
  saveSettingsBackup,
  saveTranscriptionExport,
  selectDirectory,
  selectPythonExecutable,
  selectModelArchive,
  selectSettingsBackup,
  selectAudioEnhancementMedia,
  selectAudioSeparationMedia,
  selectTranscriptionMedia,
  selectReferenceAudio,
  selectVoicePackage,
  saveVoicePackage,
  stageManagedMediaFile,
  spawnBackendProcess,
  terminateProcessTree,
  validateLegadoImportUrl,
  waitForBackend
};
