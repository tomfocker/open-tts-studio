const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopWindow", {
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close")
});

contextBridge.exposeInMainWorld("desktopConfig", {
  apiBase: process.env.OPEN_TTS_API_BASE || "http://127.0.0.1:8765"
});

contextBridge.exposeInMainWorld("desktopFiles", {
  openPath: (targetPath) => ipcRenderer.invoke("file:open-path", targetPath),
  selectDirectory: () => ipcRenderer.invoke("file:select-directory"),
  selectModelArchive: () => ipcRenderer.invoke("file:select-model-archive"),
  selectReferenceAudio: () => ipcRenderer.invoke("file:select-reference-audio"),
  saveSettingsBackup: (content) => ipcRenderer.invoke("file:save-settings-backup", content),
  selectSettingsBackup: () => ipcRenderer.invoke("file:select-settings-backup")
});

contextBridge.exposeInMainWorld("desktopClipboard", {
  writeText: (content) => ipcRenderer.invoke("clipboard:write-text", content)
});

contextBridge.exposeInMainWorld("desktopBilibiliSampler", {
  getSession: () => ipcRenderer.invoke("bilibili-sampler:get-session"),
  startLogin: () => ipcRenderer.invoke("bilibili-sampler:start-login"),
  pollLogin: () => ipcRenderer.invoke("bilibili-sampler:poll-login"),
  logout: () => ipcRenderer.invoke("bilibili-sampler:logout"),
  parseLink: (link) => ipcRenderer.invoke("bilibili-sampler:parse-link", link),
  loadAudioOptions: (kind, itemId) => ipcRenderer.invoke("bilibili-sampler:load-audio-options", { kind, itemId }),
  extractSample: (request) => ipcRenderer.invoke("bilibili-sampler:extract-sample", request),
  cancelExtract: () => ipcRenderer.invoke("bilibili-sampler:cancel-extract"),
  onStateChanged: (listener) => {
    const channel = "bilibili-sampler:state-changed";
    const handler = (_event, state) => listener(state);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
