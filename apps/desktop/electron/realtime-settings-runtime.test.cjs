const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createRealtimeSettingsStore, normalizeRealtimeSettings } = require("./realtime-settings-runtime.cjs");

let temporaryDirectory;

before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "open-tts-realtime-settings-"));
});

after(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => {
    const decrypted = value.toString("utf8");
    assert.ok(decrypted.startsWith("protected:"));
    return decrypted.slice("protected:".length);
  }
};

test("realtime settings encrypt the API key and restore the saved conversation defaults", async () => {
  const store = createRealtimeSettingsStore({
    fs,
    safeStorage,
    getUserDataPath: () => temporaryDirectory
  });
  const settings = {
    llmBaseUrl: "https://example.test/v1",
    llmModel: "qwen3",
    llmApiKey: "secret-key",
    systemPrompt: "请用简短中文回答",
    voiceId: "voice-1",
    ttsEnabled: true,
    ttsBackend: "streaming"
  };

  const saved = await store.save(settings);
  const storedJson = await fs.readFile(path.join(temporaryDirectory, "realtime-session.json"), "utf8");

  assert.equal(saved.llmApiKey, "");
  assert.equal(storedJson.includes("secret-key"), false);
  assert.equal(JSON.parse(storedJson).llmApiKeyEncrypted.length > 0, true);
  assert.deepEqual(await store.load(), settings);
});

test("realtime settings discard unsupported values and retain safe defaults", () => {
  assert.deepEqual(normalizeRealtimeSettings({
    llmBaseUrl: "  http://127.0.0.1:11434/v1  ",
    ttsBackend: "unsafe",
    ttsEnabled: "yes"
  }), {
    llmBaseUrl: "http://127.0.0.1:11434/v1",
    llmModel: "",
    llmApiKey: "",
    systemPrompt: "",
    voiceId: "",
    ttsEnabled: true,
    ttsBackend: "auto"
  });
});
