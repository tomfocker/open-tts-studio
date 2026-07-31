const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  BilibiliSamplerService,
  createDefaultBilibiliSamplerState,
  parseBilibiliLink
} = require("./bilibili-sampler-runtime.cjs");

function createFsMock(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const directories = new Set();

  return {
    existsSync(filePath) {
      return files.has(filePath) || directories.has(filePath);
    },
    mkdirSync(filePath) {
      directories.add(filePath);
    },
    readFileSync(filePath) {
      if (!files.has(filePath)) {
        throw new Error(`ENOENT: ${filePath}`);
      }
      return files.get(filePath);
    },
    unlinkSync(filePath) {
      files.delete(filePath);
    },
    renameSync(fromPath, toPath) {
      if (!files.has(fromPath)) {
        throw new Error(`ENOENT: ${fromPath}`);
      }
      files.set(toPath, files.get(fromPath));
      files.delete(fromPath);
    },
    statSync(filePath) {
      if (!files.has(filePath)) {
        throw new Error(`ENOENT: ${filePath}`);
      }
      return { size: Buffer.byteLength(files.get(filePath)) };
    },
    promises: {
      async writeFile(filePath, content) {
        files.set(filePath, content);
      },
      async mkdir(filePath) {
        directories.add(filePath);
      },
      async rm(targetPath, options = {}) {
        const recursive = Boolean(options.recursive);
        const normalizedPrefix = `${targetPath}${path.sep}`;
        files.delete(targetPath);
        directories.delete(targetPath);
        if (recursive) {
          for (const filePath of [...files.keys()]) {
            if (filePath.startsWith(normalizedPrefix)) {
              files.delete(filePath);
            }
          }
          for (const directoryPath of [...directories]) {
            if (directoryPath.startsWith(normalizedPrefix)) {
              directories.delete(directoryPath);
            }
          }
        }
      }
    },
    files,
    directories
  };
}

function createFetchResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      getSetCookie: () => options.setCookies ?? [],
      get: (name) => name.toLowerCase() === "set-cookie" ? (options.setCookies ?? []).join(", ") : null
    },
    async json() {
      return body;
    }
  };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFixtureFetch({ metadataPayload, playPayload }) {
  return async (url) => {
    const normalizedUrl = String(url);
    if (normalizedUrl.includes("/x/web-interface/view")) {
      return createFetchResponse(metadataPayload);
    }
    if (normalizedUrl.includes("/x/player/playurl")) {
      return createFetchResponse(playPayload);
    }
    throw new Error(`Unexpected fetch url: ${normalizedUrl}`);
  };
}

function createTestApp() {
  return {
    getPath(name) {
      if (name === "userData") {
        return path.join("C:", "Users", "Test", "AppData", "Roaming", "OpenTTS");
      }
      if (name === "downloads") {
        return path.join("C:", "Users", "Test", "Downloads");
      }
      throw new Error(`Unexpected app path: ${name}`);
    }
  };
}

test("createDefaultBilibiliSamplerState returns an idle logged-out state", () => {
  assert.deepEqual(createDefaultBilibiliSamplerState(), {
    loginSession: {
      isLoggedIn: false,
      nickname: null,
      avatarUrl: null,
      expiresAt: null
    },
    parsedLink: null,
    selection: {
      itemId: null
    },
    audioOptionSummary: null,
    taskStage: "idle",
    error: null
  });
});

test("parseBilibiliLink rejects unsupported hosts and accepts video links", () => {
  assert.equal(parseBilibiliLink("https://example.com/watch?v=1"), null);
  assert.deepEqual(toPlain(parseBilibiliLink("https://www.bilibili.com/video/BV1xK4y1m7aA?p=2")), {
    kind: "video",
    bvid: "BV1xK4y1m7aA",
    page: 2,
    title: null,
    coverUrl: null,
    items: [
      {
        id: "page:2",
        kind: "page",
        title: "P2",
        page: 2
      }
    ],
    selectedItemId: "page:2"
  });
});

