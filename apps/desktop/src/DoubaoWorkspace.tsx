import {
  Activity,
  BookOpen,
  CheckCircle2,
  Clipboard,
  Cloud,
  Cookie as CookieIcon,
  Database,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  Library,
  Loader2,
  LogIn,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  Wand2,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  cancelDoubaoPrefetch,
  cancelLegadoBookCache,
  cleanDoubaoLogCache,
  clearDoubaoBookCache,
  clearDoubaoCookies,
  configureDoubaoCookieRotation,
  confirmDoubaoQrLogin,
  createDoubaoCookie,
  deleteDoubaoAudio,
  deleteDoubaoCachedBook,
  deleteDoubaoCookie,
  deleteDoubaoPrefetchChapter,
  deleteDoubaoPrefetchFiles,
  deleteDoubaoPrefetchTask,
  fetchDoubaoCacheStats,
  fetchDoubaoCachedChapter,
  fetchDoubaoCachedChapters,
  fetchDoubaoCachedBooks,
  fetchDoubaoCookie,
  fetchDoubaoCookies,
  fetchDoubaoDeviceId,
  fetchDoubaoDocument,
  fetchDoubaoDocuments,
  fetchDoubaoLegacySettings,
  fetchDoubaoPrefetchTasks,
  fetchDoubaoPrefetchCacheDetail,
  fetchDoubaoStatus,
  fetchDoubaoVoices,
  fetchLegadoBooks,
  fetchLegadoChapterContent,
  fetchLegadoChapters,
  generateDoubaoSpeech,
  generateLegadoBookId,
  getApiBase,
  getLegadoImportUrl,
  getLegadoPrefabConfigUrl,
  getLegadoRealtimeConfigUrl,
  normalizeLegadoServiceBase,
  pauseDoubaoPrefetch,
  pollDoubaoQrLogin,
  regenerateDoubaoDeviceId,
  resetDoubaoLegacySettings,
  resumeDoubaoPrefetch,
  retryDoubaoPrefetch,
  rotateDoubaoCookie,
  saveDoubaoLegacySettings,
  setDoubaoCookieUsageLimit,
  setDoubaoDeviceIdAutoGenerate,
  startDoubaoPrefetch,
  startDoubaoQrLogin,
  startLegadoBookCache,
  testAllDoubaoCookies,
  testDoubaoCookie,
  testLegadoTtsConfig,
  toAudioUrl,
  toggleDoubaoCookie,
  updateDoubaoCookie
} from "./api";
import type {
  DoubaoCacheStats,
  DoubaoCachedBook,
  DoubaoCachedChapter,
  DoubaoCookieRecord,
  DoubaoCookieStats,
  DoubaoDeviceId,
  DoubaoDocument,
  DoubaoLegacySettings,
  DoubaoPrefetchTask,
  DoubaoQrSession,
  DoubaoQrStatus,
  DoubaoStatus,
  DoubaoVoice,
  LegadoBook,
  LegadoChapter,
  SpeechResult
} from "./types";

import "./doubao-workspace.css";

type DoubaoWorkspaceProps = {
  onClose: () => void;
};

type WorkspaceTab = "synthesis" | "accounts" | "reader" | "cache" | "maintenance";
type WorkspaceTheme = "light" | "dark";
type ReaderConfigTemplate = "default" | "fast" | "safe" | "custom";

type CookieDraft = {
  id: string | null;
  name: string;
  value: string;
  description: string;
};

type CookieSort = "name" | "usageCount" | "createdAt";
type CookieViewMode = "grid" | "list";

type BookCacheProgress = {
  current: number;
  total: number;
  cached: number;
  skipped: number;
  failed: number;
  chapter: string;
  percent: number;
  status: string;
  error?: string;
};

type DoubaoSpeechHistoryItem = {
  id: string;
  createdAt: string;
  text: string;
  voiceId: string;
  voiceName: string;
  speed: number;
  pitch: number;
  format: "mp3" | "wav";
  result: SpeechResult;
};

const emptyCookieDraft: CookieDraft = { id: null, name: "", value: "", description: "" };

const readerConfigTemplates: Array<{ id: ReaderConfigTemplate; label: string; delay: number | null }> = [
  { id: "default", label: "默认 5 秒", delay: 5 },
  { id: "fast", label: "快速 1 秒", delay: 1 },
  { id: "safe", label: "安全 10 秒", delay: 10 },
  { id: "custom", label: "自定义", delay: null }
];

function initialSpeechHistory(): DoubaoSpeechHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const payload = JSON.parse(window.localStorage.getItem("opentts-doubao-speech-history") || "[]") as unknown;
    if (!Array.isArray(payload)) return [];
    return payload.filter((item): item is DoubaoSpeechHistoryItem => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<DoubaoSpeechHistoryItem>;
      return Boolean(record.id && record.createdAt && record.text && record.voiceId && record.result?.audio_url && record.result?.file_path);
    }).slice(0, 50);
  } catch {
    return [];
  }
}

function initialCookieViewMode(): CookieViewMode {
  if (typeof window === "undefined") return "grid";
  return window.localStorage.getItem("opentts-doubao-cookie-view") === "list" ? "list" : "grid";
}

function outputFilename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

const defaultLegacySettings: DoubaoLegacySettings = {
  prefetch: { cacheConcurrent: 20 },
  tts: { requestDelay: 15, requestIntervalDelay: 3, maxRetries: 3 },
  system: { logLevel: "info" },
  version: "1.0.0",
  updatedAt: ""
};

function initialTheme(): WorkspaceTheme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("opentts-doubao-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialReaderServer(): { ip: string; port: number } {
  if (typeof window === "undefined") return { ip: "127.0.0.1", port: 1122 };
  try {
    const stored = JSON.parse(window.localStorage.getItem("opentts-legado-server") || "null") as
      | { ip?: string; port?: number }
      | null;
    return {
      ip: stored?.ip?.trim() || "127.0.0.1",
      port: Number.isInteger(stored?.port) ? Number(stored?.port) : 1122
    };
  } catch {
    return { ip: "127.0.0.1", port: 1122 };
  }
}

function initialLegadoServiceBase(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:8765";
  return window.localStorage.getItem("opentts-legado-service-base")?.trim() || getApiBase();
}

function formatDate(value?: string | null): string {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function bookName(book: LegadoBook | DoubaoCachedBook | null): string {
  if (!book) return "未选择书籍";
  return String(book.name || book.bookName || book.bookUrl || book.bookId || "未命名书籍");
}

function cachedBookIdentifier(book: DoubaoCachedBook): string {
  return String(book.source === "prefetch" ? book.bookId || book.bookUrl || "" : book.bookUrl || book.bookId || "");
}

function chapterIndex(chapter: LegadoChapter): number {
  const value = chapter.chapterIndex ?? chapter.index;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function chapterTitle(chapter: LegadoChapter): string {
  return String(chapter.chapterTitle || chapter.title || `第 ${chapterIndex(chapter) + 1} 章`);
}

function chapterKey(chapter: LegadoChapter): string {
  return `${chapterIndex(chapter)}:${String(chapter.chapterUrl || chapter.url || "")}`;
}

function prefetchProgress(task: DoubaoPrefetchTask): { completed: number; total: number; failed: number; percent: number } {
  const chapters = task.chapters || [];
  const total = chapters.length || Number(task.progress?.total || 0);
  const completed = chapters.length
    ? chapters.filter((chapter) => chapter.status === "completed").length
    : Number(task.progress?.current || task.progress?.completed?.length || 0);
  const failed = chapters.length
    ? chapters.filter((chapter) => chapter.status === "failed").length
    : Number(task.progress?.failed?.length || 0);
  return { completed, total, failed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

function extractChapterContent(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "content", "body"]) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      if (typeof nested.content === "string") return nested.content;
      if (typeof nested.data === "string") return nested.data;
    }
  }
  return JSON.stringify(payload, null, 2);
}

function taskStatusLabel(status: string): string {
  return {
    pending: "等待中",
    queued: "排队中",
    processing: "生成中",
    paused: "已暂停",
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
    cancelled: "已取消",
    cancelling: "取消中"
  }[status] || status;
}

