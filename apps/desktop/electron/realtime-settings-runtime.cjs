const path = require("node:path");

const SETTINGS_FILE_NAME = "realtime-session.json";
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 512;
const MAX_API_KEY_LENGTH = 16_384;
const MAX_PROMPT_LENGTH = 16_384;
const MAX_VOICE_ID_LENGTH = 512;
const TTS_BACKENDS = new Set(["auto", "streaming", "compatibility"]);

function text(value, maxLength, { trim = true } = {}) {
  if (typeof value !== "string") return "";
  const normalized = trim ? value.trim() : value;
  return normalized.slice(0, maxLength);
}

function normalizeRealtimeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const ttsBackend = text(source.ttsBackend, 32);
  return {
    llmBaseUrl: text(source.llmBaseUrl, MAX_BASE_URL_LENGTH),
    llmModel: text(source.llmModel, MAX_MODEL_LENGTH),
    llmApiKey: text(source.llmApiKey, MAX_API_KEY_LENGTH, { trim: false }),
    systemPrompt: text(source.systemPrompt, MAX_PROMPT_LENGTH),
    voiceId: text(source.voiceId, MAX_VOICE_ID_LENGTH),
    ttsEnabled: typeof source.ttsEnabled === "boolean" ? source.ttsEnabled : true,
    ttsBackend: TTS_BACKENDS.has(ttsBackend) ? ttsBackend : "auto"
  };
}

function createRealtimeSettingsStore({ fs, safeStorage, getUserDataPath }) {
  function filePath() {
    return path.join(getUserDataPath(), SETTINGS_FILE_NAME);
  }

  async function load() {
    let stored;
    try {
      stored = JSON.parse(await fs.readFile(filePath(), "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return normalizeRealtimeSettings();
      throw error;
    }
    const settings = normalizeRealtimeSettings(stored);
    if (!stored || typeof stored.llmApiKeyEncrypted !== "string" || !stored.llmApiKeyEncrypted) {
      return settings;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return settings;
    }
    try {
      settings.llmApiKey = safeStorage.decryptString(Buffer.from(stored.llmApiKeyEncrypted, "base64"));
    } catch {
      // A copied profile or damaged OS credential store must not prevent the
      // rest of the realtime configuration from loading.
      settings.llmApiKey = "";
    }
    return normalizeRealtimeSettings(settings);
  }

  async function save(value) {
    const settings = normalizeRealtimeSettings(value);
    const payload = {
      version: 1,
      llmBaseUrl: settings.llmBaseUrl,
      llmModel: settings.llmModel,
      systemPrompt: settings.systemPrompt,
      voiceId: settings.voiceId,
      ttsEnabled: settings.ttsEnabled,
      ttsBackend: settings.ttsBackend,
      llmApiKeyEncrypted: ""
    };
    if (settings.llmApiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("当前系统无法加密保存实时 LLM 的 API Key。");
      }
      payload.llmApiKeyEncrypted = safeStorage.encryptString(settings.llmApiKey).toString("base64");
    }
    const destination = filePath();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(payload), "utf8");
    await fs.rename(temporary, destination);
    return { ...settings, llmApiKey: "" };
  }

  return { load, save };
}

module.exports = { createRealtimeSettingsStore, normalizeRealtimeSettings };
