const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildBackendLaunchOptions,
  chooseFrontendTarget,
  createBackendSupervisor,
  createDesktopPaths,
  ensureBackend,
  isBackendHealthy,
  migrateLegacyManagedModelAssets,
  migrateManagedStorage,
  remapManagedJsonFiles,
  openLegadoImportUrl,
  openLocalPath,
  revealLocalItem,
  resolveBilibiliInputsDirectory,
  resolveDesktopSettings,
  resolveManagedStorage,
  resolvePreferredStorageRoot,
  resolveFfmpegPath,
  saveSettingsBackup,
  saveTranscriptionExport,
  saveVoicePackage,
  synchronizeManagedStorageSettings,
  selectDirectory,
  selectPythonExecutable,
  selectModelArchive,
  selectSettingsBackup,
  selectTranscriptionMedia,
  selectReferenceAudio,
  selectVoicePackage,
  terminateProcessTree,
  validateLegadoImportUrl
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
  assert.equal(launchOptions.env.OPEN_TTS_FFMPEG_PATH, resolveFfmpegPath(paths));
});

test("createDesktopPaths keeps packaged user data and model weights outside application resources", () => {
  const workspaceRoot = path.resolve("D:/OpenTTS/resources/workspace");
  const storageRoot = path.resolve("D:/OpenTTS Library");
  const paths = createDesktopPaths(__dirname, workspaceRoot, {
    dataRoot: path.join(storageRoot, "data"),
    modelStoreRoot: path.join(storageRoot, "models"),
    storageRoot,
    resourcesRoot: "D:/OpenTTS/resources"
  });

  const launchOptions = buildBackendLaunchOptions(paths, 8765);

  assert.equal(paths.logsDir, path.join(paths.dataRoot, "logs"));
  assert.equal(paths.storageRoot, storageRoot);
  assert.equal(launchOptions.env.OPEN_TTS_STORAGE_ROOT, storageRoot);
  assert.equal(launchOptions.env.OPEN_TTS_OUTPUT_DIR, path.join(paths.dataRoot, "outputs"));
  assert.equal(launchOptions.env.OPEN_TTS_MODEL_STORE_ROOT, paths.modelStoreRoot);
  assert.equal(launchOptions.env.OPEN_TTS_QWEN_ASR_WORK_DIR, path.join(paths.dataRoot, "asr", "qwen3-work"));
  assert.equal(launchOptions.env.OPEN_TTS_TRANSCRIPTION_INPUT_DIR, path.join(paths.dataRoot, "transcriptions", "inputs"));
  assert.equal(launchOptions.env.OPEN_TTS_AUDIO_ENHANCEMENT_JOBS_FILE, path.join(paths.dataRoot, "config", "audio-enhancements.json"));
  assert.equal(launchOptions.env.OPEN_TTS_AUDIO_ENHANCEMENT_INPUT_DIR, path.join(paths.dataRoot, "audio-enhancements", "inputs"));
  assert.equal(launchOptions.env.OPEN_TTS_AUDIO_ENHANCEMENT_WORK_DIR, path.join(paths.dataRoot, "audio-enhancements", "work"));
  assert.equal(launchOptions.env.OPEN_TTS_AUDIO_SEPARATION_ROOT, path.join(paths.dataRoot, "audio-separations"));
  assert.equal(launchOptions.env.OPEN_TTS_INDEXTTS2_ROOT, path.join(paths.modelStoreRoot, "IndexTTS2"));
  assert.equal(launchOptions.env.OPEN_TTS_VOICE_LIBRARY_FILE, path.join(paths.dataRoot, "config", "voices.json"));
  assert.equal(launchOptions.env.OPEN_TTS_DOUBAO_COOKIE_FILE, path.join(paths.dataRoot, "config", "doubao-cookies.json"));
  assert.equal(launchOptions.env.OPEN_TTS_DOUBAO_DATA_DIR, path.join(paths.dataRoot, "doubao"));
});

test("resolveManagedStorage reuses the legacy model library without copying weights", () => {
  const appDataRoot = path.resolve("C:/Users/test/AppData/Roaming/open-tts-desktop");
  const paths = createDesktopPaths(__dirname, path.resolve("D:/OpenTTS/resources/workspace"), {
    dataRoot: path.join(appDataRoot, "data"),
    modelStoreRoot: path.join(appDataRoot, "models"),
    storageRoot: appDataRoot
  });

  const managed = resolveManagedStorage(paths, {
    stored: {
      voxcpm2_root: "D:/code/tts/models/VoxCPM2",
      output_dir: "D:/code/tts/data/outputs"
    }
  });

  assert.equal(managed.storageRoot, path.resolve("D:/code/tts"));
  assert.equal(managed.modelStoreRoot, path.join(path.resolve("D:/code/tts"), "models"));
  assert.equal(managed.dataRoot, path.join(path.resolve("D:/code/tts"), "data"));
  assert.equal(managed.settingsFile, path.join(appDataRoot, "data", "config", "user-settings.json"));
});

