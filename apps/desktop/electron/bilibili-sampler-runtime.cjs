const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const QR_BOOTSTRAP_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const BILIBILI_VIDEO_VIEW_URL = "https://api.bilibili.com/x/web-interface/view";
const BILIBILI_VIDEO_PLAY_URL = "https://api.bilibili.com/x/player/playurl";
const BILIBILI_BANGUMI_SEASON_URL = "https://api.bilibili.com/pgc/view/web/season";
const BILIBILI_BANGUMI_PLAY_URL = "https://api.bilibili.com/pgc/player/web/playurl";
const DEFAULT_STREAM_QN = 120;
const DEFAULT_FNVAL = 4048;
const SESSION_FILE_NAME = "bilibili-sampler-session.json";
const TASK_ROOT_DIRECTORY_NAME = "bilibili-sampler";
const TASKS_DIRECTORY_NAME = "tasks";
const SOURCE_AUDIO_FILE_NAME = "source.audio";
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;

const BILIBILI_VIDEO_REGEX = /\/video\/(BV[0-9A-Za-z]+)/i;
const BILIBILI_BANGUMI_EP_REGEX = /\/bangumi\/play\/(ep\d+)/i;
const BILIBILI_BANGUMI_SS_REGEX = /\/bangumi\/play\/(ss\d+)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizePositiveInteger(value, fallback) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  const normalized = Math.trunc(numberValue);
  return normalized > 0 ? normalized : fallback;
}

function normalizePositiveNumber(value) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }
  return Math.trunc(numberValue);
}

function normalizeSeconds(value) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }
  return numberValue;
}

