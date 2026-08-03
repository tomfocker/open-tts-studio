const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopWindow", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close")
});

contextBridge.exposeInMainWorld("desktopConfig", {
  apiBase: process.env.OPEN_TTS_API_BASE || "http://127.0.0.1:8765"
});

contextBridge.exposeInMainWorld("desktopBackend", {
  ensureOnline: () => ipcRenderer.invoke("backend:ensure-online")
});

contextBridge.exposeInMainWorld("desktopRealtimeSettings", {
  load: () => ipcRenderer.invoke("realtime-settings:load"),
  save: (settings) => ipcRenderer.invoke("realtime-settings:save", settings)
});

contextBridge.exposeInMainWorld("desktopFiles", {
  openPath: (targetPath) => ipcRenderer.invoke("file:open-path", targetPath),
  revealInFolder: (targetPath) => ipcRenderer.invoke("file:reveal-in-folder", targetPath),
  selectDirectory: () => ipcRenderer.invoke("file:select-directory"),
  selectPythonExecutable: () => ipcRenderer.invoke("file:select-python-executable"),
  selectModelArchive: () => ipcRenderer.invoke("file:select-model-archive"),
  selectReferenceAudio: () => ipcRenderer.invoke("file:select-reference-audio"),
  selectTranscriptionMedia: () => ipcRenderer.invoke("file:select-transcription-media"),
  selectAudioEnhancementMedia: () => ipcRenderer.invoke("file:select-audio-enhancement-media"),
  selectAudioSeparationMedia: () => ipcRenderer.invoke("file:select-audio-separation-media"),
  saveTranscriptionExport: (content, defaultName, extension) => ipcRenderer.invoke("file:save-transcription-export", content, defaultName, extension),
  readSelectedAudio: (targetPath) => ipcRenderer.invoke("file:read-selected-audio", targetPath),
  readManagedReferenceAudio: (targetPath) => ipcRenderer.invoke("file:read-managed-reference-audio", targetPath),
  selectVoicePackage: () => ipcRenderer.invoke("file:select-voice-package"),
  saveVoicePackage: (sourcePath, defaultName) => ipcRenderer.invoke("file:save-voice-package", sourcePath, defaultName),
  saveSettingsBackup: (content) => ipcRenderer.invoke("file:save-settings-backup", content),
  selectSettingsBackup: () => ipcRenderer.invoke("file:select-settings-backup")
});

contextBridge.exposeInMainWorld("desktopClipboard", {
  writeText: (content) => ipcRenderer.invoke("clipboard:write-text", content)
});

contextBridge.exposeInMainWorld("desktopExternal", {
  openLegadoImport: (targetUrl) => ipcRenderer.invoke("external:open-legado-import", targetUrl)
});

contextBridge.exposeInMainWorld("desktopUpdater", {
  getState: () => ipcRenderer.invoke("app-update:get-state"),
  check: () => ipcRenderer.invoke("app-update:check"),
  download: () => ipcRenderer.invoke("app-update:download"),
  install: () => ipcRenderer.invoke("app-update:install"),
  onStateChanged: (listener) => {
    const channel = "app-update:state-changed";
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});

contextBridge.exposeInMainWorld("desktopBilibiliSampler", {
  getSession: () => ipcRenderer.invoke("bilibili-sampler:get-session"),
  startLogin: () => ipcRenderer.invoke("bilibili-sampler:start-login"),
  pollLogin: () => ipcRenderer.invoke("bilibili-sampler:poll-login"),
  logout: () => ipcRenderer.invoke("bilibili-sampler:logout"),
  parseLink: (link) => ipcRenderer.invoke("bilibili-sampler:parse-link", link),
  loadAudioOptions: (kind, itemId, qn) => ipcRenderer.invoke("bilibili-sampler:load-audio-options", { kind, itemId, qn }),
  extractSample: (request) => ipcRenderer.invoke("bilibili-sampler:extract-sample", request),
  downloadVideo: (request) => ipcRenderer.invoke("bilibili-sampler:download-video", request),
  listHistory: () => ipcRenderer.invoke("bilibili-sampler:list-history"),
  getHistoryItem: (historyId) => ipcRenderer.invoke("bilibili-sampler:get-history-item", historyId),
  extractHistorySample: (historyId, payload) => ipcRenderer.invoke("bilibili-sampler:extract-history-sample", historyId, payload),
  stageTranscription: (historyId) => ipcRenderer.invoke("bilibili-sampler:stage-transcription", historyId),
  removeHistory: (historyId) => ipcRenderer.invoke("bilibili-sampler:remove-history", historyId),
  cancelExtract: () => ipcRenderer.invoke("bilibili-sampler:cancel-extract"),
  onStateChanged: (listener) => {
    const channel = "bilibili-sampler:state-changed";
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