export function DoubaoWorkspace({ onClose }: DoubaoWorkspaceProps) {
  const [theme, setTheme] = useState<WorkspaceTheme>(initialTheme);
  const [tab, setTab] = useState<WorkspaceTab>("synthesis");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<DoubaoStatus | null>(null);
  const [voices, setVoices] = useState<DoubaoVoice[]>([]);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voiceGender, setVoiceGender] = useState("");
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [ttsText, setTtsText] = useState("你好，这里是 OpenTTS Studio 的豆包语音工作台。");
  const [speechRate, setSpeechRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [audioFormat, setAudioFormat] = useState<"mp3" | "wav">("mp3");
  const [speechResult, setSpeechResult] = useState<SpeechResult | null>(null);
  const [speechHistory, setSpeechHistory] = useState<DoubaoSpeechHistoryItem[]>(initialSpeechHistory);

  const [cookies, setCookies] = useState<DoubaoCookieRecord[]>([]);
  const [cookieStats, setCookieStats] = useState<DoubaoCookieStats | null>(null);
  const [cookieDraft, setCookieDraft] = useState<CookieDraft>(emptyCookieDraft);
  const [usageLimits, setUsageLimits] = useState<Record<string, number>>({});
  const [cookieQuery, setCookieQuery] = useState("");
  const [cookieSort, setCookieSort] = useState<CookieSort>("name");
  const [cookieSortAscending, setCookieSortAscending] = useState(true);
  const [cookieViewMode, setCookieViewMode] = useState<CookieViewMode>(initialCookieViewMode);
  const [selectedCookieIds, setSelectedCookieIds] = useState<Set<string>>(new Set());
  const [expandedCookieId, setExpandedCookieId] = useState("");
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [rotationCount, setRotationCount] = useState(10);
  const [qrSession, setQrSession] = useState<DoubaoQrSession | null>(null);
  const [qrStatus, setQrStatus] = useState<DoubaoQrStatus | null>(null);
  const [qrCookieName, setQrCookieName] = useState("豆包扫码账号");

  const initialServer = useMemo(initialReaderServer, []);
  const [serverIp, setServerIp] = useState(initialServer.ip);
  const [serverPort, setServerPort] = useState(initialServer.port);
  const [books, setBooks] = useState<LegadoBook[]>([]);
  const [selectedBookUrl, setSelectedBookUrl] = useState("");
  const [bookId, setBookId] = useState("");
  const [chapters, setChapters] = useState<LegadoChapter[]>([]);
  const [selectedChapterKeys, setSelectedChapterKeys] = useState<Set<string>>(new Set());
  const [chapterAnchorKey, setChapterAnchorKey] = useState("");
  const [chapterPreview, setChapterPreview] = useState<{ title: string; content: string } | null>(null);
  const [bookCacheProgress, setBookCacheProgress] = useState<BookCacheProgress | null>(null);
  const [useCacheOnly, setUseCacheOnly] = useState(false);
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [prefetchRequestDelay, setPrefetchRequestDelay] = useState(15);
  const [configDelay, setConfigDelay] = useState(5);
  const [configTemplate, setConfigTemplate] = useState<ReaderConfigTemplate>("default");
  const [legadoServiceBase, setLegadoServiceBase] = useState(initialLegadoServiceBase);

  const [tasks, setTasks] = useState<DoubaoPrefetchTask[]>([]);
  const [cachedBooks, setCachedBooks] = useState<DoubaoCachedBook[]>([]);
  const [cacheStats, setCacheStats] = useState<DoubaoCacheStats>({});
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [inspectedCachedBook, setInspectedCachedBook] = useState<DoubaoCachedBook | null>(null);
  const [inspectedCachedChapters, setInspectedCachedChapters] = useState<DoubaoCachedChapter[]>([]);
  const [cacheChapterPreview, setCacheChapterPreview] = useState<{ title: string; content: string; detail?: string } | null>(null);

  const [legacySettings, setLegacySettings] = useState<DoubaoLegacySettings>(defaultLegacySettings);
  const [deviceId, setDeviceId] = useState<DoubaoDeviceId | null>(null);
  const [documents, setDocuments] = useState<DoubaoDocument[]>([]);
  const [documentQuery, setDocumentQuery] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<DoubaoDocument | null>(null);

  const filteredVoices = useMemo(() => {
    const query = voiceQuery.trim().toLocaleLowerCase("zh-CN");
    return voices.filter((voice) => {
      const matchesGender = !voiceGender || voice.gender === voiceGender;
      const haystack = `${voice.name} ${voice.style_id} ${voice.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
      return matchesGender && (!query || haystack.includes(query));
    });
  }, [voiceGender, voiceQuery, voices]);

  const visibleCookies = useMemo(() => {
    const query = cookieQuery.trim().toLocaleLowerCase("zh-CN");
    const filtered = cookies.filter((cookie) => {
      const haystack = `${cookie.name} ${cookie.description || ""}`.toLocaleLowerCase("zh-CN");
      return !query || haystack.includes(query);
    });
    const direction = cookieSortAscending ? 1 : -1;
    return filtered.sort((left, right) => {
      if (cookieSort === "usageCount") return (left.usage.usageCount - right.usage.usageCount) * direction;
      if (cookieSort === "createdAt") {
        return (new Date(left.metadata.createdAt).getTime() - new Date(right.metadata.createdAt).getTime()) * direction;
      }
      return left.name.localeCompare(right.name, "zh-CN") * direction;
    });
  }, [cookieQuery, cookieSort, cookieSortAscending, cookies]);
  const allVisibleCookiesSelected = visibleCookies.length > 0 && visibleCookies.every((cookie) => selectedCookieIds.has(cookie.id));

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.style_id === selectedVoiceId) ?? null,
    [selectedVoiceId, voices]
  );
  const selectedBook = useMemo(
    () => books.find((book) => book.bookUrl === selectedBookUrl) ?? null,
    [books, selectedBookUrl]
  );
  const selectedChapters = useMemo(
    () => chapters.filter((chapter) => selectedChapterKeys.has(chapterKey(chapter))),
    [chapters, selectedChapterKeys]
  );
  const normalizedLegadoServiceBase = useMemo(
    () => normalizeLegadoServiceBase(legadoServiceBase),
    [legadoServiceBase]
  );
  const legadoServiceHost = useMemo(() => {
    if (!normalizedLegadoServiceBase) return "";
    return new URL(normalizedLegadoServiceBase).hostname;
  }, [normalizedLegadoServiceBase]);
  const isLoopbackLegadoService = ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(legadoServiceHost);
  const realtimeConfigUrl = selectedVoiceId && normalizedLegadoServiceBase
    ? getLegadoRealtimeConfigUrl(selectedVoiceId, configDelay, normalizedLegadoServiceBase)
    : "";
  const prefabConfigUrl = normalizedLegadoServiceBase
    ? getLegadoPrefabConfigUrl(normalizedLegadoServiceBase)
    : "";
  const realtimeImportUrl = getLegadoImportUrl(realtimeConfigUrl);
  const prefabImportUrl = getLegadoImportUrl(prefabConfigUrl);

  async function runAction<T>(key: string, action: () => Promise<T>, successMessage?: string): Promise<T | null> {
    setPendingAction(key);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
      return null;
    } finally {
      setPendingAction((current) => (current === key ? null : current));
    }
  }

  async function loadCookieState() {
    const result = await fetchDoubaoCookies();
    setCookies(result.cookies);
    setCookieStats(result.stats);
    setRotationEnabled(result.stats.rotation.usageLimitEnabled);
    setRotationCount(result.stats.rotation.usageCountPerCookie);
    setUsageLimits(Object.fromEntries(result.cookies.map((cookie) => [cookie.id, cookie.limits.customUsageLimit])));
  }

  async function loadOperationalState() {
    const results = await Promise.allSettled([
      fetchDoubaoStatus(),
      fetchDoubaoVoices(),
      fetchDoubaoCookies(),
      fetchDoubaoPrefetchTasks(),
      fetchDoubaoCachedBooks(),
      fetchDoubaoCacheStats(),
      fetchDoubaoLegacySettings(),
      fetchDoubaoDeviceId(),
      fetchDoubaoDocuments()
    ]);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    if (results[1].status === "fulfilled") {
      setVoices(results[1].value);
      setSelectedVoiceId((current) => current || results[1].value[0]?.style_id || "");
    }
    if (results[2].status === "fulfilled") {
      setCookies(results[2].value.cookies);
      setCookieStats(results[2].value.stats);
      setRotationEnabled(results[2].value.stats.rotation.usageLimitEnabled);
      setRotationCount(results[2].value.stats.rotation.usageCountPerCookie);
      setUsageLimits(Object.fromEntries(results[2].value.cookies.map((cookie) => [cookie.id, cookie.limits.customUsageLimit])));
    }
    if (results[3].status === "fulfilled") setTasks(results[3].value);
    if (results[4].status === "fulfilled") setCachedBooks(results[4].value);
    if (results[5].status === "fulfilled") setCacheStats(results[5].value);
    if (results[6].status === "fulfilled") {
      setLegacySettings(results[6].value);
    }
    if (results[7].status === "fulfilled") setDeviceId(results[7].value);
    if (results[8].status === "fulfilled") setDocuments(results[8].value);

    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "部分豆包数据加载失败");
    }
  }

  async function refreshTaskAndCacheState() {
    const [nextTasks, nextBooks, nextStats, nextStatus] = await Promise.all([
      fetchDoubaoPrefetchTasks(),
      fetchDoubaoCachedBooks(),
      fetchDoubaoCacheStats(),
      fetchDoubaoStatus()
    ]);
    setTasks(nextTasks);
    setCachedBooks(nextBooks);
    setCacheStats(nextStats);
    setStatus(nextStatus);
  }

  useEffect(() => {
    document.body.classList.add("doubao-workspace-open");
    return () => document.body.classList.remove("doubao-workspace-open");
  }, []);

  useEffect(() => {
    void loadOperationalState();
    const timer = window.setInterval(() => {
      void Promise.allSettled([fetchDoubaoStatus(), fetchDoubaoPrefetchTasks()]).then(([nextStatus, nextTasks]) => {
        if (nextStatus.status === "fulfilled") setStatus(nextStatus.value);
        if (nextTasks.status === "fulfilled") setTasks(nextTasks.value);
      });
    }, 4_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("opentts-doubao-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("opentts-legado-server", JSON.stringify({ ip: serverIp, port: serverPort }));
  }, [serverIp, serverPort]);

  useEffect(() => {
    window.localStorage.setItem("opentts-legado-service-base", legadoServiceBase);
  }, [legadoServiceBase]);

  useEffect(() => {
    window.localStorage.setItem("opentts-doubao-speech-history", JSON.stringify(speechHistory.slice(0, 50)));
  }, [speechHistory]);

  useEffect(() => {
    window.localStorage.setItem("opentts-doubao-cookie-view", cookieViewMode);
  }, [cookieViewMode]);

  useEffect(() => {
    const availableIds = new Set(cookies.map((cookie) => cookie.id));
    setSelectedCookieIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
    if (expandedCookieId && !availableIds.has(expandedCookieId)) setExpandedCookieId("");
  }, [cookies, expandedCookieId]);

  useEffect(() => {
    if (!qrSession || qrStatus?.status === "confirmed" || qrStatus?.status === "expired") return;
    const poll = async () => {
      try {
        const nextStatus = await pollDoubaoQrLogin(qrSession.sessionId);
        setQrStatus(nextStatus);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "扫码状态检查失败");
      }
    };
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => window.clearInterval(timer);
  }, [qrSession, qrStatus?.status]);

  async function copyText(value: string, label: string) {
    const result = await runAction(`copy-${label}`, async () => {
      if (window.desktopClipboard) {
        await window.desktopClipboard.writeText(value);
      } else {
        await navigator.clipboard.writeText(value);
      }
    }, `${label}已复制`);
    return result;
  }

  async function openLegadoImport(configUrl: string, label: string) {
    const importUrl = getLegadoImportUrl(configUrl);
    if (!importUrl) {
      setError("阅读导入链接无效，请先检查本机朗读服务地址和音色");
      return;
    }
    await runAction(`import-${label}`, async () => {
      if (window.desktopExternal?.openLegadoImport) {
        await window.desktopExternal.openLegadoImport(importUrl);
      } else {
        window.location.assign(importUrl);
      }
    }, `已请求阅读导入${label}配置`);
  }

  async function onTestReaderConfig(configUrl: string, label: string) {
    if (!configUrl) {
      setError("配置链接无效，请先完成服务地址和音色设置");
      return;
    }
    const result = await runAction(`test-config-${label}`, () => testLegadoTtsConfig(configUrl));
    if (result) setMessage(`${label}配置可用：${result.name}`);
  }

  function applyReaderConfigTemplate(template: ReaderConfigTemplate) {
    setConfigTemplate(template);
    const delay = readerConfigTemplates.find((item) => item.id === template)?.delay;
    if (delay !== null && delay !== undefined) setConfigDelay(delay);
  }

  function selectChaptersToEnd() {
    if (!chapters.length) return;
    const selectedIndexes = chapters
      .map((chapter, index) => (selectedChapterKeys.has(chapterKey(chapter)) ? index : -1))
      .filter((index) => index >= 0);
    const anchorIndex = Math.max(
      0,
      chapters.findIndex((chapter) => chapterKey(chapter) === chapterAnchorKey),
      selectedIndexes.length ? Math.min(...selectedIndexes) : 0
    );
    setSelectedChapterKeys(new Set(chapters.slice(anchorIndex).map(chapterKey)));
    setChapterAnchorKey(chapterKey(chapters[anchorIndex]));
  }

  async function onGenerateSpeech() {
    if (!ttsText.trim() || !selectedVoiceId) return;
    const result = await runAction(
      "generate",
      () =>
        generateDoubaoSpeech({
          input: ttsText.trim(),
          voice: selectedVoiceId,
          speed: Math.max(0.25, Math.min(4, 1 + speechRate / 50)),
          pitch,
          responseFormat: audioFormat
        }),
      "语音生成完成"
    );
    if (result) {
      setSpeechResult(result);
      setSpeechHistory((current) => [
        {
          id: globalThis.crypto?.randomUUID?.() || `speech-${Date.now()}`,
          createdAt: new Date().toISOString(),
          text: ttsText.trim(),
          voiceId: selectedVoiceId,
          voiceName: selectedVoice?.name || selectedVoiceId,
          speed: speechRate,
          pitch,
          format: audioFormat,
          result
        },
        ...current
      ].slice(0, 50));
      const nextStatus = await fetchDoubaoStatus().catch(() => null);
      if (nextStatus) setStatus(nextStatus);
      await loadCookieState().catch(() => undefined);
    }
  }

  async function onDeleteSpeechHistory(item: DoubaoSpeechHistoryItem) {
    const filename = outputFilename(item.result.file_path);
    const deleted = await runAction(
      `speech-history-delete-${item.id}`,
      async () => {
        if (filename) await deleteDoubaoAudio(filename).catch(() => ({ deleted: false }));
      },
      "历史音频已删除"
    );
    if (deleted !== null) {
      setSpeechHistory((current) => current.filter((entry) => entry.id !== item.id));
      if (speechResult?.file_path === item.result.file_path) setSpeechResult(null);
    }
  }

  async function onClearSpeechHistory() {
    const cleared = await runAction("speech-history-clear", async () => {
      for (const item of speechHistory) {
        const filename = outputFilename(item.result.file_path);
        if (filename) await deleteDoubaoAudio(filename).catch(() => ({ deleted: false }));
      }
    }, "豆包合成历史已清空");
    if (cleared !== null) {
      setSpeechHistory([]);
      setSpeechResult(null);
    }
  }

  async function onStartQrLogin() {
    const result = await runAction("qr-start", startDoubaoQrLogin, "二维码已生成，请使用豆包 App 扫描");
    if (result) {
      setQrSession(result);
      setQrStatus({ status: "pending", message: "等待扫描二维码" });
    }
  }

  async function onConfirmQrLogin() {
    if (!qrSession || !qrCookieName.trim()) return;
    const result = await runAction(
      "qr-confirm",
      () => confirmDoubaoQrLogin(qrSession.sessionId, qrCookieName.trim()),
      "扫码账号已加密保存"
    );
    if (result) {
      setQrSession(null);
      setQrStatus(null);
      await loadCookieState();
      setStatus(await fetchDoubaoStatus());
    }
  }

  async function onSaveCookie() {
    if (!cookieDraft.name.trim() || !cookieDraft.value.trim()) {
      setError("Cookie 名称和值不能为空");
      return;
    }
    const editing = Boolean(cookieDraft.id);
    const result = await runAction(
      editing ? `cookie-save-${cookieDraft.id}` : "cookie-create",
      () =>
        cookieDraft.id
          ? updateDoubaoCookie(cookieDraft.id, {
              name: cookieDraft.name.trim(),
              value: cookieDraft.value.trim(),
              description: cookieDraft.description.trim()
            })
          : createDoubaoCookie({
              name: cookieDraft.name.trim(),
              value: cookieDraft.value.trim(),
              description: cookieDraft.description.trim()
            }),
      editing ? "Cookie 已更新" : "Cookie 已加密保存"
    );
    if (result) {
      setCookieDraft(emptyCookieDraft);
      await loadCookieState();
      setStatus(await fetchDoubaoStatus());
    }
  }

  async function onEditCookie(cookieId: string) {
    const record = await runAction(`cookie-edit-${cookieId}`, () => fetchDoubaoCookie(cookieId, true));
    if (record) {
      setCookieDraft({ id: record.id, name: record.name, value: record.value || "", description: record.description || "" });
    }
  }

  async function onCookieAction(key: string, action: () => Promise<unknown>, successMessage: string) {
    const result = await runAction(key, action, successMessage);
    if (result !== null) {
      await loadCookieState();
      const nextStatus = await fetchDoubaoStatus().catch(() => null);
      if (nextStatus) setStatus(nextStatus);
    }
  }

  async function onBatchTestCookies(ids: Set<string>) {
    const indexes = cookies
      .map((cookie, index) => (ids.has(cookie.id) ? index : -1))
      .filter((index) => index >= 0);
    if (!indexes.length) return;
    await onCookieAction(
      "cookies-batch-test",
      () => testAllDoubaoCookies(indexes),
      `已完成 ${indexes.length} 个账号的验证`
    );
  }

  async function onBatchDeleteCookies() {
    const ids = [...selectedCookieIds];
    if (!ids.length) return;
    await onCookieAction(
      "cookies-batch-delete",
      async () => {
        for (const id of ids) await deleteDoubaoCookie(id);
      },
      `已删除 ${ids.length} 个账号`
    );
    setSelectedCookieIds(new Set());
  }

  async function onLoadBooks() {
    if (!serverIp.trim() || !Number.isInteger(serverPort) || serverPort <= 0) {
      setError("请填写有效的阅读 Web 服务地址和端口");
      return;
    }
    const result = await runAction("load-books", () => fetchLegadoBooks(serverIp.trim(), serverPort), "书架连接成功");
    if (!result) return;
    setBooks(result);
    setChapters([]);
    setSelectedChapterKeys(new Set());
    setChapterAnchorKey("");
    setSelectedBookUrl("");
    setBookId("");
    if (result[0]) await onSelectBook(result[0]);
  }

  async function onSelectBook(book: LegadoBook) {
    setSelectedBookUrl(book.bookUrl);
    setChapterPreview(null);
    setBookCacheProgress(null);
    const result = await runAction(
      `load-chapters-${book.bookUrl}`,
      async () => {
        const [nextChapters, idResult] = await Promise.all([
          fetchLegadoChapters(serverIp.trim(), serverPort, book.bookUrl),
          generateLegadoBookId(book.bookUrl)
        ]);
        return { nextChapters, bookId: idResult.bookId };
      },
      `已加载《${bookName(book)}》目录`
    );
    if (result) {
      setChapters(result.nextChapters);
      setBookId(result.bookId);
      setSelectedChapterKeys(new Set());
      setChapterAnchorKey("");
    }
  }

  async function onPreviewChapter(chapter: LegadoChapter) {
    if (!selectedBook) return;
    const result = await runAction(
      `preview-${chapterKey(chapter)}`,
      () => fetchLegadoChapterContent(serverIp.trim(), serverPort, selectedBook.bookUrl, chapterIndex(chapter))
    );
    if (result !== null) setChapterPreview({ title: chapterTitle(chapter), content: extractChapterContent(result) });
  }

  async function onStartPrefetch() {
    if (!selectedBook || !bookId || !selectedVoiceId || selectedChapters.length === 0) {
      setError("请选择书籍、音色和至少一个章节");
      return;
    }
    const result = await runAction(
      "prefetch-start",
      () =>
        startDoubaoPrefetch({
          bookInfo: { bookId, bookName: bookName(selectedBook), bookUrl: selectedBook.bookUrl },
          chaptersInfo: selectedChapters.map((chapter) => ({
            chapterId: String(chapter.chapterUrl || chapter.url || chapterIndex(chapter)),
            chapterTitle: chapterTitle(chapter),
            chapterUrl: String(chapter.chapterUrl || chapter.url || ""),
            chapterIndex: chapterIndex(chapter)
          })),
          options: {
            voiceId: selectedVoiceId,
            speed: speechRate,
            pitch,
            serverIp: serverIp.trim(),
            serverPort,
            useCacheOnly,
            forceRegenerate,
            requestDelay: prefetchRequestDelay
          }
        }),
      `已创建 ${selectedChapters.length} 章预制任务`
    );
    if (result) {
      setTab("cache");
      await refreshTaskAndCacheState();
    }
  }

  async function onCacheSelectedBook() {
    if (!selectedBook) return;
    const progressUrl = new URL("/api/legado/book-cache/progress", getApiBase());
    progressUrl.searchParams.set("bookUrl", selectedBook.bookUrl);
    const stream = new EventSource(progressUrl.toString());
    setBookCacheProgress({ current: 0, total: 0, cached: 0, skipped: 0, failed: 0, chapter: "", percent: 0, status: "starting" });
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Partial<BookCacheProgress>;
        if (!payload || typeof payload !== "object" || !payload.status) return;
        setBookCacheProgress({
          current: Number(payload.current || 0),
          total: Number(payload.total || 0),
          cached: Number(payload.cached || 0),
          skipped: Number(payload.skipped || 0),
          failed: Number(payload.failed || 0),
          chapter: String(payload.chapter || ""),
          percent: Math.max(0, Math.min(100, Number(payload.percent || 0))),
          status: String(payload.status),
          error: payload.error ? String(payload.error) : undefined
        });
      } catch {
        // Ignore malformed progress events and keep the cache request running.
      }
    };
    try {
      const result = await runAction(
        "cache-book",
        () => startLegadoBookCache({ ...selectedBook, name: bookName(selectedBook) }, serverIp.trim(), serverPort),
        "整本正文缓存完成"
      );
      if (result) await refreshTaskAndCacheState();
    } finally {
      stream.close();
    }
  }

  async function onTaskAction(key: string, action: () => Promise<unknown>, successMessage: string) {
    const result = await runAction(key, action, successMessage);
    if (result !== null) await refreshTaskAndCacheState();
  }

  async function onInspectCachedBook(book: DoubaoCachedBook) {
    const identifier = cachedBookIdentifier(book);
    if (!identifier) return;
    const chapters = await runAction(
      `cache-inspect-${identifier}-${book.source || "all"}`,
      () => fetchDoubaoCachedChapters(identifier, book.source),
      `已加载《${bookName(book)}》缓存明细`
    );
    if (chapters) {
      setInspectedCachedBook(book);
      setInspectedCachedChapters(chapters);
      setCacheChapterPreview(null);
    }
  }

  async function onInspectCachedChapter(book: DoubaoCachedBook, chapter: DoubaoCachedChapter) {
    const identifier = cachedBookIdentifier(book);
    if (!identifier) return;
    if (book.source === "prefetch") {
      const chapterId = String(chapter.chapterId || chapter.url || chapter.index);
      const detail = await runAction(
        `cache-chapter-${identifier}-${chapterId}`,
        () => fetchDoubaoPrefetchCacheDetail(identifier, chapterId)
      );
      if (detail?.index) {
        const metadata = detail.index.metadata;
        setCacheChapterPreview({
          title: chapter.title,
          content: detail.index.content || detail.index.segments?.map((segment) => segment.text || "").filter(Boolean).join("\n") || "暂无正文索引",
          detail: `${metadata?.completedSegments || 0}/${metadata?.totalSegments || 0} 段 · ${metadata?.status || "未知状态"}`
        });
      }
      return;
    }
    const detail = await runAction(
      `cache-chapter-${identifier}-${chapter.index}`,
      () => fetchDoubaoCachedChapter(identifier, chapter.index)
    );
    if (detail) {
      setCacheChapterPreview({ title: chapter.title, content: extractChapterContent(detail), detail: "正文缓存" });
    }
  }

  async function onInspectTaskChapter(task: DoubaoPrefetchTask, chapterId: string, title: string) {
    const detail = await runAction(
      `task-chapter-detail-${task.taskId}-${chapterId}`,
      () => fetchDoubaoPrefetchCacheDetail(task.bookInfo.bookId, chapterId)
    );
    if (detail?.index) {
      setCacheChapterPreview({
        title,
        content: detail.index.content || detail.index.segments?.map((segment) => segment.text || "").filter(Boolean).join("\n") || "暂无正文索引",
        detail: `${detail.index.metadata?.completedSegments || 0}/${detail.index.metadata?.totalSegments || 0} 段 · ${detail.index.metadata?.status || "未知状态"}`
      });
    }
  }

  async function onDeletePrefetchChapter(bookId: string, chapterId: string) {
    const result = await runAction(
      `prefetch-chapter-delete-${bookId}-${chapterId}`,
      () => deleteDoubaoPrefetchChapter(bookId, chapterId),
      "章节预制音频已删除"
    );
    if (result !== null) {
      setInspectedCachedChapters((current) => current.filter((chapter) => String(chapter.chapterId || chapter.url || chapter.index) !== chapterId));
      setCacheChapterPreview(null);
      await refreshTaskAndCacheState();
    }
  }

  async function onSaveLegacySettings() {
    const result = await runAction(
      "legacy-settings-save",
      () => saveDoubaoLegacySettings(legacySettings),
      "豆包运行参数已保存"
    );
    if (result) {
      setLegacySettings(result);
    }
  }

  async function onSearchDocuments() {
    const result = await runAction("docs-search", () => fetchDoubaoDocuments(documentQuery));
    if (result) setDocuments(result);
  }

  async function onOpenDocument(documentId: string) {
    const result = await runAction(`doc-${documentId}`, () => fetchDoubaoDocument(documentId));
    if (result) setSelectedDocument(result);
  }

  const online = status?.service.status === "running";
  const usableCookieCount = cookieStats?.valid ?? status?.cookies.valid ?? 0;

  return (
    <section className="doubaoWorkspace" data-theme={theme} aria-label="豆包与阅读工作台">
      <header className="doubaoWorkspaceHeader">
        <div className="doubaoBrand">
          <span className="doubaoBrandIcon"><Cloud size={21} strokeWidth={1.9} /></span>
          <div>
            <strong>豆包与阅读</strong>
            <span>Doubao Web · maintained adapter</span>
          </div>
        </div>

        <nav className="doubaoTabs" aria-label="豆包工作台导航">
          <button className={tab === "synthesis" ? "active" : ""} onClick={() => setTab("synthesis")}>
            <Wand2 size={16} /><span>语音合成</span>
          </button>
          <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>
            <KeyRound size={16} /><span>登录与账号</span>
          </button>
          <button className={tab === "reader" ? "active" : ""} onClick={() => setTab("reader")}>
            <BookOpen size={16} /><span>阅读预制</span>
          </button>
          <button className={tab === "cache" ? "active" : ""} onClick={() => setTab("cache")}>
            <Database size={16} /><span>任务与缓存</span>
          </button>
          <button className={tab === "maintenance" ? "active" : ""} onClick={() => setTab("maintenance")}>
            <Settings2 size={16} /><span>维护</span>
          </button>
        </nav>

        <div className="doubaoHeaderActions">
          <span className={`doubaoHealth ${online ? "online" : "offline"}`}>
            <span />{online ? `${usableCookieCount} 个账号可用` : "后端未就绪"}
          </span>
          <button
            className="doubaoIconButton"
            title={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="doubaoIconButton" title="刷新" onClick={() => void runAction("refresh", loadOperationalState, "状态已刷新") }>
            {pendingAction === "refresh" ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
          <button className="doubaoIconButton close" title="返回主工作台" onClick={onClose}><X size={20} /></button>
        </div>
      </header>

      {(error || message) && (
        <div className={`doubaoFeedback ${error ? "error" : "success"}`} role="status">
          {error ? <Activity size={16} /> : <CheckCircle2 size={16} />}
          <span>{error || message}</span>
          <button onClick={() => { setError(null); setMessage(null); }} aria-label="关闭提示"><X size={15} /></button>
        </div>
      )}

      <main className="doubaoWorkspaceBody">
        {tab === "synthesis" && (
          <div className="doubaoSynthesisLayout">
            <section className="doubaoPanel doubaoComposer">
              <div className="doubaoSectionHeading">
                <div><Sparkles size={18} /><span><strong>文本转语音</strong><small>使用豆包网页端内部 WebSocket，不需要火山引擎密钥</small></span></div>
                <span className="doubaoProviderBadge">doubao-web</span>
              </div>
              <label className="doubaoField doubaoTextField">
                <span>待合成文本 <em>{ttsText.length} 字</em></span>
                <textarea value={ttsText} maxLength={5000} onChange={(event) => setTtsText(event.target.value)} />
              </label>
              <div className="doubaoParameterGrid">
                <label className="doubaoField">
                  <span>语速 <output>{speechRate > 0 ? `+${speechRate}` : speechRate}</output></span>
                  <input type="range" min={-50} max={100} value={speechRate} onChange={(event) => setSpeechRate(Number(event.target.value))} />
                  <small>-50 慢速 · 0 自然 · 100 快速</small>
                </label>
                <label className="doubaoField">
                  <span>音调 <output>{pitch > 0 ? `+${pitch}` : pitch}</output></span>
                  <input type="range" min={-12} max={12} value={pitch} onChange={(event) => setPitch(Number(event.target.value))} />
                  <small>-12 低沉 · 0 原声 · 12 高亮</small>
                </label>
              </div>
              <div className="doubaoComposerFooter">
                <div className="doubaoFormatSwitch" aria-label="输出格式">
                  {(["mp3", "wav"] as const).map((format) => (
                    <button key={format} className={audioFormat === format ? "active" : ""} onClick={() => setAudioFormat(format)}>{format.toUpperCase()}</button>
                  ))}
                </div>
                <button
                  className="doubaoPrimaryButton"
                  disabled={!ttsText.trim() || !selectedVoiceId || pendingAction === "generate" || usableCookieCount === 0}
                  onClick={() => void onGenerateSpeech()}
                >
                  {pendingAction === "generate" ? <Loader2 className="spin" size={17} /> : <Volume2 size={17} />}
                  <span>{pendingAction === "generate" ? "正在生成" : "生成语音"}</span>
                </button>
              </div>
              {usableCookieCount === 0 && (
                <button className="doubaoInlineNotice" onClick={() => setTab("accounts")}>
                  <KeyRound size={16} /><span>需要先扫码登录或添加一个有效 Cookie</span>
                </button>
              )}
              {speechResult && (
                <div className="doubaoAudioResult">
                  <span className="doubaoAudioGlyph"><Play size={19} fill="currentColor" /></span>
                  <div>
                    <strong>{selectedVoice?.name || "豆包音色"}</strong>
                    <span>{audioFormat.toUpperCase()} · {speechResult.sample_rate} Hz · 已保存到输出目录</span>
                    <audio controls src={toAudioUrl(speechResult.audio_url)} />
                  </div>
                  <button className="doubaoSecondaryButton" onClick={() => void window.desktopFiles?.openPath(speechResult.file_path)}>
                    <HardDrive size={15} /><span>打开文件</span>
                  </button>
                </div>
              )}
              <section className="doubaoSpeechHistory">
                <div className="doubaoSpeechHistoryHeading">
                  <span><strong>合成历史</strong><small>保留最近 50 条</small></span>
                  {speechHistory.length > 0 && <button onClick={() => { if (window.confirm("确定清空豆包合成历史和对应音频文件吗？")) void onClearSpeechHistory(); }}><Trash2 size={13} />清空</button>}
                </div>
                <div className="doubaoSpeechHistoryList">
                  {speechHistory.map((item) => (
                    <article key={item.id} className={speechResult?.file_path === item.result.file_path ? "active" : ""}>
                      <button className="doubaoSpeechHistoryMain" onClick={() => { setSpeechResult(item.result); setSelectedVoiceId(item.voiceId); }}>
                        <Play size={13} fill="currentColor" />
                        <span><strong>{item.voiceName}</strong><small>{item.text}</small></span>
                      </button>
                      <span>{item.format.toUpperCase()} · {formatDate(item.createdAt)}</span>
                      <button className="doubaoSpeechHistoryDelete" title="删除历史与音频" onClick={() => { if (window.confirm("确定删除这条历史和音频文件吗？")) void onDeleteSpeechHistory(item); }}><Trash2 size={13} /></button>
                    </article>
                  ))}
                  {!speechHistory.length && <div className="doubaoEmptyState small"><Volume2 size={20} /><span>生成后的音频会出现在这里</span></div>}
                </div>
              </section>
            </section>

            <aside className="doubaoPanel doubaoVoiceBrowser">
              <div className="doubaoSectionHeading compact">
                <div><Library size={18} /><span><strong>豆包音色</strong><small>{filteredVoices.length} / {voices.length} 个</small></span></div>
              </div>
              <div className="doubaoVoiceFilters">
                <label><Search size={15} /><input value={voiceQuery} placeholder="搜索名称或标签" onChange={(event) => setVoiceQuery(event.target.value)} /></label>
                <select value={voiceGender} onChange={(event) => setVoiceGender(event.target.value)}>
                  <option value="">全部性别</option><option value="女">女声</option><option value="男">男声</option>
                </select>
              </div>
              <div className="doubaoVoiceList">
                {filteredVoices.map((voice) => (
                  <button
                    key={voice.style_id}
                    className={selectedVoiceId === voice.style_id ? "doubaoVoiceItem active" : "doubaoVoiceItem"}
                    onClick={() => setSelectedVoiceId(voice.style_id)}
                  >
                    <span className={`doubaoVoiceAvatar ${voice.gender === "女" ? "female" : "male"}`}>{voice.name.slice(0, 1)}</span>
                    <span><strong>{voice.name}</strong><small>{voice.gender} · {voice.age} · {voice.tags.join(" / ")}</small></span>
                    {selectedVoiceId === voice.style_id && <CheckCircle2 size={17} />}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}

        {tab === "accounts" && (
          <div className="doubaoAccountsLayout">
            <section className="doubaoPanel doubaoQrPanel">
              <div className="doubaoSectionHeading">
                <div><LogIn size={18} /><span><strong>扫码登录豆包</strong><small>Cookie 只保存到本机，并由 Windows DPAPI 加密</small></span></div>
              </div>
              <div className="doubaoQrBody">
                {qrSession ? (
                  <>
                    <div className="doubaoQrImage"><img src={qrSession.qrCodeImg} alt="豆包登录二维码" /></div>
                    <div className="doubaoQrSteps">
                      <span className={`doubaoQrState ${qrStatus?.status || "pending"}`}><Wifi size={16} />{qrStatus?.message || "等待扫描"}</span>
                      <ol><li>打开豆包 App 扫描二维码</li><li>在手机端确认登录</li><li>确认后将账号加密保存</li></ol>
                      {qrStatus?.status === "confirmed" && (
                        <label className="doubaoField"><span>账号名称</span><input value={qrCookieName} maxLength={100} onChange={(event) => setQrCookieName(event.target.value)} /></label>
                      )}
                      <div className="doubaoButtonRow">
                        {qrStatus?.status === "confirmed" ? (
                          <button className="doubaoPrimaryButton" disabled={!qrCookieName.trim() || pendingAction === "qr-confirm"} onClick={() => void onConfirmQrLogin()}>
                            {pendingAction === "qr-confirm" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}<span>保存账号</span>
                          </button>
                        ) : (
                          <button className="doubaoSecondaryButton" onClick={() => void onStartQrLogin()}><RefreshCw size={15} /><span>刷新二维码</span></button>
                        )}
                        <button className="doubaoGhostButton" onClick={() => { setQrSession(null); setQrStatus(null); }}>取消</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="doubaoQrEmpty">
                    <span><KeyRound size={29} /></span>
                    <strong>免手工复制 Cookie</strong>
                    <p>扫码确认后，后端直接接收登录凭据并加密落盘，页面不会显示 Cookie 明文。</p>
                    <button className="doubaoPrimaryButton" disabled={pendingAction === "qr-start"} onClick={() => void onStartQrLogin()}>
                      {pendingAction === "qr-start" ? <Loader2 className="spin" size={17} /> : <LogIn size={17} />}<span>生成登录二维码</span>
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="doubaoPanel doubaoCookieEditor">
              <div className="doubaoSectionHeading compact">
                <div><Plus size={18} /><span><strong>{cookieDraft.id ? "编辑 Cookie" : "手工添加 Cookie"}</strong><small>适合扫码被上游拦截时使用</small></span></div>
              </div>
              <div className="doubaoFormGrid">
                <label className="doubaoField"><span>名称</span><input value={cookieDraft.name} maxLength={100} placeholder="例如：主账号" onChange={(event) => setCookieDraft((draft) => ({ ...draft, name: event.target.value }))} /></label>
                <label className="doubaoField"><span>备注</span><input value={cookieDraft.description} maxLength={500} placeholder="可选" onChange={(event) => setCookieDraft((draft) => ({ ...draft, description: event.target.value }))} /></label>
                <label className="doubaoField wide"><span>Cookie 请求头</span><textarea value={cookieDraft.value} maxLength={10000} placeholder="sessionid=...; s_v_web_id=..." onChange={(event) => setCookieDraft((draft) => ({ ...draft, value: event.target.value }))} /></label>
              </div>
              <div className="doubaoButtonRow end">
                {cookieDraft.id && <button className="doubaoGhostButton" onClick={() => setCookieDraft(emptyCookieDraft)}>取消编辑</button>}
                <button className="doubaoPrimaryButton" disabled={!cookieDraft.name.trim() || !cookieDraft.value.trim() || pendingAction?.startsWith("cookie-save") || pendingAction === "cookie-create"} onClick={() => void onSaveCookie()}>
                  {pendingAction?.startsWith("cookie-save") || pendingAction === "cookie-create" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}<span>{cookieDraft.id ? "保存修改" : "加密保存"}</span>
                </button>
              </div>
            </section>

            <section className="doubaoPanel doubaoCookiePool">
              <div className="doubaoSectionHeading">
                <div><CookieIcon size={18} /><span><strong>Cookie 池</strong><small>{cookieStats?.valid || 0} 可用 · {cookieStats?.totalRequests || 0} 次请求</small></span></div>
                <div className="doubaoButtonRow">
                  <button className="doubaoSecondaryButton" disabled={!cookies.length || pendingAction === "cookies-test-all"} onClick={() => void onCookieAction("cookies-test-all", () => testAllDoubaoCookies(cookies.map((_cookie, index) => index)), "全部账号验证完成")}>
                    {pendingAction === "cookies-test-all" ? <Loader2 className="spin" size={15} /> : <Activity size={15} />}<span>全部验证</span>
                  </button>
                  <button className="doubaoSecondaryButton" disabled={!cookies.length} onClick={() => void onCookieAction("cookie-rotate", () => rotateDoubaoCookie(), "已切换到下一个账号")}><RotateCw size={15} /><span>轮换</span></button>
                </div>
              </div>
              <div className="doubaoRotationBar">
                <label className="doubaoCheck"><input type="checkbox" checked={rotationEnabled} onChange={(event) => setRotationEnabled(event.target.checked)} /><span>按使用次数自动轮换</span></label>
                <label><span>每个账号</span><input type="number" min={1} max={1000} value={rotationCount} onChange={(event) => setRotationCount(Number(event.target.value))} /><span>次</span></label>
                <button className="doubaoSecondaryButton" onClick={() => void onCookieAction("rotation-save", () => configureDoubaoCookieRotation({ usageLimitEnabled: rotationEnabled, usageCountPerCookie: rotationCount }), "轮换策略已保存")}><SlidersHorizontal size={15} /><span>保存策略</span></button>
              </div>
              <div className="doubaoCookieToolbar">
                <label className="doubaoCheck"><input type="checkbox" checked={allVisibleCookiesSelected} onChange={(event) => setSelectedCookieIds((current) => { const next = new Set(current); for (const cookie of visibleCookies) event.target.checked ? next.add(cookie.id) : next.delete(cookie.id); return next; })} /><span>多选 {selectedCookieIds.size ? `(${selectedCookieIds.size})` : ""}</span></label>
                <label className="doubaoCookieSearch"><Search size={14} /><input value={cookieQuery} placeholder="搜索名称或备注" onChange={(event) => setCookieQuery(event.target.value)} /></label>
                <select value={cookieSort} onChange={(event) => setCookieSort(event.target.value as CookieSort)}><option value="name">按名称</option><option value="usageCount">按使用次数</option><option value="createdAt">按创建时间</option></select>
                <button title="切换排序方向" onClick={() => setCookieSortAscending((current) => !current)}><SlidersHorizontal size={14} />{cookieSortAscending ? "升序" : "降序"}</button>
                <button title="切换卡片/列表视图" onClick={() => setCookieViewMode((current) => current === "grid" ? "list" : "grid")}><Library size={14} />{cookieViewMode === "grid" ? "列表" : "卡片"}</button>
              </div>
              {selectedCookieIds.size > 0 && (
                <div className="doubaoCookieBatchBar">
                  <span>已选择 {selectedCookieIds.size} 个账号</span>
                  <button disabled={pendingAction === "cookies-batch-test"} onClick={() => void onBatchTestCookies(selectedCookieIds)}><Activity size={14} />批量验证</button>
                  <button className="danger" disabled={pendingAction === "cookies-batch-delete"} onClick={() => { if (window.confirm(`确定删除选中的 ${selectedCookieIds.size} 个账号吗？`)) void onBatchDeleteCookies(); }}><Trash2 size={14} />批量删除</button>
                </div>
              )}
              <div className={`doubaoCookieList ${cookieViewMode}`}>
                {visibleCookies.length ? visibleCookies.map((cookie) => (
                  <article key={cookie.id} className={`doubaoCookieCard ${cookie.status.isActive ? "active" : ""} ${cookie.status.isDisabled ? "disabled" : ""}`}>
                    <div className="doubaoCookieHeader">
                      <label className="doubaoCookieSelect" title="选择账号"><input type="checkbox" checked={selectedCookieIds.has(cookie.id)} onChange={(event) => setSelectedCookieIds((current) => { const next = new Set(current); event.target.checked ? next.add(cookie.id) : next.delete(cookie.id); return next; })} /></label>
                      <span className="doubaoCookieIcon"><CookieIcon size={18} /></span>
                      <div><strong>{cookie.name}</strong><small>{cookie.valuePreview || "已加密"} · {cookie.description || "无备注"}</small></div>
                      <span className={`doubaoStatusPill ${cookie.status.isDisabled ? "disabled" : cookie.status.isValid ? "ready" : "failed"}`}>
                        {cookie.status.isDisabled ? "已停用" : cookie.status.isActive ? "当前使用" : cookie.status.isValid ? "可用" : "无效"}
                      </span>
                    </div>
                    <div className="doubaoCookieMetrics">
                      <span><em>调用</em><strong>{cookie.usage.usageCount}</strong></span>
                      <span><em>成功</em><strong>{cookie.usage.successCount}</strong></span>
                      <span><em>失败</em><strong>{cookie.usage.failureCount}</strong></span>
                      <span><em>验证</em><strong>{formatDate(cookie.status.lastValidated)}</strong></span>
                    </div>
                    {cookie.status.lastError && <div className="doubaoCardError">{cookie.status.lastError}</div>}
                    {expandedCookieId === cookie.id && (
                      <div className="doubaoCookieDetail">
                        <span><em>创建</em><strong>{formatDate(cookie.metadata.createdAt)}</strong></span>
                        <span><em>更新</em><strong>{formatDate(cookie.metadata.updatedAt)}</strong></span>
                        <span><em>最近使用</em><strong>{formatDate(cookie.usage.lastUsed)}</strong></span>
                        <span><em>分钟上限</em><strong>{cookie.limits.maxRequestsPerMinute}</strong></span>
                        <span><em>优先级 / 权重</em><strong>{cookie.metadata.priority} / {cookie.metadata.weight}</strong></span>
                        <span><em>总上限</em><strong>{cookie.limits.customUsageLimit || "不限"}</strong></span>
                      </div>
                    )}
                    <div className="doubaoCookieActions">
                      <button onClick={() => void onCookieAction(`activate-${cookie.id}`, () => rotateDoubaoCookie(cookie.id), "已切换当前账号")} disabled={cookie.status.isDisabled || cookie.status.isActive}>设为当前</button>
                      <button onClick={() => void onCookieAction(`test-${cookie.id}`, () => testDoubaoCookie(cookie.id), "账号验证完成")}>验证</button>
                      <button onClick={() => void onEditCookie(cookie.id)}>编辑</button>
                      <button onClick={() => setExpandedCookieId((current) => current === cookie.id ? "" : cookie.id)}>{expandedCookieId === cookie.id ? "收起详情" : "详情"}</button>
                      <button onClick={() => void onCookieAction(`toggle-${cookie.id}`, () => toggleDoubaoCookie(cookie.id), cookie.status.isDisabled ? "账号已启用" : "账号已停用")}>{cookie.status.isDisabled ? "启用" : "停用"}</button>
                      <label className="doubaoLimitInput"><span>总限制</span><input type="number" min={0} max={10000} value={usageLimits[cookie.id] ?? 0} onChange={(event) => setUsageLimits((values) => ({ ...values, [cookie.id]: Number(event.target.value) }))} /><button onClick={() => void onCookieAction(`limit-${cookie.id}`, () => setDoubaoCookieUsageLimit(cookie.id, usageLimits[cookie.id] ?? 0), "账号总限制已保存")}>保存</button></label>
                      <button className="danger" onClick={() => { if (window.confirm(`确定删除“${cookie.name}”吗？`)) void onCookieAction(`delete-${cookie.id}`, () => deleteDoubaoCookie(cookie.id), "账号已删除"); }}><Trash2 size={14} />删除</button>
                    </div>
                  </article>
                )) : (
                  <div className="doubaoEmptyState"><CookieIcon size={26} /><strong>{cookies.length ? "没有匹配账号" : "还没有账号"}</strong><span>{cookies.length ? "换一个搜索词试试" : "扫码登录或在上方手工添加 Cookie"}</span></div>
                )}
              </div>
              {cookies.length > 0 && <button className="doubaoDangerLink" onClick={() => { if (window.confirm("确定清空全部豆包 Cookie 吗？")) void onCookieAction("cookies-clear", clearDoubaoCookies, "全部 Cookie 已清空"); }}><Trash2 size={14} />清空全部 Cookie</button>}
            </section>
          </div>
        )}

        {tab === "reader" && (
          <div className="doubaoReaderLayout">
            <aside className="doubaoPanel doubaoReaderSidebar">
              <div className="doubaoSectionHeading compact"><div><Wifi size={18} /><span><strong>阅读 Web 服务</strong><small>连接 Legado 书架</small></span></div></div>
              <div className="doubaoServerForm">
                <label className="doubaoField"><span>服务器地址</span><input value={serverIp} onChange={(event) => setServerIp(event.target.value)} /></label>
                <label className="doubaoField"><span>端口</span><input type="number" min={1} max={65535} value={serverPort} onChange={(event) => setServerPort(Number(event.target.value))} /></label>
                <button className="doubaoPrimaryButton" disabled={pendingAction === "load-books"} onClick={() => void onLoadBooks()}>
                  {pendingAction === "load-books" ? <Loader2 className="spin" size={16} /> : <Wifi size={16} />}<span>连接并读取书架</span>
                </button>
              </div>
              <div className="doubaoBookList">
                {books.map((book) => (
                  <button key={book.bookUrl} className={selectedBookUrl === book.bookUrl ? "active" : ""} onClick={() => void onSelectBook(book)}>
                    <span className="doubaoBookCover"><BookOpen size={18} /></span>
                    <span><strong>{bookName(book)}</strong><small>{String(book.author || "作者未知")} · {book.totalChapters ?? "?"} 章</small></span>
                  </button>
                ))}
                {!books.length && <div className="doubaoEmptyState small"><BookOpen size={23} /><span>连接阅读后显示书架</span></div>}
              </div>
            </aside>

            <section className="doubaoPanel doubaoChapterWorkspace">
              <div className="doubaoSectionHeading">
                <div><BookOpen size={18} /><span><strong>{bookName(selectedBook)}</strong><small>{selectedBook ? `${chapters.length} 章 · 本地 ID ${bookId || "生成中"}` : "从左侧选择书籍"}</small></span></div>
                {selectedBook && (
                  <div className="doubaoButtonRow">
                    <button className="doubaoSecondaryButton" disabled={pendingAction === "cache-book"} onClick={() => void onCacheSelectedBook()}>
                      {pendingAction === "cache-book" ? <Loader2 className="spin" size={15} /> : <HardDrive size={15} />}<span>缓存整本正文</span>
                    </button>
                    {pendingAction === "cache-book" && <button className="doubaoGhostButton" onClick={() => void runAction("cache-cancel", () => cancelLegadoBookCache(selectedBook.bookUrl), "已发送取消请求")}>取消缓存</button>}
                  </div>
                )}
              </div>
              {bookCacheProgress && (
                <section className={`doubaoBookCacheProgress ${bookCacheProgress.status}`}>
                  <div className="doubaoBookCacheProgressHeading">
                    <span><strong>{bookCacheProgress.status === "starting" ? "正在准备正文缓存" : bookCacheProgress.status === "cancelling" ? "正在取消缓存" : bookCacheProgress.status === "completed" ? "正文缓存完成" : bookCacheProgress.status === "partial" ? "正文缓存部分完成" : bookCacheProgress.status === "cancelled" ? "正文缓存已取消" : "正在缓存正文"}</strong><small>{bookCacheProgress.chapter || bookName(selectedBook)}</small></span>
                    <strong>{bookCacheProgress.percent}%</strong>
                  </div>
                  <div className="doubaoProgress"><span style={{ width: `${bookCacheProgress.percent}%` }} /></div>
                  <div className="doubaoBookCacheProgressMeta"><span>{bookCacheProgress.current} / {bookCacheProgress.total || "?"} 章</span><span>新增 {bookCacheProgress.cached}</span><span>跳过 {bookCacheProgress.skipped}</span><span>失败 {bookCacheProgress.failed}</span></div>
                  {bookCacheProgress.error && <div className="doubaoCardError">{bookCacheProgress.error}</div>}
                </section>
              )}
              {selectedBook ? (
                <>
                  <div className="doubaoChapterToolbar">
                    <label className="doubaoCheck"><input type="checkbox" checked={chapters.length > 0 && selectedChapterKeys.size === chapters.length} onChange={(event) => { setSelectedChapterKeys(event.target.checked ? new Set(chapters.map(chapterKey)) : new Set()); setChapterAnchorKey(event.target.checked && chapters[0] ? chapterKey(chapters[0]) : ""); }} /><span>全选 {chapters.length} 章</span></label>
                    <div className="doubaoChapterBatchActions">
                      <span>已选 {selectedChapterKeys.size} 章</span>
                      <button disabled={!chapters.length} onClick={selectChaptersToEnd}>选至末尾</button>
                      <button disabled={!selectedChapterKeys.size} onClick={() => { setSelectedChapterKeys(new Set()); setChapterAnchorKey(""); }}>清空</button>
                    </div>
                  </div>
                  <div className="doubaoChapterList">
                    {chapters.map((chapter) => {
                      const key = chapterKey(chapter);
                      return (
                        <article key={key} className={selectedChapterKeys.has(key) ? "selected" : ""}>
                          <label><input type="checkbox" checked={selectedChapterKeys.has(key)} onChange={() => { setChapterAnchorKey(key); setSelectedChapterKeys((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }} /><span>{chapterIndex(chapter) + 1}</span><strong>{chapterTitle(chapter)}</strong></label>
                          <button onClick={() => void onPreviewChapter(chapter)}>预览正文</button>
                        </article>
                      );
                    })}
                  </div>
                  <div className="doubaoPrefetchBar">
                    <div>
                      <strong>批量预制音频</strong>
                      <span>{selectedVoice?.name || "请选择音色"} · 语速 {speechRate} · 音调 {pitch}</span>
                    </div>
                    <label className="doubaoCheck"><input type="checkbox" checked={useCacheOnly} onChange={(event) => setUseCacheOnly(event.target.checked)} /><span>仅使用本地正文</span></label>
                    <label className="doubaoCheck"><input type="checkbox" checked={forceRegenerate} onChange={(event) => setForceRegenerate(event.target.checked)} /><span>覆盖已有音频</span></label>
                    <label className="doubaoCompactNumber"><span>轮询延迟</span><input type="number" min={0} max={60} value={prefetchRequestDelay} onChange={(event) => setPrefetchRequestDelay(Number(event.target.value))} /><span>秒</span></label>
                    <button className="doubaoPrimaryButton" disabled={!selectedChapters.length || !selectedVoiceId || pendingAction === "prefetch-start"} onClick={() => void onStartPrefetch()}>
                      {pendingAction === "prefetch-start" ? <Loader2 className="spin" size={16} /> : <Volume2 size={16} />}<span>预制 {selectedChapters.length} 章</span>
                    </button>
                  </div>
                </>
              ) : <div className="doubaoEmptyState fill"><BookOpen size={30} /><strong>选择一本书开始</strong><span>可缓存正文、预览章节并批量预制音频</span></div>}
            </section>

            <aside className="doubaoReaderRight">
              <section className="doubaoPanel doubaoConfigCard">
                <div className="doubaoSectionHeading compact"><div><Clipboard size={18} /><span><strong>阅读朗读配置</strong><small>复制链接到“网络导入”</small></span></div></div>
                <label className="doubaoField">
                  <span>本机朗读服务地址</span>
                  <input
                    value={legadoServiceBase}
                    onChange={(event) => setLegadoServiceBase(event.target.value)}
                    placeholder="http://192.168.1.20:8765"
                    aria-invalid={!normalizedLegadoServiceBase}
                  />
                  <small>手机导入时填写电脑的局域网地址；API 监听地址需设为 0.0.0.0 并重启。</small>
                </label>
                <div className="doubaoConfigTemplates" aria-label="实时配置模板">
                  {readerConfigTemplates.map((template) => (
                    <button key={template.id} className={configTemplate === template.id ? "active" : ""} onClick={() => applyReaderConfigTemplate(template.id)}>{template.label}</button>
                  ))}
                </div>
                <label className="doubaoField"><span>实时模式延迟（秒）</span><input type="number" min={0} max={60} value={configDelay} onChange={(event) => { setConfigDelay(Number(event.target.value)); setConfigTemplate("custom"); }} /></label>
                <div className="doubaoConfigLink">
                  <span><strong>实时模式</strong><code>{realtimeConfigUrl || "先选择音色"}</code></span>
                  <div>
                    <button title="测试配置" disabled={!realtimeConfigUrl || pendingAction === "test-config-实时"} onClick={() => void onTestReaderConfig(realtimeConfigUrl, "实时")}><Activity size={15} /></button>
                    <button title="复制配置链接" disabled={!realtimeConfigUrl} onClick={() => void copyText(realtimeConfigUrl, "实时配置链接")}><Clipboard size={15} /></button>
                    <button title="一键导入到阅读" disabled={!realtimeImportUrl} onClick={() => void openLegadoImport(realtimeConfigUrl, "实时")}><BookOpen size={15} /></button>
                  </div>
                </div>
                <div className="doubaoConfigLink">
                  <span><strong>预制模式</strong><code>{prefabConfigUrl || "服务地址无效"}</code></span>
                  <div>
                    <button title="测试配置" disabled={!prefabConfigUrl || pendingAction === "test-config-预制"} onClick={() => void onTestReaderConfig(prefabConfigUrl, "预制")}><Activity size={15} /></button>
                    <button title="复制配置链接" disabled={!prefabConfigUrl} onClick={() => void copyText(prefabConfigUrl, "预制配置链接")}><Clipboard size={15} /></button>
                    <button title="一键导入到阅读" disabled={!prefabImportUrl} onClick={() => void openLegadoImport(prefabConfigUrl, "预制")}><BookOpen size={15} /></button>
                  </div>
                </div>
                {!normalizedLegadoServiceBase && <p className="doubaoCardError">请输入有效的 HTTP/HTTPS 服务地址，例如 http://192.168.1.20:8765。</p>}
                {normalizedLegadoServiceBase && isLoopbackLegadoService && <p className="doubaoCardWarning">当前地址只能供本机使用；手机请改为电脑的局域网 IP，不能填写 127.0.0.1 或 0.0.0.0。</p>}
                <p>实时模式缺少 Cookie 时会返回静音，预制模式只读取本地缓存，适合稳定连续朗读。</p>
              </section>
              <section className="doubaoPanel doubaoPreviewCard">
                <div className="doubaoSectionHeading compact"><div><FileText size={18} /><span><strong>章节预览</strong><small>{chapterPreview?.title || "尚未选择"}</small></span></div></div>
                <div className="doubaoPreviewContent">{chapterPreview?.content || "点击章节右侧的“预览正文”查看内容。"}</div>
              </section>
            </aside>
          </div>
        )}

        {tab === "cache" && (
          <div className="doubaoCacheLayout">
            <section className="doubaoCacheSummary">
              <article><span><Activity size={18} /></span><div><strong>{tasks.filter((task) => task.status === "processing").length}</strong><small>运行中任务</small></div></article>
              <article><span><CheckCircle2 size={18} /></span><div><strong>{tasks.filter((task) => task.status === "completed").length}</strong><small>已完成任务</small></div></article>
              <article><span><BookOpen size={18} /></span><div><strong>{Number(cacheStats.totalBooks || cachedBooks.length)}</strong><small>正文缓存书籍</small></div></article>
              <article><span><HardDrive size={18} /></span><div><strong>{formatBytes(Number(cacheStats.totalSize || cacheStats.cacheSize || 0))}</strong><small>正文缓存体积</small></div></article>
            </section>

            <section className="doubaoPanel doubaoTaskPanel">
              <div className="doubaoSectionHeading"><div><Gauge size={18} /><span><strong>预制任务</strong><small>任务状态会每 4 秒自动更新</small></span></div><button className="doubaoSecondaryButton" onClick={() => void runAction("task-refresh", refreshTaskAndCacheState, "任务状态已刷新")}><RefreshCw size={15} /><span>刷新</span></button></div>
              <div className="doubaoTaskList">
                {tasks.map((task) => {
                  const progress = prefetchProgress(task);
                  return (
                    <article key={task.taskId} className={`doubaoTaskCard ${task.status}`}>
                      <div className="doubaoTaskHeader"><div><strong>{bookName(task.bookInfo)}</strong><span>{task.taskId}</span></div><span className={`doubaoStatusPill ${task.status}`}>{taskStatusLabel(task.status)}</span></div>
                      <div className="doubaoProgress"><span style={{ width: `${progress.percent}%` }} /></div>
                      <div className="doubaoTaskMeta"><span>{progress.completed} / {progress.total} 章</span><span>{progress.failed ? `${progress.failed} 章失败` : "无失败章节"}</span><span>{formatDate(task.updatedAt)}</span></div>
                      {task.chapters?.find((chapter) => chapter.error)?.error && <div className="doubaoCardError">{task.chapters.find((chapter) => chapter.error)?.error}</div>}
                      <div className="doubaoTaskActions">
                        <button onClick={() => { setExpandedTaskId((current) => current === task.taskId ? "" : task.taskId); setCacheChapterPreview(null); }}><FileText size={14} />{expandedTaskId === task.taskId ? "收起章节" : "章节明细"}</button>
                        {task.status === "processing" && <button onClick={() => void onTaskAction(`pause-${task.taskId}`, () => pauseDoubaoPrefetch(task.taskId), "任务已暂停")}><Pause size={14} />暂停</button>}
                        {(["paused", "cancelled", "partial", "failed"] as string[]).includes(task.status) && <button onClick={() => void onTaskAction(`resume-${task.taskId}`, () => resumeDoubaoPrefetch(task.taskId), "任务已恢复")}><Play size={14} />恢复</button>}
                        {(["processing", "paused"] as string[]).includes(task.status) && <button onClick={() => void onTaskAction(`cancel-${task.taskId}`, () => cancelDoubaoPrefetch(task.taskId), "任务已取消，已生成内容保留")}><X size={14} />取消</button>}
                        {(["partial", "failed", "paused"] as string[]).includes(task.status) && <button onClick={() => void onTaskAction(`retry-${task.taskId}`, () => retryDoubaoPrefetch(task.taskId), "失败章节已重新排队")}><RotateCw size={14} />重试</button>}
                        <button onClick={() => void onTaskAction(`files-${task.taskId}`, () => deleteDoubaoPrefetchFiles(task.taskId), "任务音频文件已清理")}><HardDrive size={14} />清理文件</button>
                        <button className="danger" onClick={() => { if (window.confirm("确定删除这条预制任务记录吗？")) void onTaskAction(`remove-${task.taskId}`, () => deleteDoubaoPrefetchTask(task.taskId), "任务记录已删除"); }}><Trash2 size={14} />删除</button>
                      </div>
                      {expandedTaskId === task.taskId && (
                        <div className="doubaoTaskChapterDetails">
                          {(task.chapters || []).map((chapter, chapterPosition) => (
                            <article key={`${task.taskId}-${chapter.chapterId || chapterPosition}`} className={`doubaoTaskChapter ${chapter.status}`}>
                              <div className="doubaoTaskChapterHeading">
                                <span>{Number.isFinite(chapter.chapterIndex) ? Number(chapter.chapterIndex) + 1 : chapterPosition + 1}</span>
                                <div><strong>{chapter.chapterTitle || `第 ${chapterPosition + 1} 章`}</strong><small>{chapter.completedSegments || 0} / {chapter.totalSegments || 0} 段</small></div>
                                <span className={`doubaoStatusPill ${chapter.status}`}>{taskStatusLabel(chapter.status)}</span>
                              </div>
                              {chapter.error && <p className="doubaoTaskChapterError">{chapter.error}</p>}
                              <div className="doubaoTaskChapterActions">
                                <button onClick={() => void onInspectTaskChapter(task, chapter.chapterId, chapter.chapterTitle)}><FileText size={13} />查看索引</button>
                                <button disabled={chapter.status === "completed" || chapter.status === "processing"} onClick={() => void onTaskAction(`retry-${task.taskId}-${chapter.chapterId}`, () => retryDoubaoPrefetch(task.taskId, chapter.chapterId), "本章已重新排队")}><RotateCw size={13} />重试本章</button>
                                <button className="danger" onClick={() => { if (window.confirm(`确定删除“${chapter.chapterTitle}”的预制音频吗？`)) void onDeletePrefetchChapter(task.bookInfo.bookId, chapter.chapterId); }}><Trash2 size={13} />删除音频</button>
                              </div>
                            </article>
                          ))}
                          {!task.chapters?.length && <div className="doubaoEmptyState small"><FileText size={20} /><span>此任务没有章节明细</span></div>}
                          {cacheChapterPreview && (
                            <article className="doubaoCacheChapterPreview">
                              <header><div><strong>{cacheChapterPreview.title}</strong><small>{cacheChapterPreview.detail}</small></div><button className="doubaoIconButton" title="关闭预览" onClick={() => setCacheChapterPreview(null)}><X size={14} /></button></header>
                              <pre>{cacheChapterPreview.content}</pre>
                            </article>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!tasks.length && <div className="doubaoEmptyState fill"><Gauge size={27} /><strong>暂无预制任务</strong><span>从“阅读预制”选择章节后创建任务</span></div>}
              </div>
            </section>

            <section className="doubaoPanel doubaoCacheBooksPanel">
              <div className="doubaoSectionHeading"><div><Database size={18} /><span><strong>书籍缓存</strong><small>正文缓存和预制音频统一管理</small></span></div><div className="doubaoButtonRow"><button className="doubaoSecondaryButton" onClick={() => { if (window.confirm("确定清空全部正文和预制缓存吗？")) void onTaskAction("cache-clear-all", () => clearDoubaoBookCache("all"), "全部豆包缓存已清空"); }}><Trash2 size={15} /><span>清空全部</span></button></div></div>
              <div className="doubaoCachedBookGrid">
                {cachedBooks.map((book, index) => {
                  const identifier = cachedBookIdentifier(book);
                  const isInspected = Boolean(inspectedCachedBook && cachedBookIdentifier(inspectedCachedBook) === identifier && inspectedCachedBook.source === book.source);
                  return (
                    <article key={`${identifier}-${book.source || index}`} className={isInspected ? "selected" : ""}>
                      <span className="doubaoBookCover large"><BookOpen size={21} /></span>
                      <div><strong>{bookName(book)}</strong><small>{book.source === "prefetch" ? "预制音频" : "正文缓存"} · {book.cachedChapters ?? book.totalChapters ?? "?"} 章</small><span>{formatBytes(Number(book.totalSize || book.size || 0))} · {formatDate(book.updatedAt || book.cachedAt)}</span></div>
                      <div className="doubaoCachedBookActions">
                        <button className="doubaoIconButton" title="查看缓存章节" disabled={!identifier} onClick={() => void onInspectCachedBook(book)}><FileText size={16} /></button>
                        <button className="doubaoIconButton danger" title="删除书籍缓存" disabled={!identifier} onClick={() => { if (window.confirm(`确定删除《${bookName(book)}》的缓存吗？`)) void onTaskAction(`cache-delete-${identifier}`, () => deleteDoubaoCachedBook(identifier), "书籍缓存已删除").then(() => { if (isInspected) { setInspectedCachedBook(null); setInspectedCachedChapters([]); setCacheChapterPreview(null); } }); }}><Trash2 size={16} /></button>
                      </div>
                    </article>
                  );
                })}
                {!cachedBooks.length && <div className="doubaoEmptyState"><Database size={26} /><strong>缓存为空</strong><span>缓存正文或完成预制后会显示在这里</span></div>}
              </div>
              {inspectedCachedBook && (
                <section className="doubaoCacheInspector">
                  <header>
                    <div><strong>《{bookName(inspectedCachedBook)}》章节明细</strong><small>{inspectedCachedBook.source === "prefetch" ? "预制音频索引" : "阅读正文缓存"} · {inspectedCachedChapters.length} 章</small></div>
                    <button className="doubaoIconButton" title="关闭明细" onClick={() => { setInspectedCachedBook(null); setInspectedCachedChapters([]); setCacheChapterPreview(null); }}><X size={15} /></button>
                  </header>
                  <div className="doubaoCacheInspectorBody">
                    <div className="doubaoCacheChapterList">
                      {inspectedCachedChapters.map((chapter, chapterPosition) => {
                        const chapterId = String(chapter.chapterId || chapter.url || chapter.index);
                        return (
                          <article key={`${chapterId}-${chapter.index}`}>
                            <span>{Number.isFinite(chapter.index) ? chapter.index + 1 : chapterPosition + 1}</span>
                            <div><strong>{chapter.title}</strong><small>{inspectedCachedBook.source === "prefetch" ? `章节 ID：${chapterId}` : "正文已缓存"}</small></div>
                            <div>
                              <button title={inspectedCachedBook.source === "prefetch" ? "查看预制索引" : "查看正文"} onClick={() => void onInspectCachedChapter(inspectedCachedBook, chapter)}><FileText size={14} /></button>
                              {inspectedCachedBook.source === "prefetch" && <button className="danger" title="删除本章预制音频" onClick={() => { if (window.confirm(`确定删除“${chapter.title}”的预制音频吗？`)) void onDeletePrefetchChapter(cachedBookIdentifier(inspectedCachedBook), chapterId); }}><Trash2 size={14} /></button>}
                            </div>
                          </article>
                        );
                      })}
                      {!inspectedCachedChapters.length && <div className="doubaoEmptyState small"><Database size={20} /><span>没有可显示的章节</span></div>}
                    </div>
                    <article className="doubaoCacheChapterPreview standalone">
                      {cacheChapterPreview ? <><header><div><strong>{cacheChapterPreview.title}</strong><small>{cacheChapterPreview.detail}</small></div><button className="doubaoIconButton" title="关闭预览" onClick={() => setCacheChapterPreview(null)}><X size={14} /></button></header><pre>{cacheChapterPreview.content}</pre></> : <div className="doubaoEmptyState fill"><FileText size={24} /><strong>选择一个章节</strong><span>正文或预制索引会显示在这里</span></div>}
                    </article>
                  </div>
                </section>
              )}
            </section>
          </div>
        )}

        {tab === "maintenance" && (
          <div className="doubaoMaintenanceLayout">
            <section className="doubaoPanel doubaoRuntimeSettings">
              <div className="doubaoSectionHeading"><div><SlidersHorizontal size={18} /><span><strong>豆包运行参数</strong><small>保存后新任务立即使用</small></span></div></div>
              <div className="doubaoSettingsGrid">
                <label className="doubaoField"><span>阅读请求延迟</span><input type="number" min={0} max={60} value={legacySettings.tts.requestDelay} onChange={(event) => setLegacySettings((settings) => ({ ...settings, tts: { ...settings.tts, requestDelay: Number(event.target.value) } }))} /><small>生成阅读实时配置时使用，单位秒</small></label>
                <label className="doubaoField"><span>预制段落间隔</span><input type="number" min={0} max={60} step={0.5} value={legacySettings.tts.requestIntervalDelay} onChange={(event) => setLegacySettings((settings) => ({ ...settings, tts: { ...settings.tts, requestIntervalDelay: Number(event.target.value) } }))} /><small>降低连续请求触发风控的概率</small></label>
                <label className="doubaoField"><span>失败重试次数</span><input type="number" min={0} max={5} value={legacySettings.tts.maxRetries} onChange={(event) => setLegacySettings((settings) => ({ ...settings, tts: { ...settings.tts, maxRetries: Number(event.target.value) } }))} /><small>单次合成最多额外重试 5 次</small></label>
                <label className="doubaoField"><span>正文缓存并发</span><input type="number" min={1} max={50} value={legacySettings.prefetch.cacheConcurrent} onChange={(event) => setLegacySettings((settings) => ({ ...settings, prefetch: { ...settings.prefetch, cacheConcurrent: Number(event.target.value) } }))} /><small>只影响从阅读服务拉取正文</small></label>
              </div>
              <div className="doubaoButtonRow end">
                <button className="doubaoSecondaryButton" onClick={() => void runAction("legacy-reset", resetDoubaoLegacySettings, "已恢复默认参数").then((result) => { if (result) setLegacySettings(result); })}><RefreshCw size={15} /><span>恢复默认</span></button>
                <button className="doubaoPrimaryButton" disabled={pendingAction === "legacy-settings-save"} onClick={() => void onSaveLegacySettings()}>{pendingAction === "legacy-settings-save" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}<span>保存参数</span></button>
              </div>
            </section>

            <section className="doubaoPanel doubaoDeviceCard">
              <div className="doubaoSectionHeading compact"><div><ShieldCheck size={18} /><span><strong>豆包设备标识</strong><small>WebSocket 请求身份的一部分</small></span></div></div>
              {deviceId ? (
                <div className="doubaoDeviceValues">
                  <label><span>Device ID</span><code>{deviceId.deviceId}</code><button onClick={() => void copyText(deviceId.deviceId, "Device ID")}><Clipboard size={14} /></button></label>
                  <label><span>Web ID</span><code>{deviceId.webId}</code><button onClick={() => void copyText(deviceId.webId, "Web ID")}><Clipboard size={14} /></button></label>
                  <label className="doubaoCheck"><input type="checkbox" checked={deviceId.autoGenerate} onChange={(event) => void runAction("device-auto", () => setDoubaoDeviceIdAutoGenerate(event.target.checked), "设备 ID 策略已更新").then((result) => { if (result) setDeviceId(result); })} /><span>每次请求自动生成新设备 ID</span></label>
                  <button className="doubaoSecondaryButton" onClick={() => void runAction("device-regenerate", regenerateDoubaoDeviceId, "设备 ID 已重新生成").then((result) => { if (result) setDeviceId(result); })}><RotateCw size={15} /><span>立即重新生成</span></button>
                </div>
              ) : <div className="doubaoEmptyState small"><Loader2 className="spin" size={22} /><span>正在读取设备标识</span></div>}
            </section>

            <section className="doubaoPanel doubaoDocsPanel">
              <div className="doubaoSectionHeading"><div><FileText size={18} /><span><strong>本地维护文档</strong><small>不加载上游远程公告或可执行内容</small></span></div></div>
              <div className="doubaoDocsToolbar"><label><Search size={15} /><input value={documentQuery} placeholder="搜索文档名称或正文" onChange={(event) => setDocumentQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onSearchDocuments(); }} /></label><button className="doubaoSecondaryButton" onClick={() => void onSearchDocuments()}><Search size={15} /><span>搜索</span></button></div>
              <div className="doubaoDocsLayout">
                <div className="doubaoDocList">
                  {documents.map((document) => <button key={document.id} className={selectedDocument?.id === document.id ? "active" : ""} onClick={() => void onOpenDocument(document.id)}><FileText size={16} /><span><strong>{document.name}</strong><small>{document.path} · {formatBytes(document.size)}</small></span></button>)}
                </div>
                <article className="doubaoDocContent">
                  {selectedDocument ? <><header><strong>{selectedDocument.name}</strong><span>{selectedDocument.path}</span></header><pre>{selectedDocument.content}</pre></> : <div className="doubaoEmptyState fill"><FileText size={26} /><strong>选择文档阅读</strong><span>维护说明来自当前项目本地文件</span></div>}
                </article>
              </div>
            </section>

            <section className="doubaoPanel doubaoSafetyCard">
              <div className="doubaoSectionHeading compact"><div><ShieldCheck size={18} /><span><strong>维护版安全边界</strong><small>已替换上游高风险自更新链路</small></span></div></div>
              <ul><li>Cookie 使用 Windows DPAPI 加密，不写明文配置。</li><li>远程公告与远程文档已改为本地只读内容。</li><li>不支持上传 ZIP 覆盖正在运行的程序，更新由 Electron 安全流程负责。</li><li>豆包网页接口未提供稳定性承诺，协议变更集中在独立适配层维护。</li></ul>
              <button className="doubaoSecondaryButton" onClick={() => void runAction("clean-logs", cleanDoubaoLogCache, "任务日志缓存已清理")}><Trash2 size={15} /><span>清理任务日志缓存</span></button>
            </section>
          </div>
        )}
      </main>
    </section>
  );
}