function parseBilibiliHost(rawInput) {
  const trimmed = String(rawInput ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function isRealBilibiliHost(hostname) {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function createPageItem(page, title) {
  const normalizedPage = normalizePositiveInteger(page, 1);
  return {
    id: `page:${normalizedPage}`,
    kind: "page",
    title: normalizeText(title) ?? `P${normalizedPage}`,
    page: normalizedPage
  };
}

function createEpisodeItem(epId, title) {
  const normalizedEpId = normalizeText(epId);
  if (!normalizedEpId) {
    throw new Error("Episode item requires epId");
  }
  return {
    id: `episode:${normalizedEpId}`,
    kind: "episode",
    title: normalizeText(title) ?? `EP ${normalizedEpId}`,
    epId: normalizedEpId
  };
}

function createSeasonItem(seasonId, title) {
  const normalizedSeasonId = normalizeText(seasonId);
  if (!normalizedSeasonId) {
    throw new Error("Season item requires seasonId");
  }
  return {
    id: `season:${normalizedSeasonId}`,
    kind: "season",
    title: normalizeText(title) ?? `SS ${normalizedSeasonId}`,
    seasonId: normalizedSeasonId
  };
}

function parseBilibiliLink(input) {
  const url = parseBilibiliHost(input);
  if (!url || !isRealBilibiliHost(url.hostname)) {
    return null;
  }

  const videoMatch = url.pathname.match(BILIBILI_VIDEO_REGEX);
  if (videoMatch?.[1]) {
    const page = normalizePositiveInteger(url.searchParams.get("p"), 1);
    return {
      kind: "video",
      bvid: videoMatch[1],
      page,
      title: null,
      coverUrl: null,
      items: [createPageItem(page)],
      selectedItemId: `page:${page}`
    };
  }

  const episodeMatch = url.pathname.match(BILIBILI_BANGUMI_EP_REGEX);
  if (episodeMatch?.[1]) {
    return {
      kind: "episode",
      epId: episodeMatch[1],
      title: null,
      coverUrl: null,
      items: [createEpisodeItem(episodeMatch[1])],
      selectedItemId: `episode:${episodeMatch[1]}`
    };
  }

  const seasonMatch = url.pathname.match(BILIBILI_BANGUMI_SS_REGEX);
  if (seasonMatch?.[1]) {
    return {
      kind: "season",
      seasonId: seasonMatch[1],
      title: null,
      coverUrl: null,
      items: [createSeasonItem(seasonMatch[1])],
      selectedItemId: `season:${seasonMatch[1]}`
    };
  }

  return null;
}

function createDefaultBilibiliSamplerState() {
  return {
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
  };
}

function resolvePollStatus(payload) {
  const status = String(payload?.status ?? "").trim().toLowerCase();
  const code = Number(payload?.code);
  if (status === "confirmed" || code === 0) {
    return "confirmed";
  }
  if (status === "pending" || code === 86101) {
    return "pending";
  }
  if (status === "scanned" || code === 86090) {
    return "scanned";
  }
  if (status === "expired" || code === 86038) {
    return "expired";
  }
  return "invalid";
}

function normalizeConfirmedSession(payload) {
  const loginSession = {
    isLoggedIn: true,
    nickname: normalizeText(payload?.user_info?.uname),
    avatarUrl: normalizeText(payload?.user_info?.face),
    expiresAt: normalizeText(payload?.expires_at)
  };

  const cookieEntries = Array.isArray(payload?.cookie_info?.cookies) ? payload.cookie_info.cookies : [];
  const cookieMap = new Map();
  for (const cookie of cookieEntries) {
    const name = normalizeText(cookie?.name);
    const value = normalizeText(cookie?.value);
    if (name && value) {
      cookieMap.set(name, value);
    }
  }

  const sessData = normalizeText(payload?.sessdata) ?? cookieMap.get("SESSDATA") ?? null;
  const biliJct = normalizeText(payload?.bili_jct) ?? cookieMap.get("bili_jct") ?? null;
  if (!sessData || !biliJct) {
    throw new Error("Bilibili confirmed login is missing auth cookies");
  }

  return {
    loginSession,
    auth: {
      sessData,
      biliJct,
      refreshToken: normalizeText(payload?.refresh_token)
    }
  };
}

function isValidLoginSession(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.isLoggedIn === "boolean" &&
      (typeof value.nickname === "string" || value.nickname === null) &&
      (typeof value.avatarUrl === "string" || value.avatarUrl === null) &&
      (typeof value.expiresAt === "string" || value.expiresAt === null)
  );
}

function isValidAuthSession(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.sessData === "string" &&
      value.sessData.trim() &&
      typeof value.biliJct === "string" &&
      value.biliJct.trim() &&
      (typeof value.refreshToken === "string" || value.refreshToken === null)
  );
}

function buildItemTitle(primary, secondary, fallback) {
  const parts = [normalizeText(primary), normalizeText(secondary)].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

function parseNumericId(rawValue, prefix) {
  const normalized = normalizeText(rawValue);
  if (!normalized) {
    return null;
  }
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) || null : normalized;
}

function getExtensionFromUrl(url) {
  try {
    const extension = path.extname(new URL(url).pathname);
    return extension || ".bin";
  } catch {
    return ".bin";
  }
}

function sanitizeFileName(value) {
  return (normalizeText(value) ?? "bilibili-sample")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "bilibili-sample";
}

function getResourceUrl(resource) {
  if (!resource) {
    return null;
  }
  const primary = normalizeText(resource.baseUrl ?? resource.base_url);
  if (primary) {
    return primary;
  }
  const backupList = Array.isArray(resource.backupUrl)
    ? resource.backupUrl
    : Array.isArray(resource.backup_url)
      ? resource.backup_url
      : [];
  for (const candidate of backupList) {
    const normalized = normalizeText(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function readWavMetadata(pathToWav, fsImpl = fs) {
  const buffer = fsImpl.readFileSync(pathToWav);
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    return {
      sampleRate: DEFAULT_SAMPLE_RATE,
      durationSeconds: 0
    };
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  let dataOffset = 36;
  let dataSize = 0;
  while (dataOffset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    dataOffset += 8 + chunkSize;
  }
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return {
    sampleRate,
    durationSeconds: bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0
  };
}

class BilibiliSamplerService {
  constructor(dependencies = {}) {
    this.app = dependencies.app ?? {
      getPath(name) {
        if (name === "userData") {
          return path.join(process.cwd(), "data", "userData");
        }
        if (name === "downloads") {
          return path.join(process.cwd(), "data", "downloads");
        }
        return process.cwd();
      }
    };
    this.fs = dependencies.fs ?? fs;
    this.fetchImpl = dependencies.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this.now = dependencies.now ?? (() => Date.now());
    this.defaultOutputDirectory = dependencies.defaultOutputDirectory ?? null;
    this.downloadBinaryImpl = dependencies.downloadBinary ?? ((input) => this.downloadBinary(input));
    this.runFfmpegImpl = dependencies.runFfmpeg ?? ((input) => this.runFfmpeg(input));
    this.getFfmpegPathImpl = dependencies.getFfmpegPath ?? (() => process.env.OPEN_TTS_FFMPEG_PATH || "ffmpeg");
    this.readWavMetadataImpl = dependencies.readWavMetadata ?? ((filePath) => readWavMetadata(filePath, this.fs));
    this.stateListeners = new Set();
    this.state = createDefaultBilibiliSamplerState();
    this.authSession = null;
    this.pendingAuthCode = null;
    this.itemPlaybackTargets = new Map();
    this.playPayloads = new Map();
    this.activeExtractTask = null;
  }

  getState() {
    return clone(this.state);
  }

  onStateChanged(listener) {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  loadSession() {
    try {
      const sessionPath = this.getSessionPath();
      if (!this.fs.existsSync(sessionPath)) {
        return { success: true, data: this.getState().loginSession };
      }
      const record = JSON.parse(this.fs.readFileSync(sessionPath, "utf-8"));
      if (!isValidLoginSession(record.loginSession) || !isValidAuthSession(record.auth)) {
        this.clearPersistedSession();
        this.authSession = null;
        this.updateState({
          loginSession: createDefaultBilibiliSamplerState().loginSession,
          error: "Stored Bilibili session is invalid"
        });
        return { success: false, error: "Stored Bilibili session is invalid" };
      }
      this.authSession = record.auth;
      this.updateState({
        loginSession: record.loginSession,
        error: null
      });
      return { success: true, data: record.loginSession };
    } catch (error) {
      this.clearPersistedSession();
      this.authSession = null;
      const message = this.toErrorMessage(error);
      this.updateState({
        loginSession: createDefaultBilibiliSamplerState().loginSession,
        error: message
      });
      return { success: false, error: message };
    }
  }

  async bootstrapQrLogin() {
    try {
      const payload = await this.fetchJson(QR_BOOTSTRAP_URL, { includeAuth: false, allowNonZeroCode: false });
      const qrUrl = normalizeText(payload?.data?.url);
      const authCode = normalizeText(payload?.data?.qrcode_key);
      if (!qrUrl || !authCode) {
        throw new Error("Bilibili QR bootstrap response is missing url or qrcode_key");
      }
      this.pendingAuthCode = authCode;
      this.updateState({ error: null });
      return { success: true, data: { qrUrl, authCode } };
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.updateState({ error: message });
      return { success: false, error: message };
    }
  }

  async pollLogin() {
    if (!this.pendingAuthCode) {
      return { success: false, error: "QR login has not been initialized" };
    }
    try {
      const payload = await this.fetchJson(
        `${QR_POLL_URL}?qrcode_key=${encodeURIComponent(this.pendingAuthCode)}`,
        { includeAuth: false, allowNonZeroCode: true }
      );
      const pollData = payload?.data ?? {};
      const status = resolvePollStatus(pollData);
      if (status === "pending" || status === "scanned") {
        this.updateState({ error: null });
        return { success: true, data: { status } };
      }
      if (status === "expired") {
        this.pendingAuthCode = null;
        this.clearPersistedSession();
        this.authSession = null;
        this.updateState({
          loginSession: createDefaultBilibiliSamplerState().loginSession,
          error: "QR login expired"
        });
        return { success: false, error: "QR login expired" };
      }
      if (status === "confirmed") {
        const confirmedSession = normalizeConfirmedSession(pollData);
        await this.persistSession(confirmedSession);
        this.pendingAuthCode = null;
        this.authSession = confirmedSession.auth;
        this.updateState({
          loginSession: confirmedSession.loginSession,
          error: null
        });
        return { success: true, data: { status, loginSession: confirmedSession.loginSession } };
      }
      throw new Error("Bilibili login status was invalid");
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.updateState({ error: message });
      return { success: false, error: message };
    }
  }

  async logout() {
    try {
      this.pendingAuthCode = null;
      this.clearPersistedSession();
      this.authSession = null;
      this.updateState({
        loginSession: createDefaultBilibiliSamplerState().loginSession,
        error: null
      });
      return { success: true };
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.updateState({ error: message });
      return { success: false, error: message };
    }
  }

  async parseLink(request) {
    const parsedInput = parseBilibiliLink(request?.url);
    if (!parsedInput) {
      this.itemPlaybackTargets.clear();
      this.playPayloads.clear();
      this.updateState({
        parsedLink: null,
        selection: { itemId: null },
        audioOptionSummary: null,
        taskStage: "failed",
        error: "Unsupported Bilibili link"
      });
      return { success: false, error: "Unsupported Bilibili link" };
    }
    this.itemPlaybackTargets.clear();
    this.playPayloads.clear();
    this.updateState({ taskStage: "parsing", error: null });

    try {
      const parsedLink =
        parsedInput.kind === "video"
          ? await this.loadVideoMetadata(parsedInput)
          : await this.loadBangumiMetadata(parsedInput);
      this.updateState({
        parsedLink,
        selection: { itemId: parsedLink.selectedItemId },
        audioOptionSummary: null,
        taskStage: "idle",
        error: null
      });
      return { success: true, data: parsedLink };
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.updateState({
        parsedLink: null,
        selection: { itemId: null },
        audioOptionSummary: null,
        taskStage: "failed",
        error: message
      });
      return { success: false, error: message };
    }
  }

  async loadAudioOptions(request) {
    if (!this.state.parsedLink) {
      return { success: false, error: "Parse a Bilibili link before loading audio options" };
    }
    if (this.state.parsedLink.kind !== request.kind) {
      return { success: false, error: "Selected item does not match the parsed link type" };
    }
    if (!this.state.parsedLink.items.some((item) => item.id === request.itemId)) {
      return { success: false, error: "Selected item was not found" };
    }

    this.updateState({
      taskStage: "loading-audio-options",
      selection: { itemId: request.itemId },
      error: null
    });

    try {
      const playPayload = await this.loadPlayInfo(this.state.parsedLink, request.itemId);
      this.playPayloads.set(request.itemId, playPayload);
      const summary = this.buildAudioSummary(playPayload);
      const data = {
        itemId: request.itemId,
        qnOptions: this.normalizeQnOptions(playPayload),
        summary
      };
      this.updateState({
        audioOptionSummary: summary,
        taskStage: "idle",
        error: null
      });
      return { success: true, data };
    } catch (error) {
      const message = this.toErrorMessage(error);
      this.updateState({
        audioOptionSummary: null,
        taskStage: "failed",
        error: message
      });
      return { success: false, error: message };
    }
  }

  async extractSample(request = {}) {
    const startSeconds = normalizeSeconds(request.startSeconds);
    const endSeconds = normalizeSeconds(request.endSeconds);
    if (startSeconds !== null && startSeconds < 0) {
      return { success: false, error: "Start time must be greater than or equal to zero" };
    }
    if (endSeconds !== null && endSeconds <= (startSeconds ?? 0)) {
      return { success: false, error: "End time must be greater than start time" };
    }
    if (!this.state.parsedLink || !this.state.selection.itemId) {
      return { success: false, error: "Load Bilibili audio options before extracting a sample" };
    }

    const selectedItemId = this.state.selection.itemId;
    const playPayload = this.playPayloads.get(selectedItemId);
    if (!playPayload) {
      return { success: false, error: "Selected item is missing loaded audio options" };
    }

    const audioUrl = this.resolveAudioUrl(playPayload);
    if (!audioUrl) {
      return { success: false, error: "Selected item does not have an audio stream" };
    }

    const ffmpegPath = this.getFfmpegPathImpl();
    if (!ffmpegPath) {
      return { success: false, error: "FFmpeg is not available" };
    }

    const controller = new AbortController();
    const tempDirectory = this.getTaskDirectory();
    const outputDirectory = request.outputDirectory || this.defaultOutputDirectory || this.app.getPath("downloads");
    const sampleBaseName = sanitizeFileName(request.sampleName || this.getDefaultSampleName());
    const sourceExtension = getExtensionFromUrl(audioUrl);
    const sourceTempPath = path.join(tempDirectory, `${SOURCE_AUDIO_FILE_NAME}${sourceExtension}`);
    const outputPath = path.join(outputDirectory, `${sampleBaseName}.wav`);
    const sourceOutputPath = path.join(outputDirectory, `${sampleBaseName}.source${sourceExtension}`);

    this.activeExtractTask = { controller, tempDirectory };
    this.fs.mkdirSync(tempDirectory, { recursive: true });
    this.fs.mkdirSync(outputDirectory, { recursive: true });

    try {
      this.updateState({ taskStage: "downloading-audio", error: null });
      await this.downloadBinaryImpl({
        url: audioUrl,
        destinationPath: sourceTempPath,
        signal: controller.signal,
        headers: this.getRequestHeaders()
      });

      this.updateState({ taskStage: "converting", error: null });
      this.removeExistingFileIfPresent(outputPath);
      await this.runFfmpegImpl({
        ffmpegPath,
        inputPath: sourceTempPath,
        outputPath,
        startSeconds,
        endSeconds,
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS
      });

      this.assertOutputFile(outputPath);
      this.removeExistingFileIfPresent(sourceOutputPath);
      this.moveFile(sourceTempPath, sourceOutputPath);
      await this.cleanupTaskDirectory(tempDirectory);

      const metadata = this.readWavMetadataImpl(outputPath);
      if (!metadata.durationSeconds || metadata.durationSeconds <= 0) {
        throw new Error("Extracted audio is empty");
      }
      const selectedItem = this.getSelectedItem();
      this.updateState({ taskStage: "completed", error: null });
      return {
        success: true,
        data: {
          audioPath: outputPath,
          sourceAudioPath: sourceOutputPath,
          durationSeconds: metadata.durationSeconds,
          sampleRate: metadata.sampleRate,
          title: this.state.parsedLink.title,
          itemTitle: selectedItem?.title ?? null
        }
      };
    } catch (error) {
      const cancelled = controller.signal.aborted || this.isAbortError(error);
      if (cancelled) {
        await this.cleanupTaskDirectory(tempDirectory);
        this.updateState({ taskStage: "cancelled", error: null });
        return { success: false, error: "Extraction cancelled" };
      }
      const message = this.toErrorMessage(error);
      await this.cleanupTaskDirectory(tempDirectory);
      this.updateState({ taskStage: "failed", error: message });
      return { success: false, error: message };
    } finally {
      this.activeExtractTask = null;
    }
  }

  cancelExtract() {
    if (!this.activeExtractTask) {
      return { success: false, error: "No Bilibili extraction is in progress" };
    }
    this.activeExtractTask.controller.abort();
    return { success: true };
  }

  async loadVideoMetadata(parsedInput) {
    const url = new URL(BILIBILI_VIDEO_VIEW_URL);
    url.searchParams.set("bvid", parsedInput.bvid);
    const payload = await this.fetchJson(url.toString());
    const data = payload?.data ?? payload;
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    const requestedPage = parsedInput.page ?? 1;
    const items = pages.length > 0
      ? pages.map((pageEntry) => {
          const item = createPageItem(pageEntry?.page, pageEntry?.part);
          this.itemPlaybackTargets.set(item.id, {
            cid: normalizePositiveNumber(pageEntry?.cid),
            page: item.page
          });
          return item;
        })
      : parsedInput.items.map((item) => {
          this.itemPlaybackTargets.set(item.id, { cid: null, page: item.page });
          return item;
        });
    const selected = items.find((item) => item.page === requestedPage) ?? items[0];
    return {
      kind: "video",
      bvid: parsedInput.bvid,
      page: selected?.page ?? requestedPage,
      title: normalizeText(data?.title),
      coverUrl: normalizeText(data?.pic),
      items,
      selectedItemId: selected?.id ?? `page:${requestedPage}`
    };
  }

  async loadBangumiMetadata(parsedInput) {
    const url = new URL(BILIBILI_BANGUMI_SEASON_URL);
    const selectedEpisodeId = parsedInput.kind === "episode" ? parseNumericId(parsedInput.epId, "ep") : null;
    const selectedSeasonId = parsedInput.kind === "season" ? parseNumericId(parsedInput.seasonId, "ss") : null;
    if (selectedEpisodeId) {
      url.searchParams.set("ep_id", selectedEpisodeId);
    } else if (selectedSeasonId) {
      url.searchParams.set("season_id", selectedSeasonId);
    }

    const payload = await this.fetchJson(url.toString());
    const data = payload?.result ?? payload?.data ?? payload;
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    const episodeItems = episodes.map((episode) => {
      const epId = `ep${episode?.id}`;
      const item = createEpisodeItem(epId, buildItemTitle(episode?.title, episode?.long_title, `EP ${epId}`));
      this.itemPlaybackTargets.set(item.id, {
        cid: normalizePositiveNumber(episode?.cid),
        epId
      });
      return item;
    });

    if (episodeItems.length > 0) {
      const requestedId = parsedInput.kind === "episode" ? `episode:${parsedInput.epId}` : null;
      const selected = episodeItems.find((item) => item.id === requestedId) ?? episodeItems[0];
      return {
        kind: "episode",
        epId: selected.epId,
        title: normalizeText(data?.season_title) ?? normalizeText(data?.title),
        coverUrl: normalizeText(data?.cover),
        items: episodeItems,
        selectedItemId: selected.id
      };
    }

    if (parsedInput.kind === "episode") {
      const item = createEpisodeItem(parsedInput.epId);
      this.itemPlaybackTargets.set(item.id, { cid: null, epId: parsedInput.epId });
      return {
        ...parsedInput,
        items: [item],
        selectedItemId: item.id
      };
    }

    const item = createSeasonItem(parsedInput.seasonId);
    this.itemPlaybackTargets.set(item.id, { cid: null, seasonId: parsedInput.seasonId });
    return {
      ...parsedInput,
      items: [item],
      selectedItemId: item.id
    };
  }

  async loadPlayInfo(parsedLink, itemId) {
    const target = this.itemPlaybackTargets.get(itemId);
    if (!target?.cid) {
      throw new Error("Selected item is missing playback metadata");
    }
    const url = new URL(parsedLink.kind === "video" ? BILIBILI_VIDEO_PLAY_URL : BILIBILI_BANGUMI_PLAY_URL);
    if (parsedLink.kind === "video") {
      url.searchParams.set("bvid", parsedLink.bvid);
    } else {
      const epId = parseNumericId(target.epId ?? parsedLink.epId, "ep");
      if (epId) {
        url.searchParams.set("ep_id", epId);
      } else {
        const seasonId = parseNumericId(target.seasonId ?? parsedLink.seasonId, "ss");
        if (!seasonId) {
          throw new Error("Selected item is missing season metadata");
        }
        url.searchParams.set("season_id", seasonId);
      }
    }
    url.searchParams.set("cid", String(target.cid));
    url.searchParams.set("fnval", String(DEFAULT_FNVAL));
    url.searchParams.set("qn", String(DEFAULT_STREAM_QN));
    url.searchParams.set("fourk", "1");
    const payload = await this.fetchJson(url.toString());
    return payload?.result ?? payload?.data ?? payload;
  }

  normalizeQnOptions(playPayload) {
    const qualityList = Array.isArray(playPayload?.accept_quality) ? playPayload.accept_quality : [];
    const descriptions = Array.isArray(playPayload?.accept_description) ? playPayload.accept_description : [];
    const seen = new Set();
    const options = [];
    qualityList.forEach((quality, index) => {
      const qn = normalizePositiveNumber(quality);
      if (!qn || seen.has(qn)) {
        return;
      }
      seen.add(qn);
      options.push({
        qn,
        label: normalizeText(descriptions[index]) ?? `${qn}P`,
        selected: index === 0,
        available: true
      });
    });
    return options;
  }

  buildAudioSummary(playPayload) {
    const audioStreams = Array.isArray(playPayload?.dash?.audio) ? playPayload.dash.audio : [];
    const hasAudio = audioStreams.some((stream) => Boolean(getResourceUrl(stream)));
    return {
      hasAudio,
      disabledReason: hasAudio ? null : "当前条目没有可用音频流"
    };
  }

  resolveAudioUrl(playPayload) {
    const audioStreams = Array.isArray(playPayload?.dash?.audio) ? playPayload.dash.audio : [];
    for (const stream of audioStreams) {
      const url = getResourceUrl(stream);
      if (url) {
        return url;
      }
    }
    return null;
  }

  async fetchJson(url, options = {}) {
    if (!this.fetchImpl) {
      throw new Error("Fetch is not available");
    }
    const response = await this.fetchImpl(url, {
      headers: options.includeAuth === false ? {} : this.getRequestHeaders()
    });
    const payload = await response.json();
    const code = Number(payload?.code ?? 0);
    if (!options.allowNonZeroCode && Number.isFinite(code) && code !== 0) {
      throw new Error(normalizeText(payload?.message) ?? "Bilibili request failed");
    }
    return payload;
  }

  getRequestHeaders() {
    if (!this.authSession) {
      return {};
    }
    return {
      cookie: `SESSDATA=${this.authSession.sessData}; bili_jct=${this.authSession.biliJct}`
    };
  }

  getSessionPath() {
    return path.join(this.app.getPath("userData"), SESSION_FILE_NAME);
  }

  async persistSession(session) {
    const sessionPath = this.getSessionPath();
    this.fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    await this.fs.promises.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  clearPersistedSession() {
    const sessionPath = this.getSessionPath();
    if (this.fs.existsSync(sessionPath)) {
      this.fs.unlinkSync(sessionPath);
    }
  }

  getTaskDirectory() {
    return path.join(this.app.getPath("userData"), TASK_ROOT_DIRECTORY_NAME, TASKS_DIRECTORY_NAME, String(this.now()));
  }

  getSelectedItem() {
    return this.state.parsedLink?.items.find((item) => item.id === this.state.selection.itemId) ?? null;
  }

  getDefaultSampleName() {
    const selectedItem = this.getSelectedItem();
    return [this.state.parsedLink?.title, selectedItem?.title].filter(Boolean).join(" - ") || "bilibili-sample";
  }

  updateState(patch) {
    const nextState = {
      ...this.state,
      ...patch,
      loginSession: patch.loginSession ?? this.state.loginSession,
      selection: patch.selection ?? this.state.selection
    };
    const changed = JSON.stringify(nextState) !== JSON.stringify(this.state);
    this.state = nextState;
    if (!changed) {
      return;
    }
    const snapshot = this.getState();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }

  removeExistingFileIfPresent(filePath) {
    if (this.fs.existsSync(filePath)) {
      this.fs.unlinkSync(filePath);
    }
  }

  moveFile(fromPath, toPath) {
    this.removeExistingFileIfPresent(toPath);
    this.fs.renameSync(fromPath, toPath);
  }

  assertOutputFile(filePath) {
    if (!this.fs.existsSync(filePath)) {
      throw new Error("Extracted audio file was not created");
    }
    const stat = this.fs.statSync(filePath);
    if (!stat.size || stat.size <= 0) {
      throw new Error("Extracted audio is empty");
    }
  }

  async cleanupTaskDirectory(taskDirectory) {
    await this.fs.promises.rm(taskDirectory, { recursive: true, force: true });
  }

  async downloadBinary(input) {
    if (!this.fetchImpl) {
      throw new Error("Fetch is not available");
    }
    const response = await this.fetchImpl(input.url, {
      headers: input.headers,
      signal: input.signal
    });
    if (typeof response.arrayBuffer !== "function") {
      throw new Error("Binary downloads are not supported by the current fetch implementation");
    }
    await this.fs.promises.writeFile(input.destinationPath, Buffer.from(await response.arrayBuffer()));
  }

  async runFfmpeg(input) {
    const args = ["-y"];
    if (input.startSeconds !== null && typeof input.startSeconds !== "undefined") {
      args.push("-ss", String(input.startSeconds));
    }
    args.push("-i", input.inputPath);
    if (input.endSeconds !== null && typeof input.endSeconds !== "undefined") {
      args.push("-to", String(input.endSeconds));
    }
    args.push("-ac", String(input.channels), "-ar", String(input.sampleRate), input.outputPath);

    await new Promise((resolve, reject) => {
      const child = childProcess.spawn(input.ffmpegPath, args, { windowsHide: true });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`FFmpeg exited with code ${code ?? "unknown"}`));
      });
    });
  }

  isAbortError(error) {
    const message = this.toErrorMessage(error).toLowerCase();
    return message === "aborted" || message.includes("abort");
  }

  toErrorMessage(error) {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === "object" && typeof error.message === "string") {
      return error.message;
    }
    return String(error);
  }
}

module.exports = {
  BilibiliSamplerService,
  createDefaultBilibiliSamplerState,
  parseBilibiliLink,
  readWavMetadata
};