test("managed storage defaults to D drive and safely migrates legacy models, data and recorded paths", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "open-tts-storage-migration-"));
  const sourceRoot = path.join(temporaryRoot, "legacy");
  const targetRoot = path.join(temporaryRoot, "open-tts");
  try {
    fs.mkdirSync(path.join(sourceRoot, "models", "VoxCPM2"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "models", "VoxCPM2", "weights.bin"), "model");
    fs.writeFileSync(path.join(sourceRoot, "models", "README.md"), "source build asset");
    fs.mkdirSync(path.join(sourceRoot, "data", "config"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "data", "outputs"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "data", "outputs", "result.wav"), "audio");
    fs.writeFileSync(path.join(sourceRoot, "data", "config", "user-settings.json"), JSON.stringify({
      storage_root: sourceRoot,
      output_dir: path.join(sourceRoot, "data", "outputs"),
      voxcpm2_root: path.join(sourceRoot, "models", "VoxCPM2"),
      asr_backend: "sensevoice"
    }));
    fs.mkdirSync(path.join(targetRoot, "data", "outputs"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "data", "outputs", "existing.wav"), "existing");

    const moved = migrateManagedStorage([sourceRoot], targetRoot, { excludedModelNames: ["README.md"] });
    assert.ok(moved.length >= 2);
    assert.equal(fs.existsSync(path.join(targetRoot, "models", "VoxCPM2", "weights.bin")), true);
    assert.equal(fs.existsSync(path.join(sourceRoot, "models", "README.md")), true);
    assert.equal(fs.existsSync(path.join(targetRoot, "models", "README.md")), false);
    assert.equal(fs.existsSync(path.join(targetRoot, "data", "outputs", "result.wav")), true);
    assert.equal(fs.existsSync(path.join(sourceRoot, "models", "VoxCPM2")), false);
    assert.equal(fs.existsSync(path.join(sourceRoot, "data")), false);

    const remapped = remapManagedJsonFiles(path.join(targetRoot, "data"), [{ source: sourceRoot, target: targetRoot }]);
    assert.equal(remapped.length, 1);
    assert.equal(synchronizeManagedStorageSettings(path.join(targetRoot, "data", "config", "user-settings.json"), targetRoot), true);
    const settings = JSON.parse(fs.readFileSync(path.join(targetRoot, "data", "config", "user-settings.json"), "utf8"));
    assert.equal(settings.storage_root, path.resolve(targetRoot));
    assert.equal(settings.output_dir, path.join(targetRoot, "data", "outputs"));
    assert.equal(settings.voxcpm2_root, path.join(targetRoot, "models", "VoxCPM2"));
    assert.equal(settings.asr_backend, "sensevoice");
    assert.equal(resolvePreferredStorageRoot({ platform: "win32" }), path.resolve("D:/open-tts"));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("migrateLegacyManagedModelAssets only copies managed ASR assets missing from the user model store", () => {
  const copied = [];
  const existing = new Set([
    path.join("legacy", "models", "Qwen3-runtime-cuda"),
    path.join("target", "SenseVoiceSmall")
  ]);
  const fakeFs = {
    existsSync: (target) => existing.has(target),
    mkdirSync: () => {},
    cpSync: (source, target) => {
      copied.push([source, target]);
      existing.add(target);
    }
  };
  const paths = { workspaceRoot: "legacy", modelStoreRoot: "target" };

  const migrated = migrateLegacyManagedModelAssets(paths, { fs: fakeFs });

  assert.deepEqual(migrated, ["Qwen3-runtime-cuda"]);
  assert.deepEqual(copied, [[path.join("legacy", "models", "Qwen3-runtime-cuda"), path.join("target", "Qwen3-runtime-cuda")]]);
});

test("createDesktopPaths can load the packaged renderer from app.asar", () => {
  const workspaceRoot = path.resolve("D:/OpenTTS/resources/workspace");
  const appRoot = path.resolve("D:/OpenTTS/resources/app.asar");
  const paths = createDesktopPaths(__dirname, workspaceRoot, {
    desktopDir: appRoot,
    distIndex: path.join(appRoot, "dist", "index.html")
  });

  assert.equal(paths.desktopDir, appRoot);
  assert.equal(paths.distIndex, path.join(appRoot, "dist", "index.html"));
  assert.notEqual(paths.distIndex, path.join(workspaceRoot, "apps", "desktop", "dist", "index.html"));
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

test("isBackendHealthy requires the current desktop instance token when configured", async () => {
  const healthy = await isBackendHealthy(
    "http://127.0.0.1:8765/v1/health",
    "current-token",
    async () => ({ ok: true, json: async () => ({ instance_token: "current-token" }) })
  );
  const stale = await isBackendHealthy(
    "http://127.0.0.1:8765/v1/health",
    "current-token",
    async () => ({ ok: true, json: async () => ({ instance_token: "stale-token" }) })
  );

  assert.equal(healthy, true);
  assert.equal(stale, false);
});

test("backend supervisor serializes recovery and clears an exited child process", async () => {
  let healthy = false;
  let spawnCount = 0;
  const handlers = {};
  const child = {
    pid: 3200,
    once: (event, callback) => {
      handlers[event] = callback;
    }
  };
  const supervisor = createBackendSupervisor({
    healthUrl: "http://127.0.0.1:8765/v1/health",
    isHealthy: async () => healthy,
    spawnBackend: () => {
      spawnCount += 1;
      healthy = true;
      return child;
    },
    waitForReady: async () => healthy,
    terminate: () => assert.fail("a fresh recovery should not terminate a child"),
    restartOnExit: false
  });

  const [first, second] = await Promise.all([supervisor.ensureOnline(), supervisor.ensureOnline()]);

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(spawnCount, 1);
  assert.equal(supervisor.getProcess(), child);
  handlers.exit();
  assert.equal(supervisor.getProcess(), null);
});

test("backend supervisor restarts an unexpectedly exited child", async () => {
  let healthy = false;
  let spawnCount = 0;
  const children = [];
  const supervisor = createBackendSupervisor({
    healthUrl: "http://127.0.0.1:8765/v1/health",
    isHealthy: async () => healthy,
    spawnBackend: () => {
      spawnCount += 1;
      healthy = true;
      const handlers = {};
      const child = {
        pid: 3300 + spawnCount,
        once: (event, callback) => {
          handlers[event] = callback;
        },
        handlers
      };
      children.push(child);
      return child;
    },
    waitForReady: async () => healthy,
    restartDelayMs: 1
  });

  await supervisor.ensureOnline();
  healthy = false;
  children[0].handlers.exit();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(spawnCount, 2);
  assert.equal(supervisor.getProcess(), children[1]);
  supervisor.stop();
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
  const packagedPath = path.join(paths.resourcesRoot, "ffmpeg", "ffmpeg.exe");

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

test("revealLocalItem delegates to the desktop shell for a local file", () => {
  const revealed = [];
  revealLocalItem("D:/OpenTTS/data/outputs/preview.wav", {
    showItemInFolder: (targetPath) => revealed.push(targetPath)
  });

  assert.deepEqual(revealed, ["D:/OpenTTS/data/outputs/preview.wav"]);
});

test("revealLocalItem rejects empty paths", () => {
  assert.throws(() => revealLocalItem("", { showItemInFolder: () => undefined }), /Path is required/);
});

test("openLegadoImportUrl opens only a validated HTTP TTS deep link", async () => {
  const opened = [];
  const source = "http://192.168.1.20:8765/api/legado/tts-config?voiceId=voice-1&delay=5";
  const target = `legado://import/httpTTS?src=${encodeURIComponent(source)}`;

  const result = await openLegadoImportUrl(target, {
    openExternal: async (value) => opened.push(value)
  });

  assert.deepEqual(opened, [target]);
  assert.equal(result, target);
});

test("validateLegadoImportUrl rejects unrelated protocols and unsafe sources", () => {
  assert.throws(() => validateLegadoImportUrl("https://example.test"), /Only Legado HTTP TTS/);
  assert.throws(
    () => validateLegadoImportUrl("legado://import/httpTTS?src=file%3A%2F%2FC%3A%2Fsecret"),
    /must be an HTTP or HTTPS URL/
  );
  assert.throws(
    () => validateLegadoImportUrl("legado://import/httpTTS?src=https%3A%2F%2Fuser%3Apass%40example.test"),
    /without credentials/
  );
  assert.throws(
    () => validateLegadoImportUrl("legado://import/httpTTS?src=https%3A%2F%2Fexample.test&src=http%3A%2F%2F127.0.0.1%3A8765"),
    /only one src parameter/
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

test("selectPythonExecutable only allows choosing a Python executable", async () => {
  const optionsSeen = [];
  const selectedPath = await selectPythonExecutable({
    showOpenDialog: async (options) => {
      optionsSeen.push(options);
      return { canceled: false, filePaths: ["D:/runtimes/audio-enhancement/python.exe"] };
    }
  });

  assert.equal(selectedPath, "D:/runtimes/audio-enhancement/python.exe");
  assert.equal(optionsSeen[0].title, "选择语音增强 Python 运行时");
  assert.deepEqual(optionsSeen[0].properties, ["openFile"]);
  assert.deepEqual(optionsSeen[0].filters, [{ name: "Python executable", extensions: ["exe"] }]);
});

test("selectTranscriptionMedia stages a video under an opaque managed ID", async () => {
  const calls = [];
  const copied = [];
  const selected = await selectTranscriptionMedia(
    {
      showOpenDialog: async (options) => {
        calls.push(options);
        return { canceled: false, filePaths: ["D:/videos/final cut.mp4"] };
      }
    },
    {
      stat: async () => ({ isFile: () => true, size: 123456 }),
      mkdir: async () => {},
      copyFile: async (source, destination) => copied.push({ source, destination })
    },
    "D:/OpenTTS/data/transcriptions/inputs",
    () => "11111111-1111-1111-1111-111111111111"
  );

  assert.deepEqual(selected, { id: "11111111111111111111111111111111", fileName: "final cut.mp4", fileSizeBytes: 123456 });
  assert.equal(calls[0].title, "选择要转写的音频或视频");
  assert.ok(calls[0].filters[0].extensions.includes("mp4"));
  assert.deepEqual(copied, [{ source: "D:/videos/final cut.mp4", destination: path.join("D:/OpenTTS/data/transcriptions/inputs", "11111111111111111111111111111111.mp4") }]);
  assert.doesNotMatch(JSON.stringify(selected), /D:\\videos/i);
});

test("saveTranscriptionExport writes UTF-8 TXT and respects cancellation", async () => {
  const writes = [];
  const saved = await saveTranscriptionExport(
    { showSaveDialog: async () => ({ canceled: false, filePath: "D:/exports/result.srt" }) },
    { writeFile: async (...args) => writes.push(args) },
    "第一句字幕",
    "final.mp4.srt",
    "srt"
  );
  assert.equal(saved, "D:/exports/result.srt");
  assert.deepEqual(writes, [["D:/exports/result.srt", "第一句字幕", "utf8"]]);
  const cancelled = await saveTranscriptionExport(
    { showSaveDialog: async () => ({ canceled: true }) },
    { writeFile: async () => assert.fail("must not write") },
    "文本",
    "result.txt",
    "txt"
  );
  assert.equal(cancelled, null);
});

test("selectVoicePackage returns the ZIP selected through the native dialog", async () => {
  const selectedPath = await selectVoicePackage({
    showOpenDialog: async (options) => {
      assert.equal(options.title, "导入音色包");
      assert.ok(options.filters[0].extensions.includes("zip"));
      return { canceled: false, filePaths: ["D:/backups/narrator.zip"] };
    }
  });

  assert.equal(selectedPath, "D:/backups/narrator.zip");
});

test("saveVoicePackage copies the generated package to the native save path", async () => {
  const calls = [];
  const savedPath = await saveVoicePackage(
    {
      showSaveDialog: async (options) => {
        calls.push(options);
        return { canceled: false, filePath: "D:/backups/narrator.zip" };
      }
    },
    { copyFile: async (...args) => calls.push(args) },
    "D:/code/tts/data/exports/narrator.zip",
    "OpenTTS-voice-narrator.zip"
  );

  assert.equal(savedPath, "D:/backups/narrator.zip");
  assert.equal(calls[0].title, "导出音色包");
  assert.deepEqual(calls[1], ["D:/code/tts/data/exports/narrator.zip", "D:/backups/narrator.zip"]);
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

test("selectModelArchive returns an archive chosen through the native file dialog", async () => {
  const selectedPath = await selectModelArchive({
    showOpenDialog: async (options) => {
      assert.equal(options.title, "选择模型压缩包");
      assert.deepEqual(options.properties, ["openFile"]);
      assert.ok(options.filters[0].extensions.includes("7z"));
      return { canceled: false, filePaths: ["D:/downloads/VoxCPM2-full.zip"] };
    }
  });

  assert.equal(selectedPath, "D:/downloads/VoxCPM2-full.zip");
});

test("selectModelArchive returns null when selection is cancelled", async () => {
  const selectedPath = await selectModelArchive({
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