test("QR login persists only the auth cookies returned by the confirmed poll response", async () => {
  const fsMock = createFsMock();
  let pollCount = 0;
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fs: fsMock,
    fetch: async (url) => {
      if (String(url).includes("qrcode/generate")) {
        return createFetchResponse({
          code: 0,
          data: { url: "https://passport.bilibili.com/h5-app/passport/sso?token=opaque", qrcode_key: "qr-key" }
        });
      }
      if (String(url).includes("qrcode/poll")) {
        pollCount += 1;
        return createFetchResponse({
          code: 0,
          data: {
            code: 0,
            refresh_token: "refresh-token",
            user_info: { uname: "Local User", face: "https://i0.hdslb.com/avatar.jpg" }
          }
        }, {
          setCookies: [
            "SESSDATA=sess-token; Path=/; HttpOnly",
            "bili_jct=csrf-token; Path=/"
          ]
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }
  });

  const bootstrap = await service.bootstrapQrLogin();
  assert.equal(bootstrap.success, true);
  assert.equal(bootstrap.data.qrUrl, "https://passport.bilibili.com/h5-app/passport/sso?token=opaque");

  const result = await service.pollLogin();
  assert.equal(pollCount, 1);
  assert.equal(result.success, true);
  assert.equal(result.data.status, "confirmed");
  assert.deepEqual(toPlain(result.data.loginSession), {
    isLoggedIn: true,
    nickname: "Local User",
    avatarUrl: "https://i0.hdslb.com/avatar.jpg",
    expiresAt: null
  });

  const persisted = JSON.parse(fsMock.files.get(path.join(createTestApp().getPath("userData"), "bilibili-sampler-session.json")));
  assert.equal(persisted.auth.sessData, "sess-token");
  assert.equal(persisted.auth.biliJct, "csrf-token");
  assert.doesNotMatch(JSON.stringify(result), /sess-token|csrf-token|refresh-token/);
});

test("QR login returns a safe HTTP error when Bilibili rejects the bootstrap request", async () => {
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fetch: async () => createFetchResponse({ code: -412, message: "blocked" }, { ok: false, status: 412 })
  });

  const result = await service.bootstrapQrLogin();
  assert.deepEqual(result, { success: false, error: "Bilibili request failed (HTTP 412)" });
  assert.equal(service.getState().error, "Bilibili request failed (HTTP 412)");
});

test("parseLink loads Bilibili page metadata and selectable pages", async () => {
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fetch: createFixtureFetch({
      metadataPayload: {
        code: 0,
        data: {
          title: "Voice Study",
          pic: "https://i0.hdslb.com/cover.jpg",
          pages: [
            { page: 1, part: "Intro", cid: 101 },
            { page: 2, part: "Clean Speech", cid: 202 }
          ]
        }
      },
      playPayload: {}
    })
  });

  const result = await service.parseLink({
    url: "https://www.bilibili.com/video/BV1xK4y1m7aA?p=2"
  });

  assert.equal(result.success, true);
  assert.deepEqual(toPlain(result.data), {
    kind: "video",
    bvid: "BV1xK4y1m7aA",
    page: 2,
    title: "Voice Study",
    coverUrl: "https://i0.hdslb.com/cover.jpg",
    items: [
      { id: "page:1", kind: "page", title: "Intro", page: 1 },
      { id: "page:2", kind: "page", title: "Clean Speech", page: 2 }
    ],
    selectedItemId: "page:2"
  });
  assert.equal(service.getState().taskStage, "idle");
  assert.equal(service.getState().selection.itemId, "page:2");
});

test("loadAudioOptions stores selected play payload and reports audio availability", async () => {
  const fetchCalls = [];
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fetch: async (url) => {
      fetchCalls.push(String(url));
      return createFixtureFetch({
        metadataPayload: {
          code: 0,
          data: {
            title: "Voice Study",
            pages: [{ page: 1, part: "Intro", cid: 101 }]
          }
        },
        playPayload: {
          code: 0,
          data: {
            accept_quality: [80],
            accept_description: ["1080P"],
            dash: {
              video: [{ id: 80, baseUrl: "https://cdn.example.com/video.m4s" }],
              audio: [{ id: 30280, baseUrl: "https://cdn.example.com/audio.m4s" }]
            }
          }
        }
      })(url);
    }
  });

  await service.parseLink({ url: "https://www.bilibili.com/video/BV1xK4y1m7aA" });
  const result = await service.loadAudioOptions({ kind: "video", itemId: "page:1" });

  assert.equal(result.success, true);
  assert.deepEqual(toPlain(result.data), {
    itemId: "page:1",
    qnOptions: [{ qn: 80, label: "1080P", selected: true, available: true }],
    summary: {
      hasAudio: true,
      hasVideo: true,
      disabledReason: null,
      videoDisabledReason: null
    }
  });
  assert.equal(fetchCalls[1], "https://api.bilibili.com/x/player/playurl?bvid=BV1xK4y1m7aA&cid=101&fnval=4048&qn=120&fourk=1");
});

