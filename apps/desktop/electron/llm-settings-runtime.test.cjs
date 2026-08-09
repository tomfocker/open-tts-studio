const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createLlmSettingsStore, normalizeLlmSettings, DEFAULT_SYSTEM_PROMPT } = require("./llm-settings-runtime.cjs");

let temporaryDirectory;

before(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "open-tts-llm-settings-"));
});

after(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^protected:/, "")
};

test("global LLM settings encrypt API keys and clamp numeric options", async () => {
  const store = createLlmSettingsStore({ fs, safeStorage, getUserDataPath: () => temporaryDirectory });
  const input = { enabled: true, baseUrl: " http://127.0.0.1:11434/v1 ", model: "qwen3", apiKey: "secret", systemPrompt: "回答中文", temperature: 9, maxTokens: 99999 };
  const saved = await store.save(input);
  const storedJson = await fs.readFile(path.join(temporaryDirectory, "llm-settings.json"), "utf8");
  assert.equal(saved.apiKey, "");
  assert.equal(storedJson.includes("secret"), false);
  assert.equal(JSON.parse(storedJson).maxTokens, 8192);
  assert.equal((await store.load()).apiKey, "secret");
  assert.equal((await store.load()).baseUrl, "http://127.0.0.1:11434/v1");
});

test("normalization returns safe defaults", () => {
  assert.deepEqual(normalizeLlmSettings({ temperature: "bad", maxTokens: 0 }), {
    enabled: true,
    baseUrl: "https://api.cdn-krill-ai.com/codex/v1",
    model: "gpt-5.6-luna",
    apiKey: "",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    maxTokens: 1
  });
});
