function normalizeReleaseNotes(value) {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : item && typeof item.note === "string" ? item.note : ""))
      .filter(Boolean)
      .join("\n") || null;
  }
  return null;
}

function createInitialUpdateState(app, enabled) {
  return {
    status: enabled ? "idle" : "unavailable",
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: null,
    progressPercent: null,
    message: enabled ? "" : "开发环境不会检查更新。"
  };
}

function createUpdateService({ app, autoUpdater, enabled }) {
  let state = createInitialUpdateState(app, enabled);
  const listeners = new Set();
  const publish = (next) => {
    state = { ...state, ...next };
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };

  if (enabled) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () => publish({ status: "checking", message: "正在检查 GitHub 最新版本。", progressPercent: null }));
    autoUpdater.on("update-available", (info) => publish({
      status: "available",
      availableVersion: info.version || null,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      message: "发现新版本，可以下载后重启安装。",
      progressPercent: null
    }));
    autoUpdater.on("update-not-available", () => publish({
      status: "up-to-date",
      availableVersion: null,
      releaseNotes: null,
      message: "当前已是最新版本。",
      progressPercent: null
    }));
    autoUpdater.on("download-progress", (progress) => publish({
      status: "downloading",
      progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      message: "正在下载更新包。"
    }));
    autoUpdater.on("update-downloaded", (info) => publish({
      status: "downloaded",
      availableVersion: info.version || state.availableVersion,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || state.releaseNotes,
      progressPercent: 100,
      message: "更新已下载，重启应用后安装。"
    }));
    autoUpdater.on("error", (error) => publish({
      status: "error",
      message: error?.message || "检查更新失败。",
      progressPercent: null
    }));
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async check() {
      if (!enabled) {
        return publish(createInitialUpdateState(app, false));
      }
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        publish({ status: "error", message: error?.message || "检查更新失败。", progressPercent: null });
      }
      return state;
    },
    async download() {
      if (!enabled) {
        return state;
      }
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        publish({ status: "error", message: error?.message || "下载更新失败。", progressPercent: null });
      }
      return state;
    },
    install() {
      if (enabled && state.status === "downloaded") {
        publish({ status: "installing", message: "正在重启并安装更新。" });
        autoUpdater.quitAndInstall();
      }
      return state;
    }
  };
}

module.exports = {
  createInitialUpdateState,
  createUpdateService,
  normalizeReleaseNotes
};