test("extractSample downloads audio and runs ffmpeg with clipping options", async () => {
  const fsMock = createFsMock();
  const downloaded = [];
  const ffmpegCalls = [];
  const outputDirectory = path.join("D:", "code", "tts", "data", "inputs", "bilibili");
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fs: fsMock,
    fetch: createFixtureFetch({
      metadataPayload: {
        code: 0,
        data: {
          title: "Voice Study",
          pages: [{ page: 1, part: "Intro", cid: 101 }]
        }
      },
      playPayload: {
        code: 0,
        data: {
          accept_quality: [80],
          accept_description: ["1080P"],
          dash: {
            audio: [{ id: 30280, baseUrl: "https://cdn.example.com/audio.m4s" }]
          }
        }
      }
    }),
    now: () => 1713657600000,
    defaultOutputDirectory: outputDirectory,
    getFfmpegPath: () => "C:\\ffmpeg\\bin\\ffmpeg.exe",
    downloadBinary: async ({ url, destinationPath, headers }) => {
      downloaded.push({ url, destinationPath, headers });
      await fsMock.promises.writeFile(destinationPath, Buffer.from(`payload:${url}`));
    },
    runFfmpeg: async (input) => {
      ffmpegCalls.push(input);
      await fsMock.promises.writeFile(input.outputPath, Buffer.from("RIFFwav"));
    },
    readWavMetadata: () => ({ sampleRate: 24000, durationSeconds: 8 })
  });

  await service.parseLink({ url: "https://www.bilibili.com/video/BV1xK4y1m7aA" });
  await service.loadAudioOptions({ kind: "video", itemId: "page:1" });

  const result = await service.extractSample({
    startSeconds: 5,
    endSeconds: 13,
    sampleName: "Clean Speech"
  });

  assert.equal(result.success, true);
  assert.equal(service.getState().taskStage, "completed");
  assert.deepEqual(downloaded, [
    {
      url: "https://cdn.example.com/audio.m4s",
      destinationPath: path.join(createTestApp().getPath("userData"), "bilibili-sampler", "tasks", "1713657600000", "source.audio.m4s"),
      headers: {
        accept: "*/*",
        "accept-language": "zh-CN,zh;q=0.9",
        referer: "https://www.bilibili.com/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    }
  ]);
  assert.deepEqual(ffmpegCalls, [
    {
      ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe",
      inputPath: path.join(createTestApp().getPath("userData"), "bilibili-sampler", "tasks", "1713657600000", "source.audio.m4s"),
      outputPath: path.join(outputDirectory, "Clean Speech.wav"),
      startSeconds: 5,
      endSeconds: 13,
      sampleRate: 24000,
      channels: 1
    }
  ]);
  assert.deepEqual(toPlain(result.data), {
    audioPath: path.join(outputDirectory, "Clean Speech.wav"),
    sourceAudioPath: path.join(outputDirectory, "Clean Speech.source.m4s"),
    durationSeconds: 8,
    sampleRate: 24000,
    title: "Voice Study",
    itemTitle: "Intro"
  });
});

