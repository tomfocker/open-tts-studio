const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_API_PORT = 8765;
const DEFAULT_DEV_URL = "http://127.0.0.1:5173";
const DEFAULT_API_HOST = "127.0.0.1";

function createDesktopPaths(electronDir, workspaceRoot) {
  const resolvedWorkspaceRoot = workspaceRoot || path.resolve(electronDir, "..", "..", "..");
  const apiDir = path.join(resolvedWorkspaceRoot, "apps", "api");
  const desktopDir = path.join(resolvedWorkspaceRoot, "apps", "desktop");
  return {
    workspaceRoot: resolvedWorkspaceRoot,
    apiDir,
    apiPython: path.join(apiDir, ".venv", "Scripts", "python.exe"),
    desktopDir,
    distIndex: path.join(desktopDir, "dist", "index.html"),
    logsDir: path.join(resolvedWorkspaceRoot, "data", "logs")
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
      OPEN_TTS_SETTINGS_FILE: settings.settingsFile
    }
  };
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

function resolveDesktopSettings(paths, options = {}) {
  const settingsFile = options.settingsFile || path.join(paths.workspaceRoot, "data", "config", "user-settings.json");
  const existsSync = options.existsSync || fs.existsSync;
  const readFileSync = options.readFileSync || fs.readFileSync;
  let stored = {};

  if (existsSync(settingsFile)) {
    try {
      stored = JSON.parse(readFileSync(settingsFile, "utf-8"));
    } catch {
      stored = {};
    }
  }

  const apiHost = normalizeApiHost(options.apiHost ?? stored.api_host);
  const apiPort = normalizeApiPort(options.apiPort ?? stored.api_port);

  return {
    apiBase: `http://${apiHost}:${apiPort}`,
    apiHost,
    apiPort,
    settingsFile
  };
}

function resolveBilibiliInputsDirectory(paths) {
  return path.join(paths.workspaceRoot, "data", "inputs", "bilibili");
}

function resolveFfmpegPath(paths, options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const requireFn = options.require || require;
  const explicitPath = typeof env.OPEN_TTS_FFMPEG_PATH === "string" ? env.OPEN_TTS_FFMPEG_PATH.trim() : "";

  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const packagedPath = path.join(paths.desktopDir, "resources", "ffmpeg", "ffmpeg.exe");
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

async function selectReferenceAudio(dialogImpl) {
  const result = await dialogImpl.showOpenDialog({
    title: "选择参考音频",
    properties: ["openFile"],
    filters: [
      {
        name: "Audio",
        extensions: ["wav", "mp3", "flac", "m4a", "ogg"]
      }
    ]
  });
  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
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
  ensureBackend,
  isHttpOk,
  loadFrontend,
  openLocalPath,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveFfmpegPath,
  saveSettingsBackup,
  selectDirectory,
  selectSettingsBackup,
  selectReferenceAudio,
  spawnBackendProcess,
  terminateProcessTree,
  waitForBackend
};
