const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildBackendLaunchOptions,
  chooseFrontendTarget,
  createDesktopPaths,
  ensureBackend,
  openLocalPath,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveFfmpegPath,
  saveSettingsBackup,
  selectDirectory,
  selectSettingsBackup,
  selectReferenceAudio,
  terminateProcessTree
} = require("./desktop-runtime.cjs");

test("buildBackendLaunchOptions points at the bundled API environment", () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);

  const launchOptions = buildBackendLaunchOptions(paths, 8765);

  assert.equal(
    launchOptions.filePath,
    path.join(workspaceRoot, "apps", "api", ".venv", "Scripts", "python.exe")
  );
  assert.deepEqual(launchOptions.args, [
    "-m",
    "uvicorn",
    "tts_api.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8765"
  ]);
  assert.equal(launchOptions.cwd, path.join(workspaceRoot, "apps", "api"));
  assert.equal(launchOptions.env.PYTHONIOENCODING, "utf-8");
});

test("ensureBackend reuses an already healthy local API", async () => {
  let spawnCount = 0;
  const result = await ensureBackend({
    healthUrl: "http://127.0.0.1:8765/v1/health",
    isHealthy: async () => true,
    spawnBackend: () => {
      spawnCount += 1;
    }
  });

  assert.equal(result.status, "reused");
  assert.equal(spawnCount, 0);
});

test("resolveDesktopSettings reads a configured API port for the next launch", () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);
  const settingsPath = path.join(workspaceRoot, "data", "config", "user-settings.json");

  const settings = resolveDesktopSettings(paths, {
    existsSync: (filePath) => filePath === settingsPath,
    readFileSync: () => JSON.stringify({ api_port: 8877 })
  });

  assert.equal(settings.apiPort, 8877);
  assert.equal(settings.apiBase, "http://127.0.0.1:8877");
  assert.equal(settings.settingsFile, settingsPath);
});

test("resolveBilibiliInputsDirectory points at the local Bilibili input cache", () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);

  assert.equal(
    resolveBilibiliInputsDirectory(paths),
    path.join(workspaceRoot, "data", "inputs", "bilibili")
  );
});

test("resolveFfmpegPath prefers an explicit environment path", () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);

  const ffmpegPath = resolveFfmpegPath(paths, {
    env: { OPEN_TTS_FFMPEG_PATH: "D:/tools/ffmpeg.exe" },
    existsSync: () => true
  });

  assert.equal(ffmpegPath, "D:/tools/ffmpeg.exe");
});

test("resolveFfmpegPath falls back to the packaged ffmpeg resource", () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);
  const packagedPath = path.join(paths.desktopDir, "resources", "ffmpeg", "ffmpeg.exe");

  const ffmpegPath = resolveFfmpegPath(paths, {
    env: {},
    existsSync: (filePath) => filePath === packagedPath
  });

  assert.equal(ffmpegPath, packagedPath);
});

test("openLocalPath delegates to the desktop shell for non-empty paths", async () => {
  const opened = [];
  const result = await openLocalPath("D:/models/VoxCPM2", {
    openPath: async (targetPath) => {
      opened.push(targetPath);
      return "";
    }
  });

  assert.deepEqual(opened, ["D:/models/VoxCPM2"]);
  assert.equal(result, "");
});

test("openLocalPath rejects empty paths", async () => {
  await assert.rejects(
    () => openLocalPath(" ", { openPath: async () => "" }),
    /Path is required/
  );
});

test("selectReferenceAudio returns the chosen audio path", async () => {
  const optionsSeen = [];
  const selectedPath = await selectReferenceAudio({
    showOpenDialog: async (options) => {
      optionsSeen.push(options);
      return { canceled: false, filePaths: ["D:/voices/demo.wav"] };
    }
  });

  assert.equal(selectedPath, "D:/voices/demo.wav");
  assert.deepEqual(optionsSeen[0].properties, ["openFile"]);
  assert.equal(optionsSeen[0].filters[0].name, "Audio");
  assert.ok(optionsSeen[0].filters[0].extensions.includes("wav"));
});