test("extractSample rejects an end time before start time", async () => {
  const service = new BilibiliSamplerService({ app: createTestApp() });

  const result = await service.extractSample({
    startSeconds: 10,
    endSeconds: 9,
    sampleName: "Bad Range"
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "End time must be greater than start time");
});

test("downloadVideo downloads DASH tracks and remuxes a local MP4 without re-encoding", async () => {
  const fsMock = createFsMock();
  const downloaded = [];
  const mergeCalls = [];
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fs: fsMock,
    fetch: createFixtureFetch({
      metadataPayload: {
        code: 0,
        data: { title: "Video Study", pages: [{ page: 1, part: "Intro", cid: 101 }] }
      },
      playPayload: {
        code: 0,
        data: {
          dash: {
            video: [{ id: 80, baseUrl: "https://cdn.example.com/video.m4s" }],
            audio: [{ id: 30280, baseUrl: "https://cdn.example.com/audio.m4s" }]
          }
        }
      }
    }),
    now: () => 1713657600002,
    getFfmpegPath: () => "C:\\ffmpeg\\bin\\ffmpeg.exe",
    downloadBinary: async ({ url, destinationPath, headers }) => {
      downloaded.push({ url, destinationPath, headers });
      await fsMock.promises.writeFile(destinationPath, Buffer.from(`track:${url}`));
    },
    mergeFfmpeg: async (input) => {
      mergeCalls.push(input);
      await fsMock.promises.writeFile(input.outputPath, Buffer.from("mp4"));
    }
  });

  await service.parseLink({ url: "https://www.bilibili.com/video/BV1xK4y1m7aA" });
  await service.loadAudioOptions({ kind: "video", itemId: "page:1" });
  const result = await service.downloadVideo({ fileName: "Video Export" });

  const taskDirectory = path.join(createTestApp().getPath("userData"), "bilibili-sampler", "tasks", "1713657600002");
  const outputPath = path.join(createTestApp().getPath("downloads"), "Video Export.mp4");
  assert.equal(result.success, true);
  assert.equal(service.getState().taskStage, "completed");
  assert.deepEqual(downloaded.map(({ url, destinationPath }) => ({ url, destinationPath })), [
    { url: "https://cdn.example.com/video.m4s", destinationPath: path.join(taskDirectory, "source.video.m4s") },
    { url: "https://cdn.example.com/audio.m4s", destinationPath: path.join(taskDirectory, "source.audio.m4s") }
  ]);
  assert.equal(downloaded.every(({ headers }) => headers.referer === "https://www.bilibili.com/"), true);
  assert.deepEqual(mergeCalls, [{
    ffmpegPath: "C:\\ffmpeg\\bin\\ffmpeg.exe",
    videoPath: path.join(taskDirectory, "source.video.m4s"),
    audioPath: path.join(taskDirectory, "source.audio.m4s"),
    outputPath
  }]);
  assert.deepEqual(toPlain(result.data), { videoPath: outputPath, title: "Video Study", itemTitle: "Intro" });
});

test("extractSample surfaces a redacted FFmpeg diagnostic on conversion failure", async () => {
  const fsMock = createFsMock();
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fs: fsMock,
    fetch: createFixtureFetch({
      metadataPayload: {
        code: 0,
        data: { title: "Voice Study", pages: [{ page: 1, part: "Intro", cid: 101 }] }
      },
      playPayload: {
        code: 0,
        data: { dash: { audio: [{ id: 30280, baseUrl: "https://cdn.example.com/audio.m4s" }] } }
      }
    }),
    downloadBinary: async ({ destinationPath }) => {
      await fsMock.promises.writeFile(destinationPath, Buffer.from("not-audio"));
    },
    runFfmpeg: async () => {
      throw new Error("FFmpeg exited with code 1: Error opening <local-file>");
    }
  });

  await service.parseLink({ url: "https://www.bilibili.com/video/BV1xK4y1m7aA" });
  await service.loadAudioOptions({ kind: "video", itemId: "page:1" });
  const result = await service.extractSample({ sampleName: "Failure Case" });

  assert.equal(result.success, false);
  assert.equal(result.error, "FFmpeg exited with code 1: Error opening <local-file>");
  assert.equal(service.getState().error, result.error);
});

test("cancelExtract aborts an active audio download", async () => {
  const fsMock = createFsMock();
  const service = new BilibiliSamplerService({
    app: createTestApp(),
    fs: fsMock,
    fetch: createFixtureFetch({
      metadataPayload: {
        code: 0,
        data: {
          title: "Voice Study",
          pages: [{ page: 1, part: "Intro", cid: 101 }]
        }
      },
      playPayload: {
        code: 0,
        data: {
          dash: {
            audio: [{ id: 30280, baseUrl: "https://cdn.example.com/audio.m4s" }]
          }
        }
      }
    }),
    now: () => 1713657600001,
    defaultOutputDirectory: path.join("D:", "code", "tts", "data", "inputs", "bilibili"),
    downloadBinary: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    })
  });

  await service.parseLink({ url: "https://www.bilibili.com/video/BV1xK4y1m7aA" });
  await service.loadAudioOptions({ kind: "video", itemId: "page:1" });

  const extracting = service.extractSample({ sampleName: "Cancelable" });
  const cancelResult = service.cancelExtract();
  const result = await extracting;

  assert.equal(cancelResult.success, true);
  assert.equal(result.success, false);
  assert.equal(result.error, "Extraction cancelled");
  assert.equal(service.getState().taskStage, "cancelled");
});
