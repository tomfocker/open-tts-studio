const path = require("node:path");

const SETTINGS_FILE_NAME = "llm-settings.json";
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 512;
const MAX_API_KEY_LENGTH = 16_384;
const MAX_PROMPT_LENGTH = 16_384;
const DEFAULT_BASE_URL = "https://api.cdn-krill-ai.com/codex/v1";
const DEFAULT_MODEL = "gpt-5.6-luna";

function text(value, maxLength, { trim = true } = {}) {
  if (typeof value !== "string") return "";
  const normalized = trim ? value.trim() : value;
  return normalized.slice(0, maxLength);
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeLlmSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    baseUrl: text(source.baseUrl, MAX_BASE_URL_LENGTH) || DEFAULT_BASE_URL,
    model: text(source.model, MAX_MODEL_LENGTH) || DEFAULT_MODEL,
    apiKey: text(source.apiKey, MAX_API_KEY_LENGTH, { trim: false }),
    systemPrompt: text(source.systemPrompt, MAX_PROMPT_LENGTH),
    temperature: number(source.temperature, 0.7, 0, 2),
    maxTokens: Math.round(number(source.maxTokens, 512, 1, 8192))
  };
}

function createLlmSettingsStore({ fs, safeStorage, getUserDataPath, loadLegacySettings }) {
  function filePath() {
    return path.join(getUserDataPath(), SETTINGS_FILE_NAME);
  }

  async function readStored() {
    try {
      return JSON.parse(await fs.readFile(filePath(), "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function load() {
    const stored = await readStored();
    if (!stored) {
      const legacy = typeof loadLegacySettings === "function" ? await loadLegacySettings() : null;
      return normalizeLlmSettings(legacy);
    }
    const settings = normalizeLlmSettings(stored);
    if (typeof stored.apiKeyEncrypted !== "string" || !stored.apiKeyEncrypted || !safeStorage.isEncryptionAvailable()) {
      return settings;
    }
    try {
      settings.apiKey = safeStorage.decryptString(Buffer.from(stored.apiKeyEncrypted, "base64"));
    } catch {
      settings.apiKey = "";
    }
    return normalizeLlmSettings(settings);
  }

  async function save(value) {
    const settings = normalizeLlmSettings(value);
    const payload = {
      version: 1,
      enabled: settings.enabled,
      baseUrl: settings.baseUrl,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      apiKeyEncrypted: ""
    };
    if (settings.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("当前系统无法加密保存全局 LLM 的 API Key。");
      }
      payload.apiKeyEncrypted = safeStorage.encryptString(settings.apiKey).toString("base64");
    }
    const destination = filePath();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(payload), "utf8");
    await fs.rename(temporary, destination);
    return { ...settings, apiKey: "" };
  }

  return { load, save };
}

module.exports = { createLlmSettingsStore, normalizeLlmSettings, DEFAULT_BASE_URL, DEFAULT_MODEL };