test("selectReferenceAudio returns null when selection is cancelled", async () => {
  const selectedPath = await selectReferenceAudio({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  });

  assert.equal(selectedPath, null);
});

test("selectDirectory returns the chosen directory path", async () => {
  const selectedPath = await selectDirectory({
    showOpenDialog: async (options) => {
      assert.deepEqual(options.properties, ["openDirectory"]);
      return { canceled: false, filePaths: ["D:/AI/IndexTTS2"] };
    }
  });

  assert.equal(selectedPath, "D:/AI/IndexTTS2");
});

test("selectDirectory returns null when selection is cancelled", async () => {
  const selectedPath = await selectDirectory({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] })
  });

  assert.equal(selectedPath, null);
});

test("saveSettingsBackup writes a JSON export to the selected native path", async () => {
  const calls = [];
  const savedPath = await saveSettingsBackup(
    {
      showSaveDialog: async (options) => {
        calls.push(options);
        return { canceled: false, filePath: "D:/backups/opentts-settings.json" };
      }
    },
    {
      writeFile: async (...args) => calls.push(args)
    },
    '{"version":1}',
    "OpenTTS-Studio-settings-2026-07-12.json"
  );

  assert.equal(savedPath, "D:/backups/opentts-settings.json");
  assert.equal(calls[0].title, "导出设置备份");
  assert.equal(calls[0].filters[0].name, "JSON");
  assert.deepEqual(calls[1], ["D:/backups/opentts-settings.json", '{"version":1}', "utf8"]);
});

test("saveSettingsBackup returns null when the native save dialog is cancelled", async () => {
  const savedPath = await saveSettingsBackup(
    { showSaveDialog: async () => ({ canceled: true }) },
    { writeFile: async () => assert.fail("writeFile should not be called") },
    '{"version":1}',
    "OpenTTS-Studio-settings.json"
  );

  assert.equal(savedPath, null);
});

test("selectSettingsBackup reads the JSON selected through the native dialog", async () => {
  const selected = await selectSettingsBackup(
    {
      showOpenDialog: async (options) => {
        assert.equal(options.title, "选择设置备份");
        assert.deepEqual(options.properties, ["openFile"]);
        return { canceled: false, filePaths: ["D:/backups/opentts-settings.json"] };
      }
    },
    { readFile: async () => '{"schema":"open-tts-studio-settings"}' }
  );

  assert.deepEqual(selected, {
    path: "D:/backups/opentts-settings.json",
    content: '{"schema":"open-tts-studio-settings"}'
  });
});

test("chooseFrontendTarget loads packaged dist when no dev server is available", async () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);

  const target = await chooseFrontendTarget(paths, {
    devUrl: "http://127.0.0.1:5173",
    isDevServerAvailable: async () => false,
    fileExists: () => true
  });

  assert.equal(target.kind, "file");
  assert.equal(target.value, path.join(workspaceRoot, "apps", "desktop", "dist", "index.html"));
});

test("chooseFrontendTarget prefers packaged dist when dev server use is disabled", async () => {
  const workspaceRoot = path.resolve("D:/code/tts");
  const paths = createDesktopPaths(__dirname, workspaceRoot);

  const target = await chooseFrontendTarget(paths, {
    devUrl: "http://127.0.0.1:5173",
    preferDevServer: false,
    isDevServerAvailable: async () => true,
    fileExists: () => true
  });

  assert.equal(target.kind, "file");
  assert.equal(target.value, path.join(workspaceRoot, "apps", "desktop", "dist", "index.html"));
});

test("terminateProcessTree uses taskkill on Windows", () => {
  const calls = [];
  const processHandle = { pid: 1234, kill: () => calls.push(["kill"]) };

  terminateProcessTree(processHandle, {
    platform: "win32",
    execFile: (file, args) => calls.push([file, args])
  });

  assert.deepEqual(calls, [["taskkill", ["/PID", "1234", "/T", "/F"]]]);
});
