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

function createFetchResponse(body) {
  return {
    ok: true,
    status: 200,
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
              video: [],
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
      disabledReason: null
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
    downloadBinary: async ({ url, destinationPath }) => {
      downloaded.push({ url, destinationPath });
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
      destinationPath: path.join(createTestApp().getPath("userData"), "bilibili-sampler", "tasks", "1713657600000", "source.audio.m4s")
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
