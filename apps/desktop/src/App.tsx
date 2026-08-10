import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Cpu,
  Download,
  FileText,
  Film,
  FolderOpen,
  Gauge,
  Library,
  Link2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Maximize2,
  Mic2,
  Minus,
  Info,
  Pause,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Radio,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Moon,
  Sun,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  Waves,
  Wifi,
  X
} from "lucide-react";
import QRCode from "qrcode";
import { CSSProperties, ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { ConfirmationDialog, type ConfirmationRequest } from "./ConfirmationDialog";

import {
  activateVoiceReference,
  activateModelPackage,
  cancelBatchProject,
  cancelSpeechJob,
  checkModelInstance,
  clearSpeechJobHistory,
  createSpeechJob,
  createVoiceReference,
  createVoice,
  createBatchProject,
  deleteAudioAsset,
  deleteBatchProjectSegmentHistory,
  deleteSpeechJobHistoryRecord,
  deleteVoice,
  deleteVoiceReference,
  exportVoicePackage,
  fetchAppSettings,
  fetchAudioAssets,
  fetchBatchProjects,
  fetchModelInstances,
  fetchModelPackages,
  fetchModels,
  fetchSpeechJob,
  fetchSystemStatus,
  fetchTaskSummaries,
  fetchVoiceQuality,
  fetchVoices,
  exportSettingsBackup,
  fetchDoubaoStatus,
  fetchDoubaoVoices,
  fetchDoubaoPrefetchTasks,
  fetchDoubaoPrefetchTaskSummary,
  getApiBase,
  importSettingsBackup,
  importVoicePackage,
  inspectModelPackage,
  prewarmRealtimeRuntime,
  polishVoicePrompt,
  pauseDoubaoPrefetch,
  resumeDoubaoPrefetch,
  cancelDoubaoPrefetch,
  retryDoubaoPrefetch,
  registerModelPackage,
  releaseRealtimeRuntime,
  reserveRealtimeRuntime,
  retryBatchProject,
  retrySpeechJob,
  recognizeVoiceReferenceClip,
  repairVoiceAudio,
  runBatchProject,
  resumeBatchProject,
  saveAppSettings,
  testLlmConnection,
  transformLlmText,
  startModelRuntime,
  stopModelRuntime,
  toAudioUrl,
  updateBatchProject,
  updateModelPackage,
  updateModelInstance,
  updateVoice,
  updateVoiceReference,
  type GenerateSpeechOptions
} from "./api";
import { DoubaoWorkspace } from "./DoubaoWorkspace";
import { EnhancementWorkspace } from "./EnhancementWorkspace";
import { MediaSamplerWorkspace } from "./MediaSamplerWorkspace";
import { SeparationWorkspace } from "./SeparationWorkspace";
import { RealtimeWorkspace } from "./RealtimeWorkspace";
import { TranscriptionWorkspace } from "./TranscriptionWorkspace";
import voiceAvatarPack from "./assets/voice-avatar-pack.jpg";
import type {
  AudioAsset,
  AppUpdateState,
  AppSettings,
  BatchProject,
  BatchProjectCreate,
  BilibiliAudioOptionsResult,
  BilibiliDownloadVideoRequest,
  BilibiliDownloadVideoResult,
  BilibiliExtractLocalSampleResult,
  BilibiliExtractSampleRequest,
  BilibiliExtractSampleResult,
  BilibiliLoginQrPayload,
  BilibiliLoginSession,
  BilibiliMediaHistoryEntry,
  BilibiliMediaHistoryItem,
  BilibiliParsedItem,
  BilibiliParsedLink,
  BilibiliPollLoginPayload,
  BilibiliSamplerState,
  BilibiliVideoQuality,
  DoubaoStatus,
  DoubaoVoice,
  DoubaoPrefetchTask,
  DoubaoPrefetchTaskSummary,
  ModelDirectory,
  ModelHealthResult,
  ModelInfo,
  ModelInstanceProfile,
  ModelPackageRecord,
  QwenRuntimeResolution,
  IpcResponse,
  SpeechResult,
  SpeechJob,
  SettingsBackup,
  SystemStatus,
  TaskResult,
  TaskSummary,
  VoiceInfo,
  VoiceQualityReport,
  WorkerStatus,
  GlobalLlmSettings,
  LlmPolishResult,
  LlmTextTransformResult
} from "./types";

type PrimaryWorkspace = "creation" | "doubao" | "transcription" | "sampler" | "enhancement" | "separation" | "assets";

type TaskCenterResult = TaskResult & {
  task_id: string;
  task_title: string;
  source: string;
  status: string;
  created_at: string;
  asset: AudioAsset | null;
  bilibili_history_id?: string;
  relation: "task" | "orphan" | "history";
  summary_only?: boolean;
};

declare global {
  interface Window {
    desktopWindow?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    desktopBackend?: {
      ensureOnline: () => Promise<{ ready: boolean; status: string; message?: string | null }>;
    };
    desktopLlmSettings?: {
      load: () => Promise<GlobalLlmSettings>;
      save: (settings: GlobalLlmSettings) => Promise<unknown>;
    };
    desktopFiles?: {
      openPath: (targetPath: string) => Promise<string>;
      revealInFolder: (targetPath: string) => Promise<void>;
      selectDirectory: () => Promise<string | null>;
      selectPythonExecutable: () => Promise<string | null>;
      selectModelArchive: () => Promise<string | null>;
      selectReferenceAudio: () => Promise<string | null>;
      selectTranscriptionMedia: () => Promise<{ id: string; fileName: string; fileSizeBytes: number } | null>;
      selectAudioEnhancementMedia: () => Promise<{ id: string; fileName: string; fileSizeBytes: number } | null>;
      selectAudioSeparationMedia: () => Promise<{ id: string; fileName: string; fileSizeBytes: number } | null>;
      saveTranscriptionExport: (content: string, defaultName: string, extension: "txt" | "srt") => Promise<string | null>;
      readSelectedAudio: (targetPath: string) => Promise<Uint8Array>;
      readManagedReferenceAudio: (targetPath: string) => Promise<Uint8Array>;
      selectVoicePackage: () => Promise<string | null>;
      saveVoicePackage: (sourcePath: string, defaultName: string) => Promise<string | null>;
      saveSettingsBackup: (content: string) => Promise<string | null>;
      selectSettingsBackup: () => Promise<{ path: string; content: string } | null>;
    };
    desktopClipboard?: {
      writeText: (content: string) => Promise<void>;
    };
    desktopExternal?: {
      openLegadoImport: (targetUrl: string) => Promise<string>;
    };
    desktopUpdater?: {
      getState: () => Promise<AppUpdateState>;
      check: () => Promise<AppUpdateState>;
      download: () => Promise<AppUpdateState>;
      install: () => Promise<AppUpdateState>;
      onStateChanged: (listener: (state: AppUpdateState) => void) => () => void;
    };
    desktopBilibiliSampler?: {
      getSession: () => Promise<IpcResponse<BilibiliLoginSession>>;
      startLogin: () => Promise<IpcResponse<BilibiliLoginQrPayload>>;
      pollLogin: () => Promise<IpcResponse<BilibiliPollLoginPayload>>;
      logout: () => Promise<IpcResponse>;
      parseLink: (link: string) => Promise<IpcResponse<BilibiliParsedLink>>;
      loadAudioOptions: (kind: BilibiliParsedLink["kind"], itemId: string, qn?: number) => Promise<IpcResponse<BilibiliAudioOptionsResult>>;
      extractSample: (request: BilibiliExtractSampleRequest) => Promise<IpcResponse<BilibiliExtractSampleResult>>;
      downloadVideo: (request: BilibiliDownloadVideoRequest) => Promise<IpcResponse<BilibiliDownloadVideoResult>>;
      listHistory: () => Promise<IpcResponse<BilibiliMediaHistoryEntry[]>>;
      getHistoryItem: (historyId: string) => Promise<IpcResponse<BilibiliMediaHistoryItem>>;
      extractHistorySample: (historyId: string, request: BilibiliExtractSampleRequest) => Promise<IpcResponse<BilibiliExtractLocalSampleResult>>;
      stageTranscription: (historyId: string) => Promise<IpcResponse<{ id: string; fileName: string; fileSizeBytes: number }>>;
      removeHistory: (historyId: string) => Promise<IpcResponse>;
      cancelExtract: () => Promise<IpcResponse>;
      onStateChanged: (listener: (state: BilibiliSamplerState) => void) => () => void;
    };
  }
}

type VoiceReferencePreset = {
  id: string;
  name: string;
  referenceAudio?: string;
  referenceText?: string;
  sourceType?: string;
  sourceUrl?: string;
  referenceAudioManaged?: boolean;
  originalReferenceAudio?: string;
};

type VoicePreset = {
  id: string;
  name: string;
  subtitle: string;
  initials: string;
  background: string;
  referenceAudio?: string;
  referenceText?: string;
  authorizationStatus?: string;
  sourceType?: string;
  sourceUrl?: string;
  referenceAudioManaged?: boolean;
  originalReferenceAudio?: string;
  references: VoiceReferencePreset[];
  activeReferenceId?: string;
  modelBinding?: {
    modelId: string;
    weights: Record<string, string>;
  };
};

type VoiceAvatar =
  | { kind: "pack"; index: number }
  | { kind: "custom"; dataUrl: string };

const VOICE_AVATAR_STORAGE_KEY = "open-tts-studio.voice-avatars";
const VOICE_FAVORITES_STORAGE_KEY = "open-tts-studio.voice-favorites";
const VOICE_AVATAR_COLUMNS = 4;
const VOICE_AVATAR_ROWS = 6;
const VOICE_AVATAR_COUNT = VOICE_AVATAR_COLUMNS * VOICE_AVATAR_ROWS;

function readVoiceAvatars(): Record<string, VoiceAvatar> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(VOICE_AVATAR_STORAGE_KEY) ?? "{}");
    if (!stored || typeof stored !== "object") return {};
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => {
      if (!value || typeof value !== "object") return false;
      const avatar = value as Partial<VoiceAvatar>;
      return avatar.kind === "pack"
        ? Number.isInteger(avatar.index) && Number(avatar.index) >= 0 && Number(avatar.index) < VOICE_AVATAR_COUNT
        : avatar.kind === "custom" && typeof avatar.dataUrl === "string" && avatar.dataUrl.startsWith("data:image/");
    })) as Record<string, VoiceAvatar>;
  } catch {
    return {};
  }
}

function readVoiceFavorites(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(VOICE_FAVORITES_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored)
      ? [...new Set(stored.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}

function voiceAvatarFor(voice: VoicePreset, avatars: Record<string, VoiceAvatar>): VoiceAvatar {
  const saved = avatars[voice.id];
  if (saved) return saved;
  const total = Array.from(voice.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return { kind: "pack", index: total % VOICE_AVATAR_COUNT };
}

function voiceAvatarStyle(voice: VoicePreset, avatars: Record<string, VoiceAvatar>): CSSProperties {
  const avatar = voiceAvatarFor(voice, avatars);
  if (avatar.kind === "custom") {
    return { backgroundImage: `url(${avatar.dataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  }
  const column = avatar.index % VOICE_AVATAR_COLUMNS;
  const row = Math.floor(avatar.index / VOICE_AVATAR_COLUMNS);
  return {
    backgroundImage: `url(${voiceAvatarPack})`,
    backgroundSize: `${VOICE_AVATAR_COLUMNS * 100}% ${VOICE_AVATAR_ROWS * 100}%`,
    backgroundPosition: `${column * (100 / Math.max(1, VOICE_AVATAR_COLUMNS - 1))}% ${row * (100 / Math.max(1, VOICE_AVATAR_ROWS - 1))}%`
  };
}

type VoiceManagerDraft = {
  name: string;
  referenceName: string;
  referenceText: string;
};

type ResultVoiceSaveMode = "create" | "append";

type VoiceLibrarySaveSource = {
  kind: "result" | "asset";
  filePath: string;
  referenceText?: string;
  modelName: string;
  sourceVoiceName: string;
  displayName: string;
  durationSeconds?: number;
  authorizationStatus: string;
  sourceType: string;
};

type ReferenceAudioEditorTarget =
  | { kind: "create" }
  | { kind: "append"; voiceId: string }
  | { kind: "replace"; voiceId: string; referenceId: string }
  | { kind: "trim"; voiceId: string; referenceId: string };

type ReferenceAudioEditorState = {
  sourcePath: string;
  previewUrl: string;
  name: string;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  autoRecognize: boolean;
  target: ReferenceAudioEditorTarget;
};

type WaveformStatus = "idle" | "loading" | "ready" | "unavailable";

type AppTheme = "light" | "dark";
type AccentTheme = "emerald" | "azure" | "violet" | "amber" | "rose";

type ThemeTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> };
};

const APP_THEME_STORAGE_KEY = "open-tts-studio.theme";
const APP_ACCENT_STORAGE_KEY = "open-tts-studio.accent";

const accentThemeOptions: Array<{ id: AccentTheme; label: string; description: string; preview: string }> = [
  { id: "emerald", label: "翡翠绿", description: "克制、清晰", preview: "#4fba6f" },
  { id: "azure", label: "雾霭蓝", description: "冷静、专注", preview: "#3b9fd3" },
  { id: "violet", label: "暮光紫", description: "沉稳、柔和", preview: "#8a72d4" },
  { id: "amber", label: "琥珀橙", description: "温暖、有力", preview: "#d68a36" },
  { id: "rose", label: "蔷薇红", description: "鲜明、克制", preview: "#d6647b" }
];

function readAppTheme(): AppTheme {
  try {
    return window.localStorage.getItem(APP_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function readAccentTheme(): AccentTheme {
  try {
    const storedAccent = window.localStorage.getItem(APP_ACCENT_STORAGE_KEY);
    return accentThemeOptions.some((option) => option.id === storedAccent) ? storedAccent as AccentTheme : "emerald";
  } catch {
    return "emerald";
  }
}

type AudioWaveformProps = {
  peaks: number[];
  status: WaveformStatus;
  theme: AppTheme;
  progressRatio?: number;
  selectionStartRatio?: number;
  selectionEndRatio?: number;
  editableSelection?: boolean;
  onSeekRatio?: (ratio: number) => void;
  onSelectionChange?: (boundary: "start" | "end", ratio: number) => void;
  onSelectionMove?: (startRatio: number, endRatio: number) => void;
  ariaLabel: string;
  className?: string;
};

type DrawCandidate = {
  id: string;
  index: number;
  result: SpeechResult;
  modelName: string;
  voiceName: string;
  input: string;
};

type DrawSession = {
  id: string;
  total: number;
  currentIndex: number;
  successful: number;
  failed: number;
  status: "running" | "stopping" | "completed" | "cancelled";
  activeJobId: string | null;
  cancelRequested: boolean;
  model: string;
  input: string;
  options: GenerateSpeechOptions;
  modelName: string;
  voiceName: string;
  handlingTerminalJob: boolean;
};

const WAVEFORM_SAMPLE_COUNT = 360;
const WAVEFORM_MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;
const VIDEO_WAVEFORM_MAX_ANALYSIS_BYTES = 128 * 1024 * 1024;
const SAMPLER_MIN_CLIP_SECONDS = 0.1;

function clampWaveformRatio(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function buildWaveformPeaks(audioBuffer: AudioBuffer, peakCount = WAVEFORM_SAMPLE_COUNT) {
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  if (channels.length === 0 || audioBuffer.length === 0) {
    return [];
  }
  const bucketSize = Math.max(1, Math.ceil(audioBuffer.length / peakCount));
  const stepSize = Math.max(1, Math.floor(bucketSize / 1800));
  const peaks = Array.from({ length: peakCount }, (_, bucketIndex) => {
    const start = bucketIndex * bucketSize;
    const end = Math.min(audioBuffer.length, start + bucketSize);
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += stepSize) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }
    }
    return peak;
  });
  const largestPeak = Math.max(...peaks, 0);
  return largestPeak > 0 ? peaks.map((peak) => peak / largestPeak) : peaks;
}

async function decodeWaveformPeaks(audioData: ArrayBuffer, maximumBytes = WAVEFORM_MAX_ANALYSIS_BYTES) {
  if (audioData.byteLength > maximumBytes) {
    throw new Error("媒体文件较大，已跳过波形分析");
  }
  if (!window.AudioContext) {
    throw new Error("当前环境不支持音频波形分析");
  }
  const audioContext = new window.AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(audioData.slice(0));
    return buildWaveformPeaks(decoded);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

function AudioWaveform({
  peaks,
  status,
  theme,
  progressRatio = 0,
  selectionStartRatio = 0,
  selectionEndRatio = 1,
  editableSelection = false,
  onSeekRatio,
  onSelectionChange,
  onSelectionMove,
  ariaLabel,
  className
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragBoundaryRef = useRef<"start" | "end" | "selection" | null>(null);
  const dragStartRatioRef = useRef(0);
  const dragSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const selectionMovedRef = useRef(false);
  const startRatio = clampWaveformRatio(selectionStartRatio, 0);
  const endRatio = Math.max(startRatio, clampWaveformRatio(selectionEndRatio, 1));
  const currentRatio = clampWaveformRatio(progressRatio, 0);
  const interactive = Boolean(onSeekRatio || onSelectionChange || onSelectionMove);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let frameId = 0;
    const draw = () => {
      const context = canvas.getContext("2d");
      const bounds = canvas.getBoundingClientRect();
      if (!context || bounds.width <= 0 || bounds.height <= 0) {
        return;
      }
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.floor(bounds.width);
      const height = Math.floor(bounds.height);
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const palette = theme === "dark"
        ? {
            background: "#101923",
            waveform: "rgba(132, 157, 174, 0.44)",
            selectedWaveform: "rgba(99, 201, 139, 0.84)",
            selectionMask: "rgba(2, 8, 13, 0.42)",
            selectionHandle: "rgba(116, 222, 157, 0.94)",
            progress: "rgba(148, 193, 221, 0.9)"
          }
        : {
            background: "rgba(222, 231, 239, 0.68)",
            waveform: "rgba(115, 137, 157, 0.44)",
            selectedWaveform: "rgba(69, 157, 101, 0.82)",
            selectionMask: "rgba(54, 68, 82, 0.15)",
            selectionHandle: "rgba(44, 127, 77, 0.9)",
            progress: "rgba(39, 76, 104, 0.92)"
          };
      context.fillStyle = palette.background;
      context.fillRect(0, 0, width, height);

      const selectedStart = startRatio * width;
      const selectedEnd = endRatio * width;
      if (peaks.length > 0) {
        const barWidth = Math.max(1, width / peaks.length - 1);
        for (let index = 0; index < peaks.length; index += 1) {
          const ratio = index / Math.max(1, peaks.length - 1);
          const x = ratio * width;
          const amplitude = Math.max(0, Math.min(1, peaks[index] ?? 0));
          const barHeight = Math.max(1, amplitude * Math.max(4, height - 12));
          const insideSelection = x >= selectedStart && x <= selectedEnd;
          context.fillStyle = insideSelection ? palette.selectedWaveform : palette.waveform;
          context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
        }
      } else {
        context.fillStyle = palette.waveform;
        context.fillRect(0, Math.floor(height / 2), width, 1);
      }

      if (editableSelection) {
        context.fillStyle = palette.selectionMask;
        context.fillRect(0, 0, selectedStart, height);
        context.fillRect(selectedEnd, 0, Math.max(0, width - selectedEnd), height);
        context.fillStyle = palette.selectionHandle;
        context.fillRect(selectedStart - 1, 0, 2, height);
        context.fillRect(selectedEnd - 1, 0, 2, height);
      }

      if (currentRatio > 0) {
        const currentX = currentRatio * width;
        context.fillStyle = palette.progress;
        context.fillRect(currentX - 1, 0, 2, height);
      }
    };
    const queueDraw = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(draw);
    };
    const resizeObserver = new ResizeObserver(queueDraw);
    resizeObserver.observe(canvas);
    queueDraw();
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [currentRatio, editableSelection, endRatio, peaks, startRatio, theme]);

  const getPointerRatio = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return clampWaveformRatio((event.clientX - bounds.left) / Math.max(1, bounds.width), 0);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!interactive) {
      return;
    }
    const ratio = getPointerRatio(event);
    if (editableSelection && onSelectionChange) {
      const handleThreshold = 0.035;
      if (Math.abs(ratio - startRatio) <= handleThreshold || ratio < startRatio) {
        dragBoundaryRef.current = "start";
        onSelectionChange("start", ratio);
      } else if (Math.abs(ratio - endRatio) <= handleThreshold || ratio > endRatio) {
        dragBoundaryRef.current = "end";
        onSelectionChange("end", ratio);
      } else {
        dragBoundaryRef.current = "selection";
        dragStartRatioRef.current = ratio;
        dragSelectionRef.current = { start: startRatio, end: endRatio };
        selectionMovedRef.current = false;
      }
    } else {
      onSeekRatio?.(ratio);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const boundary = dragBoundaryRef.current;
    if (!boundary) {
      return;
    }
    if (boundary === "selection") {
      const selection = dragSelectionRef.current;
      if (!selection || !onSelectionMove) {
        return;
      }
      const delta = getPointerRatio(event) - dragStartRatioRef.current;
      const width = selection.end - selection.start;
      const nextStart = Math.max(0, Math.min(1 - width, selection.start + delta));
      onSelectionMove(nextStart, nextStart + width);
      if (Math.abs(delta) > 0.002) {
        selectionMovedRef.current = true;
      }
      return;
    }
    if (!onSelectionChange) {
      return;
    }
    onSelectionChange(boundary, getPointerRatio(event));
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragBoundaryRef.current === "selection" && !selectionMovedRef.current) {
      onSeekRatio?.(getPointerRatio(event));
    }
    dragBoundaryRef.current = null;
    dragSelectionRef.current = null;
    selectionMovedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const statusLabel = status === "loading" ? "正在分析真实波形…" : status === "unavailable" ? "此音频无法分析波形" : "";
  return (
    <button
      className={["audioWaveform", className].filter(Boolean).join(" ")}
      type="button"
      disabled={!interactive}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onKeyDown={(event) => {
        if (!onSeekRatio || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
          return;
        }
        event.preventDefault();
        onSeekRatio(clampWaveformRatio(currentRatio + (event.key === "ArrowRight" ? 0.03 : -0.03), 0));
      }}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {statusLabel && <span className="audioWaveformStatus">{statusLabel}</span>}
    </button>
  );
}

type GenerationProgress = {
  percent: number;
  phaseIndex: number;
  phaseTitle: string;
  detail: string;
  estimate: string;
};

type SettingsDraft = {
  api_host: string;
  api_port: number;
  indextts2_root: string;
  indextts2_idle_timeout_seconds: number;
  local_api_idle_timeout_seconds: number;
  asr_backend: "sensevoice" | "qwen3";
  audio_enhancement_python: string;
  audio_enhancement_device: "auto" | "cuda" | "cpu";
  deepfilternet3_root: string;
  mossformer2_se_root: string;
  audio_separation_python: string;
  audio_separation_root: string;
  audio_separation_device: "auto" | "cuda" | "cpu";
  voxcpm2_root: string;
  voxcpm2_api_host: string;
  voxcpm2_api_port: number;
  gptsovits_root: string;
  gptsovits_api_host: string;
  gptsovits_api_port: number;
  default_model_id: "indextts2" | "voxcpm2" | "gptsovits";
  prewarm_default_model_on_startup: boolean;
};

type SettingsSection = "common" | "assets" | "system";

const defaultGlobalLlmSettings: GlobalLlmSettings = {
  enabled: true,
  baseUrl: "",
  model: "",
  apiKey: "",
  systemPrompt: "你是 OpenTTS Studio 的实时中文语音助手。用自然、友好、简洁的口语直接回答。避免 Markdown、标题、列表符号、代码块、表情和括号说明。每次优先一到三句，需要补充时用短句说明；不要复述用户的问题。",
  temperature: 0.7,
  maxTokens: 512
};

type ModelProfileDraft = {
  package_label: string;
  user_note: string;
};

type PendingModelSwitch = {
  targetModelId: string;
  loadedModelIds: string[];
};

type ModelWarmupState = {
  modelId: string;
  status: "waiting" | "warming" | "ready" | "failed";
  message: string;
};

const voxcpm2ParameterHints = {
  cfg: "控制指令的遵从程度。推荐 2.0；低于 1.5 会减弱指令，高于 2.6 可能让音色不稳定。",
  steps: "扩散采样次数。推荐 10；提高步数会更慢，通常不建议超过 16。",
  normalize: "生成前规范化数字、时间等文本。推荐开启；需要保留原始读法时可关闭。",
  denoise: "对参考音频做轻度降噪。推荐关闭；仅在底噪明显时开启，可能损失部分音色细节。"
} as const;

const indexTts2ParameterHints = {
  temperature: "控制采样随机性。推荐 0.8；降低会更稳定，提高会更有变化，但过高可能出现错字或异常韵律。",
  topP: "只从累计概率最高的一组候选中采样。推荐 0.8；降低更保守，提高会增加表达变化。",
  topK: "每一步最多保留的候选数量。推荐 30；降低更稳定，提高会增加多样性。",
  numBeams: "并行比较的候选序列数量。推荐 3；提高可能更稳定，但会明显增加生成时间和显存开销。",
  repetitionPenalty: "抑制重复音节和循环。推荐 10；过低可能重复，过高可能损伤自然度。",
  maxMelTokens: "单段最多生成的音频 Token。推荐 1500；太小会截断，增大只提高长度上限，不等同于生成步数。"
} as const;

const voicePresets: VoicePreset[] = [
  {
    id: "custom",
    name: "导入音色",
    subtitle: "导入",
    initials: "自",
    background: "linear-gradient(135deg, #59616c 0%, #c8cfd6 100%)",
    references: []
  }
];

const cloneModeLabels = ["文本生成", "音色设计", "可控克隆", "极致克隆"] as const;
type CloneMode = (typeof cloneModeLabels)[number];

type ControlPromptPreset = {
  label: string;
  prompt: string;
};

const INDEXTTS2_EMOTION_PRESETS: ControlPromptPreset[] = [
  { label: "跟随原音", prompt: "" },
  { label: "平静", prompt: "平静" },
  { label: "开心", prompt: "开心" },
  { label: "悲伤", prompt: "悲伤" },
  { label: "愤怒", prompt: "愤怒" },
  { label: "惊喜", prompt: "惊喜" },
  { label: "恐惧", prompt: "恐惧" },
  { label: "低落", prompt: "低落" },
  { label: "厌恶", prompt: "厌恶" }
];

const VOXCPM2_VOICE_DESIGN_PRESETS: ControlPromptPreset[] = [
  { label: "温柔女声", prompt: "年轻女性，音色清亮温柔，普通话自然，语速适中，亲切且有感染力。" },
  { label: "沉稳男声", prompt: "成年男性，音色低沉浑厚，表达沉稳可信，吐字清晰，语速稍慢。" },
  { label: "活泼少女", prompt: "年轻少女，声音明亮活泼，带自然笑意，语速稍快，情绪轻快。" },
  { label: "知性旁白", prompt: "成熟女性，知性克制，声音温暖，吐字清晰，纪录片旁白风格。" },
  { label: "故事爷爷", prompt: "年长男性，声音温厚慈祥，节奏舒缓，像在安静地讲睡前故事。" },
  { label: "清冷青年", prompt: "年轻男性，音色清冷干净，表达克制，语速自然，带轻微疏离感。" }
];

const VOXCPM2_CLONE_STYLE_PRESETS: ControlPromptPreset[] = [
  { label: "自然跟随", prompt: "" },
  { label: "温柔平静", prompt: "用温柔、平静的语气表达，语速稍慢，情绪自然克制。" },
  { label: "开心明快", prompt: "用开心、明快的语气表达，带自然笑意，语速稍快。" },
  { label: "严肃坚定", prompt: "用严肃、坚定的语气表达，吐字清晰，停顿有力。" },
  { label: "悲伤克制", prompt: "用悲伤但克制的语气表达，语速稍慢，保留自然停顿。" },
  { label: "轻声耳语", prompt: "用轻柔的耳语感表达，音量较低，语速缓慢，保持自然。" },
  { label: "激昂有力", prompt: "用激昂、有力量的语气表达，节奏明快，重音清晰。" }
];

const featureLabels: Record<string, string> = {
  plain_tts: "文本生成",
  streaming: "流式输出",
  voice_design: "音色设计",
  voice_clone: "音色克隆",
  controllable_clone: "可控克隆",
  extreme_clone: "极致克隆",
  emotion_control: "情绪控制",
  duration_control: "语速控制"
};

const generationPhases = ["连接后端", "加载模型", "推理生成", "整理音频"];

function createDefaultBilibiliSamplerState(): BilibiliSamplerState {
  return {
    loginSession: {
      isLoggedIn: false,
      nickname: null,
      avatarUrl: null,
      expiresAt: null
    },
    parsedLink: null,
    selection: {
      itemId: null,
      qn: null
    },
    audioOptionSummary: null,
    downloadProgress: {
      receivedBytes: 0,
      totalBytes: null,
      percent: null,
      bytesPerSecond: null
    },
    taskStage: "idle",
    error: null
  };
}

function samplerStageLabel(stage: BilibiliSamplerState["taskStage"]) {
  switch (stage) {
    case "parsing":
      return "正在解析";
    case "loading-audio-options":
      return "加载音频流";
    case "downloading-video":
      return "下载视频";
    case "downloading-audio":
      return "下载音频";
    case "converting":
      return "转码切分";
    case "merging":
      return "封装 MP4";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return "等待操作";
  }
}

function formatSamplerItemMeta(item: BilibiliParsedItem | null) {
  if (!item) {
    return "未选择条目";
  }
  if (item.kind === "page") {
    return `分 P ${item.page}`;
  }
  if (item.kind === "episode") {
    return item.epId;
  }
  return item.seasonId;
}

function formatSamplerVideoQuality(quality: BilibiliVideoQuality) {
  const resolution = quality.width && quality.height ? `${quality.width}×${quality.height}` : null;
  return [quality.label, resolution, quality.codec].filter(Boolean).join(" · ");
}

function formatSamplerTransferBytes(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatSamplerTransferRate(value: number | null | undefined) {
  return value && value > 0 ? `${formatSamplerTransferBytes(value)}/s` : "速度计算中";
}

function samplerKindLabel(kind: BilibiliParsedLink["kind"] | null | undefined) {
  if (kind === "episode") {
    return "番剧单集";
  }
  if (kind === "season") {
    return "番剧季";
  }
  return "视频";
}

function samplerPollStatusLabel(status: BilibiliPollLoginPayload["status"]) {
  if (status === "pending") {
    return "等待扫码";
  }
  if (status === "scanned") {
    return "已扫码，等待确认";
  }
  if (status === "confirmed") {
    return "登录成功";
  }
  if (status === "expired") {
    return "二维码已过期";
  }
  return "登录状态无效";
}

function getSamplerDefaultName(parsedLink: BilibiliParsedLink | null, item: BilibiliParsedItem | null) {
  const parts = [parsedLink?.title, item?.title].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : "B站取样音色";
}

function parseOptionalSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseBatchSegments(source: string, fileName = "") {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const looksLikeSubtitle = /\.(srt|vtt)$/i.test(fileName) || /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(normalized);
  const blocks = looksLikeSubtitle ? normalized.split(/\n\s*\n+/) : normalized.split(/\n\s*\n+|\n+/);
  return blocks
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^\d+$/.test(line) && !/-->/.test(line) && !/^WEBVTT/i.test(line))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 500);
}

function batchProjectStatusLabel(status: BatchProject["status"]) {
  switch (status) {
    case "queued":
      return "队列中";
    case "running":
      return "生成中";
    case "cancelling":
      return "停止中";
    case "cancelled":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "有失败项";
    default:
      return "草稿";
  }
}

function batchProjectProgress(project: BatchProject) {
  const completed = project.segments.filter((segment) => segment.status === "succeeded").length;
  const failed = project.segments.filter((segment) => segment.status === "failed").length;
  return { completed, failed, total: project.segments.length };
}

function batchSegmentStatusLabel(status: BatchProject["segments"][number]["status"]) {
  switch (status) {
    case "running":
      return "生成中";
    case "succeeded":
      return "完成";
    case "failed":
      return "失败";
    default:
      return "待生成";
  }
}

function voiceQualityLabel(report: VoiceQualityReport) {
  if (report.status === "ready") {
    return "参考音频合格";
  }
  if (report.status === "warning") {
    return "建议处理后使用";
  }
  if (report.status === "error") {
    return "参考音频不可用";
  }
  return "尚未检查";
}

function voiceSourceLabel(sourceType: string | undefined) {
  if (sourceType === "gptsovits_model_weights") {
    return "模型专属权重";
  }
  if (sourceType === "bilibili") {
    return "B 站取样";
  }
  if (sourceType === "generated") {
    return "本地生成";
  }
  if (sourceType === "built_in") {
    return "内置样例";
  }
  return "本地导入";
}

function createSettingsDraft(settings: AppSettings | null): SettingsDraft {
  const modelStoreRoot = settings?.model_store_root ?? "models";
  // IndexTTS2 is a worker while Vox/GPT-SoVITS are API services, hence the
  // two legacy backend fields. The desktop exposes one user policy and keeps
  // both values in sync; prefer the longer existing value on migration so an
  // update never releases a previously long-lived model sooner than expected.
  const idleTimeoutSeconds = Math.max(
    settings?.indextts2_idle_timeout_seconds ?? 600,
    settings?.local_api_idle_timeout_seconds ?? 600
  );
  return {
    api_host: settings?.api_host ?? "127.0.0.1",
    api_port: settings?.api_port ?? 8765,
    indextts2_root: settings?.indextts2_root ?? `${modelStoreRoot}\\IndexTTS2`,
    indextts2_idle_timeout_seconds: idleTimeoutSeconds,
    local_api_idle_timeout_seconds: idleTimeoutSeconds,
    asr_backend: settings?.asr_backend ?? "sensevoice",
    audio_enhancement_python: settings?.audio_enhancement_python ?? "",
    audio_enhancement_device: settings?.audio_enhancement_device ?? "auto",
    deepfilternet3_root: settings?.deepfilternet3_root ?? `${modelStoreRoot}\\DeepFilterNet3`,
    mossformer2_se_root: settings?.mossformer2_se_root ?? `${modelStoreRoot}\\MossFormer2-SE-48K`,
    audio_separation_python: settings?.audio_separation_python ?? "",
    audio_separation_root: settings?.audio_separation_root ?? `${modelStoreRoot}\\MDX_Net_Models`,
    audio_separation_device: settings?.audio_separation_device ?? "auto",
    voxcpm2_root: settings?.voxcpm2_root ?? `${modelStoreRoot}\\VoxCPM2`,
    voxcpm2_api_host: settings?.voxcpm2_api_host ?? "127.0.0.1",
    voxcpm2_api_port: settings?.voxcpm2_api_port ?? 8000,
    gptsovits_root: settings?.gptsovits_root ?? `${modelStoreRoot}\\GPT-SoVITS`,
    gptsovits_api_host: settings?.gptsovits_api_host ?? "127.0.0.1",
    gptsovits_api_port: settings?.gptsovits_api_port ?? 9880,
    default_model_id: localDefaultModelId(settings?.default_model_id),
    prewarm_default_model_on_startup: settings?.prewarm_default_model_on_startup ?? false
  };
}

function formatSamplerClipSeconds(value: number) {
  return Math.max(0, value).toFixed(1);
}

function qwenRuntimeLabel(resolution: QwenRuntimeResolution | undefined) {
  if (!resolution) {
    return "正在读取本地运行时";
  }
  if (resolution.error) {
    return `不可用：${resolution.error}`;
  }
  return `${resolution.label}（${resolution.requested_device === "auto" ? "自动选择" : `已指定 ${resolution.requested_device.toUpperCase()}`}）`;
}

function getFileBaseName(filePath: string) {
  const fileName = filePath.split(/[\\/]/).pop() ?? "本地音色";
  return fileName.replace(/\.[^.]+$/, "") || "本地音色";
}

function getAudioMimeType(filePath: string) {
  const suffix = filePath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    opus: "audio/ogg; codecs=opus",
    webm: "audio/webm"
  };
  return (suffix && mimeTypes[suffix]) || "application/octet-stream";
}

function referenceAudioRecommendation(modelId: string) {
  if (modelId === "gptsovits") {
    return "GPT-SoVITS 建议 3～10 秒（推荐 5～8 秒）：单人、干净、自然说话即可。";
  }
  if (modelId === "voxcpm2") {
    return "VoxCPM2 建议 5～15 秒：极致克隆时，参考文字必须与该片段逐字一致。";
  }
  return "IndexTTS2 建议 5～15 秒：保留清晰、无背景音乐的单人语音，效果更稳定。";
}

function voiceColorFromId(id: string) {
  const palettes = [
    "linear-gradient(135deg, #47646b 0%, #a8ced0 100%)",
    "linear-gradient(135deg, #6b5d4e 0%, #d8c7aa 100%)",
    "linear-gradient(135deg, #4f6175 0%, #b8c7d9 100%)",
    "linear-gradient(135deg, #706070 0%, #d7c1d0 100%)",
    "linear-gradient(135deg, #4e6a59 0%, #b9d7c4 100%)"
  ];
  const total = Array.from(id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return palettes[total % palettes.length];
}

function createImportedVoicePreset(voice: VoiceInfo): VoicePreset | null {
  if (!voice.reference_audio && !voice.model_binding) {
    return null;
  }
  const modelBinding = voice.model_binding
    ? { modelId: voice.model_binding.model_id, weights: voice.model_binding.weights }
    : undefined;
  const serverReferences = Array.isArray(voice.references) && voice.references.length > 0
    ? voice.references
    : voice.reference_audio
      ? [{
          id: voice.active_reference_id ?? "legacy-main",
          name: "主参考",
          reference_audio: voice.reference_audio,
          reference_text: voice.reference_text ?? null,
          source_type: voice.source_type,
          source_url: voice.source_url ?? null,
          original_reference_audio: voice.original_reference_audio ?? null,
          reference_audio_sha256: voice.reference_audio_sha256 ?? null,
          reference_audio_managed: voice.reference_audio_managed,
          created_at: voice.created_at,
          updated_at: voice.updated_at
        }]
      : [];
  const references = serverReferences.map((reference) => ({
    id: reference.id,
    name: reference.name,
    referenceAudio: reference.reference_audio ?? undefined,
    referenceText: reference.reference_text ?? undefined,
    sourceType: reference.source_type,
    sourceUrl: reference.source_url ?? undefined,
    referenceAudioManaged: reference.reference_audio_managed,
    originalReferenceAudio: reference.original_reference_audio ?? undefined
  }));
  return {
    id: voice.id,
    name: voice.name,
    subtitle: modelBinding
      ? `${modelBinding.modelId === "gptsovits" ? "GPT-SoVITS" : modelBinding.modelId} · 专属权重`
      : voiceSourceLabel(voice.source_type),
    initials: voice.name.trim().slice(0, 1) || "音",
    background: voiceColorFromId(voice.id),
    referenceAudio: voice.reference_audio ?? undefined,
    referenceText: voice.reference_text ?? undefined,
    authorizationStatus: voice.authorization_status,
    sourceType: voice.source_type,
    sourceUrl: voice.source_url ?? undefined,
    referenceAudioManaged: voice.reference_audio_managed,
    originalReferenceAudio: voice.original_reference_audio ?? undefined,
    references,
    activeReferenceId: voice.active_reference_id ?? references[0]?.id,
    modelBinding
  };
}

function createVoiceManagerDraft(voice: VoicePreset | null, referenceId?: string | null): VoiceManagerDraft {
  const reference = voice?.references.find((item) => item.id === referenceId)
    ?? voice?.references.find((item) => item.id === voice?.activeReferenceId)
    ?? voice?.references[0];
  return {
    name: voice?.name ?? "",
    referenceName: reference?.name ?? "",
    referenceText: reference?.referenceText ?? ""
  };
}

function createGeneratedVoiceName(modelName: string, sourceVoiceName: string) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;
  return `${modelName}-${sourceVoiceName}-${time}`;
}

function createGeneratedReferenceName(modelName: string) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;
  return `${modelName} 生成片段 ${time}`;
}

function formatDuration(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return "0:00";
  }
  const roundedValue = Math.max(1, Math.round(value));
  const minutes = Math.floor(roundedValue / 60);
  const seconds = Math.floor(roundedValue % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clampPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${Math.round(value)}%`;
}

function formatMemory(used: number | null | undefined, total: number | null | undefined) {
  if (typeof used !== "number" || typeof total !== "number" || total <= 0) {
    return "-";
  }
  const unit = total >= 1024 ? "GB" : "MB";
  const divisor = total >= 1024 ? 1024 : 1;
  return `${(used / divisor).toFixed(unit === "GB" ? 1 : 0)} / ${(total / divisor).toFixed(unit === "GB" ? 1 : 0)} ${unit}`;
}

function formatUptime(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || seconds < 1) {
    return "刚刚启动";
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

function isLocalApiModel(modelId: string) {
  return modelId === "voxcpm2" || modelId === "gptsovits";
}

function isLocalSynthesisModel(model: ModelInfo) {
  return model.id !== "doubao-web" && model.adapter !== "doubao_web";
}

function localDefaultModelId(modelId: AppSettings["default_model_id"] | undefined): SettingsDraft["default_model_id"] {
  return modelId === "doubao-web" || !modelId ? "indextts2" : modelId;
}

function isRuntimeControllable(modelId: string) {
  return modelId === "indextts2" || isLocalApiModel(modelId);
}

function isRealtimeExclusiveTtsModel(modelId: string) {
  return modelId === "indextts2" || modelId === "voxcpm2" || modelId === "gptsovits";
}

function getWorkerStatusForModel(systemStatus: SystemStatus | null, modelId: string) {
  if (modelId === "voxcpm2") {
    return systemStatus?.workers.voxcpm2;
  }
  if (modelId === "gptsovits") {
    return systemStatus?.workers.gptsovits;
  }
  if (modelId === "indextts2") {
    return systemStatus?.workers.indextts2;
  }
  return undefined;
}

function workerReleaseText(worker: WorkerStatus | undefined, modelId: string) {
  if (modelId === "doubao-web") {
    return "无需显存";
  }
  if (!worker) {
    return "等待状态";
  }
  if (worker.state === "starting") {
    return "服务正在启动";
  }
  if (worker.state === "external") {
    return "外部服务运行中";
  }
  if (!worker.loaded) {
    return isLocalApiModel(modelId) ? "服务未启动" : "显存已释放";
  }
  if ((worker.active_requests ?? 0) > 0) {
    return "正在生成，结束后开始计时";
  }
  if (typeof worker.release_in_seconds === "number") {
    return `${formatDuration(worker.release_in_seconds)} 后释放`;
  }
  return "模型驻留中";
}

function workerBadgeText(worker: WorkerStatus | undefined, modelId: string) {
  if (modelId === "doubao-web") {
    return "云端服务";
  }
  if (worker?.state === "starting") {
    return "启动中";
  }
  if (worker?.state === "external") {
    return "外部服务";
  }
  if (isLocalApiModel(modelId)) {
    return worker?.loaded ? "服务运行" : "未启动";
  }
  return worker?.loaded ? "模型驻留" : "已释放";
}

function workerDetailText(worker: WorkerStatus | undefined, modelId: string) {
  if (modelId === "doubao-web") {
    return "豆包通过云端服务生成，切换到它不会卸载或占用本地 GPU 模型。";
  }
  if (worker?.state === "external") {
    return "服务由外部进程启动。本软件只读取状态，不会尝试结束它。";
  }
  if (worker?.state === "starting") {
    return "已创建本地运行时，正在等待服务就绪；此过程不会自动发起语音生成。";
  }
  if (modelId === "voxcpm2") {
    return worker?.loaded
      ? "VoxCPM2 由本软件管理，空闲后会自动停止并释放显存。"
      : "VoxCPM2 会在第一次生成时自动启动本地 API。";
  }
  if (modelId === "gptsovits") {
    return worker?.loaded
      ? "GPT-SoVITS 由本软件管理，空闲后会自动停止并释放显存。"
      : "GPT-SoVITS 会在第一次生成时自动启动本地 API。";
  }
  return worker?.loaded
    ? "IndexTTS2 运行在本软件托管的 worker 中，空闲后会自动退出。"
    : "下一次生成会重新加载模型。";
}

function modelBadge(model: ModelInfo | undefined) {
  if (!model) {
    return "等待模型";
  }
  if (model.id === "indextts2" || model.id === "voxcpm2" || model.id === "gptsovits") {
    return "已接入";
  }
  if (model.id === "doubao-web") {
    return "云端";
  }
  if (model.adapter === "mock") {
    return "演示";
  }
  return "预留";
}

function hasFeature(model: ModelInfo | undefined, feature: string) {
  return Boolean(model?.features.includes(feature));
}

function supportsRequestCapability(model: ModelInfo | undefined, capability: string) {
  return Boolean(model?.request_capabilities?.includes(capability));
}

function featureLabel(feature: string) {
  return featureLabels[feature] ?? feature;
}

function commercialUseLabel(model: ModelInfo | undefined) {
  if (!model) {
    return "授权未知";
  }
  if (model.commercial_use === "allowed") {
    return "可商用";
  }
  if (model.commercial_use === "restricted") {
    return "商用受限";
  }
  return "授权未知";
}

function createModelProfileDraft(instance: ModelInstanceProfile): ModelProfileDraft {
  return {
    package_label: instance.package_label ?? "",
    user_note: instance.user_note ?? ""
  };
}

function modelProfileDraftChanged(instance: ModelInstanceProfile, draft: ModelProfileDraft | undefined) {
  if (!draft) {
    return false;
  }
  return draft.package_label !== (instance.package_label ?? "") || draft.user_note !== (instance.user_note ?? "");
}

function formatHistoryTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function modelInstanceStatusLabel(status: string | undefined) {
  if (status === "ready") {
    return "可用";
  }
  if (status === "untested") {
    return "未测试";
  }
  if (status === "missing") {
    return "缺失";
  }
  if (status === "broken") {
    return "需修复";
  }
  if (status === "disabled") {
    return "已禁用";
  }
  return "未知";
}

function runtimeTypeLabel(runtimeType: string) {
  if (runtimeType === "worker_lazy_pack") {
    return "懒人包 Worker";
  }
  if (runtimeType === "lazy_pack_api") {
    return "本地 API";
  }
  return "预留";
}

function modelPackageStateLabel(state: ModelPackageRecord["state"]) {
  if (state === "stable") {
    return "当前稳定包";
  }
  if (state === "archived") {
    return "已归档";
  }
  return "候选包";
}

function modelPackageSourceLabel(sourceKind: ModelPackageRecord["source_kind"]) {
  return sourceKind === "archive" ? "压缩包" : "目录包";
}

function modelPackageAdapterLabel(status: ModelPackageRecord["inspection"]["adapter_status"]) {
  if (status === "ready") {
    return "适配就绪";
  }
  if (status === "reserved") {
    return "适配器预留";
  }
  if (status === "archive") {
    return "等待解压";
  }
  return "结构待修复";
}

function taskStatusLabel(status: string) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "running") {
    return "执行中";
  }
  if (status === "cancelling") {
    return "停止中";
  }
  if (status === "succeeded" || status === "completed") {
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  if (status === "paused") {
    return "已暂停";
  }
  if (status === "partial") {
    return "部分完成";
  }
  return status || "未知";
}

function taskHasMissingResult(task: Pick<TaskSummary, "source" | "stage" | "results">) {
  return (task.results ?? []).some((result) => !result.exists)
    || (task.source === "bilibili" && task.stage === "file_missing");
}

function taskEventStageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "等待调度",
    validating: "校验请求",
    waiting_generation_slot: "等待本地 GPU",
    waiting_cloud_request: "准备云端请求",
    preparing_memory: "整理本地显存",
    preparing_cloud: "校验云端账号",
    starting_adapter: "开始合成",
    finalizing: "整理音频",
    ebook_prefetching: "预制章节",
    ebook_completed: "电子书完成",
    ebook_paused: "电子书暂停",
    ebook_cancelled: "电子书已取消",
    ebook_failed: "电子书待处理",
    downloaded: "已下载",
    file_missing: "文件缺失",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  };
  return labels[stage] ?? stage;
}

function taskSourceLabel(source: TaskSummary["source"]) {
  if (source === "speech") {
    return "单句生成";
  }
  if (source === "batch_project") {
    return "批量旁白";
  }
  if (source === "bilibili") {
    return "B 站取样";
  }
  if (source === "transcription") {
    return "音视频转写";
  }
  if (source === "audio_enhancement") {
    return "语音增强";
  }
  if (source === "audio_separation") {
    return "人声/伴奏分轨";
  }
  if (source === "alignment") {
    return "强制对齐";
  }
  if (source === "realtime") {
    return "实时对话";
  }
  if (source === "ebook") {
    return "电子书";
  }
  return "监控目录";
}

function taskResultKindLabel(kind: string) {
  if (kind === "video") {
    return "视频";
  }
  if (kind === "audio") {
    return "音频";
  }
  if (kind === "transcript") {
    return "TXT 转写";
  }
  if (kind === "subtitle") {
    return "SRT 字幕";
  }
  if (kind === "alignment") {
    return "时间轴";
  }
  if (kind === "enhancement") {
    return "增强音频";
  }
  if (kind === "separation") {
    return "分轨音频";
  }
  if (kind === "ebook") {
    return "电子书章节";
  }
  return "文件";
}

function taskResultIcon(kind: string) {
  if (kind === "ebook") {
    return <BookOpen size={15} strokeWidth={1.9} />;
  }
  if (kind === "video") {
    return <Film size={15} strokeWidth={1.9} />;
  }
  if (kind === "audio" || kind === "enhancement" || kind === "separation") {
    return <Volume2 size={15} strokeWidth={1.9} />;
  }
  if (kind === "subtitle" || kind === "transcript" || kind === "alignment") {
    return <FileText size={15} strokeWidth={1.9} />;
  }
  return <FileText size={15} strokeWidth={1.9} />;
}

function ebookPrefetchProgress(task: DoubaoPrefetchTask) {
  const chapters = task.chapters ?? [];
  const total = chapters.length || Number(task.progress?.total || 0);
  const completed = chapters.length
    ? chapters.filter((chapter) => chapter.status === "completed").length
    : Number(task.progress?.completed?.length || 0);
  const failed = chapters.length
    ? chapters.filter((chapter) => chapter.status === "failed").length
    : Number(task.progress?.failed?.length || 0);
  return { total, completed, failed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

function asEbookTaskSummary(task: DoubaoPrefetchTask): TaskSummary {
  const progress = ebookPrefetchProgress(task);
  const status = task.status === "processing" ? "running" : task.status;
  const bookName = String(task.bookInfo.bookName || "未命名电子书");
  const hasFailure = progress.failed > 0;
  const error = task.chapters?.find((chapter) => chapter.error)?.error
    || task.progress?.failed?.[0]?.error
    || null;
  const stage = status === "running"
    ? "ebook_prefetching"
    : status === "completed"
      ? "ebook_completed"
      : status === "paused"
        ? "ebook_paused"
        : status === "cancelled"
          ? "ebook_cancelled"
          : hasFailure ? "ebook_failed" : "ebook_pending";
  const message = status === "running"
    ? `正在预制第 ${Math.min(progress.completed + 1, Math.max(progress.total, 1))}/${progress.total || "?"} 章。`
    : status === "completed"
      ? `已完成 ${progress.completed}/${progress.total} 章电子书音频。`
      : status === "paused"
        ? `已暂停，已完成 ${progress.completed}/${progress.total} 章。`
        : status === "cancelled"
          ? `已取消，已保留 ${progress.completed}/${progress.total} 章成果。`
          : error || `已完成 ${progress.completed}/${progress.total} 章，${progress.failed} 章需要处理。`;
  return {
    id: `ebook:${task.taskId}`,
    source: "ebook",
    title: `《${bookName}》 · ${progress.total || "?"} 章音频`,
    status,
    stage,
    progress_percent: status === "completed" ? 100 : progress.percent,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    completed_at: ["completed", "partial", "failed", "cancelled"].includes(status) ? task.updatedAt : null,
    error,
    retryable: ["paused", "cancelled", "partial", "failed"].includes(status),
    cancelable: status === "running",
    events: [{ occurred_at: task.updatedAt, stage, message, level: error ? "error" : "info" }],
    results: [{
      id: `ebook:${task.taskId}:summary`,
      kind: "ebook",
      label: "电子书章节汇总",
      file_name: `《${bookName}》 · ${progress.completed}/${progress.total || "?"} 章音频`,
      model: "doubao-web",
      text: message,
      exists: true,
      downloadable: false
    }]
  };
}

function settingsDraftHasChanges(draft: SettingsDraft, settings: AppSettings | null) {
  const baseline = createSettingsDraft(settings);
  return (Object.keys(baseline) as Array<keyof SettingsDraft>).some((key) => draft[key] !== baseline[key]);
}

function taskResultContextLabel(result: Pick<TaskCenterResult, "file_name" | "label" | "task_title">) {
  const label = result.label?.trim();
  const taskTitle = result.task_title?.trim();
  const context = taskTitle && taskTitle !== result.file_name && taskTitle !== label
    ? `任务：${taskTitle}`
    : null;
  return [label, context].filter(Boolean).join(" · ") || "成果文件";
}

function taskResultRelationLabel(relation: TaskCenterResult["relation"]) {
  if (relation === "orphan") {
    return "未关联任务";
  }
  if (relation === "history") {
    return "历史记录";
  }
  return "已关联任务";
}

function resultDateGroup(value: string): { key: string; label: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { key: "unknown", label: "未标记日期" };
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const label = date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  return { key, label };
}

function resolveTaskResultUrl(url: string) {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(url) || /^(?:blob|data|file):/i.test(url)) {
    return url;
  }
  return toAudioUrl(url);
}

function buildTaskDiagnosticText(task: TaskSummary) {
  const lines = [
    "OpenTTS Studio 任务诊断",
    `任务：${task.title}`,
    `来源：${taskSourceLabel(task.source)}`,
    `状态：${taskStatusLabel(task.status)}`,
    `阶段：${task.stage}`,
    `进度：${task.progress_percent}%`,
    `创建：${task.created_at}`,
    `更新：${task.updated_at}`
  ];
  if (task.error) {
    lines.push(`错误：${task.error}`);
  }
  if (task.log_file) {
    lines.push(`日志：${task.log_file}`);
  }
  if (task.events.length > 0) {
    lines.push("最近事件：");
    lines.push(...task.events.slice(-12).map((event) => `[${event.occurred_at}] ${event.level}/${event.stage}: ${event.message}`));
  }
  return lines.join("\n");
}

function isTerminalTaskStatus(status: string) {
  return ["succeeded", "completed", "failed", "cancelled"].includes(status);
}

function getSpeechJobProgress(job: SpeechJob): GenerationProgress {
  const latestEvent = job.events[job.events.length - 1];
  const isCloudJob = job.request.model === "doubao-web";
  const stageMap: Record<string, Omit<GenerationProgress, "percent" | "detail">> = {
    queued: { phaseIndex: 0, phaseTitle: isCloudJob ? "任务已进入云端合成队列" : "任务已进入本地队列", estimate: isCloudJob ? "不会等待本地 GPU 任务" : "等待前序任务完成" },
    validating: { phaseIndex: 0, phaseTitle: isCloudJob ? "校验豆包账号与请求" : "校验本地模型与请求", estimate: "正在读取真实后端状态" },
    waiting_generation_slot: { phaseIndex: 0, phaseTitle: "等待串行生成槽位", estimate: "避免多个本地模型争抢显存" },
    waiting_cloud_request: { phaseIndex: 0, phaseTitle: "准备豆包云端请求", estimate: "仅按 Cookie 限流，不占用本地 GPU" },
    preparing_memory: { phaseIndex: 1, phaseTitle: "整理模型显存", estimate: "避免模型之间争抢显存" },
    preparing_cloud: { phaseIndex: 1, phaseTitle: "校验豆包账号与音色", estimate: "本地 GPU 模型保持原有状态" },
    starting_adapter: { phaseIndex: isCloudJob ? 2 : 1, phaseTitle: isCloudJob ? "豆包云端正在合成" : "适配器已启动", estimate: "模型正在处理请求" },
    finalizing: { phaseIndex: 3, phaseTitle: "整理音频与结果", estimate: isCloudJob ? "即将保存云端音频" : "即将返回本地 WAV 文件" },
    completed: { phaseIndex: 3, phaseTitle: "生成完成", estimate: "音频已写入输出目录" },
    failed: { phaseIndex: 3, phaseTitle: "生成失败", estimate: "可在任务中心查看诊断日志" },
    cancelled: { phaseIndex: 0, phaseTitle: "任务已取消", estimate: "排队任务不会继续启动模型" }
  };
  const fallback = { phaseIndex: 1, phaseTitle: "本地模型正在处理", estimate: "等待后端返回真实阶段" };
  const meta = stageMap[job.stage] ?? fallback;
  return {
    percent: Math.max(3, job.progress_percent),
    phaseIndex: meta.phaseIndex,
    phaseTitle: meta.phaseTitle,
    detail: latestEvent?.message ?? "正在等待后端任务事件。",
    estimate: meta.estimate
  };
}

function samplerTaskProgress(stage: BilibiliSamplerState["taskStage"]) {
  if (stage === "parsing") {
    return 18;
  }
  if (stage === "loading-audio-options") {
    return 34;
  }
  if (stage === "downloading-video") {
    return 42;
  }
  if (stage === "downloading-audio") {
    return 64;
  }
  if (stage === "converting") {
    return 82;
  }
  if (stage === "merging") {
    return 88;
  }
  if (stage === "completed") {
    return 100;
  }
  return 0;
}

function formatPackageSize(sizeBytes: number | null | undefined, scanComplete: boolean) {
  if (sizeBytes === null || sizeBytes === undefined) {
    return "体积未统计";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rendered = `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  return scanComplete ? rendered : `至少 ${rendered}`;
}

function formatAssetSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isBackendConnectionError(error: unknown) {
  if (error instanceof TypeError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network(?:error| request)|load failed|未响应|连接(?:中断|被拒绝|失败)/i.test(message);
}

function audioAssetSourceLabel(source: AudioAsset["source"]) {
  if (source === "speech") {
    return "单句生成";
  }
  if (source === "realtime") {
    return "实时对话";
  }
  if (source === "batch_project") {
    return "批量旁白";
  }
  if (source === "audio_enhancement") {
    return "语音增强";
  }
  if (source === "audio_separation") {
    return "人声/伴奏分轨";
  }
  return "输出目录文件";
}

function audioAssetOriginLabel(origin: AudioAsset["origin"]) {
  if (origin === "local") {
    return "本地合成";
  }
  if (origin === "cloud") {
    return "云端合成";
  }
  return "监控目录";
}

function isModelInstanceUsable(instance: ModelInstanceProfile | undefined) {
  return Boolean(instance?.enabled) && instance?.status === "ready";
}

function getSupportedCloneModes(model: ModelInfo | undefined): CloneMode[] {
  if (!model) {
    return ["可控克隆"];
  }
  const modes: CloneMode[] = [];
  if (hasFeature(model, "voice_design")) {
    modes.push("音色设计");
  }
  if (hasFeature(model, "controllable_clone") || hasFeature(model, "voice_clone") || hasFeature(model, "emotion_control")) {
    modes.push("可控克隆");
  }
  if (hasFeature(model, "extreme_clone")) {
    modes.push("极致克隆");
  }
  return modes.length > 0 ? modes : ["文本生成"];
}

function cloneModeNeedsVoice(mode: CloneMode) {
  return mode === "可控克隆" || mode === "极致克隆";
}

function cloneModeNeedsReferenceText(mode: CloneMode) {
  return mode === "极致克隆";
}

function supportsControlPrompt(model: ModelInfo | undefined, mode: CloneMode) {
  if (mode === "音色设计") {
    return hasFeature(model, "voice_design");
  }
  if (mode === "可控克隆") {
    return hasFeature(model, "controllable_clone") || hasFeature(model, "emotion_control");
  }
  // VoxCPM2 的极致克隆是“参考音频 + 原文”的续写模式。上游 WebUI
  // 也会关闭音色设计指令，避免它被拼进待合成文本。
  if (mode === "极致克隆") {
    return false;
  }
  return false;
}

function capabilityHint(model: ModelInfo | undefined, mode: CloneMode) {
  if (!model) {
    return "等待模型能力信息";
  }
  if (model.id === "gptsovits" && mode === "可控克隆") {
    return "GPT-SoVITS 会使用参考音频生成目标文本，参考文本可在极致克隆中补充。";
  }
  if (model.id === "gptsovits" && mode === "极致克隆") {
    return "GPT-SoVITS 会同时使用参考音频和参考文本，适合更稳定的音色复刻。";
  }
  if (model.id === "indextts2" && mode === "可控克隆") {
    return "IndexTTS2 会保留所选参考音色，并调用上游情感文本控制；留空时按参考音频完整克隆。";
  }
  if (model.id === "voxcpm2" && mode === "可控克隆") {
    return "VoxCPM2 会优先克隆参考音频的说话人特征；控制文字只能调表达，不能可靠地把男声改成女声。";
  }
  if (model.id === "voxcpm2" && mode === "极致克隆") {
    return "极致克隆使用参考音频及其原文进行无缝续写，音色设计文字会自动关闭。可在音色库中一键识别并校对参考原文。";
  }
  if (model.id === "doubao-web") {
    return "从豆包预设音色中选择一个声音后，直接在主工作台生成；账号、阅读预制与缓存仍在豆包管理中心维护。";
  }
  if (mode === "文本生成") {
    return "当前模型只使用目标文本，不需要参考音色。";
  }
  if (mode === "音色设计") {
    return "当前模型支持用控制指令直接设计声音。";
  }
  if (mode === "可控克隆") {
    return "当前模型会使用参考音频进行克隆。";
  }
  return "当前模型会使用参考音频和对应文本进行高相似度克隆。";
}

function controlPromptPlaceholder(model: ModelInfo | undefined, mode: CloneMode) {
  if (model?.id === "indextts2") {
    return "情绪描述：如惊讶、愤怒、悲伤、恐惧或平静（保持参考音色不变）";
  }
  if (model?.id === "voxcpm2" && mode === "音色设计") {
    return "音色设计：如成熟御姐、低沉男声、清亮少女音";
  }
  return "控制指令";
}

function getControlPromptPresets(model: ModelInfo | undefined, mode: CloneMode): ControlPromptPreset[] {
  if (model?.id === "indextts2" && mode === "可控克隆") {
    return INDEXTTS2_EMOTION_PRESETS;
  }
  if (model?.id === "voxcpm2" && mode === "音色设计") {
    return VOXCPM2_VOICE_DESIGN_PRESETS;
  }
  if (model?.id === "voxcpm2" && mode === "可控克隆") {
    return VOXCPM2_CLONE_STYLE_PRESETS;
  }
  return [];
}

function controlPromptGuide(model: ModelInfo | undefined, mode: CloneMode) {
  if (model?.id === "indextts2") {
    return "IndexTTS2 的情绪文本控制来自上游实验能力。建议只写一种明确情绪，例如惊讶、愤怒、悲伤、恐惧或平静；留空会跟随参考音频的原始表达。";
  }
  if (model?.id === "voxcpm2" && mode === "音色设计") {
    return "推荐结构：年龄与性别 + 音色 + 情绪 + 语速 + 使用场景。";
  }
  return "推荐结构：情绪 + 强度 + 语速或停顿；参考音频仍决定说话人音色。";
}

function getGenerationProgress(modelId: string, elapsedSeconds: number): GenerationProgress {
  if (modelId === "doubao-web") {
    if (elapsedSeconds < 1) {
      return {
        percent: 16,
        phaseIndex: 0,
        phaseTitle: "校验豆包账号与音色",
        detail: "正在检查 Cookie、预设音色与输出格式。",
        estimate: "通常几秒内完成"
      };
    }
    if (elapsedSeconds < 4) {
      return {
        percent: 34 + elapsedSeconds * 8,
        phaseIndex: 2,
        phaseTitle: "豆包云端正在合成",
        detail: "请求已发送到豆包服务，本地 GPU 模型会继续保持原有状态。",
        estimate: "网络繁忙时可能稍慢"
      };
    }
    return {
      percent: Math.min(94, 66 + elapsedSeconds * 3),
      phaseIndex: 3,
      phaseTitle: "转换并保存音频",
      detail: "正在整理云端音频并写入本地输出目录。",
      estimate: "长文本需要更多时间"
    };
  }
  const isIndexTts2 = modelId === "indextts2";
  const isVoxCpm2 = modelId === "voxcpm2";
  const isGptSoVits = modelId === "gptsovits";
  if (isGptSoVits) {
    if (elapsedSeconds < 6) {
      return {
        percent: Math.max(8, 12 + elapsedSeconds * 3),
        phaseIndex: 0,
        phaseTitle: "启动 GPT-SoVITS 本地 API",
        detail: "正在检查本地懒人包、运行环境和接口端口。",
        estimate: "首次启动会更慢"
      };
    }
    if (elapsedSeconds < 30) {
      return {
        percent: 30 + (elapsedSeconds - 6) * 1.8,
        phaseIndex: 1,
        phaseTitle: "加载 GPT-SoVITS 权重",
        detail: "首次调用会加载 GPT、SoVITS、声码器和参考音频。",
        estimate: "通常 20-90 秒"
      };
    }
    if (elapsedSeconds < 70) {
      return {
        percent: 58 + (elapsedSeconds - 30) * 0.75,
        phaseIndex: 2,
        phaseTitle: "克隆并合成语音",
        detail: "正在根据目标文本、参考音频和参考文本生成语音。",
        estimate: "长文本或首次冷启动会更慢"
      };
    }
    return {
      percent: Math.min(94, 88 + (elapsedSeconds - 70) * 0.2),
      phaseIndex: 3,
      phaseTitle: "写入并返回音频",
      detail: "正在等待 GPT-SoVITS 返回 WAV 文件。",
      estimate: "超过 2 分钟建议查看服务状态"
    };
  }
  if (isVoxCpm2) {
    if (elapsedSeconds < 6) {
      return {
        percent: Math.max(8, 12 + elapsedSeconds * 3),
        phaseIndex: 0,
        phaseTitle: "启动 VoxCPM2 本地 API",
        detail: "正在检查本地服务和懒人包运行环境。",
        estimate: "首次启动会更慢"
      };
    }
    if (elapsedSeconds < 26) {
      return {
        percent: 30 + (elapsedSeconds - 6) * 2,
        phaseIndex: 1,
        phaseTitle: "加载 VoxCPM2 模型",
        detail: "首次调用会加载权重、声码器和依赖库，显存会开始上升。",
        estimate: "通常 20-60 秒"
      };
    }
    if (elapsedSeconds < 58) {
      return {
        percent: 62 + (elapsedSeconds - 26) * 0.8,
        phaseIndex: 2,
        phaseTitle: "合成语音",
        detail: "正在根据文本、参考音频和控制指令生成音频。",
        estimate: "长文本会更慢"
      };
    }
    return {
      percent: Math.min(94, 88 + (elapsedSeconds - 58) * 0.25),
      phaseIndex: 3,
      phaseTitle: "写入并返回音频",
      detail: "正在等待本地 API 返回 WAV 文件。",
      estimate: "超过 2 分钟建议查看服务日志"
    };
  }
  if (!isIndexTts2) {
    const percent = Math.min(92, 24 + elapsedSeconds * 24);
    return {
      percent,
      phaseIndex: elapsedSeconds < 1 ? 0 : elapsedSeconds < 2 ? 2 : 3,
      phaseTitle: elapsedSeconds < 1 ? "连接本地服务" : elapsedSeconds < 2 ? "合成演示音频" : "写入音频文件",
      detail: "轻量模型通常会很快完成。",
      estimate: "通常 1-3 秒"
    };
  }

  if (elapsedSeconds < 4) {
    return {
      percent: Math.max(8, 10 + elapsedSeconds * 4),
      phaseIndex: 0,
      phaseTitle: "连接后端并创建任务",
      detail: "正在把文本、音色和控制指令送入本地 API。",
      estimate: "首次生成约 20-40 秒"
    };
  }
  if (elapsedSeconds < 14) {
    return {
      percent: 26 + (elapsedSeconds - 4) * 3.2,
      phaseIndex: 1,
      phaseTitle: "加载 IndexTTS2 权重",
      detail: "首次调用会加载模型、声码器和参考音频，后续可通过常驻进程加速。",
      estimate: "显卡和磁盘会影响耗时"
    };
  }
  if (elapsedSeconds < 32) {
    return {
      percent: 58 + (elapsedSeconds - 14) * 1.45,
      phaseIndex: 2,
      phaseTitle: "GPU 推理生成语音",
      detail: "正在根据文本和参考音色生成波形。",
      estimate: "请稍等，长文本会更慢"
    };
  }
  return {
    percent: Math.min(94, 84 + (elapsedSeconds - 32) * 0.35),
    phaseIndex: 3,
    phaseTitle: "整理音频并等待返回",
    detail: "模型可能正在保存 WAV 文件或等待进程返回。",
    estimate: "超过 90 秒建议查看日志"
  };
}

export function App() {
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(readAccentTheme);
  const [themeTransitioning, setThemeTransitioning] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("indextts2");
  const [pendingModelSwitch, setPendingModelSwitch] = useState<PendingModelSwitch | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("custom");
  const [customVoices, setCustomVoices] = useState<VoicePreset[]>([]);
  const [voiceAvatars, setVoiceAvatars] = useState<Record<string, VoiceAvatar>>(readVoiceAvatars);
  const [voiceFavoriteIds, setVoiceFavoriteIds] = useState<string[]>(readVoiceFavorites);
  const [voiceManagerOpen, setVoiceManagerOpen] = useState(false);
  const [managedVoiceId, setManagedVoiceId] = useState<string | null>(null);
  const [managedReferenceId, setManagedReferenceId] = useState<string | null>(null);
  const [voiceManagerDraft, setVoiceManagerDraft] = useState<VoiceManagerDraft>(() => createVoiceManagerDraft(null));
  const [voiceManagerAction, setVoiceManagerAction] = useState<string | null>(null);
  const [voiceManagerMessage, setVoiceManagerMessage] = useState<string | null>(null);
  const [voiceManagerError, setVoiceManagerError] = useState<string | null>(null);
  const [voiceManagerQuery, setVoiceManagerQuery] = useState("");
  const [voiceManagerFilter, setVoiceManagerFilter] = useState<"all" | "favorites">("all");
  const [voiceManagerPreviewId, setVoiceManagerPreviewId] = useState<string | null>(null);
  const [voiceManagerPreviewPlaying, setVoiceManagerPreviewPlaying] = useState(false);
  const [voiceManagerPreviewLoading, setVoiceManagerPreviewLoading] = useState(false);
  const [voiceManagerPreviewTime, setVoiceManagerPreviewTime] = useState(0);
  const [voiceManagerPreviewDuration, setVoiceManagerPreviewDuration] = useState(0);
  const [voiceManagerPreviewPeaks, setVoiceManagerPreviewPeaks] = useState<number[]>([]);
  const [voiceManagerPreviewWaveformStatus, setVoiceManagerPreviewWaveformStatus] = useState<WaveformStatus>("idle");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [cloneMode, setCloneMode] = useState<CloneMode>("可控克隆");
  const [input, setInput] = useState("你好，这是 IndexTTS2 的本地桌面软件测试。");
  const [controlPromptDrafts, setControlPromptDrafts] = useState<Record<string, string>>({});
  const [referenceText, setReferenceText] = useState("你好，这是参考音频的原始文本。");
  const [cfg, setCfg] = useState(2);
  const [steps, setSteps] = useState(10);
  const [indexTemperature, setIndexTemperature] = useState(0.8);
  const [indexTopP, setIndexTopP] = useState(0.8);
  const [indexTopK, setIndexTopK] = useState(30);
  const [indexNumBeams, setIndexNumBeams] = useState(3);
  const [indexRepetitionPenalty, setIndexRepetitionPenalty] = useState(10);
  const [indexMaxMelTokens, setIndexMaxMelTokens] = useState(1500);
  const [speed, setSpeed] = useState(1);
  const [normalizeText, setNormalizeText] = useState(true);
  const [denoise, setDenoise] = useState(false);
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [resultReferenceText, setResultReferenceText] = useState("");
  const [resultModelName, setResultModelName] = useState("");
  const [resultVoiceName, setResultVoiceName] = useState("");
  const [savedVoicePath, setSavedVoicePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeSpeechJob, setActiveSpeechJob] = useState<SpeechJob | null>(null);
  const [activeSpeechContext, setActiveSpeechContext] = useState<{ modelName: string; voiceName: string } | null>(null);
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const [drawSession, setDrawSession] = useState<DrawSession | null>(null);
  const [drawCandidates, setDrawCandidates] = useState<DrawCandidate[]>([]);
  const [selectedDrawCandidateId, setSelectedDrawCandidateId] = useState<string | null>(null);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [taskCenterSearch, setTaskCenterSearch] = useState("");
  const [taskCenterTaskSearch, setTaskCenterTaskSearch] = useState("");
  const [taskCenterStatusFilter, setTaskCenterStatusFilter] = useState("all");
  const [taskCenterTaskSourceFilter, setTaskCenterTaskSourceFilter] = useState("all");
  const [taskCenterResultFilter, setTaskCenterResultFilter] = useState("all");
  const [taskCenterSourceFilter, setTaskCenterSourceFilter] = useState("all");
  const [selectedTaskResultIds, setSelectedTaskResultIds] = useState<string[]>([]);
  const [selectedTaskResultId, setSelectedTaskResultId] = useState<string | null>(null);
  const [collapsedResultDateGroups, setCollapsedResultDateGroups] = useState<Set<string>>(new Set());
  const seenResultDateGroupsRef = useRef<Set<string>>(new Set());
  const [bilibiliHistoryItems, setBilibiliHistoryItems] = useState<BilibiliMediaHistoryItem[]>([]);
  const [remoteTasks, setRemoteTasks] = useState<TaskSummary[]>([]);
  const [ebookPrefetchTasks, setEbookPrefetchTasks] = useState<DoubaoPrefetchTask[]>([]);
  const [taskCenterAction, setTaskCenterAction] = useState<string | null>(null);
  const [taskCenterRefreshing, setTaskCenterRefreshing] = useState(false);
  const [taskSummariesLoading, setTaskSummariesLoading] = useState(false);
  const [taskCenterError, setTaskCenterError] = useState<string | null>(null);
  const [taskCenterMessage, setTaskCenterMessage] = useState<string | null>(null);
  const [ebookInspectorSummary, setEbookInspectorSummary] = useState<DoubaoPrefetchTaskSummary | null>(null);
  const [ebookInspectorLoading, setEbookInspectorLoading] = useState(false);
  const [ebookInspectorError, setEbookInspectorError] = useState<string | null>(null);
  const [ebookInspectorChapterId, setEbookInspectorChapterId] = useState<string | null>(null);
  const [taskHistoryClearConfirmOpen, setTaskHistoryClearConfirmOpen] = useState(false);
  const [audioLibraryOpen, setAudioLibraryOpen] = useState(false);
  const [monitorPanelOpen, setMonitorPanelOpen] = useState(false);
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([]);
  const [selectedAudioAssetPath, setSelectedAudioAssetPath] = useState<string | null>(null);
  const [audioLibrarySearch, setAudioLibrarySearch] = useState("");
  const [audioLibrarySource, setAudioLibrarySource] = useState("all");
  const [audioLibraryLoading, setAudioLibraryLoading] = useState(false);
  const [audioLibraryAction, setAudioLibraryAction] = useState<string | null>(null);
  const [audioLibraryError, setAudioLibraryError] = useState<string | null>(null);
  const [audioLibraryMessage, setAudioLibraryMessage] = useState<string | null>(null);
  const [audioAssetPlaying, setAudioAssetPlaying] = useState(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [globalLlmSettings, setGlobalLlmSettings] = useState<GlobalLlmSettings>(defaultGlobalLlmSettings);
  const [savedGlobalLlmSettings, setSavedGlobalLlmSettings] = useState<GlobalLlmSettings>(defaultGlobalLlmSettings);
  const [globalLlmLoading, setGlobalLlmLoading] = useState(false);
  const [globalLlmSaving, setGlobalLlmSaving] = useState(false);
  const [globalLlmTesting, setGlobalLlmTesting] = useState(false);
  const [globalLlmMessage, setGlobalLlmMessage] = useState<string | null>(null);
  const [globalLlmError, setGlobalLlmError] = useState<string | null>(null);
  const [promptPolishBusy, setPromptPolishBusy] = useState(false);
  const [promptPolishResult, setPromptPolishResult] = useState<LlmPolishResult | null>(null);
  const [promptPolishError, setPromptPolishError] = useState<string | null>(null);
  const [scriptRewriteBusy, setScriptRewriteBusy] = useState(false);
  const [scriptRewriteResult, setScriptRewriteResult] = useState<LlmTextTransformResult | null>(null);
  const [scriptRewriteError, setScriptRewriteError] = useState<string | null>(null);
  const [modelInstances, setModelInstances] = useState<ModelInstanceProfile[]>([]);
  const [modelPackages, setModelPackages] = useState<ModelPackageRecord[]>([]);
  const [modelProfileDrafts, setModelProfileDrafts] = useState<Record<string, ModelProfileDraft>>({});
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => createSettingsDraft(null));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("common");
  const settingsBodyRef = useRef<HTMLDivElement | null>(null);
  const settingsNavigationTargetRef = useRef<string | null>(null);
  const [settingsNavigationRequest, setSettingsNavigationRequest] = useState(0);
  const modalRestoreFocusRef = useRef<HTMLElement | null>(null);
  const previousModalKeyRef = useRef<string | null>(null);
  const [appConfirmation, setAppConfirmation] = useState<ConfirmationRequest | null>(null);
  const appConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMigrationAction, setSettingsMigrationAction] = useState<"export" | "import" | null>(null);
  const [globalRefreshing, setGlobalRefreshing] = useState(false);
  const [globalRefreshMessage, setGlobalRefreshMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState | null>(null);
  const defaultModelAppliedRef = useRef(false);
  const startupPrewarmAttemptedRef = useRef(false);
  const startupModelHealthCheckedRef = useRef(false);
  const systemStatusRequestRef = useRef(false);
  const taskSummariesRequestRef = useRef<Promise<void> | null>(null);
  const batchProjectsRequestRef = useRef<Promise<void> | null>(null);
  const backendRecoveryRequestRef = useRef(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [checkingModelId, setCheckingModelId] = useState<string | null>(null);
  const [savingProfileModelId, setSavingProfileModelId] = useState<string | null>(null);
  const [runtimeActionModelId, setRuntimeActionModelId] = useState<string | null>(null);
  const [modelWarmupState, setModelWarmupState] = useState<ModelWarmupState | null>(null);
  const [modelHealthResults, setModelHealthResults] = useState<Record<string, ModelHealthResult>>({});
  const [modelPackageModelId, setModelPackageModelId] = useState("indextts2");
  const [modelPackageLabel, setModelPackageLabel] = useState("");
  const [modelPackageNote, setModelPackageNote] = useState("");
  const [modelPackageAction, setModelPackageAction] = useState<string | null>(null);
  const [voiceImporting, setVoiceImporting] = useState(false);
  const [voiceImportMenuOpen, setVoiceImportMenuOpen] = useState(false);
  const [referenceAudioEditor, setReferenceAudioEditor] = useState<ReferenceAudioEditorState | null>(null);
  const [referenceAudioEditorSaving, setReferenceAudioEditorSaving] = useState(false);
  const [referenceAudioEditorError, setReferenceAudioEditorError] = useState<string | null>(null);
  const [referenceAudioPreviewTime, setReferenceAudioPreviewTime] = useState(0);
  const [referenceAudioPreviewPlaying, setReferenceAudioPreviewPlaying] = useState(false);
  const [referenceAudioWaveformPeaks, setReferenceAudioWaveformPeaks] = useState<number[]>([]);
  const [referenceAudioWaveformStatus, setReferenceAudioWaveformStatus] = useState<WaveformStatus>("idle");
  const [recognizingVoiceIds, setRecognizingVoiceIds] = useState<string[]>([]);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [resultVoiceSaveOpen, setResultVoiceSaveOpen] = useState(false);
  const [voiceLibrarySaveSource, setVoiceLibrarySaveSource] = useState<VoiceLibrarySaveSource | null>(null);
  const [resultVoiceSaveMode, setResultVoiceSaveMode] = useState<ResultVoiceSaveMode>("create");
  const [resultVoiceSaveTargetId, setResultVoiceSaveTargetId] = useState("");
  const [resultVoiceSaveName, setResultVoiceSaveName] = useState("");
  const [resultVoiceSaveError, setResultVoiceSaveError] = useState<string | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [voiceQuality, setVoiceQuality] = useState<VoiceQualityReport | null>(null);
  const [voiceQualityById, setVoiceQualityById] = useState<Record<string, VoiceQualityReport>>({});
  const [voiceQualityLoading, setVoiceQualityLoading] = useState(false);
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [samplerState, setSamplerState] = useState<BilibiliSamplerState>(() => createDefaultBilibiliSamplerState());
  const [samplerMediaOptions, setSamplerMediaOptions] = useState<BilibiliAudioOptionsResult | null>(null);
  const [samplerVideoPreview, setSamplerVideoPreview] = useState<BilibiliDownloadVideoResult | null>(null);
  const [samplerVideoPreviewError, setSamplerVideoPreviewError] = useState<string | null>(null);
  const [samplerVideoDuration, setSamplerVideoDuration] = useState(0);
  const [samplerVideoCurrentTime, setSamplerVideoCurrentTime] = useState(0);
  const [samplerVideoWaveformPeaks, setSamplerVideoWaveformPeaks] = useState<number[]>([]);
  const [samplerVideoWaveformStatus, setSamplerVideoWaveformStatus] = useState<WaveformStatus>("idle");
  const [samplerLink, setSamplerLink] = useState("");
  const [samplerQrPayload, setSamplerQrPayload] = useState<BilibiliLoginQrPayload | null>(null);
  const [samplerQrCodeUrl, setSamplerQrCodeUrl] = useState<string | null>(null);
  const [samplerPendingAction, setSamplerPendingAction] = useState<string | null>(null);
  const [samplerStartSeconds, setSamplerStartSeconds] = useState("");
  const [samplerEndSeconds, setSamplerEndSeconds] = useState("");
  const [samplerName, setSamplerName] = useState("");
  const [samplerReferenceText, setSamplerReferenceText] = useState("");
  const [samplerMessage, setSamplerMessage] = useState<string | null>(null);
  const [generationWorkspace, setGenerationWorkspace] = useState<"single" | "batch" | "realtime">("single");
  const [realtimeEntryConfirmOpen, setRealtimeEntryConfirmOpen] = useState(false);
  const [realtimeRuntimeState, setRealtimeRuntimeState] = useState<"idle" | "reserving" | "ready" | "error">("idle");
  const [realtimeRuntimeMessage, setRealtimeRuntimeMessage] = useState("");
  const workbenchNavRef = useRef<HTMLDivElement>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<PrimaryWorkspace>("creation");
  const [workspaceTransition, setWorkspaceTransition] = useState<"idle" | "entering">("idle");
  const workspaceTransitionTimersRef = useRef<number[]>([]);
  const [workbenchIndicator, setWorkbenchIndicator] = useState({ left: 4, width: 0, ready: false });
  const [workbenchNavScrollState, setWorkbenchNavScrollState] = useState({ canScrollBackward: false, canScrollForward: false });
  const [doubaoStatus, setDoubaoStatus] = useState<DoubaoStatus | null>(null);
  const [doubaoVoices, setDoubaoVoices] = useState<DoubaoVoice[]>([]);
  const [doubaoStateError, setDoubaoStateError] = useState<string | null>(null);
  const [doubaoVoiceSearch, setDoubaoVoiceSearch] = useState("");
  const [selectedDoubaoVoiceId, setSelectedDoubaoVoiceId] = useState("");
  const [doubaoPitch, setDoubaoPitch] = useState(0);
  const [doubaoFormat, setDoubaoFormat] = useState<"wav" | "mp3">("mp3");
  const [batchProjects, setBatchProjects] = useState<BatchProject[]>([]);
  const [editingBatchProjectId, setEditingBatchProjectId] = useState<string | null>(null);
  const [batchProjectTitle, setBatchProjectTitle] = useState("未命名配音项目");
  const [batchProjectModel, setBatchProjectModel] = useState(selectedModel);
  const [batchProjectVoiceId, setBatchProjectVoiceId] = useState(selectedVoice);
  const [batchProjectDoubaoVoiceId, setBatchProjectDoubaoVoiceId] = useState("");
  const [batchProjectDoubaoPitch, setBatchProjectDoubaoPitch] = useState(0);
  const [batchProjectDoubaoFormat, setBatchProjectDoubaoFormat] = useState<"wav" | "mp3">("mp3");
  const [batchProjectSegments, setBatchProjectSegments] = useState<string[]>([]);
  const [batchProjectMessage, setBatchProjectMessage] = useState<string | null>(null);
  const [batchProjectError, setBatchProjectError] = useState<string | null>(null);
  const [batchProjectAction, setBatchProjectAction] = useState<"save" | "run" | "retry" | "cancel" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [resultWaveformPeaks, setResultWaveformPeaks] = useState<number[]>([]);
  const [resultWaveformStatus, setResultWaveformStatus] = useState<WaveformStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const drawMenuRef = useRef<HTMLDivElement | null>(null);
  const themeTransitionTimerRef = useRef<number | null>(null);
  const audioAssetRef = useRef<HTMLAudioElement | null>(null);
  const samplerVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const samplerVideoPreviewPanelRef = useRef<HTMLElement | null>(null);
  const samplerVideoWaveformRequestRef = useRef(0);
  const referenceAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const referenceAudioPreviewUrlRef = useRef<string | null>(null);
  const referenceAudioWaveformRequestRef = useRef(0);
  const voiceManagerPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceManagerPreviewUrlRef = useRef<string | null>(null);
  const voiceManagerPreviewWaveformRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSamplerDefaultNameRef = useRef("");
  const selectedModelRef = useRef(selectedModel);
  const realtimeRuntimeSyncRef = useRef<Promise<void>>(Promise.resolve());
  const selectedVoiceRef = useRef(selectedVoice);
  const managedVoiceIdRef = useRef(managedVoiceId);
  const voiceRecognitionRequestsRef = useRef(new Map<string, Promise<void>>());
  const pendingModelWarmupRef = useRef<string | null>(null);
  const modelWarmupEpochRef = useRef(0);
  const drawSessionRef = useRef<DrawSession | null>(null);

  const requestConfirmation = useCallback((request: ConfirmationRequest) => new Promise<boolean>((resolve) => {
    appConfirmationResolverRef.current?.(false);
    appConfirmationResolverRef.current = resolve;
    setAppConfirmation(request);
  }), []);

  const settleConfirmation = useCallback((confirmed: boolean) => {
    const resolver = appConfirmationResolverRef.current;
    appConfirmationResolverRef.current = null;
    setAppConfirmation(null);
    resolver?.(confirmed);
  }, []);

  useEffect(() => () => {
    appConfirmationResolverRef.current?.(false);
    appConfirmationResolverRef.current = null;
  }, []);

  // Dialogs render in a single document so keyboard dismissal and focus
  // restoration need one shared topmost-layer rule. Keep this order aligned
  // with the overlay order at the bottom of the component.
  const topmostModalKey = appConfirmation
    ? "app-confirmation"
    : settingsOpen
    ? "settings"
    : samplerOpen
      ? "sampler"
      : pendingModelSwitch
        ? "model-switch"
        : realtimeEntryConfirmOpen
          ? "realtime-entry"
          : taskCenterOpen
            ? (taskHistoryClearConfirmOpen ? "task-history-confirm" : "task-center")
            : audioLibraryOpen
              ? "audio-library"
              : referenceAudioEditor
                ? "reference-editor"
                : voiceManagerOpen
                  ? "voice-manager"
                  : resultVoiceSaveOpen
                    ? "voice-save"
                    : monitorPanelOpen
                      ? "monitor"
                      : activeWorkspace === "transcription" || activeWorkspace === "sampler" || activeWorkspace === "enhancement" || activeWorkspace === "separation"
                        ? "workspace"
                        : null;

  const localModels = useMemo(
    () => models.filter(isLocalSynthesisModel),
    [models]
  );
  const selectedModelInfo = useMemo(
    () => localModels.find((model) => model.id === selectedModel),
    [localModels, selectedModel]
  );
  const selectedModelInstance = useMemo(
    () => modelInstances.find((instance) => instance.model_id === selectedModel),
    [modelInstances, selectedModel]
  );
  const isDoubao = selectedModel === "doubao-web";
  const selectedDoubaoVoice = useMemo(
    () => doubaoVoices.find((voice) => voice.style_id === selectedDoubaoVoiceId) ?? doubaoVoices[0] ?? null,
    [doubaoVoices, selectedDoubaoVoiceId]
  );
  const visibleDoubaoVoices = useMemo(() => {
    const query = doubaoVoiceSearch.trim().toLocaleLowerCase();
    if (!query) {
      return doubaoVoices;
    }
    return doubaoVoices.filter((voice) =>
      [voice.name, voice.gender, voice.age, voice.language, ...voice.tags]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(query))
    );
  }, [doubaoVoiceSearch, doubaoVoices]);
  const batchProjectDoubaoVoice = useMemo(
    () => doubaoVoices.find((voice) => voice.style_id === batchProjectDoubaoVoiceId) ?? doubaoVoices[0] ?? null,
    [batchProjectDoubaoVoiceId, doubaoVoices]
  );
  const batchProjectModelInfo = useMemo(
    () => localModels.find((model) => model.id === batchProjectModel),
    [localModels, batchProjectModel]
  );
  const batchProjectVoices = useMemo(
    () => customVoices.filter((voice) => !voice.modelBinding || voice.modelBinding.modelId === batchProjectModel),
    [customVoices, batchProjectModel]
  );
  const batchProjectVoiceInfo = useMemo(
    () => batchProjectVoices.find((voice) => voice.id === batchProjectVoiceId) ?? batchProjectVoices[0] ?? null,
    [batchProjectVoices, batchProjectVoiceId]
  );

  const visibleManagedVoices = useMemo(
    () => customVoices.filter((voice) => !voice.modelBinding || voice.modelBinding.modelId === selectedModel),
    [customVoices, selectedModel]
  );
  const appendableVoiceRoles = useMemo(
    () => customVoices.filter((voice) => !voice.modelBinding),
    [customVoices]
  );
  const availableVoices = visibleManagedVoices;

  const selectedVoiceInfo = useMemo(
    () => availableVoices.find((voice) => voice.id === selectedVoice) ?? availableVoices[0] ?? voicePresets[0],
    [availableVoices, selectedVoice]
  );
  const managedVoice = useMemo(
    () => visibleManagedVoices.find((voice) => voice.id === managedVoiceId) ?? visibleManagedVoices[0] ?? null,
    [visibleManagedVoices, managedVoiceId]
  );
  const managedReference = useMemo(
    () => managedVoice?.references.find((reference) => reference.id === managedReferenceId)
      ?? managedVoice?.references.find((reference) => reference.id === managedVoice.activeReferenceId)
      ?? managedVoice?.references[0]
      ?? null,
    [managedReferenceId, managedVoice]
  );
  const filteredManagedVoices = useMemo(() => {
    const query = voiceManagerQuery.trim().toLocaleLowerCase();
    return visibleManagedVoices.filter((voice) =>
      (voiceManagerFilter !== "favorites" || voiceFavoriteIds.includes(voice.id))
      && (!query || [voice.name, voice.subtitle, ...voice.references.map((reference) => reference.name)]
        .some((value) => value.toLocaleLowerCase().includes(query)))
    );
  }, [voiceFavoriteIds, voiceManagerFilter, visibleManagedVoices, voiceManagerQuery]);
  const visibleFavoriteVoiceCount = useMemo(
    () => visibleManagedVoices.filter((voice) => voiceFavoriteIds.includes(voice.id)).length,
    [voiceFavoriteIds, visibleManagedVoices]
  );
  const settingsDirty = useMemo(
    () => settingsDraftHasChanges(settingsDraft, appSettings),
    [appSettings, settingsDraft]
  );
  const globalLlmDirty = useMemo(
    () => globalLlmSettings.baseUrl !== savedGlobalLlmSettings.baseUrl
      || globalLlmSettings.model !== savedGlobalLlmSettings.model
      || globalLlmSettings.apiKey !== savedGlobalLlmSettings.apiKey,
    [globalLlmSettings, savedGlobalLlmSettings]
  );
  const voiceManagerDirty = useMemo(() => {
    if (!managedVoice) {
      return false;
    }
    if (voiceManagerDraft.name.trim() !== managedVoice.name) {
      return true;
    }
    if (!managedReference) {
      return false;
    }
    return voiceManagerDraft.referenceName.trim() !== managedReference.name
      || (voiceManagerDraft.referenceText.trim() || "") !== (managedReference.referenceText?.trim() || "");
  }, [managedReference, managedVoice, voiceManagerDraft]);
  const managedReferenceRecognitionKey = managedVoice && managedReference ? `${managedVoice.id}:${managedReference.id}` : "";
  const editingBatchProject = useMemo(
    () => batchProjects.find((project) => project.id === editingBatchProjectId) ?? null,
    [batchProjects, editingBatchProjectId]
  );
  const batchProjectLocked =
    editingBatchProject?.status === "queued" ||
    editingBatchProject?.status === "running" ||
    editingBatchProject?.status === "cancelling";
  const batchProjectCanStop = editingBatchProject?.status === "queued" || editingBatchProject?.status === "running";
  const batchProjectCanResume = editingBatchProject?.status === "cancelled";
  const batchProjectSegmentCount = batchProjectSegments.filter((segment) => segment.trim()).length;
  const batchProjectReferenceText = batchProjectVoiceInfo?.referenceText?.trim() ?? "";
  const batchProjectHasReference = Boolean(batchProjectVoiceInfo?.referenceAudio);
  const batchProjectShowsControlPrompt = supportsControlPrompt(batchProjectModelInfo, cloneMode);
  const batchProjectShowsSpeedControl = hasFeature(batchProjectModelInfo, "duration_control");

  const supportedCloneModes = useMemo(() => getSupportedCloneModes(selectedModelInfo), [selectedModelInfo]);
  const startupModelOptions = useMemo(() => {
    const enabledModelIds = new Set(modelInstances.filter((instance) => instance.enabled).map((instance) => instance.model_id));
    const enabledModels = localModels.filter((model) => enabledModelIds.has(model.id));
    return enabledModels.length > 0 ? enabledModels : localModels;
  }, [localModels, modelInstances]);
  const supportedCloneModeKey = supportedCloneModes.join("|");
  const needsReferenceAudio = cloneModeNeedsVoice(cloneMode);
  const effectiveReferenceText = referenceText.trim() || selectedVoiceInfo.referenceText || "";
  const needsExtremeReferenceText = cloneModeNeedsReferenceText(cloneMode);
  const showControlPrompt = supportsControlPrompt(selectedModelInfo, cloneMode);
  const controlPromptContextKey = `${selectedModel}:${cloneMode}`;
  const controlPrompt = controlPromptDrafts[controlPromptContextKey] ?? "";
  const controlPromptPresets = getControlPromptPresets(selectedModelInfo, cloneMode);
  const setControlPrompt = (value: string) => {
    setControlPromptDrafts((drafts) => ({ ...drafts, [controlPromptContextKey]: value }));
  };
  // 音色库是角色资产，不是某一种生成模式的临时参数。音色设计模式虽然
  // 不会把参考音频提交给 TTS，也仍应让用户看见、管理并预先选择已有音色。
  // 之前把整个列表随 needsReferenceAudio 隐藏，导致“1 个音色”与“没有
  // 可用音色”同时出现，误导用户认为导入数据丢失。
  const showVoiceLibrary = true;
  const showCfgSteps = selectedModel === "voxcpm2";
  const showIndexSampling = selectedModel === "indextts2";
  const showSpeedControl = hasFeature(selectedModelInfo, "duration_control");
  const showNormalizeToggle = selectedModel === "voxcpm2";
  const showDenoiseToggle = selectedModel === "voxcpm2";
  const hasParameterControls = showCfgSteps || showIndexSampling || showSpeedControl || showNormalizeToggle || showDenoiseToggle;
  const hasActiveBatchGeneration = batchProjects.some((project) =>
    project.status === "queued" || project.status === "running" || project.status === "cancelling"
  );
  const modelWarmupBusy = modelWarmupState?.status === "waiting" || modelWarmupState?.status === "warming";
  const isRealtimeWorkspace = generationWorkspace === "realtime";
  const modelSwitchLocked = loading || hasActiveBatchGeneration || modelWarmupBusy;
  const modelSwitchLockMessage = loading
    ? "当前语音任务正在生成，模型切换已锁定。任务结束后才能切换。"
    : hasActiveBatchGeneration
      ? "批量语音任务正在执行或排队，模型切换已锁定。任务结束后才能切换。"
      : modelWarmupState?.message ?? "模型正在预热，完成后才能继续切换。";
  const online = models.length > 0 && !backendError;
  const visibleError = error ?? backendError;
  const resultSavedToVoiceLibrary = Boolean(result && savedVoicePath === result.file_path);
  const referenceAudioSelectionDuration = referenceAudioEditor
    ? Math.max(0, referenceAudioEditor.trimEndSeconds - referenceAudioEditor.trimStartSeconds)
    : 0;
  const doubaoUsable = doubaoStatus?.status === "ready" && (doubaoStatus.cookies.valid ?? 0) > 0;
  const currentVoiceName = isDoubao ? selectedDoubaoVoice?.name ?? "未选择音色" : selectedVoiceInfo.name;
  const canGenerate =
    input.trim().length > 0 &&
    !loading &&
    (!modelWarmupBusy || isDoubao) &&
    (isDoubao ? doubaoUsable && Boolean(selectedDoubaoVoice) : isModelInstanceUsable(selectedModelInstance)) &&
    (!needsReferenceAudio || Boolean(selectedVoiceInfo.referenceAudio)) &&
    (!needsExtremeReferenceText || effectiveReferenceText.trim().length > 0);
  const audioUrl = result ? toAudioUrl(result.audio_url) : "";
  const progress = playbackDuration > 0 ? Math.min((playbackTime / playbackDuration) * 100, 100) : 0;
  const generationProgress = activeSpeechJob
    ? getSpeechJobProgress(activeSpeechJob)
    : getGenerationProgress(selectedModel, elapsedSeconds);
  const activeGenerationPhases = isDoubao
    ? ["校验账号", "等待队列", "云端合成", "保存音频"]
    : generationPhases;
  const apiBaseLabel = getApiBase().replace(/^https?:\/\//, "");
  const realtimeVoxModelInfo = localModels.find((model) => model.id === "voxcpm2");
  const realtimeVoxModelInstance = modelInstances.find((instance) => instance.model_id === "voxcpm2");
  const inspectorModelInfo = isRealtimeWorkspace ? realtimeVoxModelInfo : selectedModelInfo;
  const inspectorModelInstance = isRealtimeWorkspace ? realtimeVoxModelInstance : selectedModelInstance;
  const realtimeEngineStatus = realtimeRuntimeState === "ready"
    ? "ASR + Whispera 已预热，等待对话"
    : realtimeRuntimeState === "reserving"
      ? "正在预热引擎"
      : realtimeRuntimeState === "error"
        ? "预热异常"
        : "等待进入实时模式";
  const workerStatus =
    isRealtimeWorkspace || isDoubao
      ? undefined
      : selectedModel === "voxcpm2"
      ? systemStatus?.workers.voxcpm2
      : selectedModel === "gptsovits"
        ? systemStatus?.workers.gptsovits
        : systemStatus?.workers.indextts2;
  const pendingSwitchLoadedModels = (pendingModelSwitch?.loadedModelIds ?? []).map(
    (modelId) => models.find((model) => model.id === modelId)?.display_name ?? modelId
  );
  const pendingSwitchTarget = pendingModelSwitch
    ? models.find((model) => model.id === pendingModelSwitch.targetModelId)
    : null;
  const pendingSwitchIsCloud = pendingModelSwitch?.targetModelId === "doubao-web";
  const samplerBridgeAvailable = typeof window !== "undefined" && Boolean(window.desktopBilibiliSampler);
  const samplerSelectedItem = useMemo(() => {
    const parsedLink = samplerState.parsedLink;
    if (!parsedLink) {
      return null;
    }
    return parsedLink.items.find((item) => item.id === samplerState.selection.itemId) ?? parsedLink.items[0] ?? null;
  }, [samplerState.parsedLink, samplerState.selection.itemId]);
  const samplerDefaultName = useMemo(
    () => getSamplerDefaultName(samplerState.parsedLink, samplerSelectedItem),
    [samplerState.parsedLink, samplerSelectedItem]
  );
  const samplerStartValue = parseOptionalSeconds(samplerStartSeconds);
  const samplerEndValue = parseOptionalSeconds(samplerEndSeconds);
  const samplerSelectionStartSeconds = samplerVideoDuration > 0
    ? Math.max(0, Math.min(samplerVideoDuration, Number.isFinite(samplerStartValue) ? samplerStartValue ?? 0 : 0))
    : 0;
  const samplerSelectionEndSeconds = samplerVideoDuration > 0
    ? Math.max(samplerSelectionStartSeconds, Math.min(samplerVideoDuration, Number.isFinite(samplerEndValue) ? samplerEndValue ?? samplerVideoDuration : samplerVideoDuration))
    : 0;
  const samplerClipError =
    Number.isNaN(samplerStartValue)
      ? "开始时间必须是数字"
      : Number.isNaN(samplerEndValue)
        ? "结束时间必须是数字"
        : samplerStartValue !== null && samplerStartValue < 0
          ? "开始时间不能小于 0"
          : samplerVideoDuration > 0 && samplerStartValue !== null && samplerStartValue > samplerVideoDuration
            ? "开始时间不能超过视频总时长"
            : samplerVideoDuration > 0 && samplerEndValue !== null && samplerEndValue > samplerVideoDuration
              ? "结束时间不能超过视频总时长"
          : samplerEndValue !== null && samplerEndValue <= (samplerStartValue ?? 0)
            ? "结束时间必须大于开始时间"
            : null;
  const samplerExtracting = ["downloading-video", "downloading-audio", "converting", "merging"].includes(samplerState.taskStage);
  const samplerBusy =
    Boolean(samplerPendingAction) ||
    samplerState.taskStage === "parsing" ||
    samplerState.taskStage === "loading-audio-options" ||
    samplerExtracting;
  const samplerCanExtract = Boolean(
    samplerBridgeAvailable &&
      samplerState.parsedLink &&
      samplerSelectedItem &&
      samplerState.audioOptionSummary?.hasAudio &&
      samplerName.trim() &&
      !samplerClipError &&
      !samplerBusy
  );
  const samplerCanDownloadVideo = Boolean(
    samplerBridgeAvailable &&
      samplerState.parsedLink &&
      samplerSelectedItem &&
      samplerState.audioOptionSummary?.hasAudio &&
      samplerState.audioOptionSummary?.hasVideo &&
      !samplerBusy
  );
  const samplerFeedback = samplerState.error ?? samplerClipError ?? samplerMessage;
  const samplerFeedbackIsError = Boolean(samplerState.error || samplerClipError);
  const samplerTask = useMemo<TaskSummary | null>(() => {
    const stage = samplerState.taskStage;
    if (stage === "idle" && !samplerPendingAction) {
      return null;
    }
    const status = stage === "completed"
      ? "completed"
      : stage === "failed"
        ? "failed"
        : stage === "cancelled"
          ? "cancelled"
          : "running";
    const now = new Date().toISOString();
    const message = samplerState.error ?? samplerStageLabel(stage);
    return {
      id: "desktop-bilibili-sampler",
      source: "bilibili",
      title: samplerState.parsedLink?.title ?? "B 站音色取样",
      status,
      stage,
      progress_percent: samplerTaskProgress(stage),
      created_at: now,
      updated_at: now,
      error: samplerState.error,
      retryable: status === "failed" || status === "cancelled",
      cancelable: ["downloading-video", "downloading-audio", "converting", "merging"].includes(stage),
      events: [{ occurred_at: now, stage, message, level: samplerState.error ? "error" : "info" }],
      results: []
    };
  }, [samplerPendingAction, samplerState]);
  const bilibiliHistoryTasks = useMemo<TaskSummary[]>(() => bilibiliHistoryItems.map((item) => ({
    id: `bilibili:${item.id}`,
    source: "bilibili",
    title: item.title ?? item.itemTitle ?? "B 站媒体下载",
    status: item.exists ? "completed" : "failed",
    stage: item.exists ? "downloaded" : "file_missing",
    progress_percent: item.exists ? 100 : 0,
    created_at: item.downloadedAt,
    updated_at: item.downloadedAt,
    completed_at: item.downloadedAt,
    error: item.exists ? null : "历史下载文件已不存在。",
    retryable: !item.exists,
    cancelable: false,
    events: [{
      occurred_at: item.downloadedAt,
      stage: item.exists ? "downloaded" : "file_missing",
      message: item.exists ? "媒体下载已完成，可在成果中心继续取样或转写。" : "历史下载记录仍在，但本地媒体文件已不存在。",
      level: item.exists ? "info" : "error"
    }],
    results: []
  })), [bilibiliHistoryItems]);
  const taskCenterTasks = useMemo(() => {
    const ebookTasks = ebookPrefetchTasks.map(asEbookTaskSummary);
    const allTasks = samplerTask
      ? [samplerTask, ...bilibiliHistoryTasks, ...ebookTasks, ...remoteTasks]
      : [...bilibiliHistoryTasks, ...ebookTasks, ...remoteTasks];
    return [...allTasks].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [bilibiliHistoryTasks, ebookPrefetchTasks, remoteTasks, samplerTask]);
  const taskCenterResults = useMemo<TaskCenterResult[]>(() => {
    const results: TaskCenterResult[] = [];
    const representedFilePaths = new Set<string>();
    for (const task of taskCenterTasks) {
      for (const result of task.results ?? []) {
        if (result.file_path) {
          representedFilePaths.add(result.file_path);
        }
        results.push({
          ...result,
          task_id: task.id,
          task_title: task.title,
          source: task.source,
          status: task.status,
          created_at: task.completed_at ?? task.updated_at,
          asset: result.file_path ? audioAssets.find((asset) => asset.file_path === result.file_path) ?? null : null,
          relation: "task",
          summary_only: result.kind === "ebook"
        });
      }
    }
    for (const asset of audioAssets) {
      if (representedFilePaths.has(asset.file_path)) {
        continue;
      }
      results.push({
        id: `asset:${asset.asset_id}`,
        kind: "audio",
        label: audioAssetSourceLabel(asset.source),
        file_name: asset.file_name,
        file_path: asset.file_path,
        url: asset.audio_url,
        mime_type: null,
        size_bytes: asset.file_size_bytes,
        duration_seconds: asset.duration_seconds,
        model: asset.model,
        text: asset.text,
        exists: true,
        downloadable: true,
        task_id: asset.task_id ?? `asset:${asset.asset_id}`,
        task_title: asset.project_title ?? asset.file_name,
        source: asset.source,
        status: "completed",
        created_at: asset.modified_at,
        asset,
        relation: "orphan"
      });
    }
    for (const item of bilibiliHistoryItems) {
      results.push({
        id: `bilibili:${item.id}`,
        kind: "video",
        label: "B 站视频下载",
        file_name: `${item.title ?? item.itemTitle ?? "B站视频"}.mp4`,
        file_path: null,
        url: item.previewUrl,
        mime_type: "video/mp4",
        size_bytes: item.fileSizeBytes,
        duration_seconds: null,
        model: item.videoQuality?.label ?? "B 站下载",
        text: item.itemTitle ?? item.title,
        exists: item.exists,
        downloadable: true,
        task_id: `bilibili:${item.id}`,
        task_title: item.title ?? item.itemTitle ?? "B 站视频",
        source: "bilibili",
        status: "completed",
        created_at: item.downloadedAt,
        asset: null,
        bilibili_history_id: item.id,
        relation: "history"
      });
    }
    return results.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  }, [audioAssets, bilibiliHistoryItems, taskCenterTasks]);
  const visibleTaskCenterResults = useMemo(() => {
    const search = taskCenterSearch.trim().toLocaleLowerCase();
    return taskCenterResults.filter((result) => {
      const matchesKind = taskCenterResultFilter === "all"
        || result.kind === taskCenterResultFilter
        || (taskCenterResultFilter === "orphan" && result.relation === "orphan")
        || (taskCenterResultFilter === "audio_family" && ["audio", "enhancement", "separation"].includes(result.kind))
        || (taskCenterResultFilter === "ebook" && result.kind === "ebook")
        || (taskCenterResultFilter === "documents" && ["transcript", "subtitle", "alignment"].includes(result.kind))
        || (taskCenterResultFilter === "media" && ["audio", "enhancement", "separation", "video"].includes(result.kind));
      if (!matchesKind) {
        return false;
      }
      if (taskCenterSourceFilter !== "all" && result.source !== taskCenterSourceFilter) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [result.file_name, result.label, result.task_title, result.model, result.text, taskSourceLabel(result.source), taskResultRelationLabel(result.relation)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [taskCenterResultFilter, taskCenterResults, taskCenterSearch, taskCenterSourceFilter]);
  const visibleTaskCenterResultGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; results: TaskCenterResult[] }>();
    for (const result of visibleTaskCenterResults) {
      const dateGroup = resultDateGroup(result.created_at);
      const group = groups.get(dateGroup.key) ?? { ...dateGroup, results: [] };
      group.results.push(result);
      groups.set(dateGroup.key, group);
    }
    return [...groups.values()];
  }, [visibleTaskCenterResults]);
  useEffect(() => {
    setCollapsedResultDateGroups((current) => {
      if (visibleTaskCenterResultGroups.length === 0) return new Set();
      const visibleKeys = new Set(visibleTaskCenterResultGroups.map((group) => group.key));
      const newlyVisibleGroups = visibleTaskCenterResultGroups.filter((group) => !seenResultDateGroupsRef.current.has(group.key));
      const next = new Set([...current].filter((key) => visibleKeys.has(key)));
      for (const group of newlyVisibleGroups) {
        if (group.key !== visibleTaskCenterResultGroups[0].key) next.add(group.key);
      }
      // The first group is the user's current result window.  Keep it open
      // after a filter/search change even if that date group was previously
      // collapsed while browsing another result set.
      next.delete(visibleTaskCenterResultGroups[0].key);
      seenResultDateGroupsRef.current = visibleKeys;
      return next;
    });
  }, [visibleTaskCenterResultGroups]);
  useEffect(() => {
    const visibleIds = new Set(visibleTaskCenterResults.map((result) => result.id));
    setSelectedTaskResultIds((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
    setSelectedTaskResultId((current) => {
      if (!visibleTaskCenterResults.length) {
        return null;
      }
      return current && visibleIds.has(current) ? current : visibleTaskCenterResults[0].id;
    });
  }, [visibleTaskCenterResults]);
  const selectedTaskResults = useMemo(
    () => taskCenterResults.filter((result) => selectedTaskResultIds.includes(result.id)),
    [selectedTaskResultIds, taskCenterResults]
  );
  const selectableVisibleTaskResults = useMemo(
    () => visibleTaskCenterResults.filter((result) => !result.summary_only),
    [visibleTaskCenterResults]
  );
  const allVisibleTaskResultsSelected = selectableVisibleTaskResults.length > 0
    && selectableVisibleTaskResults.every((result) => selectedTaskResultIds.includes(result.id));
  const activeTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "cancelling").length,
    [taskCenterTasks]
  );
  const retryableTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => task.retryable).length,
    [taskCenterTasks]
  );
  const retryableManageTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => task.retryable && ["speech", "batch_project"].includes(task.source)).length,
    [taskCenterTasks]
  );
  const missingTaskResultCount = useMemo(
    () => taskCenterResults.filter((result) => !result.exists).length,
    [taskCenterResults]
  );
  const orphanTaskResultCount = useMemo(
    () => taskCenterResults.filter((result) => result.relation === "orphan").length,
    [taskCenterResults]
  );
  const selectedTaskResult = useMemo(
    () => visibleTaskCenterResults.find((result) => result.id === selectedTaskResultId) ?? visibleTaskCenterResults[0] ?? null,
    [selectedTaskResultId, visibleTaskCenterResults]
  );
  const selectedEbookTaskId = selectedTaskResult?.summary_only
    ? selectedTaskResult.task_id.replace(/^ebook:/, "")
    : null;
  useEffect(() => {
    let disposed = false;
    if (!selectedEbookTaskId) {
      setEbookInspectorSummary(null);
      setEbookInspectorChapterId(null);
      setEbookInspectorError(null);
      setEbookInspectorLoading(false);
      return undefined;
    }
    setEbookInspectorLoading(true);
    setEbookInspectorError(null);
    void fetchDoubaoPrefetchTaskSummary(selectedEbookTaskId)
      .then((summary) => {
        if (disposed) return;
        setEbookInspectorSummary(summary);
        setEbookInspectorChapterId((current) => current && summary.chapters.some((chapter) => chapter.chapterId === current)
          ? current
          : summary.chapters[0]?.chapterId ?? null);
      })
      .catch((error) => {
        if (disposed) return;
        setEbookInspectorSummary(null);
        setEbookInspectorError(error instanceof Error ? error.message : "无法读取电子书章节成果");
      })
      .finally(() => {
        if (!disposed) setEbookInspectorLoading(false);
      });
    return () => { disposed = true; };
  }, [selectedEbookTaskId]);
  const selectedEbookChapter = ebookInspectorSummary?.chapters.find((chapter) => chapter.chapterId === ebookInspectorChapterId)
    ?? ebookInspectorSummary?.chapters[0]
    ?? null;
  const taskResultSources = useMemo(
    () => [...new Set(taskCenterResults.map((result) => result.source))]
      .map((source) => ({ source, count: taskCenterResults.filter((result) => result.source === source).length }))
      .sort((left, right) => right.count - left.count),
    [taskCenterResults]
  );
  const completedTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => ["succeeded", "completed"].includes(task.status)).length,
    [taskCenterTasks]
  );
  const failedTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => task.status === "failed").length,
    [taskCenterTasks]
  );
  const cancelledTaskCount = useMemo(
    () => taskCenterTasks.filter((task) => task.status === "cancelled").length,
    [taskCenterTasks]
  );
  const taskCenterSources = useMemo(
    () => [...new Set(taskCenterTasks.map((task) => task.source))]
      .map((source) => ({ source, count: taskCenterTasks.filter((task) => task.source === source).length }))
      .sort((left, right) => right.count - left.count),
    [taskCenterTasks]
  );
  const visibleTaskCenterTasks = useMemo(() => {
    const search = taskCenterTaskSearch.trim().toLocaleLowerCase();
    return taskCenterTasks.filter((task) => {
      const isActive = ["queued", "running", "cancelling"].includes(task.status);
      const matchesStatus = taskCenterStatusFilter === "all"
        || (taskCenterStatusFilter === "active" && isActive)
        || (taskCenterStatusFilter === "completed" && ["succeeded", "completed"].includes(task.status))
        || (taskCenterStatusFilter === "failed" && task.status === "failed")
        || (taskCenterStatusFilter === "attention" && task.retryable)
        || (taskCenterStatusFilter === "cancelled" && task.status === "cancelled")
        || (taskCenterStatusFilter === "missing" && taskHasMissingResult(task));
      const matchesSource = taskCenterTaskSourceFilter === "all"
        || (taskCenterTaskSourceFilter === "batch" && ["batch_project", "ebook"].includes(task.source))
        || task.source === taskCenterTaskSourceFilter;
      if (!matchesStatus || !matchesSource) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [task.title, task.stage, task.error, taskSourceLabel(task.source), ...task.events.map((event) => event.message)]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [taskCenterStatusFilter, taskCenterTaskSearch, taskCenterTaskSourceFilter, taskCenterTasks]);
  const taskCenterFiltersActive = Boolean(
    taskCenterTaskSearch.trim()
    || taskCenterStatusFilter !== "all"
    || taskCenterTaskSourceFilter !== "all"
  );
  const clearableSpeechTaskCount = useMemo(
    () => remoteTasks.filter(
      (task) => task.source === "speech" && ["succeeded", "failed", "cancelled"].includes(task.status)
    ).length,
    [remoteTasks]
  );
  const visibleAudioAssets = useMemo(() => {
    const search = audioLibrarySearch.trim().toLocaleLowerCase();
    return audioAssets.filter((asset) => {
      if (audioLibrarySource !== "all" && asset.origin !== audioLibrarySource) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [asset.file_name, asset.model, asset.text, asset.project_title]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(search));
    });
  }, [audioAssets, audioLibrarySearch, audioLibrarySource]);
  useEffect(() => {
    setSelectedAudioAssetPath((current) => current && visibleAudioAssets.some((asset) => asset.file_path === current)
      ? current
      : visibleAudioAssets[0]?.file_path ?? null
    );
  }, [visibleAudioAssets]);
  const selectedAudioAsset = useMemo(
    () => visibleAudioAssets.find((asset) => asset.file_path === selectedAudioAssetPath) ?? visibleAudioAssets[0] ?? null,
    [selectedAudioAssetPath, visibleAudioAssets]
  );
  const gpuAvailable = Boolean(systemStatus?.gpu.available);
  const resourceMetrics = [
    {
      id: "cpu",
      label: "CPU",
      value: systemStatus?.system.cpu_percent,
      detail: formatPercent(systemStatus?.system.cpu_percent),
      available: Boolean(systemStatus)
    },
    {
      id: "memory",
      label: "内存",
      value: systemStatus?.system.memory_percent,
      detail: formatMemory(systemStatus?.system.memory_used_mb, systemStatus?.system.memory_total_mb),
      available: Boolean(systemStatus)
    },
    {
      id: "gpu",
      label: "GPU",
      value: systemStatus?.gpu.utilization_percent,
      detail: gpuAvailable ? formatPercent(systemStatus?.gpu.utilization_percent) : "未检测到",
      available: gpuAvailable
    },
    {
      id: "vram",
      label: "显存",
      value: systemStatus?.gpu.memory_percent,
      detail: gpuAvailable ? formatMemory(systemStatus?.gpu.memory_used_mb, systemStatus?.gpu.memory_total_mb) : "未检测到",
      available: gpuAvailable
    }
  ];

  function renderSystemMonitorPanels() {
    return (
      <>
        <section className="softPanel inspectorPanel">
          <div className="panelTitle">
            <Server size={17} strokeWidth={1.9} />
            <span>运行状态</span>
          </div>
          <div className="workerSummary">
            <div className="statusBadgeRow">
              <span className={isRealtimeWorkspace ? (realtimeRuntimeState === "ready" ? "workerBadge loaded" : realtimeRuntimeState === "error" ? "workerBadge warning" : "workerBadge") : isDoubao ? (doubaoUsable ? "workerBadge loaded" : "workerBadge warning") : workerStatus?.loaded ? "workerBadge loaded" : "workerBadge"}>
                {isRealtimeWorkspace ? (realtimeRuntimeState === "ready" ? "实时已预热" : realtimeRuntimeState === "reserving" ? "预热中" : realtimeRuntimeState === "error" ? "预热异常" : "待命") : isDoubao ? (doubaoUsable ? "云端就绪" : "需要登录") : workerBadgeText(workerStatus, selectedModel)}
              </span>
              <strong>{isRealtimeWorkspace ? realtimeEngineStatus : workerReleaseText(workerStatus, selectedModel)}</strong>
            </div>
            <span className="workerDetail">
              {isRealtimeWorkspace ? "实时对话同时保持 SenseVoice ASR 与 Whispera 流式 VoxCPM2；两者串行使用 GPU，普通模型预热已锁定。" : isDoubao && doubaoStateError ? doubaoStateError : workerDetailText(workerStatus, selectedModel)}
            </span>
          </div>
          <div className="inspectorRows">
            <div>
              <span>{isRealtimeWorkspace ? "实时引擎" : "当前模型"}</span>
              <strong>{isRealtimeWorkspace ? "Whispera + VoxCPM2" : selectedModelInfo?.display_name ?? selectedModel}</strong>
            </div>
            <div>
              <span>模型健康</span>
              <strong>{isRealtimeWorkspace ? modelInstanceStatusLabel(inspectorModelInstance?.status) : isDoubao ? (doubaoUsable ? "账号可用" : "等待账号") : modelInstanceStatusLabel(selectedModelInstance?.status)}</strong>
            </div>
            <div>
              <span>后端运行</span>
              <strong>{systemStatus ? formatUptime(systemStatus.api.uptime_seconds) : "-"}</strong>
            </div>
            <div>
              <span>显存建议</span>
              <strong>{isDoubao && !isRealtimeWorkspace ? "不占用本地显存" : inspectorModelInfo ? `${inspectorModelInfo.recommended_vram_gb} GB` : "-"}</strong>
            </div>
            <div>
              <span>采样率</span>
              <strong>{inspectorModelInfo ? `${inspectorModelInfo.native_sample_rate} Hz` : "-"}</strong>
            </div>
            <div>
              <span>商用状态</span>
              <strong>{inspectorModelInfo?.commercial_use ?? "-"}</strong>
            </div>
          </div>
        </section>

        <section className="softPanel resourcePanel">
          <div className="panelTitle">
            <Cpu size={17} strokeWidth={1.9} />
            <span>系统监控</span>
          </div>
          <div className="resourceList">
            {resourceMetrics.map((metric) => (
              <div key={metric.id} className={metric.available ? "resourceMetric" : "resourceMetric unavailable"}>
                <div className="metricHeader">
                  <span>{metric.label}</span>
                  <strong>{metric.detail}</strong>
                </div>
                <div className="metricTrack" aria-label={metric.label}>
                  <span style={{ width: `${metric.available ? clampPercent(metric.value) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="monitorNote">
            {gpuAvailable
              ? systemStatus?.gpu.name ?? "GPU 状态已接入"
              : "未检测到 NVIDIA GPU，显存数据会保持为空。"}
          </p>
        </section>

        {(loading || result) && (
          <section className="softPanel meterPanel">
            <div className="panelTitle">
              <Gauge size={17} strokeWidth={1.9} />
              <span>任务监控</span>
            </div>
            <div className="taskStatusCard">
              <div className="taskState">
                <span className={loading ? "taskStateIcon active" : "taskStateIcon"}>
                  {loading ? <Loader2 className="spin" size={18} /> : <Gauge size={18} strokeWidth={1.9} />}
                </span>
                <div>
                  <strong>{loading ? generationProgress.phaseTitle : "生成完成"}</strong>
                  <span>{loading ? generationProgress.detail : "音频已写入本地输出目录。"}</span>
                </div>
              </div>
              <div className="sideProgress">
                <span style={{ width: `${loading ? generationProgress.percent : 100}%` }} />
              </div>
            </div>
            <div className="meterMeta">
              <span>{loading ? "推理中" : "已完成"}</span>
              <strong>{loading ? formatDuration(elapsedSeconds) : formatDuration(result?.duration_seconds)}</strong>
            </div>
          </section>
        )}

        {visibleError && (
          <section className="errorPanel">
            <AlertCircle size={18} strokeWidth={1.9} />
            <span>{visibleError}</span>
          </section>
        )}
      </>
    );
  }

  async function loadModels() {
    setBackendError(null);
    try {
      const loaded = await fetchModels();
      setModels(loaded);
      const availableLocalModels = loaded.filter(isLocalSynthesisModel);
      const preferred = availableLocalModels.find((model) => model.id === "indextts2") ?? availableLocalModels[0];
      if (preferred && !availableLocalModels.some((model) => model.id === selectedModel)) {
        setSelectedModel(preferred.id);
      }
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "无法连接本地 API");
      void recoverLocalBackend();
    }
  }

  async function recoverLocalBackend() {
    if (!window.desktopBackend?.ensureOnline || backendRecoveryRequestRef.current) {
      return;
    }
    backendRecoveryRequestRef.current = true;
    setBackendError("本地后端连接中断，正在自动恢复…");
    try {
      const recovery = await window.desktopBackend.ensureOnline();
      if (!recovery.ready) {
        setBackendError(recovery.message || "本地后端暂未恢复，请查看任务诊断后重试。");
        return;
      }
      setBackendError(null);
      await Promise.all([
        loadModels(),
        loadVoices(),
        loadSystemStatus(),
        loadModelInstances(),
        loadModelPackages(),
        loadTaskSummaries(),
        loadDoubaoState()
      ]);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "本地后端自动恢复失败。");
    } finally {
      backendRecoveryRequestRef.current = false;
    }
  }

  async function loadVoices() {
    try {
      const loadedVoices = await fetchVoices();
      setCustomVoices(
        loadedVoices
          .map(createImportedVoicePreset)
          .filter((voice): voice is VoicePreset => Boolean(voice))
      );
    } catch (err) {
      setBackendError(err instanceof Error ? `音色库读取失败：${err.message}` : "音色库读取失败，请稍后重试。");
      if (isBackendConnectionError(err)) {
        void recoverLocalBackend();
      }
    }
  }

  async function loadDoubaoState() {
    setDoubaoStateError(null);
    try {
      const [nextStatus, nextVoices] = await Promise.all([fetchDoubaoStatus(), fetchDoubaoVoices()]);
      setDoubaoStatus(nextStatus);
      setDoubaoVoices(nextVoices);
      setSelectedDoubaoVoiceId((current) =>
        current && nextVoices.some((voice) => voice.style_id === current) ? current : nextVoices[0]?.style_id ?? ""
      );
      setBatchProjectDoubaoVoiceId((current) =>
        current && nextVoices.some((voice) => voice.style_id === current) ? current : nextVoices[0]?.style_id ?? ""
      );
    } catch (err) {
      setDoubaoStateError(err instanceof Error ? err.message : "无法读取豆包服务状态");
    }
  }

  function mergeManagedVoice(voice: VoiceInfo, select = false, preserveDraft = false) {
    const preset = createImportedVoicePreset(voice);
    if (!preset) {
      return;
    }
    const previous = customVoices.find((item) => item.id === preset.id);
    const preferredReferenceId = previous?.references.find((reference) => reference.id === managedReferenceId)?.id
      ?? preset.activeReferenceId
      ?? preset.references[0]?.id
      ?? null;
    setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
    managedVoiceIdRef.current = preset.id;
    setManagedVoiceId(preset.id);
    setManagedReferenceId(preferredReferenceId);
    if (preserveDraft) {
      setVoiceManagerDraft((draft) => ({ ...draft, name: preset.name }));
    } else {
      setVoiceManagerDraft(createVoiceManagerDraft(preset, preferredReferenceId));
    }
    if (select) {
      selectedVoiceRef.current = preset.id;
      setSelectedVoice(preset.id);
      setReferenceText(preset.referenceText ?? "");
    }
  }

  function applyRecognizedVoice(voice: VoiceInfo) {
    const preset = createImportedVoicePreset(voice);
    if (!preset) {
      return;
    }
    setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
    if (selectedVoiceRef.current === preset.id) {
      setReferenceText(preset.referenceText ?? "");
    }
    if (managedVoiceIdRef.current === preset.id) {
      const selectedReference = preset.references.find((reference) => reference.id === managedReferenceId)
        ?? preset.references.find((reference) => reference.id === preset.activeReferenceId)
        ?? preset.references[0];
      setVoiceManagerDraft((draft) => ({
        ...draft,
        referenceName: selectedReference?.name ?? "",
        referenceText: selectedReference?.referenceText ?? ""
      }));
    }
  }

  function startAutomaticVoiceRecognition(voice: VoiceInfo, referenceId = voice.active_reference_id ?? voice.references[0]?.id) {
    const reference = voice.references.find((item) => item.id === referenceId);
    const requestKey = referenceId ? `${voice.id}:${referenceId}` : voice.id;
    if (!reference?.reference_audio || voiceRecognitionRequestsRef.current.has(requestKey)) {
      return;
    }

    setRecognizingVoiceIds((ids) => [...new Set([...ids, requestKey])]);
    if (selectedVoiceRef.current === voice.id && voice.active_reference_id === reference.id) {
      setVoiceMessage(`${voice.name} 已导入，正在后台识别参考文本…`);
    }
    if (managedVoiceIdRef.current === voice.id && managedReferenceId === reference.id) {
      setVoiceManagerError(null);
      setVoiceManagerMessage("新参考音频已保存，正在后台识别对应原文…");
    }

    const recognition = (async () => {
      try {
        const result = await recognizeVoiceReferenceClip(voice.id, reference.id);
        const updated = await updateVoiceReference(voice.id, reference.id, { reference_text: result.text });
        applyRecognizedVoice(updated);
        if (selectedVoiceRef.current === voice.id && updated.active_reference_id === reference.id) {
          setVoiceMessage(`${voice.name} 的参考文本已自动识别，请在生成前核对。`);
        }
        if (managedVoiceIdRef.current === voice.id && managedReferenceId === reference.id) {
          setVoiceManagerMessage("参考文本已自动识别并保存，建议核对后再用于极致克隆。");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "参考音频识别失败";
        if (selectedVoiceRef.current === voice.id && voice.active_reference_id === reference.id) {
          setVoiceMessage(`自动识别未完成：${message}。可以稍后在音色库中重试。`);
        }
        if (managedVoiceIdRef.current === voice.id && managedReferenceId === reference.id) {
          setVoiceManagerError(`自动识别未完成：${message}`);
        }
      } finally {
        voiceRecognitionRequestsRef.current.delete(requestKey);
        setRecognizingVoiceIds((ids) => ids.filter((id) => id !== requestKey));
        if (voiceRecognitionRequestsRef.current.size === 0 && pendingModelWarmupRef.current) {
          const modelId = pendingModelWarmupRef.current;
          void runModelWarmup(modelId);
        }
      }
    })();

    voiceRecognitionRequestsRef.current.set(requestKey, recognition);
    queueModelWarmup(selectedModelRef.current);
  }

  function stopVoiceManagerPreview() {
    voiceManagerPreviewWaveformRequestRef.current += 1;
    const player = voiceManagerPreviewAudioRef.current;
    if (player) {
      player.onplay = null;
      player.onpause = null;
      player.onended = null;
      player.ontimeupdate = null;
      player.onloadedmetadata = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    voiceManagerPreviewAudioRef.current = null;
    if (voiceManagerPreviewUrlRef.current) {
      URL.revokeObjectURL(voiceManagerPreviewUrlRef.current);
      voiceManagerPreviewUrlRef.current = null;
    }
    setVoiceManagerPreviewId(null);
    setVoiceManagerPreviewPlaying(false);
    setVoiceManagerPreviewLoading(false);
    setVoiceManagerPreviewTime(0);
    setVoiceManagerPreviewDuration(0);
    setVoiceManagerPreviewPeaks([]);
    setVoiceManagerPreviewWaveformStatus("idle");
  }

  async function toggleVoiceManagerPreview(reference: VoiceReferencePreset) {
    if (!reference.referenceAudio) {
      setVoiceManagerError("该参考片段没有可试听的音频。");
      return;
    }
    const currentPlayer = voiceManagerPreviewAudioRef.current;
    if (voiceManagerPreviewId === reference.id && currentPlayer) {
      if (currentPlayer.paused) {
        try {
          await currentPlayer.play();
        } catch (err) {
          setVoiceManagerError(err instanceof Error ? err.message : "无法播放这条参考音频。");
        }
      } else {
        currentPlayer.pause();
      }
      return;
    }

    const readAudio = reference.referenceAudioManaged ? window.desktopFiles?.readManagedReferenceAudio : window.desktopFiles?.readSelectedAudio;
    if (!readAudio) {
      setVoiceManagerError("请在桌面软件中试听参考片段。");
      return;
    }

    stopVoiceManagerPreview();
    setVoiceManagerPreviewLoading(true);
    setVoiceManagerPreviewWaveformStatus("loading");
    setVoiceManagerError(null);
    try {
      const audioBytes = await readAudio(reference.referenceAudio);
      const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(audioBytes).buffer], { type: getAudioMimeType(reference.referenceAudio) }));
      const player = new Audio(previewUrl);
      const waveformRequestId = voiceManagerPreviewWaveformRequestRef.current + 1;
      voiceManagerPreviewWaveformRequestRef.current = waveformRequestId;
      voiceManagerPreviewUrlRef.current = previewUrl;
      voiceManagerPreviewAudioRef.current = player;
      setVoiceManagerPreviewId(reference.id);
      setVoiceManagerPreviewTime(0);
      setVoiceManagerPreviewPeaks([]);
      player.preload = "metadata";
      player.onplay = () => setVoiceManagerPreviewPlaying(true);
      player.onpause = () => setVoiceManagerPreviewPlaying(false);
      player.onended = () => {
        setVoiceManagerPreviewPlaying(false);
        setVoiceManagerPreviewTime(0);
      };
      player.ontimeupdate = () => setVoiceManagerPreviewTime(player.currentTime);
      player.onloadedmetadata = () => setVoiceManagerPreviewDuration(Number.isFinite(player.duration) ? player.duration : 0);
      player.onerror = () => setVoiceManagerError("这条音频无法在应用内播放，请检查编码或换一个文件。");
      void decodeWaveformPeaks(new Uint8Array(audioBytes).buffer)
        .then((peaks) => {
          if (voiceManagerPreviewWaveformRequestRef.current === waveformRequestId) {
            setVoiceManagerPreviewPeaks(peaks);
            setVoiceManagerPreviewWaveformStatus("ready");
          }
        })
        .catch(() => {
          if (voiceManagerPreviewWaveformRequestRef.current === waveformRequestId) {
            setVoiceManagerPreviewWaveformStatus("unavailable");
          }
        });
      await player.play();
    } catch (err) {
      stopVoiceManagerPreview();
      setVoiceManagerError(err instanceof Error ? err.message : "无法读取这条参考音频。");
    } finally {
      setVoiceManagerPreviewLoading(false);
    }
  }

  async function refreshWorkspaceState() {
    if (globalRefreshing) {
      return;
    }
    setGlobalRefreshing(true);
    setGlobalRefreshMessage(null);
    try {
      await Promise.all([
        loadModels(),
        loadVoices(),
        loadSystemStatus(),
        loadAppSettings(),
        loadModelInstances(),
        loadModelPackages(),
        loadTaskSummaries(),
        loadDoubaoState()
      ]);
      setGlobalRefreshMessage({ tone: "success", text: "状态已同步" });
    } catch (err) {
      setGlobalRefreshMessage({
        tone: "error",
        text: err instanceof Error ? `部分状态刷新失败：${err.message}` : "部分状态刷新失败，请稍后重试。"
      });
    } finally {
      setGlobalRefreshing(false);
    }
  }

  async function closeVoiceManager() {
    if (voiceManagerAction) {
      return;
    }
    if (voiceManagerDirty) {
      const confirmed = await requestConfirmation({
        title: "放弃音色修改？",
        message: "当前角色名称或参考片段文字还有未保存修改，关闭后这些修改会丢失。",
        confirmLabel: "放弃修改",
        tone: "danger"
      });
      if (!confirmed) {
        return;
      }
    }
    stopVoiceManagerPreview();
    setVoiceManagerOpen(false);
  }

  function openVoiceManager() {
    stopVoiceManagerPreview();
    const preferred = visibleManagedVoices.find((voice) => voice.id === selectedVoice) ?? visibleManagedVoices[0] ?? null;
    setManagedVoiceId(preferred?.id ?? null);
    const referenceId = preferred?.activeReferenceId ?? preferred?.references[0]?.id ?? null;
    setManagedReferenceId(referenceId);
    setVoiceManagerDraft(createVoiceManagerDraft(preferred, referenceId));
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
    setVoiceManagerQuery("");
    setVoiceManagerFilter("all");
    setAvatarPickerOpen(false);
    setVoiceManagerOpen(true);
    void loadVoices();
  }

  function selectManagedVoice(voice: VoicePreset) {
    stopVoiceManagerPreview();
    setManagedVoiceId(voice.id);
    const referenceId = voice.activeReferenceId ?? voice.references[0]?.id ?? null;
    setManagedReferenceId(referenceId);
    setVoiceManagerDraft(createVoiceManagerDraft(voice, referenceId));
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
    setAvatarPickerOpen(false);
  }

  function selectManagedReference(referenceId: string) {
    if (!managedVoice) {
      return;
    }
    if (referenceId !== managedReference?.id) {
      stopVoiceManagerPreview();
    }
    setManagedReferenceId(referenceId);
    setVoiceManagerDraft(createVoiceManagerDraft(managedVoice, referenceId));
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
  }

  async function onSaveVoiceManagerDetails() {
    if (!managedVoice) {
      return;
    }
    if (!voiceManagerDraft.name.trim()) {
      setVoiceManagerError("请填写角色名称。");
      return;
    }
    if (managedReference && !voiceManagerDraft.referenceName.trim()) {
      setVoiceManagerError("请填写参考片段名称。");
      return;
    }
    setVoiceManagerAction("save");
    setVoiceManagerError(null);
    try {
      const roleNameChanged = voiceManagerDraft.name.trim() !== managedVoice.name;
      const referenceChanged = Boolean(managedReference && (
        voiceManagerDraft.referenceName.trim() !== managedReference.name
        || (voiceManagerDraft.referenceText.trim() || "") !== (managedReference.referenceText?.trim() || "")
      ));
      const renamedRole = roleNameChanged
        ? await updateVoice(managedVoice.id, { name: voiceManagerDraft.name.trim() })
        : null;
      if (roleNameChanged && !referenceChanged) {
        mergeManagedVoice(renamedRole!, selectedVoice === renamedRole!.id);
        setVoiceManagerMessage("角色名称已保存。");
        return;
      }
      let updated: VoiceInfo;
      if (managedReference && referenceChanged) {
        try {
          updated = await updateVoiceReference(renamedRole?.id ?? managedVoice.id, managedReference.id, {
            name: voiceManagerDraft.referenceName.trim(),
            reference_text: voiceManagerDraft.referenceText.trim() || null
          });
        } catch (referenceError) {
          if (renamedRole) {
            mergeManagedVoice(renamedRole, selectedVoice === renamedRole.id, true);
            throw new Error(`角色名称已保存，但参考片段保存失败：${referenceError instanceof Error ? referenceError.message : "请稍后重试"}`);
          }
          throw referenceError;
        }
      } else if (renamedRole) {
        updated = renamedRole;
      } else {
        return;
      }
      mergeManagedVoice(updated, selectedVoice === updated.id);
      setVoiceManagerMessage(managedReference ? "角色名称和当前参考片段已保存。" : "角色名称已保存。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "保存音色失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function openReferenceAudioEditor(sourcePath: string, target: ReferenceAudioEditorTarget, source: "selected" | "managed" = "selected") {
    const readAudio = source === "managed" ? window.desktopFiles?.readManagedReferenceAudio : window.desktopFiles?.readSelectedAudio;
    if (!readAudio) {
      throw new Error("此版本暂不支持导入前试听，请更新桌面软件后重试。");
    }
    const audioBytes = await readAudio(sourcePath);
    const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(audioBytes).buffer], { type: getAudioMimeType(sourcePath) }));
    if (referenceAudioPreviewUrlRef.current) {
      URL.revokeObjectURL(referenceAudioPreviewUrlRef.current);
    }
    referenceAudioPreviewUrlRef.current = previewUrl;
    setReferenceAudioPreviewTime(0);
    setReferenceAudioEditorError(null);
    const waveformRequestId = referenceAudioWaveformRequestRef.current + 1;
    referenceAudioWaveformRequestRef.current = waveformRequestId;
    setReferenceAudioWaveformPeaks([]);
    setReferenceAudioWaveformStatus("loading");
    setReferenceAudioEditor({
      sourcePath,
      previewUrl,
      name: getFileBaseName(sourcePath),
      durationSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: 0,
      autoRecognize: false,
      target
    });
    void decodeWaveformPeaks(new Uint8Array(audioBytes).buffer)
      .then((peaks) => {
        if (referenceAudioWaveformRequestRef.current === waveformRequestId) {
          setReferenceAudioWaveformPeaks(peaks);
          setReferenceAudioWaveformStatus(peaks.length > 0 ? "ready" : "unavailable");
        }
      })
      .catch(() => {
        if (referenceAudioWaveformRequestRef.current === waveformRequestId) {
          setReferenceAudioWaveformPeaks([]);
          setReferenceAudioWaveformStatus("unavailable");
        }
      });
  }

  function closeReferenceAudioEditor() {
    referenceAudioPreviewRef.current?.pause();
    if (referenceAudioPreviewUrlRef.current) {
      URL.revokeObjectURL(referenceAudioPreviewUrlRef.current);
      referenceAudioPreviewUrlRef.current = null;
    }
    referenceAudioWaveformRequestRef.current += 1;
    setReferenceAudioPreviewTime(0);
    setReferenceAudioPreviewPlaying(false);
    setReferenceAudioWaveformPeaks([]);
    setReferenceAudioWaveformStatus("idle");
    setReferenceAudioEditorError(null);
    setReferenceAudioEditor(null);
  }

  function onReferenceAudioMetadataLoaded(durationSeconds: number) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setReferenceAudioEditorError("无法读取这条音频的时长，请换一个可正常播放的文件。");
      return;
    }
    setReferenceAudioEditor((editor) =>
      editor
        ? {
            ...editor,
            durationSeconds,
            trimStartSeconds: 0,
            trimEndSeconds: durationSeconds
          }
        : editor
    );
  }

  function updateReferenceAudioTrim(boundary: "start" | "end", rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }
    setReferenceAudioEditor((editor) => {
      if (!editor || editor.durationSeconds <= 0) {
        return editor;
      }
      const minimumGap = Math.min(0.1, editor.durationSeconds);
      if (boundary === "start") {
        return {
          ...editor,
          trimStartSeconds: Math.max(0, Math.min(value, editor.trimEndSeconds - minimumGap))
        };
      }
      return {
        ...editor,
        trimEndSeconds: Math.min(editor.durationSeconds, Math.max(value, editor.trimStartSeconds + minimumGap))
      };
    });
  }

  function onReferenceAudioPreviewTimeUpdate(currentTime: number) {
    setReferenceAudioPreviewTime(currentTime);
    const editor = referenceAudioEditor;
    const player = referenceAudioPreviewRef.current;
    if (editor && player && editor.trimEndSeconds > editor.trimStartSeconds && currentTime >= editor.trimEndSeconds) {
      player.currentTime = editor.trimEndSeconds;
      player.pause();
    }
  }

  function seekReferenceAudioPreview(ratio: number) {
    const editor = referenceAudioEditor;
    const player = referenceAudioPreviewRef.current;
    if (!editor || !player || editor.durationSeconds <= 0) {
      return;
    }
    const nextTime = Math.max(0, Math.min(editor.durationSeconds, ratio * editor.durationSeconds));
    player.currentTime = nextTime;
    setReferenceAudioPreviewTime(nextTime);
  }

  function updateReferenceAudioTrimRatio(boundary: "start" | "end", ratio: number) {
    const durationSeconds = referenceAudioEditor?.durationSeconds ?? 0;
    if (durationSeconds <= 0) {
      return;
    }
    updateReferenceAudioTrim(boundary, String(ratio * durationSeconds));
  }

  async function toggleReferenceAudioPreview() {
    const player = referenceAudioPreviewRef.current;
    const editor = referenceAudioEditor;
    if (!player || !editor) {
      return;
    }
    if (player.paused) {
      try {
        if (player.currentTime < editor.trimStartSeconds || player.currentTime >= editor.trimEndSeconds) {
          player.currentTime = editor.trimStartSeconds;
        }
        await player.play();
        setReferenceAudioPreviewPlaying(true);
      } catch (err) {
        setReferenceAudioEditorError(err instanceof Error ? err.message : "无法播放这条参考音频。");
      }
    } else {
      player.pause();
      setReferenceAudioPreviewPlaying(false);
    }
  }

  async function saveReferenceAudioEditor() {
    const editor = referenceAudioEditor;
    if (!editor || !editor.name.trim()) {
      setReferenceAudioEditorError(editor?.target.kind === "create" ? "请填写角色名称。" : "请填写参考片段名称。");
      return;
    }
    if (editor.durationSeconds <= 0 || editor.trimEndSeconds <= editor.trimStartSeconds) {
      setReferenceAudioEditorError("请等待音频加载完成后再设置裁切范围。");
      return;
    }

    const hasTrimmedSelection = editor.trimStartSeconds > 0.05 || editor.trimEndSeconds < editor.durationSeconds - 0.05;
    const trimPayload = hasTrimmedSelection
      ? {
          trim_start_seconds: Number(editor.trimStartSeconds.toFixed(3)),
          trim_end_seconds: Number(editor.trimEndSeconds.toFixed(3))
        }
      : {};
    setReferenceAudioEditorSaving(true);
    setReferenceAudioEditorError(null);
    try {
      if (editor.target.kind === "create") {
        setVoiceImporting(true);
        const createdVoice = await createVoice({
          name: editor.name.trim(),
          reference_audio: editor.sourcePath,
          reference_name: "主参考",
          authorization_status: "authorized",
          source_type: "local_import",
          ...trimPayload
        });
        const preset = createImportedVoicePreset(createdVoice);
        if (preset) {
          setCustomVoices((voices) => [...voices.filter((voice) => voice.id !== preset.id), preset]);
          selectedVoiceRef.current = preset.id;
          setSelectedVoice(preset.id);
          setReferenceText("");
          setVoiceMessage(
            editor.autoRecognize
              ? `已保存 ${preset.name}，正在识别选中片段的参考文本…`
              : `已保存 ${preset.name}。可在音色库中识别或填写参考文本。`
          );
          if (editor.autoRecognize) {
            startAutomaticVoiceRecognition(createdVoice);
          }
        }
      } else if (editor.target.kind === "append") {
        const updated = await createVoiceReference(editor.target.voiceId, {
          name: editor.name.trim(),
          reference_audio: editor.sourcePath,
          reference_text: null,
          source_type: "local_import",
          ...trimPayload
        });
        mergeManagedVoice(updated, selectedVoice === updated.id);
        const newReference = updated.references[updated.references.length - 1];
        setManagedReferenceId(newReference?.id ?? updated.active_reference_id ?? null);
        setVoiceManagerDraft(createVoiceManagerDraft(createImportedVoicePreset(updated), newReference?.id));
        setVoiceManagerMessage(
          editor.autoRecognize
            ? "参考片段已添加，正在识别该片段的参考文本。"
            : "参考片段已添加。可设为当前参考后用于生成。"
        );
        if (editor.autoRecognize) {
          startAutomaticVoiceRecognition(updated, newReference?.id);
        }
      } else {
        const updated = await updateVoiceReference(editor.target.voiceId, editor.target.referenceId, {
          reference_audio: editor.sourcePath,
          ...(editor.target.kind === "replace" ? { reference_text: null } : {}),
          ...trimPayload
        });
        mergeManagedVoice(updated, selectedVoice === updated.id);
        setManagedReferenceId(editor.target.referenceId);
        setVoiceManagerDraft(createVoiceManagerDraft(createImportedVoicePreset(updated), editor.target.referenceId));
        if (selectedVoice === updated.id && updated.active_reference_id === editor.target.referenceId) {
          setReferenceText(editor.target.kind === "replace" ? "" : updated.reference_text ?? "");
        }
        setVoiceManagerMessage(
          editor.autoRecognize
            ? editor.target.kind === "trim" ? "参考片段已裁切，正在重新识别当前片段的参考文本。" : "参考片段已替换，正在识别当前片段的参考文本。"
            : editor.target.kind === "trim" ? "参考片段已裁切，原参考文本已保留，请确认内容仍匹配。" : "参考片段已替换。需要时可点击“识别参考文本”。"
        );
        if (editor.autoRecognize) {
          startAutomaticVoiceRecognition(updated, editor.target.referenceId);
        }
      }
      closeReferenceAudioEditor();
    } catch (err) {
      setReferenceAudioEditorError(err instanceof Error ? err.message : "保存参考音频失败");
    } finally {
      setVoiceImporting(false);
      setReferenceAudioEditorSaving(false);
    }
  }

  async function onReplaceVoiceReference() {
    if (!managedVoice || !managedReference || !window.desktopFiles?.selectReferenceAudio) {
      setVoiceManagerError("请在桌面软件中选择参考音频。");
      return;
    }
    setVoiceManagerAction("replace-audio");
    setVoiceManagerError(null);
    try {
      const audioPath = await window.desktopFiles.selectReferenceAudio();
      if (!audioPath) {
        return;
      }
      await openReferenceAudioEditor(audioPath, { kind: "replace", voiceId: managedVoice.id, referenceId: managedReference.id });
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "替换参考音频失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onTrimManagedVoiceReference() {
    if (!managedVoice || !managedReference?.referenceAudio || !managedReference.referenceAudioManaged) {
      setVoiceManagerError("只有音色库托管的参考片段可以直接裁切；外部路径请先替换或重新导入。");
      return;
    }
    setVoiceManagerAction("trim-reference");
    setVoiceManagerError(null);
    try {
      await openReferenceAudioEditor(
        managedReference.referenceAudio,
        { kind: "trim", voiceId: managedVoice.id, referenceId: managedReference.id },
        "managed"
      );
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "打开参考片段裁切失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onAddVoiceReference() {
    if (!managedVoice || !window.desktopFiles?.selectReferenceAudio) {
      setVoiceManagerError("请在桌面软件中选择参考音频。");
      return;
    }
    setVoiceManagerAction("add-reference");
    setVoiceManagerError(null);
    try {
      const audioPath = await window.desktopFiles.selectReferenceAudio();
      if (!audioPath) {
        return;
      }
      await openReferenceAudioEditor(audioPath, { kind: "append", voiceId: managedVoice.id });
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "添加参考片段失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onActivateManagedReference(referenceId: string) {
    if (!managedVoice || referenceId === managedVoice.activeReferenceId) {
      return;
    }
    setVoiceManagerAction("activate-reference");
    setVoiceManagerError(null);
    try {
      const updated = await activateVoiceReference(managedVoice.id, referenceId);
      mergeManagedVoice(updated, selectedVoice === updated.id);
      setManagedReferenceId(referenceId);
      setVoiceManagerDraft(createVoiceManagerDraft(createImportedVoicePreset(updated), referenceId));
      if (selectedVoice === updated.id) {
        setReferenceText(updated.reference_text ?? "");
      }
      setVoiceManagerMessage("已设为当前参考。后续生成会使用这条片段。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "切换当前参考失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onDeleteManagedReference(referenceId: string) {
    if (!managedVoice || managedVoice.references.length <= 1) {
      setVoiceManagerError("角色至少保留一条参考片段；如需删除角色，请删除整个档案。");
      return;
    }
    const reference = managedVoice.references.find((item) => item.id === referenceId);
    if (!reference) {
      return;
    }
    if (!await requestConfirmation({
      title: "删除参考片段？",
      message: `将删除参考片段「${reference.name}」，其托管音频也会从角色目录移除。`,
      confirmLabel: "删除",
      tone: "danger"
    })) {
      return;
    }
    setVoiceManagerAction("delete-reference");
    setVoiceManagerError(null);
    try {
      const updated = await deleteVoiceReference(managedVoice.id, referenceId);
      const nextReferenceId = updated.active_reference_id ?? updated.references[0]?.id ?? null;
      mergeManagedVoice(updated, selectedVoice === updated.id);
      setManagedReferenceId(nextReferenceId);
      setVoiceManagerDraft(createVoiceManagerDraft(createImportedVoicePreset(updated), nextReferenceId));
      if (selectedVoice === updated.id) {
        setReferenceText(updated.reference_text ?? "");
      }
      setVoiceManagerMessage("参考片段已删除。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "删除参考片段失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onRecognizeManagedVoiceReference() {
    if (!managedVoice || !managedReference?.referenceAudio) {
      setVoiceManagerError("该参考片段没有可识别的音频。");
      return;
    }
    setVoiceManagerAction("recognize");
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
    pendingModelWarmupRef.current = selectedModelRef.current;
    setModelWarmupState({
      modelId: selectedModelRef.current,
      status: "waiting",
      message: "正在识别参考音频，完成后会恢复并预热当前模型。"
    });
    try {
      const result = await recognizeVoiceReferenceClip(managedVoice.id, managedReference.id);
      setVoiceManagerDraft((draft) => ({ ...draft, referenceText: result.text }));
      if (selectedVoice === managedVoice.id && managedVoice.activeReferenceId === managedReference.id) {
        setReferenceText(result.text);
      }
      setVoiceManagerMessage("该片段的参考文本已识别并填入草稿，请核对后点击保存。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "参考音频识别失败");
    } finally {
      setVoiceManagerAction(null);
      queueModelWarmup(selectedModelRef.current);
    }
  }

  async function onRepairManagedVoiceAudio() {
    if (!managedVoice || !managedReference?.referenceAudio) {
      setVoiceManagerError("该参考片段没有可修复的音频。");
      return;
    }
    if (!managedReference.referenceAudioManaged) {
      setVoiceManagerError("这条音频未由音色库托管，请替换或重新导入后再修复。");
      return;
    }
    if (managedVoice.activeReferenceId !== managedReference.id) {
      setVoiceManagerError("请先将该片段设为当前参考，再修复其音频格式。");
      return;
    }
    setVoiceManagerAction("repair-audio");
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
    try {
      const repaired = await repairVoiceAudio(managedVoice.id);
      mergeManagedVoice(repaired.voice, selectedVoice === repaired.voice.id);
      setVoiceManagerMessage(
        repaired.converted
          ? "已转换为兼容的单声道 PCM 16-bit WAV，原生成文件未改动。"
          : "该参考音频已经是兼容的单声道 PCM 16-bit WAV。"
      );
      await loadVoiceQuality(repaired.voice.id);
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "修复参考音频失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onExportVoicePackage() {
    if (!managedVoice || !window.desktopFiles?.saveVoicePackage) {
      setVoiceManagerError("请在桌面软件中导出音色包。");
      return;
    }
    setVoiceManagerAction("export");
    setVoiceManagerError(null);
    try {
      const exported = await exportVoicePackage(managedVoice.id);
      const savedPath = await window.desktopFiles.saveVoicePackage(exported.export_path, exported.file_name);
      setVoiceManagerMessage(savedPath ? `音色包已导出：${savedPath}` : "已取消保存音色包。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "导出音色包失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onImportVoicePackage() {
    if (!window.desktopFiles?.selectVoicePackage) {
      setVoiceManagerError("请在桌面软件中导入音色包。");
      return;
    }
    setVoiceManagerAction("import");
    setVoiceManagerError(null);
    try {
      const packagePath = await window.desktopFiles.selectVoicePackage();
      if (!packagePath) {
        return;
      }
      const imported = await importVoicePackage(packagePath);
      mergeManagedVoice(imported, true);
      selectedVoiceRef.current = imported.id;
      setVoiceManagerMessage(`已导入音色包：${imported.name}`);
      if (!imported.reference_text) {
        startAutomaticVoiceRecognition(imported);
      }
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "导入音色包失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onDeleteManagedVoice() {
    if (!managedVoice) {
      return;
    }
    if (!await requestConfirmation({
      title: "删除角色音色？",
      message: `将删除音色「${managedVoice.name}」。已托管的音频文件会保留，避免误删。`,
      confirmLabel: "删除",
      tone: "danger"
    })) {
      return;
    }
    setVoiceManagerAction("delete");
    setVoiceManagerError(null);
    try {
      await deleteVoice(managedVoice.id);
      setCustomVoices((voices) => voices.filter((voice) => voice.id !== managedVoice.id));
      setVoiceAvatars((avatars) => {
        const { [managedVoice.id]: _removed, ...remaining } = avatars;
        return remaining;
      });
      if (selectedVoice === managedVoice.id) {
        setSelectedVoice("custom");
      }
      setManagedVoiceId(null);
      setVoiceManagerDraft(createVoiceManagerDraft(null));
      setVoiceManagerMessage("音色档案已删除，托管音频仍保留在本地。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "删除音色失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function loadVoiceQuality(voiceId: string) {
    setVoiceQualityLoading(true);
    try {
      const report = await fetchVoiceQuality(voiceId);
      setVoiceQuality(report);
      setVoiceQualityById((reports) => ({ ...reports, [voiceId]: report }));
    } catch {
      setVoiceQuality(null);
    } finally {
      setVoiceQualityLoading(false);
    }
  }

  async function loadBatchProjects() {
    if (batchProjectsRequestRef.current) {
      return batchProjectsRequestRef.current;
    }
    const request = (async () => {
      try {
        const projects = await fetchBatchProjects();
        setBatchProjects(projects);
      } catch (err) {
        setBatchProjectError(err instanceof Error ? err.message : "无法读取批量项目");
      }
    })();
    batchProjectsRequestRef.current = request;
    try {
      await request;
    } finally {
      if (batchProjectsRequestRef.current === request) {
        batchProjectsRequestRef.current = null;
      }
    }
  }

  function createBatchProjectWorkspace() {
    setRealtimeEntryConfirmOpen(false);
    releaseRealtimeRuntimeReservation();
    setGenerationWorkspace("batch");
    setBatchProjectError(null);
    setBatchProjectMessage(null);
    setEditingBatchProjectId(null);
    setBatchProjectTitle(`配音项目 ${new Date().toLocaleDateString()}`);
    setBatchProjectModel(selectedModel);
    setBatchProjectVoiceId(selectedVoice);
    setBatchProjectSegments(parseBatchSegments(input));
    void loadBatchProjects();
  }

  function openBatchWorkspace() {
    setRealtimeEntryConfirmOpen(false);
    releaseRealtimeRuntimeReservation();
    const importedSegments = generationWorkspace !== "batch" && !editingBatchProjectId && batchProjectSegments.length === 0
      ? parseBatchSegments(input)
      : [];
    setGenerationWorkspace("batch");
    setBatchProjectError(null);
    if (importedSegments.length > 0) {
      setBatchProjectSegments(importedSegments);
      setBatchProjectMessage(`已从单次文本带入 ${importedSegments.length} 个片段，可继续编辑或导入文件。`);
    } else {
      setBatchProjectMessage(null);
    }
    void loadBatchProjects();
  }

  function openSingleWorkspace() {
    setRealtimeEntryConfirmOpen(false);
    releaseRealtimeRuntimeReservation();
    setGenerationWorkspace("single");
  }

  function selectVoiceAvatar(index: number) {
    if (!managedVoice) return;
    setVoiceAvatars((current) => ({ ...current, [managedVoice.id]: { kind: "pack", index } }));
    setAvatarPickerOpen(false);
    setVoiceManagerMessage("头像已更新，音色卡片和角色列表会立即同步。");
  }

  function toggleVoiceFavorite(voiceId: string) {
    setVoiceFavoriteIds((current) => current.includes(voiceId)
      ? current.filter((id) => id !== voiceId)
      : [...current, voiceId]);
  }

  function onCustomAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !managedVoice || !file.type.startsWith("image/")) return;
    if (file.size > 3 * 1024 * 1024) {
      setVoiceManagerError("头像图片请控制在 3 MB 以内。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setVoiceAvatars((current) => ({ ...current, [managedVoice.id]: { kind: "custom", dataUrl: reader.result as string } }));
      setAvatarPickerOpen(false);
      setVoiceManagerMessage("自定义头像已更新。");
    };
    reader.onerror = () => setVoiceManagerError("读取头像图片失败，请换一张图片重试。");
    reader.readAsDataURL(file);
  }

  function openRealtimeWorkspace() {
    if (generationWorkspace === "realtime") {
      return;
    }
    setRealtimeEntryConfirmOpen(true);
  }

  function confirmRealtimeWorkspace() {
    setRealtimeEntryConfirmOpen(false);
    setGenerationWorkspace("realtime");
    // Whispera uses a dedicated VoxCPM worker. Reserve that model's GPU
    // residency before a session can start so the normal HTTP worker cannot
    // warm the same weights in parallel.
    modelWarmupEpochRef.current += 1;
    pendingModelWarmupRef.current = null;
    setPendingModelSwitch(null);
    setModelWarmupState(null);
    reserveRealtimeRuntimeReservation();
  }

  function reserveRealtimeRuntimeReservation() {
    setRealtimeRuntimeState("reserving");
    setRealtimeRuntimeMessage("正在释放普通 VoxCPM2 服务并预约实时流式显存…");
    realtimeRuntimeSyncRef.current = realtimeRuntimeSyncRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await reserveRealtimeRuntime();
        const releasedNames = (result.released_models ?? [])
          .map((modelId) => models.find((model) => model.id === modelId)?.display_name ?? modelId)
          .join("、");
        setRealtimeRuntimeMessage(releasedNames
          ? `已释放 ${releasedNames}，正在预热 Whispera 流式 VoxCPM2 与 CUDA 图…`
          : "显存已预约，正在预热 Whispera 流式 VoxCPM2 与 CUDA 图…"
        );
        const prewarm = await prewarmRealtimeRuntime();
        if (!prewarm.worker?.loaded || !prewarm.asr?.worker?.loaded) {
          throw new Error("Whispera 流式 VoxCPM2 或 SenseVoice 未能完成预热。");
        }
        setRealtimeRuntimeState("ready");
        setRealtimeRuntimeMessage(prewarm.worker.external
          ? "已接入已运行的 Whispera 流式 VoxCPM2；SenseVoice 也已预热，普通模型仍会被锁定。"
          : prewarm.asr?.cpu_fallback
            ? "Whispera 已预热；SenseVoice 显存不足，已固定使用 CPU，首段会积攒约 1 秒防抖缓冲。"
          : prewarm.compile_warmed
            ? "Whispera、SenseVoice 与 CUDA 图已预热；首段会积攒约 1 秒防抖缓冲。"
            : "Whispera 与 SenseVoice 已预热；首段会积攒约 1 秒防抖缓冲。"
        );
        await loadSystemStatus();
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : "无法预约实时语音所需的 VoxCPM2 显存。";
        await releaseRealtimeRuntime().catch(() => undefined);
        setRealtimeRuntimeState("error");
        setRealtimeRuntimeMessage(message);
        setModelWarmupState({
          modelId: "voxcpm2",
          status: "failed",
          message: `实时语音无法接管 VoxCPM2：${message}`
        });
      });
  }

  function releaseRealtimeRuntimeReservation() {
    setRealtimeRuntimeState("idle");
    setRealtimeRuntimeMessage("");
    realtimeRuntimeSyncRef.current = realtimeRuntimeSyncRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await releaseRealtimeRuntime();
        } finally {
          void loadSystemStatus();
        }
      })
      .catch(() => {
        // Leaving realtime must never prevent navigation. The runtime will be
        // released when the local API exits even if this best-effort request
        // loses a connection during application shutdown.
      });
  }

  function selectWorkspace(workbench: PrimaryWorkspace, bypassSettingsGuard = false) {
    if (settingsOpen && !bypassSettingsGuard) {
      void closeSettings().then((closed) => {
        if (closed) {
          selectWorkspace(workbench, true);
        }
      });
      return;
    }
    const shouldRestoreCreationFocus = workbench === "creation" && activeWorkspace !== "creation";
    if (workbench !== "creation") {
      releaseRealtimeRuntimeReservation();
    } else if (generationWorkspace === "realtime") {
      reserveRealtimeRuntimeReservation();
    }
    if (workbench === activeWorkspace) return;
    workspaceTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setActiveWorkspace(workbench);
      setWorkspaceTransition("idle");
      if (shouldRestoreCreationFocus) {
        window.requestAnimationFrame(() => {
          workbenchNavRef.current?.querySelector<HTMLButtonElement>('[data-workbench-id="creation"]')?.focus({ preventScroll: true });
        });
      }
      return;
    }
    // Swap at the beginning of the fade so grid changes never occur while the old view is translated.
    // The prior two-stage slide made the main canvas appear to jump when its width changed.
    setActiveWorkspace(workbench);
    setWorkspaceTransition("entering");
    if (shouldRestoreCreationFocus) {
      window.requestAnimationFrame(() => {
        workbenchNavRef.current?.querySelector<HTMLButtonElement>('[data-workbench-id="creation"]')?.focus({ preventScroll: true });
      });
    }
    const settleTimer = window.setTimeout(() => setWorkspaceTransition("idle"), 180);
    workspaceTransitionTimersRef.current = [settleTimer];
  }

  function scrollWorkbenchNavigation(direction: -1 | 1) {
    const navigation = workbenchNavRef.current;
    if (!navigation) return;
    navigation.scrollBy({
      left: direction * 220,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  }

  function handleWorkbenchNavigationKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-workbench-id]"));
    if (!buttons.length) return;
    const focusedIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : buttons.findIndex((button) => button.dataset.workbenchId === activeWorkspace);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    const nextButton = buttons[nextIndex];
    nextButton?.focus({ preventScroll: true });
    nextButton?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  useEffect(() => () => {
    workspaceTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    // A renderer refresh must not leave the API believing that a no-longer
    // visible realtime workspace still owns VoxCPM2. Chain behind a pending
    // reservation so a late reserve response cannot win this final release.
    void realtimeRuntimeSyncRef.current
      .catch(() => undefined)
      .then(() => releaseRealtimeRuntime())
      .catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    const navigation = workbenchNavRef.current;
    const activeButton = navigation?.querySelector<HTMLButtonElement>(`[data-workbench-id="${activeWorkspace}"]`);
    if (!navigation || !activeButton) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const alignActiveButton = () => {
      const maxScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth);
      if (maxScrollLeft <= 0) return;
      const desiredScrollLeft = activeButton.offsetLeft - Math.max(0, (navigation.clientWidth - activeButton.offsetWidth) / 2);
      const buttonStarts = Array.from(navigation.querySelectorAll<HTMLButtonElement>("[data-workbench-id]"))
        .map((button) => Math.max(0, button.offsetLeft - 5));
      const targetScrollLeft = buttonStarts.reduce((closest, start) =>
        Math.abs(start - desiredScrollLeft) < Math.abs(closest - desiredScrollLeft) ? start : closest,
        buttonStarts[0] ?? 0
      );
      if (Math.abs(navigation.scrollLeft - targetScrollLeft) > 1) {
        navigation.scrollTo({ left: Math.min(maxScrollLeft, targetScrollLeft), behavior: reduceMotion ? "auto" : "smooth" });
      }
    };
    const updateIndicator = () => {
      setWorkbenchIndicator({ left: activeButton.offsetLeft, width: activeButton.offsetWidth, ready: true });
      alignActiveButton();
    };
    const updateScrollState = () => {
      const edgeThreshold = 18;
      const maxScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth);
      setWorkbenchNavScrollState({
        canScrollBackward: navigation.scrollLeft > edgeThreshold,
        canScrollForward: navigation.scrollLeft < maxScrollLeft - edgeThreshold
      });
    };
    updateIndicator();
    updateScrollState();
    alignActiveButton();
    const scrollFrame = window.requestAnimationFrame(updateScrollState);
    const scrollSettleTimer = window.setTimeout(updateScrollState, 360);
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(navigation);
    observer.observe(activeButton);
    navigation.addEventListener("scroll", updateScrollState, { passive: true });
    const scrollStateObserver = new ResizeObserver(updateScrollState);
    scrollStateObserver.observe(navigation);
    return () => {
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(scrollSettleTimer);
      observer.disconnect();
      scrollStateObserver.disconnect();
      navigation.removeEventListener("scroll", updateScrollState);
    };
  }, [activeWorkspace]);

  function editBatchProject(project: BatchProject) {
    if (project.model === "doubao-web") {
      setBatchProjectError("旧版豆包批量项目只保留历史记录；云端语音请从顶部“云端语音合成”入口重新创建。");
      setBatchProjectMessage(null);
      return;
    }
    releaseRealtimeRuntimeReservation();
    setGenerationWorkspace("batch");
    setEditingBatchProjectId(project.id);
    setBatchProjectTitle(project.title);
    setBatchProjectModel(project.model);
    setBatchProjectSegments(project.segments.map((segment) => segment.text));
    const matchingVoice = project.model === "gptsovits" && project.voice
      ? customVoices.find((voice) => voice.id === project.voice)
      : customVoices.find((voice) => voice.referenceAudio === project.reference_audio);
    setBatchProjectVoiceId(matchingVoice?.id ?? "");
    if (project.model === "voxcpm2") {
      setCfg(project.cfg ?? 2);
      setSteps(project.inference_steps ?? 10);
      setNormalizeText(project.normalize ?? true);
      setDenoise(project.denoise ?? false);
    } else if (project.model === "indextts2") {
      setIndexTemperature(project.temperature ?? 0.8);
      setIndexTopP(project.top_p ?? 0.8);
      setIndexTopK(project.top_k ?? 30);
      setIndexNumBeams(project.num_beams ?? 3);
      setIndexRepetitionPenalty(project.repetition_penalty ?? 10);
      setIndexMaxMelTokens(project.max_mel_tokens ?? 1500);
    }
    setBatchProjectError(null);
    setBatchProjectMessage(`正在编辑：${project.title}`);
  }

  function updateBatchSegment(index: number, value: string) {
    setBatchProjectSegments((segments) => segments.map((segment, segmentIndex) => (segmentIndex === index ? value : segment)));
  }

  function removeBatchSegment(index: number) {
    setBatchProjectSegments((segments) => segments.filter((_, segmentIndex) => segmentIndex !== index));
  }

  function onImportBatchSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imported = parseBatchSegments(String(reader.result ?? ""), file.name);
      if (imported.length === 0) {
        setBatchProjectError("未从该文件识别到可生成的文本片段");
        return;
      }
      setBatchProjectSegments(imported);
      setBatchProjectMessage(`已导入 ${imported.length} 个片段：${file.name}`);
      setBatchProjectError(null);
    };
    reader.onerror = () => setBatchProjectError("读取文本文件失败");
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  async function saveBatchProject(shouldRun: boolean) {
    const segments = batchProjectSegments.map((segment) => segment.trim()).filter(Boolean);
    if (!batchProjectTitle.trim()) {
      setBatchProjectError("请填写项目名称");
      return;
    }
    if (segments.length === 0) {
      setBatchProjectError("请至少保留一个文本片段");
      return;
    }
    if (!batchProjectHasReference) {
      setBatchProjectError("请选择带参考音频的本地音色");
      return;
    }
    setBatchProjectAction(shouldRun ? "run" : "save");
    setBatchProjectError(null);
    try {
      const payload: BatchProjectCreate = {
        title: batchProjectTitle.trim(),
        model: batchProjectModel,
        segments: segments.map((text) => ({ text })),
        voice: batchProjectModel === "gptsovits" ? batchProjectVoiceInfo?.id : undefined,
        response_format: "wav",
        reference_audio: batchProjectVoiceInfo?.referenceAudio,
        reference_text: supportsRequestCapability(batchProjectModelInfo, "reference_text")
          ? batchProjectReferenceText || undefined
          : undefined,
        emotion: batchProjectShowsControlPrompt && supportsRequestCapability(batchProjectModelInfo, "control_prompt")
          ? controlPrompt.trim() || undefined
          : undefined,
        speed: batchProjectShowsSpeedControl ? speed : 1,
        cfg: batchProjectModel === "voxcpm2" ? cfg : undefined,
        inference_steps: batchProjectModel === "voxcpm2" ? steps : undefined,
        temperature: batchProjectModel === "indextts2" ? indexTemperature : undefined,
        top_p: batchProjectModel === "indextts2" ? indexTopP : undefined,
        top_k: batchProjectModel === "indextts2" ? indexTopK : undefined,
        num_beams: batchProjectModel === "indextts2" ? indexNumBeams : undefined,
        repetition_penalty: batchProjectModel === "indextts2" ? indexRepetitionPenalty : undefined,
        max_mel_tokens: batchProjectModel === "indextts2" ? indexMaxMelTokens : undefined,
        normalize: batchProjectModel === "voxcpm2" ? normalizeText : undefined,
        denoise: batchProjectModel === "voxcpm2" ? denoise : undefined
      };
      const project = editingBatchProjectId
        ? await updateBatchProject(editingBatchProjectId, payload)
        : await createBatchProject(payload);
      setEditingBatchProjectId(project.id);
      if (shouldRun) {
        await runBatchProject(project.id);
        setBatchProjectMessage(`${project.title} 已加入串行生成队列`);
      } else {
        setBatchProjectMessage(`${project.title} 已保存为草稿`);
      }
      await loadBatchProjects();
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "保存批量项目失败");
    } finally {
      setBatchProjectAction(null);
    }
  }

  async function onRunExistingBatchProject(project: BatchProject, retry = false) {
    setBatchProjectAction(retry ? "retry" : "run");
    setBatchProjectError(null);
    try {
      await (retry ? retryBatchProject(project.id) : runBatchProject(project.id));
      setBatchProjectMessage(`${project.title} 已加入串行生成队列`);
      await loadBatchProjects();
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "启动批量项目失败");
    } finally {
      setBatchProjectAction(null);
    }
  }

  async function onCancelBatchProject(project: BatchProject) {
    setBatchProjectAction("cancel");
    setBatchProjectError(null);
    try {
      const updated = await cancelBatchProject(project.id);
      setBatchProjectMessage(
        updated.status === "cancelling"
          ? `${project.title} 会在当前段落完成后安全停止`
          : `${project.title} 已从生成队列中移除`
      );
      await Promise.all([loadBatchProjects(), loadTaskSummaries()]);
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "停止批量项目失败");
    } finally {
      setBatchProjectAction(null);
    }
  }

  async function onResumeBatchProject(project: BatchProject) {
    setBatchProjectAction("resume");
    setBatchProjectError(null);
    try {
      await resumeBatchProject(project.id);
      setBatchProjectMessage(`${project.title} 已从上次停止的位置继续进入队列`);
      await Promise.all([loadBatchProjects(), loadTaskSummaries()]);
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "继续批量项目失败");
    } finally {
      setBatchProjectAction(null);
    }
  }

  async function openBatchOutputDirectory() {
    if (!appSettings?.output_dir || !window.desktopFiles?.openPath) {
      setBatchProjectError("请在桌面软件中打开输出目录");
      return;
    }
    try {
      const errorMessage = await window.desktopFiles.openPath(appSettings.output_dir);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "打开输出目录失败");
    }
  }

  async function openOutputDirectory() {
    if (!appSettings?.output_dir || !window.desktopFiles?.openPath) {
      setError("请在桌面软件中打开输出目录");
      return;
    }
    try {
      const errorMessage = await window.desktopFiles.openPath(appSettings.output_dir);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开输出目录失败");
    }
  }

  async function loadSystemStatus() {
    if (systemStatusRequestRef.current) {
      return;
    }
    systemStatusRequestRef.current = true;
    try {
      const status = await fetchSystemStatus();
      setSystemStatus(status);
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "本地后端连接中断");
      void recoverLocalBackend();
    } finally {
      systemStatusRequestRef.current = false;
    }
  }

  async function loadAppSettings() {
    try {
      const loadedSettings = await fetchAppSettings();
      setAppSettings(loadedSettings);
      setSettingsDraft(createSettingsDraft(loadedSettings));
    } catch (err) {
      setBackendError(err instanceof Error ? `设置读取失败：${err.message}` : "设置读取失败，请稍后重试。");
    }
  }

  async function loadModelInstances() {
    try {
      const instances = await fetchModelInstances();
      setModelInstances(instances);
      setModelProfileDrafts((drafts) => {
        const next: Record<string, ModelProfileDraft> = {};
        for (const instance of instances) {
          next[instance.model_id] = drafts[instance.model_id] ?? createModelProfileDraft(instance);
        }
        return next;
      });
      const untestedEnabledInstances = instances.filter((instance) => instance.enabled && instance.status === "untested");
      if (untestedEnabledInstances.length > 0 && !startupModelHealthCheckedRef.current) {
        startupModelHealthCheckedRef.current = true;
        const checks = await Promise.allSettled(untestedEnabledInstances.map((instance) => checkModelInstance(instance.model_id)));
        setModelHealthResults((results) => {
          const next = { ...results };
          for (const check of checks) {
            if (check.status === "fulfilled") {
              next[check.value.model_id] = check.value;
            }
          }
          return next;
        });
        const refreshedInstances = await fetchModelInstances();
        setModelInstances(refreshedInstances);
        setModelProfileDrafts((drafts) => {
          const next: Record<string, ModelProfileDraft> = {};
          for (const instance of refreshedInstances) {
            next[instance.model_id] = drafts[instance.model_id] ?? createModelProfileDraft(instance);
          }
          return next;
        });
      }
    } catch (err) {
      if (settingsOpen) {
        setSettingsError(err instanceof Error ? `模型状态读取失败：${err.message}` : "模型状态读取失败，请稍后重试。");
      }
    }
  }

  async function loadModelPackages() {
    try {
      setModelPackages(await fetchModelPackages());
    } catch (err) {
      if (settingsOpen) {
        setSettingsError(err instanceof Error ? `模型包读取失败：${err.message}` : "模型包读取失败，请稍后重试。");
      }
    }
  }

  async function loadTaskSummaries() {
    if (taskSummariesRequestRef.current) {
      return taskSummariesRequestRef.current;
    }
    setTaskSummariesLoading(true);
    const request = (async () => {
      try {
        const [tasks, ebookTasks] = await Promise.all([
          fetchTaskSummaries(),
          fetchDoubaoPrefetchTasks().catch(() => [] as DoubaoPrefetchTask[])
        ]);
        setRemoteTasks(tasks);
        setEbookPrefetchTasks(ebookTasks);
      } catch (err) {
        setTaskCenterError(err instanceof Error ? `任务记录读取失败：${err.message}` : "任务记录读取失败，请稍后重试。");
      }
    })();
    taskSummariesRequestRef.current = request;
    try {
      await request;
    } finally {
      if (taskSummariesRequestRef.current === request) {
        taskSummariesRequestRef.current = null;
      }
      setTaskSummariesLoading(false);
    }
  }

  async function loadAudioAssets() {
    setAudioLibraryLoading(true);
    try {
      const assets = await fetchAudioAssets();
      setAudioAssets(assets);
      setSelectedAudioAssetPath((current) =>
        current && assets.some((asset) => asset.file_path === current) ? current : assets[0]?.file_path ?? null
      );
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "无法读取输出目录中的音频资产");
      if (isBackendConnectionError(err)) {
        void recoverLocalBackend();
      }
    } finally {
      setAudioLibraryLoading(false);
    }
  }

  async function loadGlobalLlmSettings() {
    const bridge = window.desktopLlmSettings;
    if (!bridge) return;
    setGlobalLlmLoading(true);
    try {
      const settings = await bridge.load();
      const loaded = { ...defaultGlobalLlmSettings, ...settings };
      setGlobalLlmSettings(loaded);
      setSavedGlobalLlmSettings(loaded);
    } catch (err) {
      setGlobalLlmError(err instanceof Error ? err.message : "读取全局 LLM 配置失败");
    } finally {
      setGlobalLlmLoading(false);
    }
  }

  async function loadBilibiliHistory() {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) {
      setBilibiliHistoryItems([]);
      return;
    }
    try {
      const listed = await bridge.listHistory();
      if (!listed.success || !listed.data) {
        throw new Error(listed.error ?? "无法读取 B 站下载历史");
      }
      const details = await Promise.all(
        listed.data.slice(0, 120).map(async (entry) => {
          if (!entry.exists) {
            return { ...entry, previewUrl: "" };
          }
          const detail = await bridge.getHistoryItem(entry.id);
          return detail.success && detail.data
            ? detail.data
            : { ...entry, exists: false, previewUrl: "" };
        })
      );
      setBilibiliHistoryItems(details);
    } catch (err) {
      if (window.desktopBilibiliSampler) {
        setTaskCenterError(err instanceof Error ? err.message : "无法读取 B 站下载历史");
      }
    }
  }

  async function refreshTaskCenter() {
    if (taskCenterRefreshing) {
      return;
    }
    setTaskCenterRefreshing(true);
    setTaskCenterError(null);
    setTaskCenterMessage(null);
    try {
      await Promise.all([
        loadTaskSummaries(),
        loadBatchProjects(),
        loadAudioAssets(),
        loadBilibiliHistory()
      ]);
      setTaskCenterMessage("成果与任务已刷新。");
    } finally {
      setTaskCenterRefreshing(false);
    }
  }

  function openAudioLibrary(selectedResultId?: string | null) {
    setAudioLibraryError(null);
    setAudioLibraryMessage(null);
    setTaskCenterError(null);
    setTaskCenterMessage(null);
    setSelectedTaskResultId(selectedResultId ?? null);
    selectWorkspace("assets");
    void loadTaskSummaries();
    void loadBatchProjects();
    void loadAudioAssets();
    void loadBilibiliHistory();
  }

  async function onOpenAudioAsset(asset: AudioAsset) {
    if (!window.desktopFiles?.openPath) {
      setAudioLibraryError("请在桌面软件中打开本地音频文件");
      return;
    }
    setAudioLibraryAction(`open-${asset.file_path}`);
    setAudioLibraryError(null);
    try {
      const errorMessage = await window.desktopFiles.openPath(asset.file_path);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      setAudioLibraryMessage(`${asset.file_name} 已交给系统默认音频程序打开。`);
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "打开音频文件失败");
    } finally {
      setAudioLibraryAction(null);
    }
  }

  async function onRevealAudioAsset(asset: AudioAsset) {
    if (!window.desktopFiles?.revealInFolder) {
      setAudioLibraryError("请在桌面软件中定位本地音频文件");
      return;
    }
    setAudioLibraryAction(`reveal-${asset.file_path}`);
    setAudioLibraryError(null);
    try {
      await window.desktopFiles.revealInFolder(asset.file_path);
      setAudioLibraryMessage(`已在资源管理器中定位 ${asset.file_name}。`);
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "打开所在目录失败");
    } finally {
      setAudioLibraryAction(null);
    }
  }

  async function onDeleteAudioAsset(asset: AudioAsset) {
    const confirmed = await requestConfirmation({
      title: "删除本地音频？",
      message: `将删除“${asset.file_name}”及其位于受监控输出目录中的本地实体文件。此操作无法撤销。`,
      confirmLabel: "删除",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setAudioLibraryAction(`delete-${asset.file_path}`);
    setAudioLibraryError(null);
    setAudioLibraryMessage(null);
    try {
      audioAssetRef.current?.pause();
      await deleteAudioAsset(asset.asset_id);
      setAudioAssets((current) => current.filter((item) => item.asset_id !== asset.asset_id));
      setSelectedAudioAssetPath((current) => (current === asset.file_path ? null : current));
      setAudioLibraryMessage(`已删除本地文件：${asset.file_name}`);
      await loadAudioAssets();
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "删除本地音频文件失败");
    } finally {
      setAudioLibraryAction(null);
    }
  }

  async function onToggleAudioAssetPlayback() {
    const audio = audioAssetRef.current;
    if (!audio) {
      return;
    }
    setAudioLibraryError(null);
    try {
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "无法在软件内播放该音频");
    }
  }

  function onAddAudioAssetToVoiceLibrary(asset: AudioAsset) {
    openVoiceLibrarySaveDialog({
      kind: "asset",
      filePath: asset.file_path,
      referenceText: asset.text ?? undefined,
      modelName: asset.model ?? "本地音频",
      sourceVoiceName: getFileBaseName(asset.file_name),
      displayName: asset.file_name,
      durationSeconds: asset.duration_seconds ?? undefined,
      authorizationStatus: asset.source === "untracked" ? "user_managed_output" : asset.origin === "cloud" ? "generated_cloud" : "generated_local",
      sourceType: asset.source === "untracked" ? "local_output" : asset.origin === "cloud" ? "cloud_generated" : "generated"
    });
  }

  function setSamplerFailure(message: string) {
    setSamplerMessage(null);
    setSamplerState((state) => ({
      ...state,
      taskStage: "failed",
      error: message
    }));
  }

  function requireSamplerBridge() {
    if (!window.desktopBilibiliSampler) {
      setSamplerFailure("请在桌面软件中使用 B 站取样");
      return null;
    }
    return window.desktopBilibiliSampler;
  }

  async function refreshSamplerSession(showError = false) {
    const sampler = window.desktopBilibiliSampler;
    if (!sampler) {
      if (showError) {
        setSamplerFailure("请在桌面软件中使用 B 站取样");
      }
      return;
    }
    try {
      const response = await sampler.getSession();
      if (!response.success || !response.data) {
        if (showError) {
          setSamplerFailure(response.error ?? "加载 B 站登录状态失败");
        }
        return;
      }
      const loginSession = response.data;
      setSamplerState((state) => ({
        ...state,
        loginSession,
        error: null
      }));
    } catch (err) {
      if (showError) {
        setSamplerFailure(err instanceof Error ? err.message : "加载 B 站登录状态失败");
      }
    }
  }

  function openSampler() {
    setSamplerOpen(true);
    setSamplerMessage(null);
    void refreshSamplerSession(true);
  }

  async function onSamplerStartLogin() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    setSamplerPendingAction("login");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.startLogin();
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "生成 B 站登录二维码失败");
      }
      setSamplerQrPayload(response.data);
      setSamplerMessage("二维码已生成，正在等待扫码确认");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "生成 B 站登录二维码失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerLogout() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    setSamplerPendingAction("logout");
    setSamplerMessage(null);
    try {
      const response = await sampler.logout();
      if (!response.success) {
        throw new Error(response.error ?? "退出 B 站登录失败");
      }
      setSamplerQrPayload(null);
      setSamplerState((state) => ({
        ...state,
        loginSession: createDefaultBilibiliSamplerState().loginSession,
        error: null
      }));
      setSamplerMessage("已退出 B 站登录");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "退出 B 站登录失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerParseLink() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    const link = samplerLink.trim();
    if (!link) {
      setSamplerFailure("请先粘贴 B 站链接");
      return;
    }
    setSamplerPendingAction("parse");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.parseLink(link);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "解析 B 站链接失败");
      }
      const parsedLink = response.data;
      setSamplerState((state) => ({
        ...state,
        parsedLink,
        selection: { itemId: parsedLink.selectedItemId, qn: null },
        audioOptionSummary: null,
        taskStage: "idle",
        error: null
      }));
      setSamplerMediaOptions(null);
      setSamplerVideoPreview(null);
      setSamplerVideoPreviewError(null);
      setSamplerVideoDuration(0);
      setSamplerVideoCurrentTime(0);
      setSamplerVideoWaveformPeaks([]);
      setSamplerVideoWaveformStatus("idle");

      const audioResponse = await sampler.loadAudioOptions(parsedLink.kind, parsedLink.selectedItemId);
      if (!audioResponse.success || !audioResponse.data) {
        throw new Error(audioResponse.error ?? "加载音频流失败");
      }
      setSamplerState((state) => ({
        ...state,
        selection: { itemId: audioResponse.data!.itemId, qn: audioResponse.data!.selectedVideo?.qn ?? null },
        audioOptionSummary: audioResponse.data!.summary,
        taskStage: "idle",
        error: null
      }));
      setSamplerMediaOptions(audioResponse.data);
      setSamplerMessage(audioResponse.data.summary.hasAudio ? "音频流已就绪" : audioResponse.data.summary.disabledReason ?? "没有可用音频流");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "解析 B 站链接失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerSelectItem(itemId: string) {
    const sampler = requireSamplerBridge();
    if (!sampler || !samplerState.parsedLink) {
      return;
    }
    setSamplerPendingAction("load-audio");
    setSamplerMessage(null);
    setSamplerState((state) => ({
      ...state,
      selection: { itemId, qn: null },
      audioOptionSummary: null,
      error: null
    }));
    setSamplerMediaOptions(null);
    try {
      const response = await sampler.loadAudioOptions(samplerState.parsedLink.kind, itemId);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "加载音频流失败");
      }
      setSamplerState((state) => ({
        ...state,
        selection: { itemId: response.data!.itemId, qn: response.data!.selectedVideo?.qn ?? null },
        audioOptionSummary: response.data!.summary,
        taskStage: "idle",
        error: null
      }));
      setSamplerMediaOptions(response.data);
      setSamplerMessage(response.data.summary.hasAudio ? "音频流已就绪" : response.data.summary.disabledReason ?? "没有可用音频流");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "加载音频流失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerExtractAndSave() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    if (samplerClipError) {
      return;
    }
    if (!samplerState.parsedLink || !samplerSelectedItem || !samplerState.audioOptionSummary?.hasAudio) {
      setSamplerFailure("请先解析链接并选择可用音频流");
      return;
    }

    const voiceName = samplerName.trim() || samplerDefaultName;
    setSamplerPendingAction("extract");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.extractSample({
        startSeconds: samplerStartValue,
        endSeconds: samplerEndValue,
        sampleName: voiceName
      });
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "取样失败");
      }

      const voice = await createVoice({
        name: voiceName,
        reference_audio: response.data.audioPath,
        reference_text: samplerReferenceText.trim() || undefined,
        authorization_status: "source_bilibili_authorized",
        source_type: "bilibili",
        source_url: samplerLink.trim() || undefined
      });
      const preset = createImportedVoicePreset(voice);
      if (!preset) {
        throw new Error("取样音频已生成，但音色库没有返回参考音频路径");
      }
      setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
      selectedVoiceRef.current = preset.id;
      setSelectedVoice(preset.id);
      if (samplerReferenceText.trim()) {
        setReferenceText(samplerReferenceText.trim());
      } else if (preset.referenceText) {
        setReferenceText(preset.referenceText);
      }
      setVoiceMessage(`已从 B 站取样：${preset.name}`);
      setSamplerMessage(`已加入音色库：${preset.name}，${formatDuration(response.data.durationSeconds)}`);
      setSamplerOpen(false);
      void loadVoices();
      if (!samplerReferenceText.trim()) {
        startAutomaticVoiceRecognition(voice);
      }
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "取样失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onMediaSamplerCreateVoice(input: { audioPath: string; name: string; durationSeconds: number }) {
    const voice = await createVoice({
      name: input.name,
      reference_audio: input.audioPath,
      authorization_status: "source_bilibili_authorized",
      source_type: "bilibili"
    });
    const preset = createImportedVoicePreset(voice);
    if (!preset) {
      throw new Error("片段已提取，但音色库没有返回可用的参考音频");
    }
    setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
    selectedVoiceRef.current = preset.id;
    setSelectedVoice(preset.id);
    setReferenceText(preset.referenceText ?? "");
    setVoiceMessage(`已从本地媒体片段加入音色库：${preset.name}`);
    void loadVoices();
    startAutomaticVoiceRecognition(voice);
    return preset.name;
  }

  async function onSamplerSelectVideoQuality(qn: number) {
    const sampler = requireSamplerBridge();
    const parsedLink = samplerState.parsedLink;
    const itemId = samplerState.selection.itemId;
    if (!sampler || !parsedLink || !itemId || !Number.isFinite(qn) || qn <= 0) {
      return;
    }
    setSamplerPendingAction("load-quality");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.loadAudioOptions(parsedLink.kind, itemId, qn);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "切换视频清晰度失败");
      }
      const { selectedVideo } = response.data;
      setSamplerState((state) => ({
        ...state,
        selection: { itemId: response.data!.itemId, qn: selectedVideo?.qn ?? null },
        audioOptionSummary: response.data!.summary,
        taskStage: "idle",
        error: null
      }));
      setSamplerMediaOptions(response.data);
      if (selectedVideo?.fellBack) {
        const requestedLabel = response.data.qnOptions.find((option) => option.qn === qn)?.label ?? `${qn}P`;
        setSamplerMessage(`请求 ${requestedLabel}，B 站实际返回 ${formatSamplerVideoQuality(selectedVideo)}`);
      } else if (selectedVideo) {
        setSamplerMessage(`视频清晰度已切换：${formatSamplerVideoQuality(selectedVideo)}`);
      }
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "切换视频清晰度失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerDownloadVideo() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    if (!samplerState.parsedLink || !samplerSelectedItem || !samplerState.audioOptionSummary?.hasAudio || !samplerState.audioOptionSummary.hasVideo) {
      setSamplerFailure("请先解析链接并选择同时含音频和视频的条目");
      return;
    }

    setSamplerPendingAction("download-video");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.downloadVideo({ fileName: samplerDefaultName });
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "下载 MP4 失败");
      }
      setSamplerVideoPreview(response.data);
      setSamplerVideoPreviewError(response.data.previewUrl ? null : "当前桌面运行时不支持软件内视频预览，请重启软件后重试。");
      const quality = response.data.videoQuality ? `（${formatSamplerVideoQuality(response.data.videoQuality)}）` : "";
      setSamplerMessage(`MP4 已保存${quality}：${response.data.videoPath}`);
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "下载 MP4 失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerOpenDownloadedVideo() {
    const videoPath = samplerVideoPreview?.videoPath;
    if (!videoPath || !window.desktopFiles?.openPath) {
      setSamplerVideoPreviewError("请在桌面软件中打开本地视频文件");
      return;
    }
    try {
      const errorMessage = await window.desktopFiles.openPath(videoPath);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
    } catch (err) {
      setSamplerVideoPreviewError(err instanceof Error ? err.message : "打开本地视频失败");
    }
  }

  async function onSamplerRevealDownloadedVideo() {
    const videoPath = samplerVideoPreview?.videoPath;
    if (!videoPath || !window.desktopFiles?.revealInFolder) {
      setSamplerVideoPreviewError("请在桌面软件中定位本地视频文件");
      return;
    }
    try {
      await window.desktopFiles.revealInFolder(videoPath);
    } catch (err) {
      setSamplerVideoPreviewError(err instanceof Error ? err.message : "定位本地视频失败");
    }
  }

  function onSamplerVideoMetadataLoaded(durationSeconds: number) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setSamplerVideoPreviewError("无法读取视频总时长，暂时不能使用波形选区。");
      return;
    }
    setSamplerVideoDuration(durationSeconds);
    setSamplerVideoCurrentTime(0);
    setSamplerStartSeconds((value) => {
      const parsed = parseOptionalSeconds(value);
      return parsed === null ? "0.0" : formatSamplerClipSeconds(Math.min(Math.max(0, parsed), durationSeconds));
    });
    setSamplerEndSeconds((value) => {
      const parsed = parseOptionalSeconds(value);
      return parsed === null ? formatSamplerClipSeconds(durationSeconds) : formatSamplerClipSeconds(Math.min(Math.max(0, parsed), durationSeconds));
    });
  }

  function seekSamplerVideoPreview(ratio: number) {
    const video = samplerVideoPreviewRef.current;
    const duration = samplerVideoDuration || video?.duration || 0;
    if (!video || !Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const nextTime = clampWaveformRatio(ratio, 0) * duration;
    video.currentTime = nextTime;
    setSamplerVideoCurrentTime(nextTime);
    void video.play().catch(() => undefined);
  }

  function updateSamplerVideoSelection(boundary: "start" | "end", ratio: number) {
    if (!Number.isFinite(samplerVideoDuration) || samplerVideoDuration <= 0) {
      return;
    }
    const minimumClip = Math.min(SAMPLER_MIN_CLIP_SECONDS, samplerVideoDuration);
    const requested = clampWaveformRatio(ratio, 0) * samplerVideoDuration;
    const currentStart = samplerSelectionStartSeconds;
    const currentEnd = samplerSelectionEndSeconds;
    const nextStart = boundary === "start"
      ? Math.min(Math.max(0, requested), Math.max(0, currentEnd - minimumClip))
      : currentStart;
    const nextEnd = boundary === "end"
      ? Math.max(Math.min(samplerVideoDuration, requested), Math.min(samplerVideoDuration, currentStart + minimumClip))
      : currentEnd;
    setSamplerStartSeconds(formatSamplerClipSeconds(nextStart));
    setSamplerEndSeconds(formatSamplerClipSeconds(nextEnd));
  }

  function moveSamplerVideoSelection(startRatio: number, endRatio: number) {
    if (!Number.isFinite(samplerVideoDuration) || samplerVideoDuration <= 0) {
      return;
    }
    const startSeconds = clampWaveformRatio(startRatio, 0) * samplerVideoDuration;
    const endSeconds = clampWaveformRatio(endRatio, 1) * samplerVideoDuration;
    setSamplerStartSeconds(formatSamplerClipSeconds(Math.min(startSeconds, endSeconds)));
    setSamplerEndSeconds(formatSamplerClipSeconds(Math.max(startSeconds, endSeconds)));
  }

  async function onSamplerCancel() {
    if (!samplerExtracting) {
      samplerVideoPreviewRef.current?.pause();
      setSamplerOpen(false);
      return;
    }
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    setSamplerPendingAction("cancel-extract");
    try {
      const response = await sampler.cancelExtract();
      if (!response.success) {
        throw new Error(response.error ?? "取消取样失败");
      }
      setSamplerMessage("已请求取消取样");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "取消取样失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onImportVoice() {
    if (!window.desktopFiles?.selectReferenceAudio) {
      setError("请在桌面软件中导入参考音频");
      return;
    }
    setVoiceImporting(true);
    setVoiceMessage(null);
    setError(null);
    try {
      const audioPath = await window.desktopFiles.selectReferenceAudio();
      if (!audioPath) {
        return;
      }
      await openReferenceAudioEditor(audioPath, { kind: "create" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入音色失败");
    } finally {
      setVoiceImporting(false);
    }
  }

  function generatedVoiceLibraryRoleName(source: VoiceLibrarySaveSource | null) {
    if (!source) {
      return "本地生成音色";
    }
    return createGeneratedVoiceName(source.modelName, source.sourceVoiceName);
  }

  function generatedVoiceLibraryReferenceName(source: VoiceLibrarySaveSource | null) {
    if (!source) {
      return "生成参考片段";
    }
    return createGeneratedReferenceName(source.modelName);
  }

  function openVoiceLibrarySaveDialog(source: VoiceLibrarySaveSource) {
    const selectedRole = appendableVoiceRoles.find((voice) => voice.id === selectedVoice);
    const defaultRole = selectedRole ?? appendableVoiceRoles[0];
    const mode: ResultVoiceSaveMode = defaultRole ? "append" : "create";
    setVoiceLibrarySaveSource(source);
    setResultVoiceSaveMode(mode);
    setResultVoiceSaveTargetId(defaultRole?.id ?? "");
    setResultVoiceSaveName(mode === "append" ? generatedVoiceLibraryReferenceName(source) : generatedVoiceLibraryRoleName(source));
    setResultVoiceSaveError(null);
    setResultVoiceSaveOpen(true);
  }

  function openResultVoiceSaveDialog() {
    if (!result || resultSavedToVoiceLibrary) {
      return;
    }
    openVoiceLibrarySaveDialog({
      kind: "result",
      filePath: result.file_path,
      referenceText: resultReferenceText || input.trim() || undefined,
      modelName: resultModelName || selectedModelInfo?.display_name || result.model,
      sourceVoiceName: resultVoiceName || selectedVoiceInfo.name,
      displayName: getFileBaseName(result.file_path),
      durationSeconds: result.duration_seconds,
      authorizationStatus: "generated_local",
      sourceType: "generated"
    });
  }

  function closeVoiceLibrarySaveDialog() {
    if (voiceSaving) {
      return;
    }
    setResultVoiceSaveOpen(false);
    setVoiceLibrarySaveSource(null);
    setResultVoiceSaveError(null);
  }

  function selectResultVoiceSaveMode(mode: ResultVoiceSaveMode) {
    setResultVoiceSaveMode(mode);
    setResultVoiceSaveName(mode === "append" ? generatedVoiceLibraryReferenceName(voiceLibrarySaveSource) : generatedVoiceLibraryRoleName(voiceLibrarySaveSource));
    setResultVoiceSaveError(null);
  }

  async function onSaveResultToVoiceLibrary() {
    const source = voiceLibrarySaveSource;
    if (!source || (source.kind === "result" && resultSavedToVoiceLibrary)) {
      return;
    }
    if (!resultVoiceSaveName.trim()) {
      setResultVoiceSaveError(resultVoiceSaveMode === "append" ? "请填写参考片段名称。" : "请填写角色名称。");
      return;
    }
    const targetRole = appendableVoiceRoles.find((voice) => voice.id === resultVoiceSaveTargetId);
    if (resultVoiceSaveMode === "append" && !targetRole) {
      setResultVoiceSaveError("请选择要加入的已有角色。");
      return;
    }
    setVoiceSaving(true);
    setVoiceMessage(null);
    setError(null);
    setResultVoiceSaveError(null);
    try {
      const referenceText = source.referenceText;
      if (resultVoiceSaveMode === "append" && targetRole) {
        const voice = await createVoiceReference(targetRole.id, {
          name: resultVoiceSaveName.trim(),
          reference_audio: source.filePath,
          reference_text: referenceText,
          source_type: source.sourceType
        });
        const preset = createImportedVoicePreset(voice);
        if (preset) {
          setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
        }
        const appendedReference = voice.references[voice.references.length - 1];
        if (source.kind === "result") {
          setSavedVoicePath(source.filePath);
        } else {
          setAudioLibraryMessage(`${source.displayName} 已作为参考片段加入角色「${targetRole.name}」。`);
        }
        setVoiceMessage(`已作为参考片段加入角色「${targetRole.name}」，当前参考未改变。`);
        if (!referenceText && appendedReference) {
          startAutomaticVoiceRecognition(voice, appendedReference.id);
        }
      } else {
        const voice = await createVoice({
          name: resultVoiceSaveName.trim(),
          reference_audio: source.filePath,
          reference_text: referenceText,
          authorization_status: source.authorizationStatus,
          source_type: source.sourceType
        });
        const preset = createImportedVoicePreset(voice);
        if (preset) {
          setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
          setSelectedVoice(preset.id);
          if (preset.referenceText) {
            setReferenceText(preset.referenceText);
          }
          if (source.kind === "result") {
            setSavedVoicePath(source.filePath);
          } else {
            setAudioLibraryMessage(`${source.displayName} 已创建为角色「${preset.name}」。`);
          }
          setVoiceMessage(`已创建角色：${preset.name}`);
          if (!referenceText) {
            startAutomaticVoiceRecognition(voice);
          }
        }
      }
      setResultVoiceSaveOpen(false);
      setVoiceLibrarySaveSource(null);
    } catch (err) {
      setResultVoiceSaveError(err instanceof Error ? err.message : "加入音色库失败");
    } finally {
      setVoiceSaving(false);
    }
  }

  function openSettings() {
    setSettingsDraft(createSettingsDraft(appSettings));
    settingsNavigationTargetRef.current = null;
    setSettingsSection("common");
    void loadGlobalLlmSettings();
    setSettingsError(null);
    setSettingsMessage(null);
    void loadModelInstances();
    void loadModelPackages();
    setSettingsOpen(true);
  }

  async function closeSettings(): Promise<boolean> {
    if (settingsSaving || settingsMigrationAction) {
      return false;
    }
    if (settingsDirty || globalLlmDirty) {
      const confirmed = await requestConfirmation({
        title: "放弃未保存修改？",
        message: "设置中心里还有未保存的修改，关闭后这些修改会丢失。",
        confirmLabel: "放弃修改",
        tone: "danger"
      });
      if (!confirmed) {
        return false;
      }
      setSettingsDraft(createSettingsDraft(appSettings));
      setGlobalLlmSettings(savedGlobalLlmSettings);
    }
    setSettingsOpen(false);
    return true;
  }

  function restoreSettingsDraft() {
    setSettingsDraft(createSettingsDraft(appSettings));
    setSettingsError(null);
    setSettingsMessage("已恢复上次保存的设置。");
  }

  function navigateSettingsSection(section: SettingsSection, targetSelector?: string) {
    settingsNavigationTargetRef.current = targetSelector ?? null;
    setSettingsSection(section);
    setSettingsNavigationRequest((current) => current + 1);
  }

  async function onSaveGlobalLlmSettings() {
    const bridge = window.desktopLlmSettings;
    if (!bridge) {
      setGlobalLlmError("请在桌面软件中保存全局 LLM 配置。");
      return;
    }
    if (!globalLlmSettings.baseUrl.trim() || !globalLlmSettings.model.trim()) {
      setGlobalLlmError("LLM 地址和模型名不能为空。");
      return;
    }
    setGlobalLlmSaving(true);
    setGlobalLlmError(null);
    setGlobalLlmMessage(null);
    try {
      const saved = { ...globalLlmSettings, baseUrl: globalLlmSettings.baseUrl.trim(), model: globalLlmSettings.model.trim() };
      await bridge.save(saved);
      setGlobalLlmSettings(saved);
      setSavedGlobalLlmSettings(saved);
      setGlobalLlmMessage("全局 LLM 配置已保存；实时语音会话会自动复用。");
      window.dispatchEvent(new Event("opentts:llm-settings-changed"));
    } catch (err) {
      setGlobalLlmError(err instanceof Error ? err.message : "保存全局 LLM 配置失败");
    } finally {
      setGlobalLlmSaving(false);
    }
  }

  async function onTestGlobalLlm() {
    if (!globalLlmSettings.baseUrl.trim() || !globalLlmSettings.model.trim()) {
      setGlobalLlmError("请先填写 LLM 地址和模型名。");
      return;
    }
    setGlobalLlmTesting(true);
    setGlobalLlmError(null);
    setGlobalLlmMessage(null);
    try {
      const result = await testLlmConnection(globalLlmSettings);
      setGlobalLlmMessage(`连接成功：${result.model} · ${result.reply}`);
    } catch (err) {
      setGlobalLlmError(err instanceof Error ? err.message : "LLM 连接测试失败");
    } finally {
      setGlobalLlmTesting(false);
    }
  }

  async function onPolishControlPrompt() {
    const keywords = controlPrompt.trim();
    if (!keywords) {
      setPromptPolishError("先在提示词框输入几个关键词，例如“温柔 少女 轻声”。");
      setPromptPolishResult(null);
      return;
    }
    if (!globalLlmSettings.baseUrl.trim() || !globalLlmSettings.model.trim()) {
      setPromptPolishError("请先在设置 → 全局 LLM 中填写接口地址和模型名。");
      setPromptPolishResult(null);
      return;
    }
    setPromptPolishBusy(true);
    setPromptPolishError(null);
    try {
      const polished = await polishVoicePrompt(globalLlmSettings, keywords, {
        modelName: selectedModelInfo?.display_name ?? selectedModel,
        mode: cloneMode
      });
      setPromptPolishResult(polished);
    } catch (err) {
      setPromptPolishError(err instanceof Error ? err.message : "AI 润色失败");
      setPromptPolishResult(null);
    } finally {
      setPromptPolishBusy(false);
    }
  }

  async function onRewriteScript() {
    const source = input.trim();
    if (!source) {
      setScriptRewriteError("先在文本框输入一段内容。");
      setScriptRewriteResult(null);
      return;
    }
    if (!globalLlmSettings.baseUrl.trim() || !globalLlmSettings.model.trim()) {
      setScriptRewriteError("请先在设置 → 全局 LLM 中填写接口地址和模型名。");
      setScriptRewriteResult(null);
      return;
    }
    setScriptRewriteBusy(true);
    setScriptRewriteError(null);
    try {
      const rewritten = await transformLlmText(globalLlmSettings, source, "rewrite_script", {
        style: "自然、顺口、适合直接朗读；保留原文事实，不要添加 Markdown"
      });
      setScriptRewriteResult(rewritten);
    } catch (err) {
      setScriptRewriteError(err instanceof Error ? err.message : "配音稿改写失败");
      setScriptRewriteResult(null);
    } finally {
      setScriptRewriteBusy(false);
    }
  }

  async function onSaveSettings() {
    if (!settingsDraft.api_host.trim()) {
      setSettingsError("监听地址不能为空");
      return;
    }

    const apiPort = Number(settingsDraft.api_port);
    if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
      setSettingsError("端口需要是 1024–65535 之间的整数");
      return;
    }

    const idleTimeouts = [
      Number(settingsDraft.indextts2_idle_timeout_seconds),
      Number(settingsDraft.local_api_idle_timeout_seconds)
    ];
    if (idleTimeouts.some((seconds) => !Number.isFinite(seconds) || seconds < 30 || seconds > 86400)) {
      setSettingsError("空闲释放时间需要在 30–86400 秒之间");
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const savedSettings = await saveAppSettings({
        api_host: settingsDraft.api_host.trim(),
        api_port: apiPort,
        indextts2_idle_timeout_seconds: idleTimeouts[0],
        local_api_idle_timeout_seconds: idleTimeouts[1],
        asr_backend: settingsDraft.asr_backend,
        audio_enhancement_python: settingsDraft.audio_enhancement_python.trim(),
        audio_enhancement_device: settingsDraft.audio_enhancement_device,
        deepfilternet3_root: settingsDraft.deepfilternet3_root.trim(),
        mossformer2_se_root: settingsDraft.mossformer2_se_root.trim(),
        audio_separation_python: settingsDraft.audio_separation_python.trim(),
        audio_separation_root: settingsDraft.audio_separation_root.trim(),
        audio_separation_device: settingsDraft.audio_separation_device,
        default_model_id: settingsDraft.default_model_id,
        prewarm_default_model_on_startup: settingsDraft.prewarm_default_model_on_startup
      });
      setAppSettings(savedSettings);
      setSettingsDraft(createSettingsDraft(savedSettings));
      if (localModels.some((model) => model.id === savedSettings.default_model_id)) {
        setSelectedModel(savedSettings.default_model_id);
      }
      setSettingsMessage("设置已保存");
      void loadSystemStatus();
      void loadModelInstances();
      void loadModelPackages();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function onExportSettingsBackup() {
    if (!window.desktopFiles?.saveSettingsBackup) {
      setSettingsError("请在桌面软件中导出设置备份");
      return;
    }

    setSettingsMigrationAction("export");
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const backup = await exportSettingsBackup();
      const savedPath = await window.desktopFiles.saveSettingsBackup(JSON.stringify(backup, null, 2));
      if (savedPath) {
        setSettingsMessage(`设置备份已保存到：${savedPath}`);
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "导出设置备份失败");
    } finally {
      setSettingsMigrationAction(null);
    }
  }

  async function onImportSettingsBackup() {
    if (!window.desktopFiles?.selectSettingsBackup) {
      setSettingsError("请在桌面软件中导入设置备份");
      return;
    }

    setSettingsMigrationAction("import");
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const selectedBackup = await window.desktopFiles.selectSettingsBackup();
      if (!selectedBackup) {
        return;
      }
      let backup: SettingsBackup;
      try {
        backup = JSON.parse(selectedBackup.content) as SettingsBackup;
      } catch {
        throw new Error("所选文件不是有效的 JSON 设置备份");
      }
      const importedSettings = await importSettingsBackup(backup);
      setAppSettings(importedSettings);
      setSettingsDraft(createSettingsDraft(importedSettings));
      await Promise.all([loadModelInstances(), loadModelPackages(), loadSystemStatus()]);
      setSettingsMessage(`已导入设置备份：${selectedBackup.path}。如修改了 API 地址或端口，请重启软件。`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "导入设置备份失败");
    } finally {
      setSettingsMigrationAction(null);
    }
  }

  async function openModelDirectory(directory: ModelDirectory) {
    if (!window.desktopFiles?.openPath) {
      setSettingsError("当前预览环境不支持打开目录");
      return;
    }
    setSettingsError(null);
    try {
      const resultMessage = await window.desktopFiles.openPath(directory.path);
      if (resultMessage) {
        setSettingsError(resultMessage);
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "无法打开目录");
    }
  }

  async function chooseDirectoryForSetting(field: "indextts2_root" | "voxcpm2_root" | "gptsovits_root" | "deepfilternet3_root" | "mossformer2_se_root" | "audio_separation_root") {
    if (!window.desktopFiles?.selectDirectory) {
      setSettingsError("当前预览环境不支持选择目录");
      return;
    }
    setSettingsError(null);
    try {
      const directoryPath = await window.desktopFiles.selectDirectory();
      if (!directoryPath) {
        return;
      }
      setSettingsDraft((draft) => ({ ...draft, [field]: directoryPath }));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "选择目录失败");
    }
  }

  async function chooseModelInstanceDirectory(instance: ModelInstanceProfile) {
    if (!window.desktopFiles?.selectDirectory) {
      setSettingsError("当前预览环境不支持选择目录");
      return;
    }
    setSettingsError(null);
    try {
      const directoryPath = await window.desktopFiles.selectDirectory();
      if (!directoryPath) {
        return;
      }
      const updated = await updateModelInstance(instance.model_id, { root_path: directoryPath });
      setModelInstances((items) => items.map((item) => (item.model_id === updated.model_id ? updated : item)));
      const health = await checkModelInstance(updated.model_id);
      setModelHealthResults((results) => ({ ...results, [updated.model_id]: health }));
      await loadModelInstances();
      if (health.status !== "ready") {
        setSettingsError(health.repair_hint ?? "模型目录检查未通过，请重新选择完整的模型包目录。");
      }
      void loadModelPackages();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "选择目录失败");
    }
  }

  function updateModelProfileDraft(modelId: string, values: Partial<ModelProfileDraft>) {
    setModelProfileDrafts((drafts) => ({
      ...drafts,
      [modelId]: {
        package_label: drafts[modelId]?.package_label ?? "",
        user_note: drafts[modelId]?.user_note ?? "",
        ...values
      }
    }));
  }

  async function onSaveModelProfile(instance: ModelInstanceProfile) {
    const draft = modelProfileDrafts[instance.model_id] ?? createModelProfileDraft(instance);
    setSavingProfileModelId(instance.model_id);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const updated = await updateModelInstance(instance.model_id, {
        package_label: draft.package_label.trim() || null,
        user_note: draft.user_note.trim() || null
      });
      setModelInstances((items) => items.map((item) => (item.model_id === updated.model_id ? updated : item)));
      setModelProfileDrafts((drafts) => ({
        ...drafts,
        [updated.model_id]: createModelProfileDraft(updated)
      }));
      setSettingsMessage(`${updated.display_name} 档案已保存`);
      void loadModelPackages();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "保存模型档案失败");
    } finally {
      setSavingProfileModelId(null);
    }
  }

  async function onCheckModelInstance(instance: ModelInstanceProfile) {
    setCheckingModelId(instance.model_id);
    setSettingsError(null);
    try {
      const result = await checkModelInstance(instance.model_id);
      setModelHealthResults((results) => ({ ...results, [instance.model_id]: result }));
      await loadModelInstances();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "检查模型失败");
    } finally {
      setCheckingModelId(null);
    }
  }

  async function onToggleModelInstance(instance: ModelInstanceProfile) {
    setSettingsError(null);
    try {
      const updated = await updateModelInstance(instance.model_id, { enabled: !instance.enabled });
      setModelInstances((items) => items.map((item) => (item.model_id === updated.model_id ? updated : item)));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "切换模型状态失败");
    }
  }

  async function onRegisterModelPackage(source: "directory" | "archive") {
    const desktopFiles = window.desktopFiles;
    if (!desktopFiles) {
      setSettingsError("请在桌面软件中登记模型包");
      return;
    }
    if (source === "archive" && !desktopFiles.selectModelArchive) {
      setSettingsError("当前预览环境不支持选择模型压缩包");
      return;
    }
    setModelPackageAction(`register-${source}`);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const selectedPath = source === "directory"
        ? await desktopFiles.selectDirectory()
        : await desktopFiles.selectModelArchive();
      if (!selectedPath) {
        return;
      }
      const registered = await registerModelPackage({
        model_id: modelPackageModelId,
        path: selectedPath,
        package_label: modelPackageLabel.trim() || null,
        user_note: modelPackageNote.trim() || null
      });
      setModelPackageLabel("");
      setModelPackageNote("");
      await loadModelPackages();
      setSettingsMessage(`${registered.path} 已登记为 ${modelPackageStateLabel(registered.state)}。`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "登记模型包失败");
    } finally {
      setModelPackageAction(null);
    }
  }

  async function onInspectModelPackage(modelPackage: ModelPackageRecord) {
    setModelPackageAction(`inspect-${modelPackage.id}`);
    setSettingsError(null);
    try {
      const inspected = await inspectModelPackage(modelPackage.id);
      setModelPackages((items) => items.map((item) => (item.id === inspected.id ? inspected : item)));
      setSettingsMessage(`${modelPackage.path} 已完成只读预检。`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "模型包预检失败");
    } finally {
      setModelPackageAction(null);
    }
  }

  async function onActivateModelPackage(modelPackage: ModelPackageRecord) {
    setModelPackageAction(`activate-${modelPackage.id}`);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const activated = await activateModelPackage(modelPackage.id);
      await Promise.all([loadModelPackages(), loadModelInstances(), loadSystemStatus()]);
      setSettingsMessage(`${activated.instance.display_name} 已切换到稳定包：${activated.package.path}`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "切换稳定模型包失败");
    } finally {
      setModelPackageAction(null);
    }
  }

  async function onArchiveModelPackage(modelPackage: ModelPackageRecord) {
    setModelPackageAction(`archive-${modelPackage.id}`);
    setSettingsError(null);
    try {
      const updated = await updateModelPackage(modelPackage.id, { state: "archived" });
      setModelPackages((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setSettingsMessage(`已归档模型包：${modelPackage.path}`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "归档模型包失败");
    } finally {
      setModelPackageAction(null);
    }
  }

  function selectModel(modelId: string) {
    selectedModelRef.current = modelId;
    setSelectedModel(modelId);
  }

  async function runModelWarmup(modelId: string) {
    const warmupEpoch = ++modelWarmupEpochRef.current;
    if (generationWorkspace === "realtime" && isRealtimeExclusiveTtsModel(modelId)) {
      pendingModelWarmupRef.current = null;
      return;
    }
    const model = models.find((candidate) => candidate.id === modelId);
    const instance = modelInstances.find((candidate) => candidate.model_id === modelId);
    const displayName = model?.display_name ?? instance?.display_name ?? modelId;
    if (!instance || !isModelInstanceUsable(instance)) {
      setModelWarmupState({
        modelId,
        status: "failed",
        message: `${displayName} 尚未配置可用模型实例，已跳过预热。`
      });
      return;
    }
    pendingModelWarmupRef.current = null;
    setModelWarmupState({ modelId, status: "warming", message: `${displayName} 正在加载到显存…` });
    try {
      const result = await startModelRuntime(modelId);
      if (warmupEpoch !== modelWarmupEpochRef.current) return;
      setSystemStatus((current) =>
        current ? { ...current, workers: { ...current.workers, [modelId]: result.worker } } : current
      );
      setModelWarmupState({ modelId, status: "ready", message: `${displayName} 已预热，可以直接开始生成。` });
      await loadSystemStatus();
    } catch (err) {
      if (warmupEpoch !== modelWarmupEpochRef.current) return;
      setModelWarmupState({
        modelId,
        status: "failed",
        message: err instanceof Error ? `预热失败：${err.message}` : `${displayName} 预热失败。`
      });
    }
  }

  function queueModelWarmup(modelId: string) {
    if (generationWorkspace === "realtime" && isRealtimeExclusiveTtsModel(modelId)) {
      pendingModelWarmupRef.current = null;
      return;
    }
    const displayName = models.find((candidate) => candidate.id === modelId)?.display_name ?? modelId;
    pendingModelWarmupRef.current = modelId;
    if (voiceRecognitionRequestsRef.current.size > 0) {
      setModelWarmupState({
        modelId,
        status: "waiting",
        message: `正在识别参考音频，完成后将自动预热 ${displayName}。`
      });
      return;
    }
    void runModelWarmup(modelId);
  }

  async function onStartModelRuntime(instance: ModelInstanceProfile) {
    setRuntimeActionModelId(instance.model_id);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const result = await startModelRuntime(instance.model_id);
      const releasedNames = (result.released_models ?? [])
        .map((modelId) => models.find((model) => model.id === modelId)?.display_name ?? modelId)
        .join("、");
      setSettingsMessage(
        releasedNames
          ? `${instance.display_name} 已完成预热，并释放了 ${releasedNames} 的显存。`
          : `${instance.display_name} 已完成预热，可以直接开始生成。`
      );
      setSystemStatus((current) =>
        current
          ? { ...current, workers: { ...current.workers, [instance.model_id]: result.worker } }
          : current
      );
      await loadSystemStatus();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "启动模型运行时失败");
    } finally {
      setRuntimeActionModelId(null);
    }
  }

  async function onStopModelRuntime(instance: ModelInstanceProfile) {
    setRuntimeActionModelId(instance.model_id);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const result = await stopModelRuntime(instance.model_id);
      setSettingsMessage(
        result.released
          ? `${instance.display_name} 已停止，显存会在进程退出后释放。`
          : `${instance.display_name} 当前没有由本软件托管的运行时。`
      );
      setSystemStatus((current) =>
        current
          ? { ...current, workers: { ...current.workers, [instance.model_id]: result.worker } }
          : current
      );
      await loadSystemStatus();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "释放模型运行时失败");
    } finally {
      setRuntimeActionModelId(null);
    }
  }

  function requestModelSwitch(targetModelId: string) {
    if (generationWorkspace === "realtime") {
      return;
    }
    if (targetModelId === selectedModel) {
      return;
    }
    if (modelSwitchLocked) {
      return;
    }
    const workers = systemStatus?.workers;
    const loadedModelIds = workers
      ? (["indextts2", "voxcpm2", "gptsovits"] as const).filter(
          (modelId) => modelId !== targetModelId && workers[modelId]?.loaded
        )
      : [];
    // Every manual model change takes the same confirmation path.  Before this
    // point a dialog appeared only when a monitoring snapshot happened to show
    // another resident worker, while an equally consequential preheat could
    // start without any explanation.
    setPendingModelSwitch({ targetModelId, loadedModelIds });
  }

  async function chooseAudioEnhancementPython() {
    if (!window.desktopFiles?.selectPythonExecutable) {
      setSettingsError("当前预览环境不支持选择 Python 运行时");
      return;
    }
    setSettingsError(null);
    try {
      const pythonPath = await window.desktopFiles.selectPythonExecutable();
      if (pythonPath) {
        setSettingsDraft((draft) => ({ ...draft, audio_enhancement_python: pythonPath }));
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "选择 Python 运行时失败");
    }
  }

  async function chooseAudioSeparationPython() {
    if (!window.desktopFiles?.selectPythonExecutable) {
      setSettingsError("当前预览环境不支持选择 Python 运行时");
      return;
    }
    setSettingsError(null);
    try {
      const pythonPath = await window.desktopFiles.selectPythonExecutable();
      if (pythonPath) {
        setSettingsDraft((draft) => ({ ...draft, audio_separation_python: pythonPath }));
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "选择 Python 运行时失败");
    }
  }

  function confirmModelSwitch() {
    if (!pendingModelSwitch || modelSwitchLocked || generationWorkspace === "realtime") {
      setPendingModelSwitch(null);
      return;
    }
    selectModel(pendingModelSwitch.targetModelId);
    queueModelWarmup(pendingModelSwitch.targetModelId);
    setPendingModelSwitch(null);
  }

  function createCurrentSpeechOptions(): GenerateSpeechOptions {
    return {
      voice: supportsRequestCapability(selectedModelInfo, "voice") ? selectedVoice : undefined,
      referenceAudio: needsReferenceAudio && supportsRequestCapability(selectedModelInfo, "reference_audio")
        ? selectedVoiceInfo.referenceAudio
        : undefined,
      referenceText: supportsRequestCapability(selectedModelInfo, "reference_text")
        && (needsExtremeReferenceText || selectedModel === "gptsovits")
        ? effectiveReferenceText.trim() || undefined
        : undefined,
      emotion: showControlPrompt && supportsRequestCapability(selectedModelInfo, "control_prompt")
        ? controlPrompt.trim() || undefined
        : undefined,
      speed: showSpeedControl ? speed : 1,
      responseFormat: "wav",
      cfg: showCfgSteps ? cfg : undefined,
      inferenceSteps: showCfgSteps ? steps : undefined,
      temperature: showIndexSampling ? indexTemperature : undefined,
      topP: showIndexSampling ? indexTopP : undefined,
      topK: showIndexSampling ? indexTopK : undefined,
      numBeams: showIndexSampling ? indexNumBeams : undefined,
      repetitionPenalty: showIndexSampling ? indexRepetitionPenalty : undefined,
      maxMelTokens: showIndexSampling ? indexMaxMelTokens : undefined,
      normalize: showNormalizeToggle ? normalizeText : undefined,
      denoise: showDenoiseToggle ? denoise : undefined
    };
  }

  function publishDrawSession(session: DrawSession | null) {
    setDrawSession(session ? { ...session } : null);
  }

  function selectDrawCandidate(candidate: DrawCandidate) {
    audioRef.current?.pause();
    setIsPlaying(false);
    setResult(candidate.result);
    setResultReferenceText(candidate.input);
    setResultModelName(candidate.modelName);
    setResultVoiceName(candidate.voiceName);
    setSavedVoicePath(null);
    setPlaybackTime(0);
    setPlaybackDuration(candidate.result.duration_seconds);
    setSelectedDrawCandidateId(candidate.id);
  }

  function finishDrawSession(session: DrawSession, status: Extract<DrawSession["status"], "completed" | "cancelled">) {
    if (drawSessionRef.current?.id !== session.id) {
      return;
    }
    session.status = status;
    session.activeJobId = null;
    session.handlingTerminalJob = false;
    drawSessionRef.current = null;
    publishDrawSession(session);
    setLoading(false);
    setGenerationStartedAt(null);
    setActiveSpeechJob(null);
    setActiveSpeechContext(null);
    if (status === "completed" && session.successful === 0) {
      setError("抽卡已结束，但没有生成出可用音频。请查看任务中心中的失败原因。");
    }
    void loadSystemStatus();
  }

  async function startNextDrawJob(session: DrawSession) {
    if (drawSessionRef.current?.id !== session.id) {
      return;
    }
    if (session.cancelRequested) {
      finishDrawSession(session, "cancelled");
      return;
    }
    session.handlingTerminalJob = false;
    session.activeJobId = null;
    publishDrawSession(session);
    try {
      const job = await createSpeechJob(session.model, session.input, session.options);
      if (drawSessionRef.current?.id !== session.id || session.cancelRequested) {
        await cancelSpeechJob(job.id, false).catch(() => undefined);
        if (drawSessionRef.current?.id === session.id) {
          finishDrawSession(session, "cancelled");
        }
        return;
      }
      session.activeJobId = job.id;
      publishDrawSession(session);
      setActiveSpeechContext({ modelName: session.modelName, voiceName: session.voiceName });
      setActiveSpeechJob(job);
      void loadTaskSummaries();
    } catch (err) {
      session.failed += 1;
      if (session.currentIndex >= session.total || session.cancelRequested) {
        finishDrawSession(session, session.cancelRequested ? "cancelled" : "completed");
        return;
      }
      session.currentIndex += 1;
      publishDrawSession(session);
      void startNextDrawJob(session);
    }
  }

  async function handleDrawTerminalJob(job: SpeechJob) {
    const session = drawSessionRef.current;
    if (!session || session.activeJobId !== job.id) {
      return false;
    }
    if (session.handlingTerminalJob) {
      return true;
    }
    session.handlingTerminalJob = true;
    if (job.status === "succeeded" && job.result) {
      const candidate: DrawCandidate = {
        id: job.id,
        index: session.currentIndex,
        result: job.result,
        modelName: session.modelName,
        voiceName: session.voiceName,
        input: session.input
      };
      session.successful += 1;
      setDrawCandidates((candidates) => [...candidates, candidate]);
      if (session.successful === 1) {
        selectDrawCandidate(candidate);
      }
    } else if (job.status !== "cancelled") {
      session.failed += 1;
    }

    setActiveSpeechJob(null);
    setActiveSpeechContext(null);
    session.activeJobId = null;
    if (session.cancelRequested || job.status === "cancelled") {
      finishDrawSession(session, "cancelled");
      return true;
    }
    if (session.currentIndex >= session.total) {
      finishDrawSession(session, "completed");
      return true;
    }
    session.currentIndex += 1;
    publishDrawSession(session);
    void startNextDrawJob(session);
    return true;
  }

  async function onDrawGenerate(count: 2 | 3 | 4) {
    if (!canGenerate) {
      return;
    }
    const requestText = input.trim();
    const session: DrawSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      total: count,
      currentIndex: 1,
      successful: 0,
      failed: 0,
      status: "running",
      activeJobId: null,
      cancelRequested: false,
      model: selectedModel,
      input: requestText,
      options: createCurrentSpeechOptions(),
      modelName: selectedModelInfo?.display_name ?? selectedModel,
      voiceName: currentVoiceName,
      handlingTerminalJob: false
    };
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setResult(null);
    setResultReferenceText("");
    setResultModelName("");
    setResultVoiceName("");
    setSavedVoicePath(null);
    setDrawCandidates([]);
    setSelectedDrawCandidateId(null);
    drawSessionRef.current = session;
    publishDrawSession(session);
    setGenerationStartedAt(Date.now());
    setElapsedSeconds(0);
    await startNextDrawJob(session);
  }

  async function onGenerate() {
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    setResult(null);
    setResultReferenceText("");
    setResultModelName("");
    setResultVoiceName("");
    setSavedVoicePath(null);
    drawSessionRef.current = null;
    setDrawSession(null);
    setDrawCandidates([]);
    setSelectedDrawCandidateId(null);
    const startedAt = Date.now();
    const requestText = input.trim();
    const requestModelName = selectedModelInfo?.display_name ?? selectedModel;
    const requestVoiceName = currentVoiceName;
    setGenerationStartedAt(startedAt);
    setElapsedSeconds(0);
    try {
      const job = await createSpeechJob(selectedModel, requestText, createCurrentSpeechOptions());
      setActiveSpeechContext({ modelName: requestModelName, voiceName: requestVoiceName });
      setActiveSpeechJob(job);
      void loadTaskSummaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
      setLoading(false);
      setGenerationStartedAt(null);
      if (isBackendConnectionError(err)) {
        void recoverLocalBackend();
      }
      void loadSystemStatus();
    }
  }

  async function onForceStopActiveGeneration() {
    const activeDrawSession = drawSessionRef.current;
    if (!activeSpeechJob && !activeDrawSession) {
      return;
    }
    const isCloudJob = activeSpeechJob?.request.model === "doubao-web";
    const drawMessage = activeDrawSession
      ? `将停止本轮抽卡，已完成的 ${activeDrawSession.successful} 条会保留，后续 ${Math.max(0, activeDrawSession.total - activeDrawSession.currentIndex)} 条不再生成。是否继续？`
      : isCloudJob
        ? "将终止当前豆包生成请求，未保存的本次结果会丢失，是否继续？"
        : "将终止当前生成并关闭该模型进程以释放显存。未保存的本次结果会丢失，是否继续？";
    if (!await requestConfirmation({
      title: "停止当前生成？",
      message: drawMessage,
      confirmLabel: "停止生成",
      tone: "danger"
    })) {
      return;
    }
    setError(null);
    try {
      if (activeDrawSession) {
        activeDrawSession.cancelRequested = true;
        activeDrawSession.status = "stopping";
        publishDrawSession(activeDrawSession);
      }
      if (!activeSpeechJob) {
        if (activeDrawSession) {
          finishDrawSession(activeDrawSession, "cancelled");
        }
        return;
      }
      const cancelled = await cancelSpeechJob(activeSpeechJob.id, true);
      setActiveSpeechJob(cancelled);
      setTaskCenterMessage(activeDrawSession ? "已停止本轮抽卡，正在结束当前任务。" : isCloudJob ? "已终止豆包生成请求。" : "已终止无响应的生成任务，模型显存正在释放。");
      void loadTaskSummaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "终止生成失败");
    }
  }

  async function onCancelTask(task: TaskSummary) {
    setTaskCenterAction(`cancel-${task.id}`);
    setTaskCenterError(null);
    try {
      if (task.source === "speech") {
        const activeDrawSession = drawSessionRef.current;
        if (activeDrawSession?.activeJobId === task.id) {
          activeDrawSession.cancelRequested = true;
          activeDrawSession.status = "stopping";
          publishDrawSession(activeDrawSession);
        }
        const force = task.status === "running";
        await cancelSpeechJob(task.id, force);
        setTaskCenterMessage(activeDrawSession?.activeJobId === task.id ? "已停止本轮抽卡，当前任务结束后不会继续生成。" : force ? "已终止当前生成，并请求释放模型显存。" : "排队生成任务已取消。");
      } else if (task.source === "batch_project") {
        const projectId = task.id.replace(/^project:/, "");
        const updated = await cancelBatchProject(projectId);
        await loadBatchProjects();
        setTaskCenterMessage(
          updated.status === "cancelling"
            ? "批量项目会在当前段落完成后安全停止。"
            : "批量项目已从生成队列中移除。"
        );
      } else if (task.source === "bilibili") {
        await onSamplerCancel();
        setTaskCenterMessage("已向 B 站取样任务发送取消请求。");
      } else if (task.source === "ebook") {
        await cancelDoubaoPrefetch(task.id.replace(/^ebook:/, ""));
        setTaskCenterMessage("电子书预制任务已停止，已完成章节会保留。");
      } else {
        throw new Error("当前任务类型暂不支持安全取消。");
      }
      await loadTaskSummaries();
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "取消任务失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onRetryTask(task: TaskSummary) {
    setTaskCenterAction(`retry-${task.id}`);
    setTaskCenterError(null);
    try {
      if (task.source === "speech") {
        const retried = await retrySpeechJob(task.id);
        const retryModelName = models.find((model) => model.id === retried.request.model)?.display_name ?? retried.request.model;
        setActiveSpeechContext({ modelName: retryModelName, voiceName: "任务重试" });
        setActiveSpeechJob(retried);
        setLoading(true);
        setGenerationStartedAt(Date.now());
        setElapsedSeconds(0);
        setTaskCenterMessage("失败的单句任务已重新进入本地队列。");
      } else if (task.source === "batch_project") {
        const projectId = task.id.replace(/^project:/, "");
        if (task.status === "cancelled") {
          await resumeBatchProject(projectId);
        } else {
          await retryBatchProject(projectId);
        }
        await loadBatchProjects();
        setTaskCenterMessage(task.status === "cancelled" ? "批量项目已从停止位置继续进入队列。" : "批量项目已重新进入串行队列。");
      } else if (task.source === "bilibili") {
        setSamplerOpen(true);
        setTaskCenterOpen(false);
        setTaskCenterMessage("已打开 B 站取样窗口，请重新发起操作。");
      } else if (task.source === "ebook") {
        const taskId = task.id.replace(/^ebook:/, "");
        if (task.status === "paused" || task.status === "cancelled") {
          await resumeDoubaoPrefetch(taskId);
        } else {
          await retryDoubaoPrefetch(taskId);
        }
        setTaskCenterMessage("电子书失败章节已重新排队。");
      } else {
        throw new Error("当前任务类型暂不支持重试。");
      }
      await loadTaskSummaries();
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "重试任务失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onRetryAllManageableTasks() {
    const candidates = taskCenterTasks.filter(
      (task) => task.retryable && ["speech", "batch_project"].includes(task.source)
    );
    if (!candidates.length) {
      setTaskCenterMessage("当前没有可批量重试的单句生成或批量旁白任务。");
      return;
    }
    if (!await requestConfirmation({
      title: "重新排队任务？",
      message: `将把 ${candidates.length} 项失败或已取消任务重新加入本地串行队列。`,
      confirmLabel: "重新排队"
    })) {
      return;
    }
    setTaskCenterAction("retry-all");
    setTaskCenterError(null);
    setTaskCenterMessage(null);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const task of candidates) {
        try {
          if (task.source === "speech") {
            await retrySpeechJob(task.id);
          } else {
            const projectId = task.id.replace(/^project:/, "");
            if (task.status === "cancelled") {
              await resumeBatchProject(projectId);
            } else {
              await retryBatchProject(projectId);
            }
          }
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }
      await loadBatchProjects();
      await loadTaskSummaries();
      setTaskCenterMessage(
        failed > 0
          ? `已重新排队 ${succeeded} 项，另有 ${failed} 项未能重试，请查看对应任务诊断。`
          : `已重新排队 ${succeeded} 项任务，后端会按串行队列依次处理。`
      );
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "批量重试任务失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onClearSpeechHistory() {
    setTaskCenterAction("clear-history");
    setTaskCenterError(null);
    setTaskCenterMessage(null);
    try {
      const result = await clearSpeechJobHistory();
      setTaskHistoryClearConfirmOpen(false);
      await loadTaskSummaries();
      setTaskCenterMessage(
        result.removed_jobs > 0
          ? `已清理 ${result.removed_jobs} 条单句生成记录和 ${result.removed_logs} 份诊断日志；生成音频仍保留在输出目录。`
          : "没有可清理的已结束单句任务；进行中的任务已保留。"
      );
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "清理生成历史失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onClearMissingTaskRecords(task: TaskSummary) {
    const missingResults = (task.results ?? []).filter((result) => !result.exists);
    const isSpeechTask = ["speech", "realtime"].includes(task.source);
    const projectId = task.source === "batch_project" && task.id.startsWith("project:")
      ? task.id.replace(/^project:/, "")
      : null;
    const removableBatchResults = projectId
      ? missingResults
        .map((result) => ({ result, segmentId: result.id.split(":segment:").pop() ?? "" }))
        .filter(({ result, segmentId }) => result.id.includes(":segment:") && segmentId)
      : [];
    if (missingResults.length === 0) {
      setTaskCenterError("这项任务没有可清理的缺失文件记录。");
      return;
    }
    if (!isSpeechTask && removableBatchResults.length === 0) {
      setTaskCenterError("这类任务暂不支持批量清理缺失记录，请在成果详情中逐项处理。");
      return;
    }
    const confirmed = await requestConfirmation({
      title: "移除缺失记录？",
      message: isSpeechTask
        ? `将移除“${task.title}”的缺失任务记录，只删除任务记录和诊断日志，不会删除其他成果文件。`
        : `将移除“${task.title}”中的 ${removableBatchResults.length} 条缺失成果记录，只清理任务记录，不会删除其他成果文件。`,
      confirmLabel: "移除记录",
      tone: "danger"
    });
    if (!confirmed) return;
    setTaskCenterAction(`clear-missing-${task.id}`);
    setTaskCenterError(null);
    setTaskCenterMessage(null);
    try {
      if (isSpeechTask) {
        await deleteSpeechJobHistoryRecord(task.id);
        setRemoteTasks((tasks) => tasks.filter((item) => item.id !== task.id));
      } else if (projectId) {
        for (const { segmentId } of removableBatchResults) {
          await deleteBatchProjectSegmentHistory(projectId, segmentId);
        }
        const missingIds = new Set(removableBatchResults.map(({ result }) => result.id));
        setRemoteTasks((tasks) => tasks.map((item) => item.id === task.id
          ? { ...item, results: item.results.filter((result) => !missingIds.has(result.id)) }
          : item));
      }
      setSelectedTaskResultIds((ids) => ids.filter((id) => !missingResults.some((result) => result.id === id)));
      await Promise.all([loadTaskSummaries(), loadBatchProjects(), loadAudioAssets()]);
      setTaskCenterMessage(isSpeechTask ? `已移除缺失任务记录：${task.title}。` : `已移除 ${removableBatchResults.length} 条缺失成果记录。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "清理缺失记录失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function openTaskLog(task: TaskSummary) {
    if (!task.log_file || !window.desktopFiles?.openPath) {
      setTaskCenterError("当前任务没有可打开的本地日志文件。");
      return;
    }
    try {
      const errorMessage = await window.desktopFiles.openPath(task.log_file);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "打开任务日志失败");
    }
  }

  async function copyTaskDiagnostics(task: TaskSummary) {
    setTaskCenterAction(`copy-${task.id}`);
    setTaskCenterError(null);
    try {
      const content = buildTaskDiagnosticText(task);
      if (window.desktopClipboard?.writeText) {
        await window.desktopClipboard.writeText(content);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        throw new Error("当前环境不支持写入剪贴板。");
      }
      setTaskCenterMessage("任务诊断已复制，可直接粘贴到反馈或排障消息中。");
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "复制任务诊断失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onOpenTaskResult(result: TaskCenterResult) {
    if (result.summary_only) {
      setSelectedTaskResultId(result.id);
      setTaskCenterMessage(`已打开 ${result.file_name} 的章节成果。`);
      return;
    }
    if (result.bilibili_history_id) {
      setSamplerOpen(true);
      setTaskCenterOpen(false);
      setSamplerMessage("已打开媒体采样工作台；可在下载历史中继续预览、取样或转写该视频。");
      return;
    }
    if (!result.file_path || !window.desktopFiles?.openPath) {
      await onDownloadTaskResult(result);
      return;
    }
    setTaskCenterAction(`open-result-${result.id}`);
    setTaskCenterError(null);
    try {
      const errorMessage = await window.desktopFiles.openPath(result.file_path);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      setTaskCenterMessage(`已打开 ${result.file_name}。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "打开结果文件失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onRevealTaskResult(result: TaskCenterResult) {
    if (!result.file_path || !window.desktopFiles?.revealInFolder) {
      setTaskCenterError("该结果尚未生成本地实体文件，无法定位目录。");
      return;
    }
    setTaskCenterAction(`reveal-result-${result.id}`);
    setTaskCenterError(null);
    try {
      await window.desktopFiles.revealInFolder(result.file_path);
      setTaskCenterMessage(`已在资源管理器中定位 ${result.file_name}。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "打开所在目录失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onOpenEbookDirectory(path: string | undefined, label: string) {
    if (!path || !window.desktopFiles?.openPath) {
      setTaskCenterError("电子书目录尚未准备好，或当前不是桌面预览环境。");
      return;
    }
    setTaskCenterAction(`open-ebook-${label}`);
    setTaskCenterError(null);
    try {
      const errorMessage = await window.desktopFiles.openPath(path);
      if (errorMessage) throw new Error(errorMessage);
      setTaskCenterMessage(`已打开${label}目录。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : `打开${label}目录失败`);
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onDownloadTaskResult(result: TaskCenterResult) {
    if (!result.url) {
      setTaskCenterError("该结果没有可导出的内容地址。");
      return;
    }
    setTaskCenterAction(`download-result-${result.id}`);
    setTaskCenterError(null);
    try {
      const anchor = document.createElement("a");
      anchor.href = resolveTaskResultUrl(result.url);
      anchor.download = result.file_name;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTaskCenterMessage(`${result.file_name} 已开始导出。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "导出结果失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onDeleteTaskResult(result: TaskCenterResult) {
    if (result.summary_only) {
      setTaskCenterError("电子书成果是章节汇总，请在任务中心管理预制进度和缓存文件。");
      return;
    }
    if (result.bilibili_history_id) {
      const bridge = window.desktopBilibiliSampler;
      if (!bridge) {
        setTaskCenterError("请在桌面软件中管理 B 站下载历史。");
        return;
      }
      const confirmed = await requestConfirmation({
        title: "移除下载记录？",
        message: `将移除“${result.file_name}”的 B 站下载记录。本地 MP4 文件会保留，不会被删除。`,
        confirmLabel: "移除记录",
        tone: "danger"
      });
      if (!confirmed) {
        return;
      }
      setTaskCenterAction(`delete-result-${result.id}`);
      setTaskCenterError(null);
      try {
        const response = await bridge.removeHistory(result.bilibili_history_id);
        if (!response.success) {
          throw new Error(response.error ?? "移除 B 站下载记录失败");
        }
        setBilibiliHistoryItems((items) => items.filter((item) => item.id !== result.bilibili_history_id));
        setSelectedTaskResultIds((ids) => ids.filter((id) => id !== result.id));
        if (selectedTaskResultId === result.id) setSelectedTaskResultId(null);
        setTaskCenterMessage(`已移除下载记录：${result.file_name}；本地 MP4 文件仍保留。`);
      } catch (err) {
        setTaskCenterError(err instanceof Error ? err.message : "移除 B 站下载记录失败");
      } finally {
        setTaskCenterAction(null);
      }
      return;
    }
    if (!result.exists && ["speech", "realtime"].includes(result.source) && result.task_id) {
      const confirmed = await requestConfirmation({
        title: "移除缺失记录？",
        message: `将移除“${result.file_name}”的缺失任务记录，只删除任务记录和诊断日志，不会删除其他成果文件。`,
        confirmLabel: "移除记录",
        tone: "danger"
      });
      if (!confirmed) return;
      setTaskCenterAction(`delete-result-${result.id}`);
      setTaskCenterError(null);
      try {
        await deleteSpeechJobHistoryRecord(result.task_id);
        // Remove it optimistically so the deleted record cannot remain selected
        // while the task-center refresh is still in flight.
        setRemoteTasks((tasks) => tasks.filter((task) => task.id !== result.task_id));
        setSelectedTaskResultIds((ids) => ids.filter((id) => id !== result.id));
        if (selectedTaskResultId === result.id) setSelectedTaskResultId(null);
        await Promise.all([loadTaskSummaries(), loadAudioAssets()]);
        setTaskCenterMessage(`已移除任务记录：${result.file_name}；${result.exists ? "实体文件仍保留在成果中心的未关联文件中。" : "对应文件已不存在，其他文件未受影响。"}`);
      } catch (err) {
        setTaskCenterError(err instanceof Error ? err.message : "移除缺失任务记录失败");
      } finally {
        setTaskCenterAction(null);
      }
      return;
    }
    if (!result.exists && result.source === "batch_project" && result.task_id.startsWith("project:") && result.id.includes(":segment:")) {
      const projectId = result.task_id.replace(/^project:/, "");
      const segmentId = result.id.split(":segment:").pop() ?? "";
      if (!projectId || !segmentId) {
        setTaskCenterError("无法定位这条批量成果记录。");
        return;
      }
      const confirmed = await requestConfirmation({
        title: "移除批量成果记录？",
        message: `将移除“${result.file_name}”的批量成果记录，只清理任务中的成果记录，不会删除其他文件。`,
        confirmLabel: "移除记录",
        tone: "danger"
      });
      if (!confirmed) return;
      setTaskCenterAction(`delete-result-${result.id}`);
      setTaskCenterError(null);
      try {
        await deleteBatchProjectSegmentHistory(projectId, segmentId);
        setRemoteTasks((tasks) => tasks.map((task) => task.id === result.task_id
          ? { ...task, results: task.results.filter((item) => item.id !== result.id) }
          : task));
        setSelectedTaskResultIds((ids) => ids.filter((id) => id !== result.id));
        if (selectedTaskResultId === result.id) setSelectedTaskResultId(null);
        await Promise.all([loadTaskSummaries(), loadBatchProjects(), loadAudioAssets()]);
        setTaskCenterMessage(`已移除批量成果记录：${result.file_name}。`);
      } catch (err) {
        setTaskCenterError(err instanceof Error ? err.message : "移除批量成果记录失败");
      } finally {
        setTaskCenterAction(null);
      }
      return;
    }
    if (!result.asset) {
      setTaskCenterError("该结果不是受监控输出目录中的音频文件，暂不能从这里删除实体文件。");
      return;
    }
    const confirmed = await requestConfirmation({
      title: "删除本地文件？",
      message: `将删除“${result.file_name}”对应的本地实体文件。此操作无法撤销。`,
      confirmLabel: "删除",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    setTaskCenterAction(`delete-result-${result.id}`);
    setTaskCenterError(null);
    try {
      audioAssetRef.current?.pause();
      await deleteAudioAsset(result.asset.asset_id);
      setAudioAssets((current) => current.filter((asset) => asset.asset_id !== result.asset?.asset_id));
      setSelectedTaskResultIds((ids) => ids.filter((id) => id !== result.id));
      if (selectedTaskResultId === result.id) setSelectedTaskResultId(null);
      setTaskCenterMessage(`已删除本地文件：${result.file_name}`);
      await Promise.all([loadTaskSummaries(), loadAudioAssets()]);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "删除本地文件失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  function toggleTaskResultSelection(resultId: string) {
    setSelectedTaskResultIds((ids) => ids.includes(resultId) ? ids.filter((id) => id !== resultId) : [...ids, resultId]);
  }

  function toggleAllVisibleTaskResults() {
    setSelectedTaskResultIds((ids) => {
      if (allVisibleTaskResultsSelected) {
        const visibleIds = new Set(selectableVisibleTaskResults.map((result) => result.id));
        return ids.filter((id) => !visibleIds.has(id));
      }
      return [...new Set([...ids, ...selectableVisibleTaskResults.map((result) => result.id)])];
    });
  }

  async function onBatchDownloadTaskResults() {
    const downloadable = selectedTaskResults.filter((result) => result.url && result.exists);
    if (!downloadable.length) {
      setTaskCenterError("所选结果没有可导出的内容。");
      return;
    }
    setTaskCenterAction("batch-download");
    setTaskCenterError(null);
    try {
      for (const result of downloadable) {
        const anchor = document.createElement("a");
        anchor.href = resolveTaskResultUrl(result.url!);
        anchor.download = result.file_name;
        anchor.rel = "noopener";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        await new Promise((resolve) => window.setTimeout(resolve, 80));
      }
      setTaskCenterMessage(`已开始导出 ${downloadable.length} 个结果。`);
    } catch (err) {
      setTaskCenterError(err instanceof Error ? err.message : "批量导出失败");
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function onBatchDeleteTaskResults() {
    const audioResults = selectedTaskResults.filter((result) => result.asset);
    const historyResults = selectedTaskResults.filter((result) => result.bilibili_history_id);
    if (!audioResults.length && !historyResults.length) {
      setTaskCenterError("所选结果没有可清理的本地文件或 B 站下载记录。");
      return;
    }
    const bridge = historyResults.length ? window.desktopBilibiliSampler : null;
    if (historyResults.length && !bridge) {
      setTaskCenterError("当前预览环境不能移除 B 站下载记录，请在桌面软件中执行批量清理。");
      return;
    }
    const warning = [
      audioResults.length ? `删除 ${audioResults.length} 个本地音频文件` : "",
      historyResults.length ? `移除 ${historyResults.length} 条 B 站下载记录（MP4 文件保留）` : ""
    ].filter(Boolean).join("；");
    if (!await requestConfirmation({
      title: "确认批量清理？",
      message: `${warning}。此操作不可撤销。`,
      confirmLabel: "开始清理",
      tone: "danger"
    })) {
      return;
    }
    setTaskCenterAction("batch-delete");
    setTaskCenterError(null);
    let removedAudioCount = 0;
    let removedHistoryCount = 0;
    try {
      for (const result of audioResults) {
        await deleteAudioAsset(result.asset!.asset_id);
        removedAudioCount += 1;
      }
      for (const result of historyResults) {
        const response = await bridge!.removeHistory(result.bilibili_history_id!);
        if (!response.success) {
          throw new Error(response.error ?? `移除 ${result.file_name} 失败`);
        }
        removedHistoryCount += 1;
      }
      setAudioAssets((assets) => assets.filter((asset) => !audioResults.some((result) => result.asset?.asset_id === asset.asset_id)));
      setBilibiliHistoryItems((items) => items.filter((item) => !historyResults.some((result) => result.bilibili_history_id === item.id)));
      setSelectedTaskResultIds([]);
      if (selectedTaskResultId && selectedTaskResults.some((result) => result.id === selectedTaskResultId)) {
        setSelectedTaskResultId(null);
      }
      setTaskCenterMessage(`已完成清理：${warning}。`);
      await Promise.all([loadTaskSummaries(), loadAudioAssets()]);
    } catch (err) {
      await Promise.all([loadTaskSummaries(), loadAudioAssets(), loadBilibiliHistory()]);
      const removedSummary = [
        removedAudioCount ? `${removedAudioCount} 个本地音频文件` : "",
        removedHistoryCount ? `${removedHistoryCount} 条 B 站下载记录` : ""
      ].filter(Boolean).join("、");
      const reason = err instanceof Error ? err.message : "批量清理失败";
      setTaskCenterError(removedSummary ? `批量清理未全部完成：已处理 ${removedSummary}；${reason}` : reason);
    } finally {
      setTaskCenterAction(null);
    }
  }

  async function togglePlayback() {
    if (!audioRef.current || !result) {
      return;
    }
    if (audioRef.current.paused) {
      await audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }

  function seekGeneratedAudio(ratio: number) {
    const player = audioRef.current;
    const durationSeconds = playbackDuration || result?.duration_seconds || 0;
    if (!player || durationSeconds <= 0) {
      return;
    }
    const nextTime = Math.max(0, Math.min(durationSeconds, ratio * durationSeconds));
    player.currentTime = nextTime;
    setPlaybackTime(nextTime);
  }

  function onImportText(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setInput(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  async function onCheckAppUpdate() {
    if (!window.desktopUpdater) {
      return;
    }
    try {
      setAppUpdate(await window.desktopUpdater.check());
    } catch (err) {
      setAppUpdate((current) => ({
        status: "error",
        currentVersion: current?.currentVersion ?? "-",
        message: err instanceof Error ? err.message : "检查更新失败"
      }));
    }
  }

  async function onDownloadAppUpdate() {
    if (!window.desktopUpdater) {
      return;
    }
    try {
      setAppUpdate(await window.desktopUpdater.download());
    } catch (err) {
      setAppUpdate((current) => ({
        status: "error",
        currentVersion: current?.currentVersion ?? "-",
        message: err instanceof Error ? err.message : "下载更新失败"
      }));
    }
  }

  async function onInstallAppUpdate() {
    if (!window.desktopUpdater) {
      return;
    }
    try {
      setAppUpdate(await window.desktopUpdater.install());
    } catch (err) {
      setAppUpdate((current) => ({
        status: "error",
        currentVersion: current?.currentVersion ?? "-",
        message: err instanceof Error ? err.message : "安装更新失败"
      }));
    }
  }

  useEffect(() => {
    return () => {
      if (referenceAudioPreviewUrlRef.current) {
        URL.revokeObjectURL(referenceAudioPreviewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!drawMenuOpen) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (event.target instanceof Node && !drawMenuRef.current?.contains(event.target)) {
        setDrawMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [drawMenuOpen]);

  useEffect(() => {
    if (loading) {
      setDrawMenuOpen(false);
    }
  }, [loading]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is optional when the host blocks local storage.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.accent = accentTheme;
    try {
      window.localStorage.setItem(APP_ACCENT_STORAGE_KEY, accentTheme);
    } catch {
      // Accent persistence is optional when the host blocks local storage.
    }
  }, [accentTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_AVATAR_STORAGE_KEY, JSON.stringify(voiceAvatars));
    } catch {
      // Avatar persistence is optional when the host blocks local storage.
    }
  }, [voiceAvatars]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_FAVORITES_STORAGE_KEY, JSON.stringify(voiceFavoriteIds));
    } catch {
      // Favorite persistence is optional when the host blocks local storage.
    }
  }, [voiceFavoriteIds]);

  useEffect(() => {
    return () => {
      if (themeTransitionTimerRef.current !== null) {
        window.clearTimeout(themeTransitionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadModels();
    loadVoices();
    void loadDoubaoState();
    loadSystemStatus();
    loadAppSettings();
    loadGlobalLlmSettings();
    loadModelInstances();
    loadModelPackages();
    loadTaskSummaries();
    void loadBatchProjects();
    void refreshSamplerSession(false);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const body = settingsBodyRef.current;
    if (!body) return undefined;
    const targetSelector = settingsNavigationTargetRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = window.requestAnimationFrame(() => {
      if (targetSelector) {
        const target = body.querySelector<HTMLElement>(targetSelector);
        if (target instanceof HTMLDetailsElement) {
          target.open = true;
        }
        target?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      } else {
        body.scrollTo({ top: 0, behavior: "auto" });
      }
      settingsNavigationTargetRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsNavigationRequest, settingsOpen, settingsSection]);

  useEffect(() => {
    const wasOpen = previousModalKeyRef.current !== null;
    if (!topmostModalKey) {
      if (wasOpen) {
        modalRestoreFocusRef.current?.focus({ preventScroll: true });
        modalRestoreFocusRef.current = null;
      }
      previousModalKeyRef.current = null;
      return undefined;
    }

    if (!wasOpen) {
      const activeElement = document.activeElement;
      modalRestoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    }
    previousModalKeyRef.current = topmostModalKey;

    const focusTimer = window.requestAnimationFrame(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'));
      const dialog = dialogs[dialogs.length - 1];
      const firstFocusable = dialog?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(focusTimer);
  }, [topmostModalKey]);

  useEffect(() => {
    if (!topmostModalKey && !drawMenuOpen && !voiceImportMenuOpen && !avatarPickerOpen && activeWorkspace === "creation") {
      return undefined;
    }

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (drawMenuOpen) {
          setDrawMenuOpen(false);
        } else if (voiceImportMenuOpen) {
          setVoiceImportMenuOpen(false);
        } else if (avatarPickerOpen) {
          setAvatarPickerOpen(false);
        } else {
          switch (topmostModalKey) {
            case "app-confirmation":
              settleConfirmation(false);
              break;
            case "settings":
              void closeSettings();
              break;
            case "sampler":
              void onSamplerCancel();
              break;
            case "model-switch":
              setPendingModelSwitch(null);
              break;
            case "realtime-entry":
              setRealtimeEntryConfirmOpen(false);
              break;
            case "task-history-confirm":
              setTaskHistoryClearConfirmOpen(false);
              break;
            case "task-center":
              setTaskCenterOpen(false);
              break;
            case "audio-library":
              setAudioLibraryOpen(false);
              break;
            case "reference-editor":
              closeReferenceAudioEditor();
              break;
            case "voice-manager":
              void closeVoiceManager();
              break;
            case "voice-save":
              closeVoiceLibrarySaveDialog();
              break;
          case "monitor":
            setMonitorPanelOpen(false);
            break;
            default:
              if (activeWorkspace !== "creation") {
                selectWorkspace("creation");
              }
              break;
          }
        }
        return;
      }

      if (event.key !== "Tab" || !topmostModalKey) {
        return;
      }
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]'));
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) {
        return;
      }
      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.offsetParent !== null);
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }
      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
        : (currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1);
      if (currentIndex === -1 || nextIndex !== currentIndex + (event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        focusableElements[nextIndex]?.focus();
      }
    };

    document.addEventListener("keydown", onGlobalKeyDown);
    return () => document.removeEventListener("keydown", onGlobalKeyDown);
  }, [activeWorkspace, avatarPickerOpen, closeReferenceAudioEditor, closeSettings, closeVoiceLibrarySaveDialog, closeVoiceManager, drawMenuOpen, onSamplerCancel, selectWorkspace, settleConfirmation, topmostModalKey, voiceImportMenuOpen]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  useEffect(() => {
    if (selectedVoice === "custom" || availableVoices.some((voice) => voice.id === selectedVoice)) {
      return;
    }
    setSelectedVoice(availableVoices[0]?.id ?? "custom");
  }, [availableVoices, selectedVoice]);

  useEffect(() => {
    managedVoiceIdRef.current = managedVoiceId;
  }, [managedVoiceId]);

  useEffect(() => {
    const updater = window.desktopUpdater;
    if (!updater) {
      return undefined;
    }
    let disposed = false;
    void updater.getState().then((state) => {
      if (!disposed) {
        setAppUpdate(state);
      }
    });
    const unsubscribe = updater.onStateChanged((state) => setAppUpdate(state));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (defaultModelAppliedRef.current || !appSettings || localModels.length === 0) {
      return;
    }
    const configuredModel = localModels.find((model) => model.id === appSettings.default_model_id)
      ?? localModels.find((model) => model.id === "indextts2")
      ?? localModels[0];
    if (configuredModel) {
      setSelectedModel(configuredModel.id);
    }
    defaultModelAppliedRef.current = true;
  }, [appSettings, localModels]);

  useEffect(() => {
    if (
      startupPrewarmAttemptedRef.current ||
      !appSettings?.prewarm_default_model_on_startup ||
      localModels.length === 0
    ) {
      return;
    }
    if (appSettings.default_model_id === "doubao-web") {
      startupPrewarmAttemptedRef.current = true;
      setSettingsMessage("已将旧版“豆包默认模型”迁移为本地合成入口；云端合成请从顶部独立入口进入。");
      return;
    }
    if (modelInstances.length === 0) {
      return;
    }
    startupPrewarmAttemptedRef.current = true;
    const model = localModels.find((candidate) => candidate.id === appSettings.default_model_id);
    const instance = modelInstances.find((candidate) => candidate.model_id === appSettings.default_model_id);
    if (!model || !instance || !isModelInstanceUsable(instance)) {
      setSettingsMessage("启动预热已跳过：默认模型未启用或尚不可用。");
      return;
    }
    setSelectedModel(model.id);
    void onStartModelRuntime(instance);
  }, [appSettings, localModels, modelInstances]);

  useEffect(() => {
    if (!window.desktopBilibiliSampler?.onStateChanged) {
      return undefined;
    }
    return window.desktopBilibiliSampler.onStateChanged((state) => {
      setSamplerState(state);
    });
  }, []);

  useEffect(() => {
    if (!samplerVideoPreview) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      samplerVideoPreviewPanelRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [samplerVideoPreview]);

  useEffect(() => {
    const previewUrl = samplerVideoPreview?.previewUrl;
    const requestId = samplerVideoWaveformRequestRef.current + 1;
    samplerVideoWaveformRequestRef.current = requestId;
    setSamplerVideoWaveformPeaks([]);
    if (!previewUrl) {
      setSamplerVideoWaveformStatus("idle");
      return;
    }

    let disposed = false;
    setSamplerVideoWaveformStatus("loading");
    void fetch(previewUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`视频读取失败：${response.status}`);
        }
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > VIDEO_WAVEFORM_MAX_ANALYSIS_BYTES) {
          throw new Error("媒体文件较大，已跳过波形分析");
        }
        return decodeWaveformPeaks(await response.arrayBuffer(), VIDEO_WAVEFORM_MAX_ANALYSIS_BYTES);
      })
      .then((peaks) => {
        if (disposed || samplerVideoWaveformRequestRef.current !== requestId) {
          return;
        }
        setSamplerVideoWaveformPeaks(peaks);
        setSamplerVideoWaveformStatus(peaks.length > 0 ? "ready" : "unavailable");
      })
      .catch(() => {
        if (disposed || samplerVideoWaveformRequestRef.current !== requestId) {
          return;
        }
        setSamplerVideoWaveformPeaks([]);
        setSamplerVideoWaveformStatus("unavailable");
      });
    return () => {
      disposed = true;
    };
  }, [samplerVideoPreview?.previewUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSystemStatus();
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeSpeechJob?.id) {
      return undefined;
    }
    let disposed = false;
    const pollJob = async () => {
      try {
        const job = await fetchSpeechJob(activeSpeechJob.id);
        if (disposed) {
          return;
        }
        setActiveSpeechJob(job);
        void loadTaskSummaries();
        if (!isTerminalTaskStatus(job.status)) {
          return;
        }
        if (await handleDrawTerminalJob(job)) {
          void loadModelInstances();
          if (job.request.model === "doubao-web") {
            void loadDoubaoState();
          }
          return;
        }
        if (job.status === "succeeded" && job.result) {
          setResult(job.result);
          setResultReferenceText(job.request.input);
          setResultModelName(activeSpeechContext?.modelName ?? job.request.model);
          setResultVoiceName(activeSpeechContext?.voiceName ?? "本地任务");
          setPlaybackTime(0);
          setPlaybackDuration(job.result.duration_seconds);
          void loadModelInstances();
          if (job.request.model === "doubao-web") {
            void loadDoubaoState();
          }
        } else {
          setError(job.error ?? (job.status === "cancelled" ? "生成任务已取消" : "生成失败"));
        }
        setLoading(false);
        setGenerationStartedAt(null);
        setActiveSpeechJob(null);
        setActiveSpeechContext(null);
        void loadSystemStatus();
      } catch (err) {
        if (disposed) {
          return;
        }
        if (isBackendConnectionError(err)) {
          setBackendError("生成任务与本地后端暂时断开，正在恢复连接…");
          void recoverLocalBackend();
          return;
        }
        setError(err instanceof Error ? err.message : "读取生成任务状态失败");
        setLoading(false);
        setGenerationStartedAt(null);
        setActiveSpeechJob(null);
        setActiveSpeechContext(null);
      }
    };
    void pollJob();
    const timer = window.setInterval(() => void pollJob(), 900);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeSpeechContext, activeSpeechJob?.id]);

  useEffect(() => {
    const hasActiveBatch = batchProjects.some(
      (project) => project.status === "queued" || project.status === "running" || project.status === "cancelling"
    );
    const shouldPoll = taskCenterOpen || activeWorkspace === "assets" || Boolean(activeSpeechJob) || hasActiveBatch || samplerBusy;
    if (!shouldPoll) {
      return undefined;
    }
    void loadTaskSummaries();
    const timer = window.setInterval(() => void loadTaskSummaries(), 1200);
    return () => window.clearInterval(timer);
  }, [activeSpeechJob, activeWorkspace, batchProjects, samplerBusy, taskCenterOpen]);

  useEffect(() => {
    if (!taskCenterOpen && activeWorkspace !== "assets") {
      return undefined;
    }
    void loadBatchProjects();
    const timer = window.setInterval(() => void loadBatchProjects(), 5_000);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, taskCenterOpen]);

  useEffect(() => {
    if (generationWorkspace !== "batch") {
      return undefined;
    }
    const hasActiveProject = batchProjects.some(
      (project) => project.status === "queued" || project.status === "running" || project.status === "cancelling"
    );
    if (!hasActiveProject) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadBatchProjects();
    }, 1600);
    return () => window.clearInterval(timer);
  }, [generationWorkspace, batchProjects]);

  useEffect(() => {
    setIsPlaying(false);
    setPlaybackTime(0);
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioAssetRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setAudioAssetPlaying(false);
  }, [selectedAudioAsset?.file_path]);

  useEffect(() => {
    if ((!audioLibraryOpen && !taskCenterOpen && activeWorkspace !== "assets") || audioLibraryAction) {
      return undefined;
    }
    // The library is a live view of the monitored output directory.  A short
    // poll catches files created or removed outside this window without
    // relying on an Electron file watcher or taking control of the desktop.
    const timer = window.setInterval(() => {
      void loadAudioAssets();
      void loadBilibiliHistory();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [activeWorkspace, audioLibraryAction, audioLibraryOpen, taskCenterOpen]);

  useEffect(() => {
    if (!audioUrl) {
      setResultWaveformPeaks([]);
      setResultWaveformStatus("idle");
      return undefined;
    }
    const controller = new AbortController();
    let disposed = false;
    setResultWaveformPeaks([]);
    setResultWaveformStatus("loading");
    void (async () => {
      try {
        const response = await fetch(audioUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`音频读取失败：${response.status}`);
        }
        const peaks = await decodeWaveformPeaks(await response.arrayBuffer());
        if (!disposed) {
          setResultWaveformPeaks(peaks);
          setResultWaveformStatus(peaks.length > 0 ? "ready" : "unavailable");
        }
      } catch (err) {
        if (!disposed && !(err instanceof DOMException && err.name === "AbortError")) {
          setResultWaveformPeaks([]);
          setResultWaveformStatus("unavailable");
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [audioUrl]);

  useEffect(() => {
    if (selectedVoiceInfo.referenceText && !referenceText.trim()) {
      setReferenceText(selectedVoiceInfo.referenceText);
    }
  }, [selectedVoiceInfo.id]);

  useEffect(() => {
    const importedVoice = customVoices.find((voice) => voice.id === selectedVoice);
    if (!importedVoice?.referenceAudio) {
      setVoiceQuality(null);
      setVoiceQualityLoading(false);
      return;
    }
    void loadVoiceQuality(importedVoice.id);
  }, [customVoices, selectedVoice]);

  useEffect(() => {
    if (!voiceMessage) {
      return undefined;
    }
    const timer = window.setTimeout(() => setVoiceMessage(null), 5600);
    return () => window.clearTimeout(timer);
  }, [voiceMessage]);

  useEffect(() => {
    if (!globalRefreshMessage) {
      return undefined;
    }
    const timer = window.setTimeout(() => setGlobalRefreshMessage(null), 3600);
    return () => window.clearTimeout(timer);
  }, [globalRefreshMessage]);

  useEffect(() => {
    const sampler = window.desktopBilibiliSampler;
    if (!samplerOpen || !sampler || !samplerQrPayload?.authCode || samplerState.loginSession.isLoggedIn) {
      return undefined;
    }

    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const response = await sampler.pollLogin();
        if (disposed) {
          return;
        }
        if (!response.success || !response.data) {
          setSamplerQrPayload(null);
          setSamplerFailure(response.error ?? "B 站二维码登录失败，请重新获取二维码");
          return;
        }
        if (response.data.loginSession) {
          setSamplerState((state) => ({ ...state, loginSession: response.data!.loginSession!, error: null }));
        }
        if (response.data.status === "confirmed") {
          setSamplerQrPayload(null);
          setSamplerMessage("登录成功");
          return;
        }
        setSamplerMessage(samplerPollStatusLabel(response.data.status));
        timer = window.setTimeout(() => void poll(), 1400);
      } catch (err) {
        if (!disposed) {
          setSamplerQrPayload(null);
          setSamplerFailure(err instanceof Error ? err.message : "B 站二维码登录失败，请重新获取二维码");
        }
      }
    };

    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [samplerOpen, samplerQrPayload?.authCode, samplerState.loginSession.isLoggedIn]);

  useEffect(() => {
    let disposed = false;
    if (!samplerQrPayload?.qrUrl) {
      setSamplerQrCodeUrl(null);
      return undefined;
    }
    QRCode.toDataURL(samplerQrPayload.qrUrl, {
      margin: 1,
      width: 184,
      color: {
        dark: "#263441",
        light: "#f7fbff"
      }
    })
      .then((dataUrl) => {
        if (!disposed) {
          setSamplerQrCodeUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSamplerQrCodeUrl(null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [samplerQrPayload?.qrUrl]);

  useEffect(() => {
    const lastDefault = lastSamplerDefaultNameRef.current;
    setSamplerName((current) => (!current.trim() || current === lastDefault ? samplerDefaultName : current));
    lastSamplerDefaultNameRef.current = samplerDefaultName;
  }, [samplerDefaultName]);

  useEffect(() => {
    if (localModels.length === 0 || localModels.some((model) => model.id === selectedModel)) {
      return;
    }
    const fallback = localModels.find((model) => model.id === "indextts2") ?? localModels[0];
    if (fallback) {
      setSelectedModel(fallback.id);
    }
  }, [localModels, selectedModel]);

  useEffect(() => {
    if (!supportedCloneModes.includes(cloneMode)) {
      setCloneMode(supportedCloneModes[0]);
    }
  }, [cloneMode, supportedCloneModeKey]);

  useEffect(() => {
    if (modelSwitchLocked) {
      setPendingModelSwitch(null);
    }
  }, [modelSwitchLocked]);

  useEffect(() => {
    if (!loading || !generationStartedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - generationStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, loading]);

  function renderBatchProjectWorkspace() {
    const projectLocked = batchProjectLocked || Boolean(batchProjectAction);
    const projectProgress = editingBatchProject ? batchProjectProgress(editingBatchProject) : null;
    return (
      <section className="batchWorkspacePanel" aria-label="批量任务工作区">
        <header className="batchWorkspaceHeader">
          <div className="batchWorkspaceIdentity">
            <span className="batchWorkspaceEyebrow"><FileText size={15} strokeWidth={1.9} /> 批量任务</span>
            <strong>{editingBatchProject?.title ?? "新建配音项目"}</strong>
            <small>
              {projectProgress
                ? `${batchProjectStatusLabel(editingBatchProject?.status ?? "draft")} · ${projectProgress.completed}/${projectProgress.total} 完成${projectProgress.failed ? ` · ${projectProgress.failed} 失败` : ""}`
                : "导入文本后按片段串行生成，确保显存和音色保持稳定。"}
            </small>
          </div>
          <div className="batchWorkspaceHeaderActions">
            <button type="button" className="pathPickButton" onClick={createBatchProjectWorkspace} disabled={Boolean(batchProjectAction)}>
              <Plus size={15} strokeWidth={1.9} />
              <span>新建项目</span>
            </button>
            <button type="button" className="pathPickButton" onClick={() => void openBatchOutputDirectory()}>
              <FolderOpen size={15} strokeWidth={1.9} />
              <span>打开输出</span>
            </button>
          </div>
        </header>

        <div className="batchWorkspaceLayout">
          <section className="batchWorkspaceComposer">
            <div className="batchWorkspaceSection batchProjectSetup">
              <div className="batchWorkspaceSectionTitle">
                <SlidersHorizontal size={16} strokeWidth={1.9} />
                <span>项目设置</span>
                <small>参数会随项目快照保存</small>
              </div>
              <div className="batchProjectConfigGrid">
                <label className="settingsField">
                  <span>项目名称</span>
                  <input value={batchProjectTitle} disabled={projectLocked} onChange={(event) => setBatchProjectTitle(event.target.value)} />
                </label>
                <label className="settingsField">
                  <span>生成模型</span>
                  <select
                    value={batchProjectModel}
                    disabled={projectLocked}
                    onChange={(event) => {
                      const modelId = event.target.value;
                      const compatibleVoice = customVoices.find((voice) =>
                        voice.id === batchProjectVoiceId && (!voice.modelBinding || voice.modelBinding.modelId === modelId)
                      ) ?? customVoices.find((voice) => !voice.modelBinding || voice.modelBinding.modelId === modelId);
                      setBatchProjectModel(modelId);
                      setBatchProjectVoiceId(compatibleVoice?.id ?? "");
                    }}
                  >
                    {localModels.map((model) => <option key={model.id} value={model.id}>{model.display_name}</option>)}
                  </select>
                </label>
              </div>

              <label className="settingsField batchVoiceField">
                <span>项目音色</span>
                <select
                  value={batchProjectVoiceInfo?.id ?? ""}
                  disabled={projectLocked || batchProjectVoices.length === 0}
                  onChange={(event) => setBatchProjectVoiceId(event.target.value)}
                >
                  {batchProjectVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}{voice.referenceText ? " · 已有提示词" : ""}</option>)}
                </select>
              </label>
              <div className={batchProjectHasReference ? "batchProjectReference" : "batchProjectReference batchProjectReferenceWarning"}>
                <span>参考音频</span>
                <strong>{batchProjectVoiceInfo?.name ?? "未选择音色"}</strong>
                <em>{batchProjectHasReference ? (batchProjectReferenceText ? "参考提示词会随项目保存" : "未填写参考提示词，建议先在音色库识别或补充") : "请选择带参考音频的音色后再生成"}</em>
              </div>
            </div>

            <div className="batchWorkspaceSection batchSegmentsSection">
              <div className="batchWorkspaceSectionTitle">
                <FileText size={16} strokeWidth={1.9} />
                <span>文本片段</span>
                <small>每段单独生成，可安全停止并从断点继续</small>
              </div>
              <div className="batchProjectImportRow">
                <button type="button" className="pathPickButton" disabled={projectLocked} onClick={() => batchFileInputRef.current?.click()}>
                  <Upload size={15} strokeWidth={1.9} />
                  <span>导入 TXT / SRT</span>
                </button>
                <button type="button" className="pathPickButton" disabled={projectLocked} onClick={() => setBatchProjectSegments((segments) => [...segments, ""])}>
                  <Plus size={15} strokeWidth={1.9} />
                  <span>新增片段</span>
                </button>
                <input ref={batchFileInputRef} className="hiddenFile" type="file" accept=".txt,.srt,.vtt,text/plain" aria-label="选择批量文本文件" onChange={onImportBatchSource} />
                <span>{batchProjectSegmentCount} 个有效片段</span>
              </div>
              {batchProjectSegments.length === 0 ? (
                <div className="batchProjectEmpty">
                  <FileText size={20} strokeWidth={1.8} />
                  <strong>导入文本或字幕开始项目</strong>
                  <span>TXT 按行/段落分段，SRT/VTT 会自动去除时间轴。</span>
                </div>
              ) : (
                <div className="batchSegmentList batchWorkspaceSegmentList">
                  {batchProjectSegments.map((segment, index) => {
                    const segmentState = editingBatchProject?.segments[index];
                    return (
                      <div key={`${editingBatchProjectId ?? "new"}-${index}`} className="batchSegmentItem">
                        <span>{index + 1}</span>
                        <textarea
                          value={segment}
                          rows={2}
                          disabled={projectLocked}
                          placeholder="输入本段文本"
                          onChange={(event) => updateBatchSegment(index, event.target.value)}
                        />
                        {segmentState && <em className={`batchSegmentState ${segmentState.status}`}>{batchSegmentStatusLabel(segmentState.status)}</em>}
                        <button type="button" className="pathPickButton batchSegmentRemove" disabled={projectLocked || batchProjectSegments.length === 1} onClick={() => removeBatchSegment(index)} title="移除片段">
                          <Trash2 size={15} strokeWidth={1.9} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="batchWorkspaceQueue" aria-label="批量项目队列">
            <div className="batchWorkspaceSectionTitle">
              <Library size={16} strokeWidth={1.9} />
              <span>项目队列</span>
              <button type="button" className="iconTextButton" title="刷新项目队列" onClick={() => void loadBatchProjects()}><RefreshCw size={15} strokeWidth={1.9} /></button>
            </div>
            {batchProjects.length === 0 ? (
              <div className="batchProjectEmpty compact">
                <Library size={19} strokeWidth={1.8} />
                <strong>尚无已保存的批量项目</strong>
                <span>保存草稿后，可在此追踪进度并从断点继续。</span>
              </div>
            ) : (
              <div className="batchProjectList batchWorkspaceProjectList">
                {batchProjects.map((project) => {
                  const progress = batchProjectProgress(project);
                  return (
                    <div key={project.id} className={project.id === editingBatchProjectId ? "batchProjectRow active" : "batchProjectRow"}>
                      <button type="button" className="batchProjectSelect" onClick={() => editBatchProject(project)}>
                        <div>
                          <strong>{project.title}</strong>
                          <span>{models.find((model) => model.id === project.model)?.display_name ?? project.model} · {progress.completed}/{progress.total} 完成{progress.failed ? ` · ${progress.failed} 失败` : ""}</span>
                        </div>
                        <em className={project.status}>{batchProjectStatusLabel(project.status)}</em>
                      </button>
                      <div className="batchProjectRowActions">
                        {project.status === "failed" ? (
                          <button type="button" className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onRunExistingBatchProject(project, true)}>
                            {batchProjectAction === "retry" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                            <span>重试</span>
                          </button>
                        ) : project.status === "cancelled" ? (
                          <button type="button" className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onResumeBatchProject(project)}>
                            {batchProjectAction === "resume" ? <Loader2 className="spin" size={15} /> : <Play size={15} strokeWidth={1.9} />}
                            <span>继续</span>
                          </button>
                        ) : project.status === "cancelling" ? (
                          <button type="button" className="pathPickButton runtimeStopButton" disabled><Loader2 className="spin" size={15} /><span>停止中</span></button>
                        ) : project.status === "queued" || project.status === "running" ? (
                          <button type="button" className="pathPickButton runtimeStopButton" disabled={Boolean(batchProjectAction)} onClick={() => void onCancelBatchProject(project)}>
                            {batchProjectAction === "cancel" ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}
                            <span>{project.status === "running" ? "安全停止" : "取消队列"}</span>
                          </button>
                        ) : (
                          <button type="button" className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onRunExistingBatchProject(project)}>
                            {batchProjectAction === "run" ? <Loader2 className="spin" size={15} /> : <Play size={15} strokeWidth={1.9} />}
                            <span>运行</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        </div>

        {(batchProjectError || batchProjectMessage) && (
          <div role={batchProjectError ? "alert" : "status"} aria-live={batchProjectError ? "assertive" : "polite"} className={batchProjectError ? "settingsFeedback error" : "settingsFeedback"}>
            {batchProjectError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
            <span>{batchProjectError ?? batchProjectMessage}</span>
          </div>
        )}

        <footer className="batchWorkspaceFooter">
          {batchProjectCanStop && editingBatchProject && (
            <button type="button" className="secondaryAction settingsAction runtimeStopButton" disabled={Boolean(batchProjectAction)} onClick={() => void onCancelBatchProject(editingBatchProject)}>
              {batchProjectAction === "cancel" ? <Loader2 className="spin" size={16} /> : <Pause size={16} strokeWidth={1.9} />}
              <span>{editingBatchProject.status === "running" ? "当前段后停止" : "取消队列"}</span>
            </button>
          )}
          {batchProjectCanResume && editingBatchProject && (
            <button type="button" className="secondaryAction settingsAction" disabled={Boolean(batchProjectAction)} onClick={() => void onResumeBatchProject(editingBatchProject)}>
              {batchProjectAction === "resume" ? <Loader2 className="spin" size={16} /> : <Play size={16} strokeWidth={1.9} />}
              <span>继续生成</span>
            </button>
          )}
          <span className="batchWorkspaceFooterSpacer" />
            <button type="button" className="secondaryAction settingsAction" disabled={projectLocked} onClick={() => void saveBatchProject(false)}>
            {batchProjectAction === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
            <span>保存草稿</span>
          </button>
            <button type="button" className="primaryAction settingsAction" disabled={projectLocked} onClick={() => void saveBatchProject(true)}>
            {batchProjectAction === "run" ? <Loader2 className="spin" size={16} /> : <Play size={16} strokeWidth={1.9} />}
            <span>保存并生成</span>
          </button>
        </footer>
      </section>
    );
  }

  function renderAssetCenterWorkspace() {
    const selected = selectedTaskResult;
    const selectedIsAudio = selected ? ["audio", "enhancement", "separation"].includes(selected.kind) : false;
    const selectedIsVideo = selected?.kind === "video";
    const typeFilters = [
      { id: "all", label: "全部成果", count: taskCenterResults.length, icon: <Library size={16} strokeWidth={1.9} /> },
      { id: "audio_family", label: "音频", count: taskCenterResults.filter((result) => ["audio", "enhancement", "separation"].includes(result.kind)).length, icon: <Volume2 size={16} strokeWidth={1.9} /> },
      { id: "ebook", label: "电子书", count: taskCenterResults.filter((result) => result.kind === "ebook").length, icon: <BookOpen size={16} strokeWidth={1.9} /> },
      { id: "video", label: "视频", count: taskCenterResults.filter((result) => result.kind === "video").length, icon: <Film size={16} strokeWidth={1.9} /> },
      { id: "documents", label: "文字与时间轴", count: taskCenterResults.filter((result) => ["transcript", "subtitle", "alignment"].includes(result.kind)).length, icon: <FileText size={16} strokeWidth={1.9} /> },
      { id: "orphan", label: "待整理文件", count: orphanTaskResultCount, icon: <FolderOpen size={16} strokeWidth={1.9} /> }
    ];

    return (
      <section className="assetCenterWorkspace" aria-label="成果中心">
        <header className="assetCenterHeader">
          <div className="assetCenterHeading">
            <span className="assetCenterHeadingIcon"><Library size={21} strokeWidth={1.9} /></span>
            <div>
              <h1>成果中心</h1>
            </div>
          </div>
          <div className="assetCenterHeaderActions">
            <button type="button" className="pathPickButton" disabled={taskCenterAction !== null || taskCenterRefreshing || audioLibraryLoading} onClick={() => void refreshTaskCenter()}>
              <RefreshCw className={taskCenterRefreshing ? "spin" : undefined} size={16} strokeWidth={1.9} />
              <span>刷新</span>
            </button>
            <button type="button" className={retryableTaskCount > 0 || missingTaskResultCount > 0 ? "assetCenterQueueButton attention" : "assetCenterQueueButton"} title={activeTaskCount + retryableTaskCount + missingTaskResultCount > 0 ? `${activeTaskCount + retryableTaskCount + missingTaskResultCount} 项任务待处理` : "任务队列"} onClick={() => {
              setTaskCenterError(null);
              setTaskCenterMessage(null);
              setTaskHistoryClearConfirmOpen(false);
              void refreshTaskCenter();
              setTaskCenterOpen(true);
            }}>
              <Gauge size={16} strokeWidth={1.9} />
              <span>任务队列</span>
              {activeTaskCount + retryableTaskCount + missingTaskResultCount > 0 && <em>{activeTaskCount + retryableTaskCount + missingTaskResultCount}</em>}
            </button>
            <button type="button" className="assetCenterReturnButton" onClick={() => selectWorkspace("creation")}>
              <ChevronLeft size={16} strokeWidth={1.9} />
              <span>返回合成</span>
            </button>
          </div>
        </header>

        <div className="assetCenterSummary" aria-label="成果概览">
          <button type="button" className={taskCenterResultFilter === "all" ? "active" : ""} aria-pressed={taskCenterResultFilter === "all"} onClick={() => setTaskCenterResultFilter("all")}>
            <span>全部成果</span><strong>{taskCenterResults.length}</strong>
          </button>
          <button type="button" className={taskCenterResultFilter === "audio_family" ? "active" : ""} aria-pressed={taskCenterResultFilter === "audio_family"} onClick={() => setTaskCenterResultFilter("audio_family")}>
            <span>音频</span><strong>{taskCenterResults.filter((result) => ["audio", "enhancement", "separation"].includes(result.kind)).length}</strong>
          </button>
          <button type="button" className={taskCenterResultFilter === "documents" ? "active" : ""} aria-pressed={taskCenterResultFilter === "documents"} onClick={() => setTaskCenterResultFilter("documents")}>
            <span>文字与时间轴</span><strong>{taskCenterResults.filter((result) => ["transcript", "subtitle", "alignment"].includes(result.kind)).length}</strong>
          </button>
          <button type="button" className={taskCenterResultFilter === "orphan" ? "attention active" : orphanTaskResultCount > 0 ? "attention" : ""} aria-pressed={taskCenterResultFilter === "orphan"} onClick={() => setTaskCenterResultFilter("orphan")}>
            <span>待整理文件</span><strong>{orphanTaskResultCount}</strong>
          </button>
        </div>

        <div className="assetCenterLayout">
          <aside className="assetCenterFilters" aria-label="成果筛选">
            <div className="assetFilterHeading">
              <strong>筛选成果</strong>
              {(taskCenterSearch || taskCenterResultFilter !== "all" || taskCenterSourceFilter !== "all") && (
                <button type="button" onClick={() => {
                  setTaskCenterSearch("");
                  setTaskCenterResultFilter("all");
                  setTaskCenterSourceFilter("all");
                }}>重置</button>
              )}
            </div>
            <label className="assetCenterSearch">
              <Search size={16} strokeWidth={1.9} />
              <input value={taskCenterSearch} placeholder="搜索文件、原文或模型" aria-label="搜索成果" onChange={(event) => setTaskCenterSearch(event.target.value)} />
            </label>
            <div className="assetFilterGroup" role="group" aria-label="成果类型">
              <span>内容类型</span>
              {typeFilters.map((filter) => (
                <button key={filter.id} type="button" className={taskCenterResultFilter === filter.id ? "active" : ""} aria-pressed={taskCenterResultFilter === filter.id} onClick={() => setTaskCenterResultFilter(filter.id)}>
                  {filter.icon}<strong>{filter.label}</strong><em>{filter.count}</em>
                </button>
              ))}
            </div>
            <div className="assetFilterGroup" role="group" aria-label="成果来源">
              <span>来源</span>
              <button type="button" className={taskCenterSourceFilter === "all" ? "active" : ""} aria-pressed={taskCenterSourceFilter === "all"} onClick={() => setTaskCenterSourceFilter("all")}>
                <Library size={16} strokeWidth={1.9} /><strong>全部来源</strong><em>{taskCenterResults.length}</em>
              </button>
              {taskResultSources.map(({ source, count }) => (
                <button key={source} type="button" className={taskCenterSourceFilter === source ? "active" : ""} aria-pressed={taskCenterSourceFilter === source} onClick={() => setTaskCenterSourceFilter(source)}>
                  <span className={`assetSourceDot source-${source}`} aria-hidden="true" /><strong>{taskSourceLabel(source)}</strong><em>{count}</em>
                </button>
              ))}
            </div>
          </aside>

          <section className="assetCenterListPanel" aria-label="成果列表">
            <header className="assetCenterListHeader">
              <div><strong>{taskCenterSearch || taskCenterResultFilter !== "all" || taskCenterSourceFilter !== "all" ? "筛选结果" : "最近成果"}</strong><span>{visibleTaskCenterResults.length} 项文件</span></div>
              <label className="assetListSelectAll"><input type="checkbox" aria-label="全选当前成果" checked={allVisibleTaskResultsSelected} onChange={toggleAllVisibleTaskResults} /><span>全选</span></label>
            </header>
            {selectedTaskResults.length > 0 && (
              <div className="assetCenterBatchBar">
                <span>已选择 {selectedTaskResults.length} 项</span>
                <button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void onBatchDownloadTaskResults()}><Download size={15} strokeWidth={1.9} /><span>导出</span></button>
                <button type="button" className="pathPickButton audioAssetDeleteButton" disabled={taskCenterAction !== null} onClick={() => void onBatchDeleteTaskResults()}><Trash2 size={15} strokeWidth={1.9} /><span>清理</span></button>
                <button type="button" className="assetCenterTextButton" disabled={taskCenterAction !== null} onClick={() => setSelectedTaskResultIds([])}>取消</button>
              </div>
            )}
            <div className="assetCenterRows">
              {audioLibraryLoading && taskCenterResults.length === 0 ? (
                <div className="assetCenterLoading" aria-label="正在读取成果"><span /><span /><span /></div>
              ) : visibleTaskCenterResults.length === 0 ? (
                <div className="assetCenterEmpty"><Library size={26} strokeWidth={1.7} /><strong>{taskCenterResults.length === 0 ? "还没有可管理的成果" : "没有符合筛选条件的成果"}</strong><span>{taskCenterResults.length === 0 ? "语音生成、转写、增强或取样完成后，文件会自动汇集到这里。" : "尝试更换类型、来源或关键词。"}</span></div>
              ) : visibleTaskCenterResultGroups.map((group) => {
                const collapsed = collapsedResultDateGroups.has(group.key);
                return (
                  <section key={group.key} className={`assetDateGroup ${collapsed ? "collapsed" : ""}`}>
                    <button className="assetDateGroupHeader" type="button" onClick={() => setCollapsedResultDateGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                      return next;
                    })} aria-expanded={!collapsed}>
                      <ChevronDown size={16} strokeWidth={2} />
                      <strong>{group.label}</strong>
                      <span>{group.results.length} 项成果</span>
                    </button>
                    {!collapsed && group.results.map((result) => {
                      const selectedForBatch = selectedTaskResultIds.includes(result.id);
                      const current = selected?.id === result.id;
                      const opening = taskCenterAction === `open-result-${result.id}`;
                      const downloading = taskCenterAction === `download-result-${result.id}`;
                      const canOpen = Boolean(result.summary_only || result.file_path || result.url || result.bilibili_history_id);
                      return (
                        <article key={result.id} className={`assetCenterRow ${current ? "current" : ""} ${result.exists ? "" : "missing"} ${result.summary_only ? "summary" : ""}`}>
                          <label className="assetRowCheckbox" title={result.summary_only ? "电子书章节汇总不可批量处理" : `选择 ${result.file_name}`}><input type="checkbox" disabled={result.summary_only} checked={selectedForBatch} onChange={() => toggleTaskResultSelection(result.id)} /><span className="srOnly">选择 {result.file_name}</span></label>
                          <button className="assetCenterRowMain" type="button" onClick={() => setSelectedTaskResultId(result.id)}>
                            <span className={`assetResultKindIcon kind-${result.kind}`}>{taskResultIcon(result.kind)}</span>
                            <span><strong title={result.file_name}>{result.file_name}</strong><small>{taskResultContextLabel(result)}</small></span>
                          </button>
                          <div className="assetCenterRowTags"><span className={`taskSourceTag source-${result.source}`}>{taskSourceLabel(result.source)}</span><span className={`taskResultKindTag kind-${result.kind}`}>{taskResultKindLabel(result.kind)}</span>{result.relation !== "task" && <span className={`taskResultRelationTag relation-${result.relation}`}>{taskResultRelationLabel(result.relation)}</span>}</div>
                          <div className="assetCenterRowMeta"><span>{result.model ?? "未关联模型"}</span><time>{formatHistoryTime(result.created_at)}</time></div>
                          <button type="button" className="assetRowOpenButton" title={result.summary_only ? "查看章节成果" : result.bilibili_history_id ? "打开媒体采样" : result.file_path ? "打开文件" : "导出文件"} aria-label={result.summary_only ? "查看章节成果" : result.bilibili_history_id ? "打开媒体采样" : result.file_path ? "打开文件" : "导出文件"} disabled={taskCenterAction !== null || !result.exists || !canOpen} onClick={() => void onOpenTaskResult(result)}>
                            {opening || downloading ? <Loader2 className="spin" size={16} /> : result.file_path || result.bilibili_history_id ? <FolderOpen size={16} strokeWidth={1.9} /> : <Download size={16} strokeWidth={1.9} />}<span className="srOnly">打开成果</span>
                          </button>
                        </article>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </section>

          <aside className="assetCenterInspector" aria-label="成果详情">
            {selected ? (
              <>
                <header className="assetInspectorHeader"><div><span className={`assetResultKindIcon kind-${selected.kind}`}>{taskResultIcon(selected.kind)}</span><div><span>{taskResultKindLabel(selected.kind)} · {taskSourceLabel(selected.source)}</span><strong title={selected.file_name}>{selected.file_name}</strong></div></div>{selected.summary_only ? <em>章节汇总</em> : !selected.exists && <em>文件缺失</em>}</header>
                <div className="assetInspectorPreview">
                  {selected.summary_only ? (
                    <div className="ebookInspectorPreview">
                      {ebookInspectorLoading ? <div className="assetInspectorPreviewEmpty"><Loader2 className="spin" size={24} /><span>正在读取章节成果…</span></div> : ebookInspectorError ? <div className="assetInspectorPreviewEmpty"><AlertCircle size={24} /><span>{ebookInspectorError}</span></div> : ebookInspectorSummary ? <>
                        <div className="ebookInspectorBook"><BookOpen size={22} strokeWidth={1.8} /><div><strong>{ebookInspectorSummary.bookName}</strong><span>{ebookInspectorSummary.chapters.length} 个章节 · 已生成 {ebookInspectorSummary.chapters.reduce((total, chapter) => total + chapter.segments.filter((segment) => segment.exists).length, 0)} 段音频</span></div></div>
                        <div className="ebookInspectorChapterList" aria-label="电子书章节">
                          {ebookInspectorSummary.chapters.map((chapter) => <button type="button" key={chapter.chapterId} className={chapter.chapterId === selectedEbookChapter?.chapterId ? "active" : ""} onClick={() => setEbookInspectorChapterId(chapter.chapterId)}><span>第 {chapter.chapterIndex + 1} 章</span><strong title={chapter.chapterTitle}>{chapter.chapterTitle}</strong><em>{chapter.segments.filter((segment) => segment.exists).length}/{chapter.segments.length || chapter.totalSegments || 0}</em></button>)}
                        </div>
                        {selectedEbookChapter ? <div className="ebookInspectorChapterDetail"><header><div><strong>{selectedEbookChapter.chapterTitle}</strong><span>{selectedEbookChapter.status} · {selectedEbookChapter.segments.length} 段</span></div><button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void onOpenEbookDirectory(selectedEbookChapter?.directoryPath, "本章")}><FolderOpen size={14} strokeWidth={1.9} />本章目录</button></header>{selectedEbookChapter.segments.length ? <div className="ebookInspectorSegments">{selectedEbookChapter.segments.map((segment, index) => <article key={segment.segmentId || index}><div><span>段落 {index + 1}</span><p>{segment.text || "（无文本）"}</p></div>{segment.exists && segment.audioUrl ? <audio controls preload="none" src={resolveTaskResultUrl(segment.audioUrl)} /> : <small>{segment.error || "音频尚未生成"}</small>}</article>)}</div> : <div className="assetInspectorPreviewEmpty"><FileText size={21} /><span>这个章节还没有可预览的分段成果。</span></div>}</div> : null}
                      </> : null}
                    </div>
                  ) : selectedIsAudio && selected.url && selected.exists ? <audio controls preload="metadata" src={resolveTaskResultUrl(selected.url)} /> : selectedIsVideo && selected.url && selected.exists ? <video controls preload="metadata" src={resolveTaskResultUrl(selected.url)} /> : <div className="assetInspectorPreviewEmpty">{taskResultIcon(selected.kind)}<span>{selected.exists ? selected.text || "此成果可通过下方操作打开或导出。" : "原始文件已不存在，可从任务记录中确认来源。"}</span></div>}
                </div>
                {selected.text && !selectedIsAudio && !selectedIsVideo && <p className="assetInspectorText">{selected.text}</p>}
                <dl className="assetInspectorMeta">
                  <div><dt>来源</dt><dd>{taskSourceLabel(selected.source)}</dd></div>
                  <div><dt>文件状态</dt><dd className={selected.summary_only ? "" : selected.relation === "orphan" || !selected.exists ? "assetMetaAttention" : ""}>{selected.summary_only ? (ebookInspectorSummary ? `已读取 ${ebookInspectorSummary.chapters.length} 个章节` : "按章节任务管理") : !selected.exists ? "文件缺失" : taskResultRelationLabel(selected.relation)}</dd></div>
                  <div><dt>关联任务</dt><dd title={selected.task_title}>{selected.relation === "orphan" ? "未关联任务" : selected.task_title}</dd></div>
                  <div><dt>模型</dt><dd>{selected.model ?? "未关联模型"}</dd></div>
                  <div><dt>文件信息</dt><dd>{selected.summary_only ? `${ebookInspectorSummary?.chapters.length ?? "-"} 个章节音频集合` : selected.duration_seconds ? formatDuration(selected.duration_seconds) : selected.size_bytes !== null && selected.size_bytes !== undefined ? formatAssetSize(selected.size_bytes) : "可导出结果"}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatHistoryTime(selected.created_at)}</dd></div>
                </dl>
                <div className="assetInspectorActions">
                  {selected.summary_only ? <>
                    <button type="button" className="primaryAction" disabled={taskCenterAction !== null || !ebookInspectorSummary?.bookDirectoryPath} onClick={() => void onOpenEbookDirectory(ebookInspectorSummary?.bookDirectoryPath, "整本电子书")}><FolderOpen size={16} strokeWidth={1.9} /><span>打开整本目录</span></button>
                    <button type="button" className="secondaryAction" disabled={taskCenterAction !== null || !selectedEbookChapter?.directoryPath} onClick={() => void onOpenEbookDirectory(selectedEbookChapter?.directoryPath, "本章")}><FolderOpen size={16} strokeWidth={1.9} /><span>打开本章目录</span></button>
                    <button type="button" className="secondaryAction" disabled={taskCenterAction !== null} onClick={() => setTaskCenterOpen(true)}><BookOpen size={16} strokeWidth={1.9} /><span>前往任务中心</span></button>
                  </> : <button type="button" className="primaryAction" disabled={taskCenterAction !== null || !selected.exists || !Boolean(selected.file_path || selected.url || selected.bilibili_history_id)} onClick={() => void onOpenTaskResult(selected)}><FolderOpen size={16} strokeWidth={1.9} /><span>{selected.bilibili_history_id ? "进入媒体采样" : selected.file_path ? "打开文件" : "导出文件"}</span></button>}
                  {selected.file_path && <button type="button" className="secondaryAction" disabled={taskCenterAction !== null || !selected.exists} onClick={() => void onRevealTaskResult(selected)}><FolderOpen size={16} strokeWidth={1.9} /><span>所在目录</span></button>}
                  {selected.asset && <button type="button" className="secondaryAction" disabled={taskCenterAction !== null} onClick={() => onAddAudioAssetToVoiceLibrary(selected.asset!)}><Save size={16} strokeWidth={1.9} /><span>加入音色库</span></button>}
                  {(!selected.summary_only && (selected.asset || selected.bilibili_history_id || (!selected.exists && ["speech", "realtime", "batch_project"].includes(selected.source)))) && <button type="button" className="secondaryAction assetInspectorDelete" disabled={taskCenterAction !== null || (!selected.exists && Boolean(selected.asset))} onClick={() => void onDeleteTaskResult(selected)}><Trash2 size={16} strokeWidth={1.9} /><span>{selected.bilibili_history_id ? "移除记录" : !selected.exists ? "移除记录" : "删除文件"}</span></button>}
                </div>
              </>
            ) : <div className="assetInspectorEmpty"><Library size={28} strokeWidth={1.7} /><strong>选择一项成果</strong><span>在左侧列表中选择文件，即可查看预览、来源和管理操作。</span></div>}
          </aside>
        </div>
      </section>
    );
  }

  function toggleTheme(event: ReactMouseEvent<HTMLButtonElement>) {
    if (themeTransitioning) {
      return;
    }

    const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const buttonBounds = event.currentTarget.getBoundingClientRect();
    const originX = buttonBounds.left + buttonBounds.width / 2;
    const originY = buttonBounds.top + buttonBounds.height / 2;
    const revealRadius = Math.hypot(
      Math.max(originX, window.innerWidth - originX),
      Math.max(originY, window.innerHeight - originY)
    );
    const applyTheme = () => {
      flushSync(() => {
        setTheme(nextTheme);
        setThemeTransitioning(true);
      });
      root.dataset.theme = nextTheme;
      if (themeTransitionTimerRef.current !== null) {
        window.clearTimeout(themeTransitionTimerRef.current);
      }
      themeTransitionTimerRef.current = window.setTimeout(() => {
        setThemeTransitioning(false);
        themeTransitionTimerRef.current = null;
      }, 560);
    };

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionDocument = document as ThemeTransitionDocument;
    if (!prefersReducedMotion && transitionDocument.startViewTransition) {
      try {
        const transition = transitionDocument.startViewTransition(applyTheme);
        void transition.ready.then(() => {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${originX}px ${originY}px)`,
                `circle(${revealRadius}px at ${originX}px ${originY}px)`
              ]
            },
            {
              duration: 520,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)"
            } as KeyframeAnimationOptions
          );
        }).catch(() => {
          // The immediate theme update is still valid when the host declines a view transition.
        });
        return;
      } catch {
        // Older Electron builds can expose the API but reject a transition at runtime.
      }
    }

    applyTheme();
  }

  const settingsLlmConfigured = Boolean(globalLlmSettings.enabled && globalLlmSettings.baseUrl.trim() && globalLlmSettings.model.trim());
  const settingsDefaultModelName = startupModelOptions.find((model) => model.id === settingsDraft.default_model_id)?.display_name ?? settingsDraft.default_model_id;
  const settingsStorageConfigured = Boolean(appSettings?.storage_root && appSettings?.model_store_root && appSettings?.output_dir);

  return (
    <main className={`studioShell theme-${theme}${themeTransitioning ? " isThemeTransitioning" : ""}`}>
      <header className="desktopTopbar">
        <div className="brandMark">
          <div className="brandGlyph">
            <Waves size={18} strokeWidth={2} />
          </div>
          <div>
            <strong>OpenTTS Studio</strong>
            <span>Local Voice Workstation</span>
          </div>
        </div>

        <nav className="workbenchNavWrap" aria-label="工作台导航">
          <button className="workbenchNavScroll" type="button" disabled={!workbenchNavScrollState.canScrollBackward} title={workbenchNavScrollState.canScrollBackward ? "显示前面的工作台" : "已到最前面的工作台"} aria-label={workbenchNavScrollState.canScrollBackward ? "显示前面的工作台" : "已到最前面的工作台"} onClick={() => scrollWorkbenchNavigation(-1)}>
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <div
            className="workbenchNav"
            ref={workbenchNavRef}
            role="group"
            aria-label="功能工作台"
            onKeyDown={handleWorkbenchNavigationKeyDown}
            data-can-scroll-backward={workbenchNavScrollState.canScrollBackward ? "true" : "false"}
            data-can-scroll-forward={workbenchNavScrollState.canScrollForward ? "true" : "false"}
            style={{ "--workbench-indicator-x": `${workbenchIndicator.left}px`, "--workbench-indicator-width": `${workbenchIndicator.width}px`, "--workbench-indicator-opacity": workbenchIndicator.ready ? 1 : 0 } as CSSProperties}
          >
            <span className="workbenchNavIndicator" aria-hidden="true" />
            <button data-workbench-id="creation" className={activeWorkspace === "creation" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "creation" ? "page" : undefined} onClick={() => selectWorkspace("creation")}>
              <Sparkles size={16} strokeWidth={1.9} />
              <span>本地 TTS</span>
            </button>
            <button data-workbench-id="doubao" className={activeWorkspace === "doubao" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "doubao" ? "page" : undefined} onClick={() => selectWorkspace("doubao")}>
              <Cloud size={16} strokeWidth={1.9} />
              <span>云端 TTS</span>
            </button>
            <button data-workbench-id="transcription" className={activeWorkspace === "transcription" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "transcription" ? "page" : undefined} onClick={() => selectWorkspace("transcription")}>
              <FileText size={16} strokeWidth={1.9} />
              <span>转写文字</span>
            </button>
            <button data-workbench-id="sampler" className={activeWorkspace === "sampler" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "sampler" ? "page" : undefined} onClick={() => selectWorkspace("sampler")}>
              <Film size={16} strokeWidth={1.9} />
              <span>媒体采样</span>
            </button>
            <button data-workbench-id="enhancement" className={activeWorkspace === "enhancement" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "enhancement" ? "page" : undefined} onClick={() => selectWorkspace("enhancement")}>
              <Wand2 size={16} strokeWidth={1.9} />
              <span>语音增强</span>
            </button>
            <button data-workbench-id="separation" className={activeWorkspace === "separation" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "separation" ? "page" : undefined} onClick={() => selectWorkspace("separation")}>
              <Waves size={16} strokeWidth={1.9} />
              <span>音频分轨</span>
            </button>
            <button data-workbench-id="assets" className={activeWorkspace === "assets" ? "workbenchNavButton active" : "workbenchNavButton"} type="button" aria-current={activeWorkspace === "assets" ? "page" : undefined} onClick={() => openAudioLibrary()}>
              <Library size={16} strokeWidth={1.9} />
              <span>成果中心</span>
            </button>
          </div>
          <button className="workbenchNavScroll" type="button" disabled={!workbenchNavScrollState.canScrollForward} title={workbenchNavScrollState.canScrollForward ? "显示后面的工作台" : "已到最后面的工作台"} aria-label={workbenchNavScrollState.canScrollForward ? "显示后面的工作台" : "已到最后面的工作台"} onClick={() => scrollWorkbenchNavigation(1)}>
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </nav>

        <div className="topStatus" title={`${online ? "本地后端在线" : "等待后端"} · ${apiBaseLabel}`}>
          <span className={online ? "statusDot online" : "statusDot"} />
          <span>{online ? "本地后端在线" : "等待后端"}</span>
          <code>{apiBaseLabel}</code>
        </div>

        <div className="windowTools">
          <div className="toolGroup globalToolGroup" role="group" aria-label="全局工具">
            <button className="toolButton" type="button" title="刷新状态" aria-label="刷新状态" disabled={globalRefreshing} onClick={() => void refreshWorkspaceState()}>
              <RefreshCw className={globalRefreshing ? "spin" : undefined} size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton taskQueueToolButton" type="button" title="任务队列" aria-label="任务队列" onClick={() => {
              setTaskCenterError(null);
              setTaskCenterMessage(null);
              setTaskHistoryClearConfirmOpen(false);
              void loadTaskSummaries();
              setTaskCenterOpen(true);
            }}>
              <Gauge size={17} strokeWidth={1.9} />
              {(activeTaskCount > 0 || retryableTaskCount > 0) && <span className={retryableTaskCount > 0 ? "taskQueueToolBadge attention" : "taskQueueToolBadge"}>{activeTaskCount + retryableTaskCount}</span>}
            </button>
            <button
              type="button"
              className={`toolButton themeToggleButton ${theme === "dark" ? "isDark" : "isLight"}${themeTransitioning ? " isTransitioning" : ""}`}
              title={theme === "dark" ? "切换为日间模式" : "切换为夜晚模式"}
              aria-label={theme === "dark" ? "切换为日间模式" : "切换为夜晚模式"}
              aria-pressed={theme === "dark"}
              onClick={toggleTheme}
            >
              <span className="themeToggleIcon" aria-hidden="true">
                <Moon className="themeToggleMoon" size={17} strokeWidth={1.9} />
                <Sun className="themeToggleSun" size={17} strokeWidth={1.9} />
              </span>
            </button>
            <button className="toolButton" type="button" title="设置" aria-label="设置" onClick={openSettings}>
              <Settings size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton monitorToolButton" type="button" title="系统监控" aria-label="系统监控" onClick={() => setMonitorPanelOpen(true)}>
              <Cpu size={17} strokeWidth={1.9} />
              <span className={online ? "toolStatusDot online" : "toolStatusDot"} aria-hidden="true" />
            </button>
          </div>
          <div className="toolGroup windowControlGroup" role="group" aria-label="窗口控制">
            <button className="toolButton" type="button" title="最小化" aria-label="最小化" onClick={() => window.desktopWindow?.minimize()}>
              <Minus size={18} strokeWidth={2} />
            </button>
            <button className="toolButton" type="button" title="最大化" aria-label="最大化" onClick={() => window.desktopWindow?.maximize()}>
              <Maximize2 size={16} strokeWidth={1.9} />
            </button>
            <button className="toolButton close" type="button" title="关闭" aria-label="关闭" onClick={() => window.desktopWindow?.close()}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      <section className={activeWorkspace === "creation" ? "workbench" : "workbench workspaceWorkbench"}>
        <aside className={activeWorkspace === "creation" ? "leftRail" : "leftRail workspaceRailHidden"}>
          <section className="softPanel voicePanel">
            <div className="panelTitle voicePanelTitle">
              <span className="panelTitleGroup">
                {isDoubao ? <Cloud size={17} strokeWidth={1.9} /> : <Library size={17} strokeWidth={1.9} />}
                <span>
                  {isDoubao ? "豆包预设音色" : "音色库"}
                  {!isDoubao && <small className="voiceLibraryCount">{visibleManagedVoices.length}</small>}
                </span>
              </span>
              <div className="voicePanelActions">
                {isDoubao ? (
                  <button type="button" className="voiceImportButton cloudManageButton" onClick={() => selectWorkspace("doubao")}>
                    <LogIn size={14} strokeWidth={1.9} />
                    <span>账号管理</span>
                  </button>
                ) : (
                  <>
                    <div className="voiceImportMenu">
                      <button
                        type="button"
                        className="voiceImportButton"
                        aria-expanded={voiceImportMenuOpen}
                        aria-haspopup="menu"
                        onClick={() => setVoiceImportMenuOpen((open) => !open)}
                        title="导入本地音频或从 B 站取样"
                      >
                        {voiceImporting ? <Loader2 className="spin" size={14} /> : <Upload size={14} strokeWidth={1.9} />}
                        <span>导入</span>
                        <ChevronDown size={13} strokeWidth={2} />
                      </button>
                      {voiceImportMenuOpen && (
                        <div className="voiceImportDropdown" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            disabled={voiceImporting || modelWarmupBusy}
                            onClick={() => {
                              setVoiceImportMenuOpen(false);
                              void onImportVoice();
                            }}
                          >
                            <Upload size={14} strokeWidth={1.9} />
                            <span>本地音频</span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setVoiceImportMenuOpen(false);
                              openSampler();
                            }}
                          >
                            <Download size={14} strokeWidth={1.9} />
                            <span>B 站取样</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button type="button" className="voiceImportButton voiceManageButton" onClick={() => {
                      setVoiceImportMenuOpen(false);
                      openVoiceManager();
                    }}>
                      <Settings size={14} strokeWidth={1.9} />
                      <span>管理</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            {isDoubao ? (
              <>
                <div className="doubaoVoiceToolbar">
                  <label>
                    <Search size={14} strokeWidth={1.9} />
                    <input
                      value={doubaoVoiceSearch}
                      onChange={(event) => setDoubaoVoiceSearch(event.target.value)}
                      placeholder="搜索音色、性别或标签"
                      aria-label="搜索豆包预设音色"
                    />
                  </label>
                  <span className={doubaoUsable ? "doubaoCloudStatus ready" : "doubaoCloudStatus warning"}>
                    {doubaoUsable ? `${doubaoStatus?.cookies.valid ?? 0} 个账号可用` : "需要登录"}
                  </span>
                </div>
                {visibleDoubaoVoices.length > 0 ? (
                  <div className="doubaoVoiceGrid" aria-label="豆包预设音色">
                    {visibleDoubaoVoices.map((voice) => (
                      <button
                        key={voice.id}
                        type="button"
                        className={voice.style_id === selectedDoubaoVoice?.style_id ? "doubaoVoiceCard active" : "doubaoVoiceCard"}
                        aria-pressed={voice.style_id === selectedDoubaoVoice?.style_id}
                        onClick={() => setSelectedDoubaoVoiceId(voice.style_id)}
                        title={`${voice.name} · ${[voice.gender, voice.age, ...voice.tags].filter(Boolean).join(" · ")}`}
                      >
                        <span className="voiceAvatar doubaoVoiceAvatar" style={{ "--avatar-bg": voiceColorFromId(voice.id) } as CSSProperties} aria-hidden="true">
                          {voice.name.slice(0, 1)}
                        </span>
                        <span className="doubaoVoiceCopy">
                          <strong>{voice.name}</strong>
                          <small>{[voice.gender, voice.age, voice.tags[0]].filter(Boolean).join(" · ") || voice.language}</small>
                        </span>
                        {voice.style_id === selectedDoubaoVoice?.style_id && <CheckCircle2 size={15} strokeWidth={2} />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="voiceEmptyState compactDoubaoEmpty">
                    {doubaoStateError ? <AlertCircle size={20} strokeWidth={1.9} /> : <Search size={20} strokeWidth={1.9} />}
                    <strong>{doubaoStateError ? "豆包服务状态读取失败" : "没有匹配的预设音色"}</strong>
                    <span>{doubaoStateError ?? "换一个关键词，或清空搜索条件。"}</span>
                  </div>
                )}
              </>
            ) : showVoiceLibrary && availableVoices.length > 0 ? (
              <div className="voiceGrid compactVoiceGrid">
                {availableVoices.map((voice) => (
                  <button
                    key={voice.id}
                    type="button"
                    className={voice.id === selectedVoice ? "voiceCard active" : "voiceCard"}
                    aria-pressed={voice.id === selectedVoice}
                    onClick={() => {
                      setSelectedVoice(voice.id);
                      if (voice.modelBinding) {
                        setReferenceText(voice.referenceText ?? "");
                      }
                    }}
                    title={voiceQualityById[voice.id]?.warnings[0] ?? `${voice.name} · ${voice.subtitle}`}
                    >
                    <span className="voiceAvatar hasImage" style={{ "--avatar-bg": voice.background, ...voiceAvatarStyle(voice, voiceAvatars) } as CSSProperties} aria-hidden="true" />
                    <span
                      className={`voiceQualityDot ${voiceQualityById[voice.id]?.status ?? "unknown"}`}
                      aria-label={voiceQualityById[voice.id] ? voiceQualityLabel(voiceQualityById[voice.id]) : "尚未检查参考音频"}
                    />
                      <span className="voiceName">{voice.name}</span>
                      {voice.modelBinding && <span className="voiceModelWeightBadge">专属权重</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="voiceEmptyState compactVoiceEmpty">
                <Mic2 size={20} strokeWidth={1.9} />
                <strong>还没有可用音色</strong>
                <span>从“导入”添加本地参考音频或 B 站取样。</span>
              </div>
            )}
          </section>

          <section className="softPanel controlPanel">
            {supportedCloneModes.length > 1 ? (
              <div
                className="segmented"
                style={{ "--segment-count": supportedCloneModes.length } as CSSProperties}
              >
                {supportedCloneModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === cloneMode ? "segment active" : "segment"}
                    aria-pressed={mode === cloneMode}
                    onClick={() => setCloneMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            ) : (
              <div className="cloneModeSummary">
                <span>生成模式</span>
                <strong>{cloneMode}</strong>
              </div>
            )}
            {showControlPrompt ? (
              <>
                <div className="controlPromptToolbar">
                  <span><Sparkles size={15} strokeWidth={1.9} />关键词 → 模型提示词</span>
                  <button
                    type="button"
                    className="secondaryAction promptPolishButton"
                    onClick={() => void onPolishControlPrompt()}
                    disabled={promptPolishBusy || loading}
                  >
                    {promptPolishBusy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} strokeWidth={1.9} />}
                    <span>{promptPolishBusy ? "润色中" : "AI 润色"}</span>
                  </button>
                </div>
                <textarea
                  className="controlPrompt"
                  value={controlPrompt}
                  onChange={(event) => setControlPrompt(event.target.value)}
                  placeholder={controlPromptPlaceholder(selectedModelInfo, cloneMode)}
                  aria-label={`${selectedModelInfo?.display_name ?? selectedModel} ${cloneMode}提示词`}
                />
                {promptPolishError && <div className="promptPolishFeedback error"><AlertCircle size={14} /><span>{promptPolishError}</span></div>}
                {promptPolishResult && (
                  <div className="promptPolishPreview">
                    <div className="promptPolishPreviewHeader">
                      <div><strong>AI 建议</strong><span>{promptPolishResult.summary}</span></div>
                      <div className="promptPolishActions">
                        <button type="button" className="secondaryAction" onClick={() => void onPolishControlPrompt()} disabled={promptPolishBusy}>重新生成</button>
                        <button type="button" className="primaryAction" onClick={() => { setControlPrompt(promptPolishResult.prompt); setPromptPolishResult(null); setPromptPolishError(null); }}>采用结果</button>
                      </div>
                    </div>
                    <p>{promptPolishResult.prompt}</p>
                    {promptPolishResult.suggestions.length > 0 && <div className="promptPolishSuggestions">{promptPolishResult.suggestions.map((suggestion) => <span key={suggestion}>{suggestion}</span>)}</div>}
                  </div>
                )}
                {controlPromptPresets.length > 0 && (
                  <div className="promptPresetSection">
                    <div className="promptPresetHeader">
                      <span><Wand2 size={15} strokeWidth={1.9} />快速预设</span>
                      <span
                        className="inlineHelp parameterHint tooltipEnd"
                        tabIndex={0}
                        role="note"
                        aria-label={controlPromptGuide(selectedModelInfo, cloneMode)}
                        data-tooltip={controlPromptGuide(selectedModelInfo, cloneMode)}
                      >
                        <Info size={15} strokeWidth={2} aria-hidden="true" />
                      </span>
                    </div>
                    <div className="promptPresetList" aria-label="提示词快速预设">
                      {controlPromptPresets.map((preset) => {
                        const selected = controlPrompt.trim() === preset.prompt;
                        return (
                          <button
                            key={`${selectedModel}-${cloneMode}-${preset.label}`}
                            type="button"
                            className={selected ? "promptPreset active" : "promptPreset"}
                            aria-pressed={selected}
                            title={preset.prompt || "不添加控制提示，跟随参考音频"}
                            onClick={() => setControlPrompt(preset.prompt)}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="capabilityNote">
                <Sparkles size={17} strokeWidth={1.9} />
                <span>{capabilityHint(selectedModelInfo, cloneMode)}</span>
              </div>
            )}
            {needsExtremeReferenceText && (
              <textarea
                className="controlPrompt referencePrompt"
                value={referenceText}
                onChange={(event) => setReferenceText(event.target.value)}
                placeholder="参考音频对应原文"
                aria-label="参考音频对应原文"
              />
            )}
            {selectedModel === "voxcpm2" && cloneMode === "可控克隆" && (
              <div className="cloneModeWarning">
                <AlertCircle size={17} strokeWidth={1.9} />
                <div>
                  <strong>参考音色会锁定说话人特征</strong>
                  <span>
                    当前正在克隆「{selectedVoiceInfo.name}」。控制文字只能调表达，不能可靠地把男声改成女声；想由描述决定音色，请改用音色设计。
                  </span>
                  <button type="button" onClick={() => setCloneMode("音色设计")} disabled={loading}>
                    切换到音色设计
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="softPanel paramsPanel">
            <div className="panelTitle">
              <SlidersHorizontal size={17} strokeWidth={1.9} />
              <span>参数</span>
              {showIndexSampling && (
                <span
                  className="inlineHelp parameterHint"
                  tabIndex={0}
                  role="note"
                  aria-label="IndexTTS2 是自回归模型，没有扩散步数；高级参数控制 GPT 音频 Token 采样。"
                  data-tooltip="IndexTTS2 是自回归模型，没有扩散步数；高级参数控制 GPT 音频 Token 采样。"
                >
                  <Info size={15} strokeWidth={2} aria-hidden="true" />
                </span>
              )}
            </div>
            {showCfgSteps && (
              <>
                <label className="sliderField parameterHint" data-tooltip={voxcpm2ParameterHints.cfg}>
                  <span className="parameterName">CFG <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                  <input type="range" min="1" max="3" step="0.1" value={cfg} onChange={(event) => setCfg(Number(event.target.value))} />
                  <strong>{cfg}</strong>
                </label>
                <label className="sliderField parameterHint" data-tooltip={voxcpm2ParameterHints.steps}>
                  <span className="parameterName">步数 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                  <input type="range" min="5" max="30" step="1" value={steps} onChange={(event) => setSteps(Number(event.target.value))} />
                  <strong>{steps}</strong>
                </label>
              </>
            )}
            {showIndexSampling && (
              <>
                <details className="indexAdvancedParameters">
                  <summary>IndexTTS2 高级采样参数</summary>
                  <div className="indexAdvancedParameterList">
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.temperature}>
                      <span className="parameterName">温度 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="0.1" max="2" step="0.1" value={indexTemperature} onChange={(event) => setIndexTemperature(Number(event.target.value))} />
                      <strong>{indexTemperature.toFixed(1)}</strong>
                    </label>
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.topP}>
                      <span className="parameterName">Top-P <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="0" max="1" step="0.01" value={indexTopP} onChange={(event) => setIndexTopP(Number(event.target.value))} />
                      <strong>{indexTopP.toFixed(2)}</strong>
                    </label>
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.topK}>
                      <span className="parameterName">Top-K <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="0" max="100" step="1" value={indexTopK} onChange={(event) => setIndexTopK(Number(event.target.value))} />
                      <strong>{indexTopK}</strong>
                    </label>
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.numBeams}>
                      <span className="parameterName">束数 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="1" max="10" step="1" value={indexNumBeams} onChange={(event) => setIndexNumBeams(Number(event.target.value))} />
                      <strong>{indexNumBeams}</strong>
                    </label>
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.repetitionPenalty}>
                      <span className="parameterName">重复 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="0.1" max="20" step="0.1" value={indexRepetitionPenalty} onChange={(event) => setIndexRepetitionPenalty(Number(event.target.value))} />
                      <strong>{indexRepetitionPenalty.toFixed(1)}</strong>
                    </label>
                    <label className="sliderField parameterHint" data-tooltip={indexTts2ParameterHints.maxMelTokens}>
                      <span className="parameterName">长度 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                      <input type="range" min="50" max="1815" step="5" value={indexMaxMelTokens} onChange={(event) => setIndexMaxMelTokens(Number(event.target.value))} />
                      <strong>{indexMaxMelTokens}</strong>
                    </label>
                  </div>
                </details>
              </>
            )}
            {showSpeedControl && (
              <label className={isDoubao ? "sliderField parameterHint" : "sliderField"} data-tooltip={isDoubao ? "豆包语速倍率，推荐 1.00；低于 1 更慢，高于 1 更快。" : undefined}>
                <span className={isDoubao ? "parameterName" : undefined}>语速 {isDoubao && <Info size={14} strokeWidth={2} aria-hidden="true" />}</span>
                <input type="range" min={isDoubao ? "0.5" : "0.75"} max={isDoubao ? "2" : "1.5"} step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
                <strong>{speed.toFixed(2)}</strong>
              </label>
            )}

            {isDoubao && (
              <>
                <label className="sliderField parameterHint" data-tooltip="调整豆包音高，范围 -12 到 12；推荐 0，数值过大可能显得不自然。">
                  <span className="parameterName">音调 <Info size={14} strokeWidth={2} aria-hidden="true" /></span>
                  <input type="range" min="-12" max="12" step="1" value={doubaoPitch} onChange={(event) => setDoubaoPitch(Number(event.target.value))} />
                  <strong>{doubaoPitch > 0 ? `+${doubaoPitch}` : doubaoPitch}</strong>
                </label>
                <div className="doubaoFormatRow">
                  <span>格式</span>
                  <div className="doubaoFormatToggle" role="group" aria-label="豆包输出格式">
                    {(["mp3", "wav"] as const).map((format) => (
                      <button type="button" key={format} className={doubaoFormat === format ? "active" : ""} aria-pressed={doubaoFormat === format} onClick={() => setDoubaoFormat(format)}>
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <small>{doubaoFormat === "mp3" ? "体积小" : "无损 PCM"}</small>
                </div>
                <div className={doubaoUsable ? "doubaoAccountNote ready" : "doubaoAccountNote warning"}>
                  {doubaoUsable ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <AlertCircle size={16} strokeWidth={1.9} />}
                  <span>{doubaoUsable ? `云端服务可用 · ${doubaoStatus?.cookies.valid ?? 0} 个有效账号` : doubaoStateError ?? "没有有效 Cookie，登录后才能生成"}</span>
                  {!doubaoUsable && <button type="button" onClick={() => selectWorkspace("doubao")}>去登录</button>}
                </div>
              </>
            )}

            {(showNormalizeToggle || showDenoiseToggle) && (
              <div className="toggleRow">
                {showNormalizeToggle && (
                  <button
                    type="button"
                    className={normalizeText ? "toggle active parameterHint" : "toggle parameterHint"}
                    aria-pressed={normalizeText}
                    data-tooltip={voxcpm2ParameterHints.normalize}
                    onClick={() => setNormalizeText((value) => !value)}
                  >
                    <CheckCircle2 size={16} strokeWidth={1.9} />
                    <span>文本正则化</span>
                  </button>
                )}
                {showDenoiseToggle && (
                  <button
                    type="button"
                    className={denoise ? "toggle active parameterHint tooltipEnd" : "toggle parameterHint tooltipEnd"}
                    aria-pressed={denoise}
                    data-tooltip={voxcpm2ParameterHints.denoise}
                    onClick={() => setDenoise((value) => !value)}
                  >
                    <ShieldCheck size={16} strokeWidth={1.9} />
                    <span>语音降噪</span>
                  </button>
                )}
              </div>
            )}

            {!hasParameterControls && (
              <div className="capabilityNote compactCapabilityNote">
                <SlidersHorizontal size={17} strokeWidth={1.9} />
                <span>当前模型暂无可调参数。</span>
              </div>
            )}

            {!isDoubao && !isModelInstanceUsable(selectedModelInstance) && (
              <div className="capabilityNote compactCapabilityNote">
                <AlertCircle size={17} strokeWidth={1.9} />
                <span>当前模型还没有可用实例，请在设置里的模型管理中心检查或修复。</span>
              </div>
            )}

            <div className="leftActions singleAction">
              <button type="button" className="secondaryAction" disabled={!result} onClick={() => void openOutputDirectory()}>
                <FolderOpen size={17} strokeWidth={1.9} />
                <span>查看成品</span>
              </button>
            </div>
          </section>
        </aside>

        <section className={`mainStage${activeWorkspace === "creation" ? "" : " workspaceMainStage"}${generationWorkspace === "realtime" && activeWorkspace === "creation" ? " realtimeMainStage" : ""} workspaceTransition-${workspaceTransition}`}>
          {activeWorkspace === "creation" ? (
            <>
          <section className={generationWorkspace === "batch" ? "softPanel canvasPanel batchCanvasPanel" : generationWorkspace === "realtime" ? "softPanel canvasPanel realtimeCanvasPanel" : "softPanel canvasPanel"}>
            <div className={generationWorkspace === "realtime" ? "engineStrip realtimeEngineStrip" : "engineStrip"}>
              {generationWorkspace === "realtime" ? (
                <>
                  <div className="engineHeader realtimeEngineHeader">
                    <Radio size={18} strokeWidth={1.9} />
                    <div>
                      <span>实时语音引擎</span>
                      <small>当前会话锁定实时链路</small>
                    </div>
                  </div>
                  <div className="realtimeEngineSummary" aria-label="当前实时语音引擎">
                    <span className="realtimeEngineName"><Waves size={17} strokeWidth={1.9} /><strong>Whispera 流式 VoxCPM2</strong></span>
                    <span className={`realtimeEngineState ${realtimeRuntimeState}`}>{realtimeEngineStatus}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="engineHeader">
                    <Cpu size={18} strokeWidth={1.9} />
                    <div>
                      <span>模型引擎</span>
                      {modelSwitchLocked && (
                        <small className="modelSwitchLock" title={modelSwitchLockMessage}>
                          <Lock size={12} strokeWidth={2} />
                          {loading || hasActiveBatchGeneration ? "当前任务结束后可切换" : "当前模型准备完成后可切换"}
                        </small>
                      )}
                      {modelWarmupState?.modelId === selectedModel && (
                        <small className={`modelWarmupStatus ${modelWarmupState.status}`} title={modelWarmupState.message}>
                          {(modelWarmupState.status === "waiting" || modelWarmupState.status === "warming") && <Loader2 className="spin" size={12} />}
                          {modelWarmupState.message}
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="modelScroller">
                    {localModels.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        className={model.id === selectedModel ? "modelPill active" : "modelPill"}
                        aria-pressed={model.id === selectedModel}
                        onClick={() => requestModelSwitch(model.id)}
                        title={modelSwitchLocked && model.id !== selectedModel ? modelSwitchLockMessage : model.display_name}
                        disabled={modelSwitchLocked && model.id !== selectedModel}
                      >
                        <span className="modelPillTitle">
                          <span className="modelPillLabel">{model.display_name}</span>
                          {model.id === selectedModel && <CheckCircle2 size={14} strokeWidth={2.1} aria-hidden="true" />}
                        </span>
                        <small>{modelBadge(model)}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={`generationWorkspaceTabs ${generationWorkspace}`} role="tablist" aria-label="生成工作模式">
                <span className="generationWorkspaceThumb" aria-hidden="true" />
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationWorkspace === "single"}
                  className={generationWorkspace === "single" ? "active" : ""}
                  onClick={openSingleWorkspace}
                >
                  <Wand2 size={15} strokeWidth={1.9} />
                  <span>单次</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationWorkspace === "batch"}
                  className={generationWorkspace === "batch" ? "active" : ""}
                  onClick={openBatchWorkspace}
                >
                  <FileText size={15} strokeWidth={1.9} />
                  <span>批量</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationWorkspace === "realtime"}
                  className={generationWorkspace === "realtime" ? "active" : ""}
                  onClick={openRealtimeWorkspace}
                >
                  <Radio size={15} strokeWidth={1.9} />
                  <span>实时</span>
                </button>
              </div>
            </div>

            {generationWorkspace === "single" ? (
              <>
            <div className="taskCanvas">
              {loading ? (
                <div className="generatingState">
                  <div className="pulseBadge" role="status" aria-live="polite">
                    <Loader2 className="spin" size={18} />
                    <span>{drawSession ? `抽卡第 ${drawSession.currentIndex}/${drawSession.total} 条生成中` : `${selectedModelInfo?.display_name ?? selectedModel} 正在生成`}</span>
                  </div>
                  {drawSession && (
                    <div className="drawGeneratingSummary">
                      <span>同一参数串行生成，不会并发占用显存</span>
                      <strong>已获得 {drawSession.successful} 条 · 失败 {drawSession.failed} 条</strong>
                    </div>
                  )}
                  <div className="progressConsole">
                    <div className="progressHeader">
                      <div>
                        <strong>{generationProgress.phaseTitle}</strong>
                        <span>{generationProgress.detail}</span>
                      </div>
                      <div className="elapsedTimer">
                        <small>已用时</small>
                        <b>{formatDuration(elapsedSeconds)}</b>
                      </div>
                    </div>
                    <div className="generationProgressBar" role="progressbar" aria-label="生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={generationProgress.percent} aria-valuetext={`${generationProgress.phaseTitle} · ${generationProgress.percent}%`}>
                      <span style={{ width: `${generationProgress.percent}%` }} />
                    </div>
                    <div className="phaseTimeline">
                      {activeGenerationPhases.map((phase, index) => (
                        <span
                          key={phase}
                          className={
                            index < generationProgress.phaseIndex
                              ? "phaseStep done"
                              : index === generationProgress.phaseIndex
                                ? "phaseStep active"
                                : "phaseStep"
                          }
                        >
                          {phase}
                        </span>
                      ))}
                    </div>
                    <div className="progressHint">{generationProgress.estimate}</div>
                  </div>
                  <button type="button" className="secondaryAction forceStopGeneration" onClick={() => void onForceStopActiveGeneration()}>
                    <X size={16} strokeWidth={2} />
                    <span>{isDoubao ? "终止云端请求" : "终止生成并释放模型"}</span>
                  </button>
                  <div className="skeletonWave">
                    {Array.from({ length: 48 }).map((_, index) => (
                      <span key={index} style={{ "--bar": `${18 + ((index * 13) % 54)}px` } as CSSProperties} />
                    ))}
                  </div>
                </div>
              ) : drawCandidates.length > 0 ? (
                <section className="drawCandidatesStage" aria-label="抽卡候选结果">
                  <header className="drawCandidatesHeader">
                    <div>
                      <span>抽卡结果</span>
                      <strong>{drawSession?.status === "cancelled" ? "已停止，已完成的候选仍可选择" : "选择一条作为当前试听结果"}</strong>
                    </div>
                    <small>{drawCandidates.length} / {drawSession?.total ?? drawCandidates.length} 条可用</small>
                  </header>
                  <div className="drawCandidateGrid">
                    {drawCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        className={candidate.id === selectedDrawCandidateId ? "drawCandidateCard active" : "drawCandidateCard"}
                        aria-pressed={candidate.id === selectedDrawCandidateId}
                        onClick={() => selectDrawCandidate(candidate)}
                      >
                        <span className="drawCandidateIndex">第 {candidate.index} 条</span>
                        <Volume2 size={20} strokeWidth={1.8} />
                        <strong>{formatDuration(candidate.result.duration_seconds)}</strong>
                        <small>{candidate.result.sample_rate} Hz · 点击选中试听</small>
                        {candidate.id === selectedDrawCandidateId && <CheckCircle2 className="drawCandidateCheck" size={16} strokeWidth={2.2} />}
                      </button>
                    ))}
                  </div>
                </section>
              ) : result ? (
                <div className="resultCard">
                  <div className="resultIcon">
                    <Volume2 size={24} strokeWidth={1.8} />
                  </div>
                  <div>
                  <h2>{resultVoiceName || currentVoiceName}</h2>
                  <p>{resultModelName || selectedModelInfo?.display_name || result.model}</p>
                  </div>
                  <div className="resultMeta">
                    <span>{result.sample_rate} Hz</span>
                    <span>{formatDuration(result.duration_seconds)}</span>
                  </div>
                </div>
              ) : (
                <div className="emptyCanvas">
                  <div className="emptyIcon">
                    <Sparkles size={25} strokeWidth={1.8} />
                  </div>
                  <h2>准备生成</h2>
                  <p>音色和文本就绪后即可生成。</p>
                  <div className="emptyCanvasSteps" aria-label="生成准备状态">
                    <span className={selectedVoiceInfo ? "ready" : ""}>
                      <CheckCircle2 size={14} strokeWidth={1.9} />
                      <b>音色</b>
                      <em>{selectedVoiceInfo?.name ?? "未选择"}</em>
                    </span>
                    <span className={input.trim() ? "ready" : ""}>
                      <CheckCircle2 size={14} strokeWidth={1.9} />
                      <b>文本</b>
                      <em>{input.trim() ? `${input.trim().length} 字` : "待输入"}</em>
                    </span>
                    <span className={canGenerate ? "ready" : ""}>
                      <CheckCircle2 size={14} strokeWidth={1.9} />
                      <b>模型</b>
                      <em>{selectedModelInfo?.display_name ?? selectedModel}</em>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="editorDock">
              <div className="editorTools">
                <button className="dockButton" type="button" onClick={() => fileInputRef.current?.click()}>
                  <FileText size={17} strokeWidth={1.9} />
                  <span>导入 TXT</span>
                </button>
                <button className="dockButton compactDockButton" type="button" title="清空文本" aria-label="清空文本" onClick={() => setInput("")}>
                  <Trash2 size={17} strokeWidth={1.9} />
                  <span>清空文本</span>
                </button>
                <button className="dockButton" type="button" onClick={() => void onRewriteScript()} disabled={scriptRewriteBusy || loading || !input.trim()}>
                  {scriptRewriteBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} strokeWidth={1.9} />}
                  <span>{scriptRewriteBusy ? "改写中" : "AI 改写配音稿"}</span>
                </button>
                <div
                  className="generateSplitAction"
                  ref={drawMenuRef}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setDrawMenuOpen(false);
                    }
                  }}
                >
                  <button className={loading ? "primaryAction editorGenerateButton isLoading" : "primaryAction editorGenerateButton"} type="button" disabled={!canGenerate} onClick={onGenerate}>
                    {loading ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} strokeWidth={1.9} />}
                    <span>{loading ? "生成中" : "开始生成"}</span>
                  </button>
                  <button
                    type="button"
                    className="primaryAction generateMenuTrigger"
                    aria-label="选择抽卡生成条数"
                    aria-haspopup="menu"
                    aria-expanded={drawMenuOpen}
                    disabled={loading}
                    title="抽卡生成"
                    onClick={() => setDrawMenuOpen((open) => !open)}
                  >
                    <ChevronDown size={17} strokeWidth={2} />
                  </button>
                  {drawMenuOpen && (
                    <div className="drawGenerateMenu" role="menu" aria-label="抽卡生成">
                      <div className="drawGenerateMenuHeader">
                        <Sparkles size={16} strokeWidth={1.9} />
                        <div>
                          <strong>抽卡生成</strong>
                          <span>同一参数串行生成，不会并发占用显存。</span>
                        </div>
                      </div>
                      {([2, 3, 4] as const).map((count) => (
                        <button
                          key={count}
                          type="button"
                          role="menuitem"
                          disabled={!canGenerate}
                          onClick={() => {
                            setDrawMenuOpen(false);
                            void onDrawGenerate(count);
                          }}
                        >
                          <span>抽 {count} 条</span>
                          <small>{count} 条候选</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} className="hiddenFile" type="file" accept=".txt,text/plain" aria-label="选择文本文件" onChange={onImportText} />
              </div>
              <textarea
                className="targetText"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    if (canGenerate && !loading) {
                      void onGenerate();
                    }
                  }
                }}
                placeholder="目标文本"
                aria-label="目标文本"
                aria-keyshortcuts="Control+Enter"
              />
              {scriptRewriteError && <div className="scriptRewriteFeedback error"><AlertCircle size={14} /><span>{scriptRewriteError}</span></div>}
              {scriptRewriteResult && (
                <div className="scriptRewritePreview">
                  <div className="scriptRewriteHeader">
                    <div><strong>AI 配音稿建议</strong><span>{scriptRewriteResult.model}</span></div>
                    <div className="scriptRewriteActions">
                      <button type="button" className="secondaryAction" onClick={() => void onRewriteScript()} disabled={scriptRewriteBusy}>重新生成</button>
                      <button type="button" className="primaryAction" onClick={() => { setInput(scriptRewriteResult.text); setScriptRewriteResult(null); setScriptRewriteError(null); }}>采用结果</button>
                    </div>
                  </div>
                  <p>{scriptRewriteResult.text}</p>
                </div>
              )}
              <div className="editorFoot">
                <span>{input.trim().length} 字</span>
                {showNormalizeToggle && <span>{normalizeText ? "文本正则化开" : "文本正则化关"}</span>}
                {showDenoiseToggle && <span>{denoise ? "降噪开" : "降噪关"}</span>}
                <span className="editorShortcutHint">Ctrl+Enter 生成</span>
              </div>
            </div>
              </>
            ) : generationWorkspace === "realtime" ? (
              <RealtimeWorkspace runtimeState={realtimeRuntimeState} runtimeMessage={realtimeRuntimeMessage} />
            ) : renderBatchProjectWorkspace()}
          </section>

          {generationWorkspace !== "realtime" && <section className={`softPanel playerPanel${result ? " hasResult" : ""}${isPlaying ? " isPlaying" : ""}`}>
            <button
              type="button"
              className={isPlaying ? "playButton isPlaying" : "playButton"}
              aria-label={isPlaying ? "暂停生成音频" : result ? "播放生成音频" : "暂无生成音频"}
              title={isPlaying ? "暂停生成音频" : result ? "播放生成音频" : "暂无生成音频"}
              disabled={!result}
              onClick={togglePlayback}
            >
              {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <div className="timeReadout">
              <span>{formatDuration(playbackTime)}</span>
              <span>/</span>
              <span>{formatDuration(playbackDuration || result?.duration_seconds)}</span>
            </div>
            <AudioWaveform
              className="playerWaveform"
              peaks={resultWaveformPeaks}
              status={resultWaveformStatus}
              theme={theme}
              progressRatio={progress / 100}
              onSeekRatio={seekGeneratedAudio}
              ariaLabel="生成音频播放波形，点击可跳转试听位置"
            />
            <div className="playerInfo">
              {result ? (
                <>
                  <strong>{resultModelName || selectedModelInfo?.display_name || result.model}</strong>
                  <span>{result.file_path}</span>
                </>
              ) : (
                <>
                  <strong>暂无音频</strong>
                  <span>生成完成后会出现在这里</span>
                </>
              )}
            </div>
            <button
              type="button"
              className={resultSavedToVoiceLibrary ? "voiceSaveButton saved" : "voiceSaveButton"}
              disabled={!result || voiceSaving || resultSavedToVoiceLibrary}
              onClick={openResultVoiceSaveDialog}
            >
              {voiceSaving ? <Loader2 className="spin" size={16} /> : resultSavedToVoiceLibrary ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <Save size={16} strokeWidth={1.9} />}
              <span>{voiceSaving ? "加入中" : resultSavedToVoiceLibrary ? "已加入" : "加入音色库"}</span>
            </button>
            <audio
              ref={audioRef}
              src={audioUrl}
              onLoadedMetadata={(event) => setPlaybackDuration(event.currentTarget.duration || result?.duration_seconds || 0)}
              onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
              onEnded={() => setIsPlaying(false)}
            />
          </section>}
            </>
          ) : (
            <section
              className="workspaceScreen"
              role="region"
              aria-label={activeWorkspace === "doubao" ? "云端 TTS 工作台" : activeWorkspace === "transcription" ? "音视频转写工作台" : activeWorkspace === "sampler" ? "媒体采样工作台" : activeWorkspace === "enhancement" ? "语音增强工作台" : activeWorkspace === "assets" ? "成果中心" : "音频分轨工作台"}
            >
              {activeWorkspace === "doubao" ? (
                <DoubaoWorkspace initialTab="synthesis" onClose={() => {
                  selectWorkspace("creation");
                  void loadDoubaoState();
                }} requestConfirmation={requestConfirmation} />
              ) : activeWorkspace === "transcription" ? (
                <TranscriptionWorkspace onClose={() => selectWorkspace("creation")} />
              ) : activeWorkspace === "sampler" ? (
                <MediaSamplerWorkspace onClose={() => selectWorkspace("creation")} onCreateVoiceFromSample={onMediaSamplerCreateVoice} />
              ) : activeWorkspace === "enhancement" ? (
                <EnhancementWorkspace onClose={() => selectWorkspace("creation")} />
              ) : activeWorkspace === "assets" ? (
                renderAssetCenterWorkspace()
              ) : (
                <SeparationWorkspace onClose={() => selectWorkspace("creation")} />
              )}
            </section>
          )}
        </section>

        <aside className={activeWorkspace === "creation" ? "rightRail" : "rightRail workspaceRailHidden"} aria-label="运行与系统监控">
          {renderSystemMonitorPanels()}
        </aside>
      </section>

      {monitorPanelOpen && (
        <div
          className="monitorDrawerOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="运行与系统监控"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setMonitorPanelOpen(false);
            }
          }}
        >
          <aside className="monitorDrawer">
            <header className="monitorDrawerHeader">
              <div>
                <strong>运行与系统监控</strong>
                <span>模型、硬件资源和当前任务状态</span>
              </div>
          <button type="button" className="modalClose" title="关闭系统监控" aria-label="关闭系统监控" onClick={() => setMonitorPanelOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="monitorDrawerBody">
              {renderSystemMonitorPanels()}
            </div>
          </aside>
        </div>
      )}

      {resultVoiceSaveOpen && voiceLibrarySaveSource && (
        <div
          className="settingsOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="保存音频到角色音色库"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !voiceSaving) {
              closeVoiceLibrarySaveDialog();
            }
          }}
        >
          <section className="settingsDialog resultVoiceSaveDialog">
            <header className="settingsHeader">
              <div>
                <strong>保存到角色音色库</strong>
                <span>选择新建角色，或作为参考片段加入已有角色</span>
              </div>
          <button type="button" className="modalClose" title="取消保存" aria-label="取消保存" disabled={voiceSaving} onClick={closeVoiceLibrarySaveDialog}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody resultVoiceSaveBody">
              <section className="resultVoiceSaveSource">
                <span className="resultVoiceSaveSourceIcon"><Waves size={18} strokeWidth={1.9} /></span>
                <div>
                  <strong>{voiceLibrarySaveSource.modelName}</strong>
                  <span title={voiceLibrarySaveSource.filePath}>{voiceLibrarySaveSource.displayName}</span>
                </div>
                <small>{voiceLibrarySaveSource.durationSeconds ? formatDuration(voiceLibrarySaveSource.durationSeconds) : "参考音频"}</small>
              </section>

              <section className="settingsGroup resultVoiceSaveModeGroup">
                <div>
                  <strong>保存方式</strong>
                  <span>加入已有角色只会新增片段，不会替换或切换当前参考。</span>
                </div>
                <div className="segmented" style={{ "--segment-count": 2 } as CSSProperties}>
                  <button
                    type="button"
                    className={resultVoiceSaveMode === "append" ? "segment active" : "segment"}
                    disabled={voiceSaving || appendableVoiceRoles.length === 0}
                    aria-pressed={resultVoiceSaveMode === "append"}
                    onClick={() => selectResultVoiceSaveMode("append")}
                  >
                    加入已有角色
                  </button>
                  <button
                    type="button"
                    className={resultVoiceSaveMode === "create" ? "segment active" : "segment"}
                    disabled={voiceSaving}
                    aria-pressed={resultVoiceSaveMode === "create"}
                    onClick={() => selectResultVoiceSaveMode("create")}
                  >
                    新建角色
                  </button>
                </div>
              </section>

              {resultVoiceSaveMode === "append" ? (
                <section className="settingsGroup resultVoiceSaveFields">
                  <label className="settingsField">
                    <span>加入到角色</span>
                    <select
                      value={resultVoiceSaveTargetId}
                      disabled={voiceSaving}
                      onChange={(event) => {
                        setResultVoiceSaveTargetId(event.target.value);
                        setResultVoiceSaveError(null);
                      }}
                    >
                      <option value="" disabled>选择一个角色</option>
                      {appendableVoiceRoles.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name} · {voice.references.length} 条片段</option>
                      ))}
                    </select>
                  </label>
                  <label className="settingsField">
                    <span>新参考片段名称</span>
                    <input
                      value={resultVoiceSaveName}
                      disabled={voiceSaving}
                      onChange={(event) => setResultVoiceSaveName(event.target.value)}
                    />
                  </label>
                </section>
              ) : (
                <section className="settingsGroup resultVoiceSaveFields">
                  <label className="settingsField">
                    <span>新角色名称</span>
                    <input
                      value={resultVoiceSaveName}
                      disabled={voiceSaving}
                      onChange={(event) => setResultVoiceSaveName(event.target.value)}
                    />
                  </label>
                  <p className="resultVoiceSaveNotice">将以这条生成音频创建一个新的角色，之后仍可继续添加更多参考片段。</p>
                </section>
              )}

              {resultVoiceSaveError && (
                <div role="alert" className="settingsFeedback error">
                  <AlertCircle size={16} strokeWidth={1.9} />
                  <span>{resultVoiceSaveError}</span>
                </div>
              )}
            </div>

            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" type="button" disabled={voiceSaving} onClick={closeVoiceLibrarySaveDialog}>
                <span>取消</span>
              </button>
              <span className="settingsFooterSpacer" />
              <button
                className="primaryAction settingsAction"
                type="button"
                disabled={voiceSaving || (resultVoiceSaveMode === "append" && !resultVoiceSaveTargetId)}
                onClick={() => void onSaveResultToVoiceLibrary()}
              >
                {voiceSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>{voiceSaving ? "正在保存" : resultVoiceSaveMode === "append" ? "加入角色" : "创建角色"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {voiceManagerOpen && (
        <div className="settingsOverlay voiceManagerOverlay" role="dialog" aria-modal="true" aria-label="角色音色库">
          <section className="settingsDialog voiceManagerDialog">
            <header className="settingsHeader voiceManagerHeader">
              <div>
                <strong>角色音色库</strong>
                <span>管理角色、头像和参考片段</span>
              </div>
              <button type="button" className="modalClose" title="关闭角色音色库" aria-label="关闭角色音色库" onClick={closeVoiceManager}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="settingsBody voiceManagerBody">
              {visibleManagedVoices.length === 0 ? (
                <div className="voiceManagerEmpty">
                  <Library size={24} strokeWidth={1.7} />
                  <strong>还没有已保存的角色</strong>
                  <span>可以从左侧导入参考音频、B 站取样，或把生成结果加入音色库。</span>
                </div>
              ) : (
                <div className="voiceManagerLayout">
                  <aside className="voiceManagerList" aria-label="角色列表">
                    <div className="voiceManagerListHeader">
                      <div>
                        <strong>角色档案</strong>
                        <small>选择一个角色开始管理</small>
                      </div>
                      <span>{visibleManagedVoices.length}</span>
                    </div>
                    <label className="voiceManagerSearch">
                      <Search size={15} strokeWidth={1.9} />
                      <input value={voiceManagerQuery} onChange={(event) => setVoiceManagerQuery(event.target.value)} placeholder="搜索角色或片段" aria-label="搜索角色或片段" />
                    </label>
                    <div className="voiceManagerQuickFilters" role="group" aria-label="角色筛选">
                      <button type="button" className={voiceManagerFilter === "all" ? "active" : ""} aria-pressed={voiceManagerFilter === "all"} onClick={() => setVoiceManagerFilter("all")}>
                        <Library size={14} strokeWidth={1.9} />
                        <span>全部</span>
                        <em>{visibleManagedVoices.length}</em>
                      </button>
                      <button type="button" className={voiceManagerFilter === "favorites" ? "active" : ""} aria-pressed={voiceManagerFilter === "favorites"} onClick={() => setVoiceManagerFilter("favorites")}>
                        <Star size={14} strokeWidth={1.9} />
                        <span>收藏</span>
                        <em>{visibleFavoriteVoiceCount}</em>
                      </button>
                    </div>
                    <div className="voiceManagerListItems">
                      {filteredManagedVoices.map((voice) => (
                        <button
                          key={voice.id}
                          type="button"
                          className={voice.id === managedVoice?.id ? "voiceManagerListItem active" : "voiceManagerListItem"}
                          aria-current={voice.id === managedVoice?.id ? "true" : undefined}
                          onClick={() => selectManagedVoice(voice)}
                        >
                          <span className="voiceAvatar hasImage" style={{ "--avatar-bg": voice.background, ...voiceAvatarStyle(voice, voiceAvatars) } as CSSProperties} aria-hidden="true" />
                          <span className="voiceManagerListCopy">
                            <strong>{voice.name}</strong>
                            <small>{voice.modelBinding ? "GPT-SoVITS 专属权重" : `${voice.references.length} 个参考片段`}</small>
                          </span>
                          {voice.id === managedVoice?.id && <CheckCircle2 className="voiceManagerListCheck" size={15} strokeWidth={2.1} />}
                        </button>
                      ))}
                      {filteredManagedVoices.length === 0 && <div className="voiceManagerListNoResults"><Search size={18} strokeWidth={1.7} /><span>{voiceManagerFilter === "favorites" ? "还没有收藏的角色" : "没有匹配的角色"}</span><small>{voiceManagerFilter === "favorites" ? "在角色详情中点击“收藏”，下次可快速找到它。" : "试试角色名或参考片段名称。"}</small></div>}
                    </div>
                    <div className="voiceManagerListFooter">
                      <span>头像与角色卡片会同步更新</span>
                    </div>
                  </aside>

                  {managedVoice && (
                    <section className="voiceManagerDetail">
                      <div className="voiceManagerRoleHeading">
                        <div className="voiceManagerRoleIdentity">
                          <span className="voiceAvatar voiceAvatarRole hasImage" style={{ "--avatar-bg": managedVoice.background, ...voiceAvatarStyle(managedVoice, voiceAvatars) } as CSSProperties} aria-hidden="true" />
                          <div className="voiceManagerRoleIdentityLine">
                            <span className="voiceManagerOverline">当前角色</span>
                            <strong>{managedVoice.name}</strong>
                            <span className="voiceManagerRoleMeta">· {managedVoice.modelBinding ? "模型专属权重" : `${managedVoice.references.length} 个参考片段`}</span>
                          </div>
                        </div>
                        <div className="voiceManagerRoleActions">
                          <span className={managedVoice.activeReferenceId ? "voiceManagerActiveState" : "voiceManagerActiveState muted"}>
                            <span className="voiceManagerActiveDot" />
                            {managedVoice.activeReferenceId ? "已连接生成" : "等待参考片段"}
                          </span>
                          <button className={voiceFavoriteIds.includes(managedVoice.id) ? "pathPickButton voiceFavoriteButton active" : "pathPickButton voiceFavoriteButton"} type="button" aria-pressed={voiceFavoriteIds.includes(managedVoice.id)} onClick={() => toggleVoiceFavorite(managedVoice.id)}>
                            <Star size={15} strokeWidth={1.9} fill={voiceFavoriteIds.includes(managedVoice.id) ? "currentColor" : "none"} />
                            <span>{voiceFavoriteIds.includes(managedVoice.id) ? "已收藏" : "收藏"}</span>
                          </button>
                          {!managedVoice.modelBinding && (
                            <button className="pathPickButton" type="button" disabled={voiceManagerAction !== null} onClick={() => void onAddVoiceReference()}>
                              {voiceManagerAction === "add-reference" ? <Loader2 className="spin" size={15} /> : <Plus size={15} strokeWidth={1.9} />}
                              <span>添加参考片段</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <section className="voiceAvatarEditor" aria-label="角色头像">
                        <div className="voiceAvatarEditorHeader">
                          <div className="voiceAvatarEditorIdentity">
                            <span className="voiceAvatar voiceAvatarLarge hasImage" style={{ "--avatar-bg": managedVoice.background, ...voiceAvatarStyle(managedVoice, voiceAvatars) } as CSSProperties} aria-hidden="true" />
                            <div>
                              <strong>角色头像</strong>
                              <span>用头像快速区分不同音色角色</span>
                            </div>
                          </div>
                          <button className="secondaryAction voiceAvatarPickerToggle" type="button" onClick={() => setAvatarPickerOpen((open) => !open)}>
                            <Palette size={15} strokeWidth={1.9} />
                            <span>{avatarPickerOpen ? "收起头像" : "更换头像"}</span>
                          </button>
                        </div>
                        {avatarPickerOpen && (
                          <div className="voiceAvatarPicker">
                            <div className="voiceAvatarPickerGrid" role="list" aria-label="潮玩头像">
                              {Array.from({ length: VOICE_AVATAR_COUNT }, (_, index) => {
                                const currentAvatar = voiceAvatarFor(managedVoice, voiceAvatars);
                                const selected = currentAvatar.kind === "pack" && currentAvatar.index === index;
                                const column = index % VOICE_AVATAR_COLUMNS;
                                const row = Math.floor(index / VOICE_AVATAR_COLUMNS);
                                return (
                                  <button
                                    key={index}
                                    className={selected ? "voiceAvatarOption selected" : "voiceAvatarOption"}
                                    type="button"
                                    aria-label={`潮玩头像 ${index + 1}`}
                                    aria-pressed={selected}
                                    onClick={() => selectVoiceAvatar(index)}
                                    style={{
                                      backgroundImage: `url(${voiceAvatarPack})`,
                                      backgroundSize: `${VOICE_AVATAR_COLUMNS * 100}% ${VOICE_AVATAR_ROWS * 100}%`,
                                      backgroundPosition: `${column * (100 / Math.max(1, VOICE_AVATAR_COLUMNS - 1))}% ${row * (100 / Math.max(1, VOICE_AVATAR_ROWS - 1))}%`
                                    }}
                                  >
                                    {selected && <CheckCircle2 size={16} strokeWidth={2.4} />}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="voiceAvatarPickerActions">
                              <button className="secondaryAction" type="button" onClick={() => avatarFileInputRef.current?.click()}>
                                <Upload size={15} strokeWidth={1.9} />
                                <span>上传自定义头像</span>
                              </button>
                              <input ref={avatarFileInputRef} type="file" accept="image/*" aria-label="上传自定义头像" hidden onChange={onCustomAvatarSelected} />
                              <span>建议使用正方形图片，头像只保存在本机。</span>
                            </div>
                          </div>
                        )}
                      </section>

                      <div className="voiceManagerWorkspaceGrid">
                        {managedVoice.references.length > 0 ? (
                          <section className="voiceReferenceSection" aria-label="参考片段">
                            <div className="voiceReferenceHeading">
                              <div>
                                <strong>参考片段</strong>
                                <span>先试听，再把最稳定的一条设为当前生成参考。</span>
                              </div>
                              <small>{managedVoice.references.length} / 24</small>
                            </div>
                            <div className="voiceReferenceList">
                              {managedVoice.references.map((reference) => {
                                const isSelected = reference.id === managedReference?.id;
                                const isActive = reference.id === managedVoice.activeReferenceId;
                                const isPreviewing = reference.id === voiceManagerPreviewId;
                                return (
                                  <article
                                    key={reference.id}
                                    className={isSelected ? "voiceReferenceCard selected" : "voiceReferenceCard"}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={isSelected}
                                    onClick={() => selectManagedReference(reference.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        selectManagedReference(reference.id);
                                      }
                                    }}
                                  >
                                    <div className="voiceReferenceCardTopline">
                                      <div className="voiceReferenceCardIdentity">
                                        <button
                                          className={isPreviewing && voiceManagerPreviewPlaying ? "voiceReferencePlay isPlaying" : "voiceReferencePlay"}
                                          type="button"
                                          disabled={voiceManagerAction !== null || voiceManagerPreviewLoading}
                                          title={isPreviewing && voiceManagerPreviewPlaying ? "暂停试听" : "试听片段"}
                                          aria-label={isPreviewing && voiceManagerPreviewPlaying ? `暂停试听 ${reference.name}` : `试听 ${reference.name}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void toggleVoiceManagerPreview(reference);
                                          }}
                                        >
                                          {isPreviewing && voiceManagerPreviewPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                                        </button>
                                        <div>
                                          <strong>{reference.name}</strong>
                                          <span className="voiceReferenceFile" title={reference.referenceAudio}>{getFileBaseName(reference.referenceAudio ?? "未指定音频")}</span>
                                        </div>
                                      </div>
                                      {isActive && <span className="voiceReferenceBadge">当前生成参考</span>}
                                    </div>
                                    <div className="voiceReferenceCardMeta">
                                      <span>{reference.referenceAudioManaged ? "音频已托管" : "外部参考路径"}</span>
                                      <span>{isSelected ? "已选中编辑" : "点击查看详情"}</span>
                                    </div>
                                    <div className="voiceReferenceWaveformWrap">
                                      {isSelected ? (
                                        <AudioWaveform
                                          className="voiceReferenceWaveform"
                                          peaks={voiceManagerPreviewPeaks}
                                          status={voiceManagerPreviewWaveformStatus}
                                          theme={theme}
                                          progressRatio={voiceManagerPreviewDuration > 0 ? voiceManagerPreviewTime / voiceManagerPreviewDuration : 0}
                                          ariaLabel="试听参考片段波形"
                                        />
                                      ) : (
                                        <div className="voiceReferenceWaveformPlaceholder"><Waves size={14} strokeWidth={1.8} /><span>选中后载入真实波形</span></div>
                                      )}
                                    </div>
                                    <div className="voiceReferenceCardActions">
                                      {!isActive && (
                                        <button
                                          className="secondaryAction voiceReferenceCardAction"
                                          type="button"
                                          disabled={voiceManagerAction !== null}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void onActivateManagedReference(reference.id);
                                          }}
                                        >
                                          <span>设为当前</span>
                                        </button>
                                      )}
                                      {managedVoice.references.length > 1 && (
                                        <button
                                          className="voiceReferenceDelete"
                                          type="button"
                                          title={`删除参考片段 ${reference.name}`}
                                          disabled={voiceManagerAction !== null}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void onDeleteManagedReference(reference.id);
                                          }}
                                        >
                                          <Trash2 size={14} strokeWidth={1.9} />
                                        </button>
                                      )}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        ) : (
                          <section className="voiceReferenceSection voiceReferenceEmptySection">
                            <div className="voiceReferenceEmptyIcon"><Waves size={20} strokeWidth={1.7} /></div>
                            <strong>这个角色还没有参考片段</strong>
                            <span>导入一条清晰、时长合适的语音后，就能在这里试听和管理。</span>
                          </section>
                        )}

                        <aside className="voiceManagerInspector" aria-label="片段详情">
                          <div className="voiceInspectorHeading">
                            <div>
                              <span className="voiceManagerOverline">片段详情</span>
                              <strong>{managedReference?.name ?? "角色设置"}</strong>
                              <span>{managedReference ? getFileBaseName(managedReference.referenceAudio ?? "本地音色") : "此角色由模型权重驱动"}</span>
                            </div>
                            {managedReference && managedVoice.activeReferenceId === managedReference.id && <span className="voiceInspectorActiveBadge"><CheckCircle2 size={13} strokeWidth={2} />当前生成</span>}
                          </div>

                          {managedReference ? (
                            <>
                              <div className="voiceInspectorPlayer">
                                <button className="voiceInspectorPlay" type="button" disabled={voiceManagerAction !== null || voiceManagerPreviewLoading} onClick={() => void toggleVoiceManagerPreview(managedReference)} title={voiceManagerPreviewPlaying ? "暂停试听" : "播放试听"}>
                                  {voiceManagerPreviewLoading ? <Loader2 className="spin" size={17} /> : voiceManagerPreviewPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                                </button>
                                <div>
                                  <strong>{voiceManagerPreviewPlaying ? "正在试听" : "点击试听这条片段"}</strong>
                                  <span>{voiceManagerPreviewDuration > 0 ? `${formatDuration(voiceManagerPreviewTime)} / ${formatDuration(voiceManagerPreviewDuration)}` : "读取音频后显示时长"}</span>
                                </div>
                              </div>
                              <div className="voiceInspectorActionRow">
                                <button className="pathPickButton" type="button" disabled={voiceManagerAction !== null || recognizingVoiceIds.includes(managedReferenceRecognitionKey)} onClick={() => void onReplaceVoiceReference()}>
                                  {voiceManagerAction === "replace-audio" ? <Loader2 className="spin" size={15} /> : <Upload size={15} strokeWidth={1.9} />}
                                  <span>替换片段</span>
                                </button>
                                <button
                                  className="secondaryAction voiceReferenceTrimButton"
                                  type="button"
                                  title={managedReference.referenceAudioManaged ? "在应用内试听并重新裁切此片段" : "外部路径请先替换或重新导入后再裁切"}
                                  disabled={voiceManagerAction !== null || !managedReference.referenceAudioManaged || recognizingVoiceIds.includes(managedReferenceRecognitionKey)}
                                  onClick={() => void onTrimManagedVoiceReference()}
                                >
                                  {voiceManagerAction === "trim-reference" ? <Loader2 className="spin" size={15} /> : <Waves size={15} strokeWidth={1.9} />}
                                  <span>裁切片段</span>
                                </button>
                              </div>
                              <button
                                className="voiceRepairButton"
                                type="button"
                                title={managedVoice.activeReferenceId === managedReference.id ? "将当前托管参考音频转换为单声道 PCM 16-bit WAV，不会改动原始生成文件" : "请先设为当前参考，再修复音频格式"}
                                disabled={voiceManagerAction !== null || !managedReference.referenceAudioManaged || !managedReference.referenceAudio || managedVoice.activeReferenceId !== managedReference.id}
                                onClick={() => void onRepairManagedVoiceAudio()}
                              >
                                {voiceManagerAction === "repair-audio" ? <Loader2 className="spin" size={15} /> : <Gauge size={15} strokeWidth={1.9} />}
                                <span>{voiceManagerAction === "repair-audio" ? "正在修复" : "修复音频格式"}</span>
                              </button>
                              <div className="voiceInspectorDivider" />
                              <label className="settingsField">
                                <span>片段名称</span>
                                <input disabled={voiceManagerAction !== null} value={voiceManagerDraft.referenceName} onChange={(event) => setVoiceManagerDraft((draft) => ({ ...draft, referenceName: event.target.value }))} />
                              </label>
                              <label className="settingsField voiceManagerPromptField">
                                <span>参考音频原文</span>
                                <textarea
                                  value={voiceManagerDraft.referenceText}
                                  placeholder="填写这条参考音频实际说的内容"
                                  disabled={voiceManagerAction !== null || recognizingVoiceIds.includes(managedReferenceRecognitionKey)}
                                  onChange={(event) => setVoiceManagerDraft((draft) => ({ ...draft, referenceText: event.target.value }))}
                                />
                              </label>
                              <button className="pathPickButton" type="button" disabled={voiceManagerAction !== null || !managedReference.referenceAudio || recognizingVoiceIds.includes(managedReferenceRecognitionKey)} onClick={() => void onRecognizeManagedVoiceReference()}>
                                {voiceManagerAction === "recognize" || recognizingVoiceIds.includes(managedReferenceRecognitionKey) ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} strokeWidth={1.9} />}
                                <span>{recognizingVoiceIds.includes(managedReferenceRecognitionKey) ? "正在自动识别" : "识别片段文本"}</span>
                              </button>
                            </>
                          ) : (
                            <div className="voiceInspectorModelCard"><Cpu size={18} strokeWidth={1.7} /><div><strong>模型专属权重</strong><span>此角色不使用普通参考片段。</span></div></div>
                          )}

                          <div className="voiceInspectorRoleField">
                            <label className="settingsField">
                              <span>角色名称</span>
                              <input disabled={voiceManagerAction !== null} value={voiceManagerDraft.name} onChange={(event) => setVoiceManagerDraft((draft) => ({ ...draft, name: event.target.value }))} />
                            </label>
                          </div>
                          <div className="voiceManagerMetadata">
                            <span>角色来源：{voiceSourceLabel(managedVoice.sourceType)}</span>
                            {managedReference && <span>片段来源：{voiceSourceLabel(managedReference.sourceType)}</span>}
                            {managedVoice.modelBinding && <span>限定模型：GPT-SoVITS</span>}
                            <span>授权：{managedVoice.authorizationStatus ?? "未标注"}</span>
                          </div>
                        </aside>
                      </div>
                    </section>
                  )}
                </div>
              )}

              {(voiceManagerError || voiceManagerMessage) && (
                <div role={voiceManagerError ? "alert" : "status"} aria-live={voiceManagerError ? "assertive" : "polite"} className={voiceManagerError ? "settingsFeedback error" : "settingsFeedback"}>
                  {voiceManagerError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                  <span>{voiceManagerError ?? voiceManagerMessage}</span>
                </div>
              )}
            </div>

            <footer className="settingsFooter voiceManagerFooter">
              {managedVoice && (
                <button className="secondaryAction voiceManagerDelete" type="button" disabled={voiceManagerAction !== null} onClick={() => void onDeleteManagedVoice()}>
                  {voiceManagerAction === "delete" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} strokeWidth={1.9} />}
                  <span>删除档案</span>
                </button>
              )}
              <div className={voiceManagerDirty ? "voiceManagerSaveState dirty" : "voiceManagerSaveState"}>
                <span className="voiceManagerSaveDot" />
                <span>{voiceManagerDirty ? "有未保存修改" : "已保存"}</span>
              </div>
              <span className="settingsFooterSpacer" />
              <button className="secondaryAction settingsAction" type="button" disabled={voiceManagerAction !== null} onClick={() => void onImportVoicePackage()}>
                {voiceManagerAction === "import" ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                <span>导入音色包</span>
              </button>
              {managedVoice && (
                <button className="secondaryAction settingsAction" type="button" title={managedVoice.modelBinding ? "模型专属权重不能导出为普通音色包" : undefined} disabled={voiceManagerAction !== null || Boolean(managedVoice.modelBinding)} onClick={() => void onExportVoicePackage()}>
                  {voiceManagerAction === "export" ? <Loader2 className="spin" size={16} /> : <Upload size={16} strokeWidth={1.9} />}
                  <span>导出音色包</span>
                </button>
              )}
              <button className="primaryAction settingsAction" type="button" disabled={!managedVoice || voiceManagerAction !== null || !voiceManagerDirty} onClick={() => void onSaveVoiceManagerDetails()}>
                {voiceManagerAction === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>{voiceManagerAction === "save" ? "正在保存" : voiceManagerDirty ? "保存修改" : "已保存"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {referenceAudioEditor && (
        <div
          className="settingsOverlay referenceAudioEditorOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="裁切参考音频"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !referenceAudioEditorSaving) {
              closeReferenceAudioEditor();
            }
          }}
        >
          <section className="settingsDialog referenceAudioEditorDialog">
            <header className="settingsHeader">
              <div>
                <strong>参考音频裁切</strong>
                <span>先试听并保留有效片段，再写入本软件的音色库</span>
              </div>
              <button type="button" className="modalClose" title="取消导入" aria-label="取消导入" disabled={referenceAudioEditorSaving} onClick={closeReferenceAudioEditor}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody referenceAudioEditorBody">
              <section className="referenceAudioFileCard">
                <div>
                  <strong>{getFileBaseName(referenceAudioEditor.sourcePath)}</strong>
                  <span title={referenceAudioEditor.sourcePath}>{referenceAudioEditor.sourcePath}</span>
                </div>
                <span className="referenceAudioDuration">
                  {referenceAudioEditor.durationSeconds > 0 ? `原始时长 ${formatDuration(referenceAudioEditor.durationSeconds)}` : "正在读取时长"}
                </span>
              </section>

              <section className="referenceAudioPlayer" aria-label="参考音频预览">
                <button
                  className="playButton referenceAudioPlayButton"
                  type="button"
                  disabled={referenceAudioEditor.durationSeconds <= 0}
                  title={referenceAudioPreviewPlaying ? "暂停试听" : "播放试听"}
                  onClick={() => void toggleReferenceAudioPreview()}
                >
                  {referenceAudioPreviewPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <div className="referenceAudioPlayerInfo">
                  <strong>{referenceAudioPreviewPlaying ? "正在试听" : "点击试听参考音频"}</strong>
                  <span>{formatDuration(referenceAudioPreviewTime)} / {formatDuration(referenceAudioEditor.durationSeconds)}</span>
                </div>
                <audio
                  ref={referenceAudioPreviewRef}
                  src={referenceAudioEditor.previewUrl}
                  preload="metadata"
                  onLoadedMetadata={(event) => onReferenceAudioMetadataLoaded(event.currentTarget.duration)}
                  onTimeUpdate={(event) => onReferenceAudioPreviewTimeUpdate(event.currentTarget.currentTime)}
                  onPlay={() => setReferenceAudioPreviewPlaying(true)}
                  onPause={() => setReferenceAudioPreviewPlaying(false)}
                  onEnded={() => setReferenceAudioPreviewPlaying(false)}
                  onError={() => setReferenceAudioEditorError("这条音频无法在应用内播放，请检查编码或换一个文件。")}
                />
              </section>

              <section className="referenceAudioTrimCard">
                <div className="referenceAudioTrimHeading">
                  <div>
                    <strong>保留片段</strong>
                    <span>当前选区 {referenceAudioSelectionDuration.toFixed(1)} 秒</span>
                  </div>
                  <button
                    className="secondaryAction referenceAudioResetButton"
                    type="button"
                    disabled={referenceAudioEditor.durationSeconds <= 0 || referenceAudioEditorSaving}
                    onClick={() => setReferenceAudioEditor((editor) => editor ? { ...editor, trimStartSeconds: 0, trimEndSeconds: editor.durationSeconds } : editor)}
                  >
                    <span>保留完整音频</span>
                  </button>
                </div>
                <AudioWaveform
                  className="referenceAudioWaveform"
                  peaks={referenceAudioWaveformPeaks}
                  status={referenceAudioWaveformStatus}
                  theme={theme}
                  progressRatio={referenceAudioEditor.durationSeconds > 0 ? referenceAudioPreviewTime / referenceAudioEditor.durationSeconds : 0}
                  selectionStartRatio={referenceAudioEditor.durationSeconds > 0 ? referenceAudioEditor.trimStartSeconds / referenceAudioEditor.durationSeconds : 0}
                  selectionEndRatio={referenceAudioEditor.durationSeconds > 0 ? referenceAudioEditor.trimEndSeconds / referenceAudioEditor.durationSeconds : 1}
                  editableSelection
                  onSeekRatio={seekReferenceAudioPreview}
                  onSelectionChange={updateReferenceAudioTrimRatio}
                  ariaLabel="参考音频真实波形，可拖动两端选区或点击试听位置"
                />
                <div className="referenceAudioTrimControls">
                  <label className="settingsField">
                    <span>起点（秒）</span>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, referenceAudioEditor.trimEndSeconds - 0.1)}
                      step="0.1"
                      disabled={referenceAudioEditor.durationSeconds <= 0 || referenceAudioEditorSaving}
                      value={Number(referenceAudioEditor.trimStartSeconds.toFixed(1))}
                      onChange={(event) => updateReferenceAudioTrim("start", event.target.value)}
                    />
                  </label>
                  <label className="settingsField">
                    <span>终点（秒）</span>
                    <input
                      type="number"
                      min={Math.min(referenceAudioEditor.durationSeconds, referenceAudioEditor.trimStartSeconds + 0.1)}
                      max={referenceAudioEditor.durationSeconds || undefined}
                      step="0.1"
                      disabled={referenceAudioEditor.durationSeconds <= 0 || referenceAudioEditorSaving}
                      value={Number(referenceAudioEditor.trimEndSeconds.toFixed(1))}
                      onChange={(event) => updateReferenceAudioTrim("end", event.target.value)}
                    />
                  </label>
                </div>
                <div className="referenceAudioSliders" aria-label="裁切选区滑块">
                  <label>
                    <span>起点</span>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(0, referenceAudioEditor.trimEndSeconds - 0.1)}
                      step="0.1"
                      disabled={referenceAudioEditor.durationSeconds <= 0 || referenceAudioEditorSaving}
                      value={referenceAudioEditor.trimStartSeconds}
                      onChange={(event) => updateReferenceAudioTrim("start", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>终点</span>
                    <input
                      type="range"
                      min={Math.min(referenceAudioEditor.durationSeconds, referenceAudioEditor.trimStartSeconds + 0.1)}
                      max={referenceAudioEditor.durationSeconds || undefined}
                      step="0.1"
                      disabled={referenceAudioEditor.durationSeconds <= 0 || referenceAudioEditorSaving}
                      value={referenceAudioEditor.trimEndSeconds}
                      onChange={(event) => updateReferenceAudioTrim("end", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="referenceAudioAdvice">
                <Info size={17} strokeWidth={1.9} />
                <div>
                  <strong>推荐选择干净的单人语音</strong>
                  <span>{referenceAudioRecommendation(selectedModel)}</span>
                  <span>尽量避开背景音乐、多人对话、长停顿与明显混响；裁切后的片段会以 WAV 托管，不会改动原文件。</span>
                </div>
              </section>

              <label className="settingsField referenceAudioNameField">
                <span>{referenceAudioEditor.target.kind === "create" ? "角色名称" : "参考片段名称"}</span>
                <input
                  value={referenceAudioEditor.name}
                  disabled={referenceAudioEditorSaving}
                  onChange={(event) => setReferenceAudioEditor((editor) => editor ? { ...editor, name: event.target.value } : editor)}
                />
              </label>

              <label className="referenceAudioAsrOption">
                <input
                  type="checkbox"
                  checked={referenceAudioEditor.autoRecognize}
                  disabled={referenceAudioEditorSaving}
                  onChange={(event) => setReferenceAudioEditor((editor) => editor ? { ...editor, autoRecognize: event.target.checked } : editor)}
                />
                <span>
                  <strong>保存后识别参考文字（ASR）</strong>
                  <small>会按当前 ASR 设置在本机识别选中片段；识别结果仍可在音色库中校对和修改。</small>
                </span>
              </label>

              {referenceAudioEditorError && (
                <div role="alert" className="settingsFeedback error">
                  <AlertCircle size={16} strokeWidth={1.9} />
                  <span>{referenceAudioEditorError}</span>
                </div>
              )}
            </div>

            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" type="button" disabled={referenceAudioEditorSaving} onClick={closeReferenceAudioEditor}>
                <span>取消</span>
              </button>
              <span className="settingsFooterSpacer" />
              <button
                className="primaryAction settingsAction"
                type="button"
                disabled={referenceAudioEditorSaving || referenceAudioEditor.durationSeconds <= 0}
                onClick={() => void saveReferenceAudioEditor()}
              >
                {referenceAudioEditorSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>{referenceAudioEditorSaving ? "正在保存" : referenceAudioEditor.target.kind === "create" ? "创建角色" : referenceAudioEditor.target.kind === "append" ? "添加参考片段" : referenceAudioEditor.target.kind === "trim" ? "保存裁切" : "保存替换"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {audioLibraryOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="音频资产库">
          <section className="settingsDialog audioLibraryDialog">
            <header className="settingsHeader">
              <div>
                <strong>音频资产库</strong>
                <span>本地与云端成品 · 受监控输出目录 · 任务可追溯</span>
              </div>
              <button type="button" className="modalClose" title="关闭" aria-label="关闭音频资产库" onClick={() => setAudioLibraryOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody audioLibraryBody">
              <div className="audioLibraryControls">
                <label className="audioLibraryField audioLibrarySearchField">
                  <span>搜索音频</span>
                    <input
                      aria-label="搜索音频资产"
                      value={audioLibrarySearch}
                    placeholder="文件名、模型、文本或项目名称"
                    onChange={(event) => setAudioLibrarySearch(event.target.value)}
                  />
                </label>
                <label className="audioLibraryField">
                  <span>来源</span>
                    <select aria-label="按来源筛选音频资产" value={audioLibrarySource} onChange={(event) => setAudioLibrarySource(event.target.value)}>
                    <option value="all">全部来源</option>
                    <option value="local">本地语音合成</option>
                    <option value="cloud">云端语音合成</option>
                    <option value="monitored">监控目录文件</option>
                  </select>
                </label>
                <button type="button" className="pathPickButton audioLibraryRefresh" disabled={audioLibraryLoading || audioLibraryAction !== null} onClick={() => void loadAudioAssets()}>
                  {audioLibraryLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                  <span>刷新</span>
                </button>
              </div>

              <div className="audioLibraryCount">
                <span>显示 {visibleAudioAssets.length} / {audioAssets.length} 个音频资产</span>
                <span>每 5 秒同步受监控目录；删除会移除实体文件</span>
              </div>

              {audioLibraryLoading && audioAssets.length === 0 ? (
                <div className="audioLibrarySkeleton" aria-label="正在读取音频资产">
                  <span />
                  <span />
                  <span />
                </div>
              ) : visibleAudioAssets.length === 0 ? (
                <div className="audioLibraryEmpty">
                  <Library size={22} strokeWidth={1.7} />
                  <strong>{audioAssets.length === 0 ? "受监控目录中暂无音频" : "没有匹配的音频资产"}</strong>
                  <span>{audioAssets.length === 0 ? "本地和云端完成一次生成后，音频会自动出现在这里。" : "尝试调整搜索词或来源筛选。"}</span>
                </div>
              ) : (
                <div className="audioLibraryLayout">
                  <div className="audioAssetList" aria-label="音频资产列表">
                    {visibleAudioAssets.map((asset) => (
                      <button
                        key={asset.file_path}
                        type="button"
                        className={asset.file_path === selectedAudioAsset?.file_path ? "audioAssetRow active" : "audioAssetRow"}
                        aria-pressed={asset.file_path === selectedAudioAsset?.file_path}
                        onClick={() => setSelectedAudioAssetPath(asset.file_path)}
                      >
                        <div>
                          <strong>{asset.file_name}</strong>
                          <span>{asset.model ?? "未关联模型"} · {formatAssetSize(asset.file_size_bytes)} · {formatHistoryTime(asset.modified_at)}</span>
                        </div>
                        <em className={`origin-${asset.origin}`}>{audioAssetOriginLabel(asset.origin)}</em>
                      </button>
                    ))}
                  </div>

                  {selectedAudioAsset && (
                    <aside className="audioAssetPreview">
                      <div className="audioAssetPreviewHeader">
                        <div>
                          <strong>{selectedAudioAsset.file_name}</strong>
                          <span>{audioAssetOriginLabel(selectedAudioAsset.origin)} · {audioAssetSourceLabel(selectedAudioAsset.source)}</span>
                        </div>
                        <span>{selectedAudioAsset.duration_seconds ? formatDuration(selectedAudioAsset.duration_seconds) : formatAssetSize(selectedAudioAsset.file_size_bytes)}</span>
                      </div>
                      <div className="audioAssetPlayer" aria-label="软件内试听">
                        <button className="audioAssetPlayButton" type="button" title={audioAssetPlaying ? "暂停试听" : "软件内试听"} onClick={() => void onToggleAudioAssetPlayback()}>
                          {audioAssetPlaying ? <Pause size={17} fill="currentColor" strokeWidth={1.9} /> : <Play size={17} fill="currentColor" strokeWidth={1.9} />}
                          <span>{audioAssetPlaying ? "暂停" : "试听"}</span>
                        </button>
                        <audio
                          ref={audioAssetRef}
                          controls
                          preload="metadata"
                          src={toAudioUrl(selectedAudioAsset.audio_url)}
                          onPlay={() => setAudioAssetPlaying(true)}
                          onPause={() => setAudioAssetPlaying(false)}
                          onEnded={() => setAudioAssetPlaying(false)}
                          onError={() => setAudioLibraryError("该音频无法在软件内播放，可能文件已被移动或损坏。")}
                        />
                      </div>
                      <div className="audioAssetMeta">
                        <span>模型</span><strong>{selectedAudioAsset.model ?? "未关联"}</strong>
                        <span>生成时间</span><strong>{formatHistoryTime(selectedAudioAsset.modified_at)}</strong>
                        <span>产出来源</span><strong>{audioAssetOriginLabel(selectedAudioAsset.origin)}</strong>
                        <span>任务类型</span><strong>{selectedAudioAsset.project_title ?? audioAssetSourceLabel(selectedAudioAsset.source)}</strong>
                      </div>
                      <p className="audioAssetText">{selectedAudioAsset.text || "该文件不带任务文本记录。"}</p>
                      <div className="audioAssetActions">
                        <button type="button" className="pathPickButton" disabled={audioLibraryAction !== null} onClick={() => void onOpenAudioAsset(selectedAudioAsset)}>
                          {audioLibraryAction === `open-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} strokeWidth={1.9} />}
                          <span>打开音频</span>
                        </button>
                        <button type="button" className="pathPickButton" disabled={audioLibraryAction !== null} onClick={() => void onRevealAudioAsset(selectedAudioAsset)}>
                          {audioLibraryAction === `reveal-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} strokeWidth={1.9} />}
                          <span>所在目录</span>
                        </button>
                        <button type="button" className="pathPickButton" disabled={audioLibraryAction !== null} onClick={() => void onAddAudioAssetToVoiceLibrary(selectedAudioAsset)}>
                          {audioLibraryAction === `voice-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <Save size={15} strokeWidth={1.9} />}
                          <span>加入音色库</span>
                        </button>
                        <button type="button" className="pathPickButton audioAssetDeleteButton" disabled={audioLibraryAction !== null} onClick={() => void onDeleteAudioAsset(selectedAudioAsset)}>
                          {audioLibraryAction === `delete-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}
                          <span>删除文件</span>
                        </button>
                      </div>
                    </aside>
                  )}
                </div>
              )}
            </div>

            {(audioLibraryError || audioLibraryMessage) && (
              <div role={audioLibraryError ? "alert" : "status"} aria-live={audioLibraryError ? "assertive" : "polite"} className={audioLibraryError ? "settingsFeedback error" : "settingsFeedback"}>
                {audioLibraryError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{audioLibraryError ?? audioLibraryMessage}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button type="button" className="secondaryAction settingsAction" onClick={() => setAudioLibraryOpen(false)}>
                <X size={16} strokeWidth={1.9} />
                <span>关闭</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {taskCenterOpen && (
        <div className="taskQueueOverlay" role="dialog" aria-modal="true" aria-label="任务队列" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setTaskCenterOpen(false);
          }
        }}>
          <aside className="taskQueueDrawer taskCenterDrawer">
            <header className="taskQueueHeader">
              <div>
                <strong>任务中心</strong>
                <span>{taskCenterTasks.length > 0 ? `共 ${taskCenterTasks.length} 项任务，状态和结果统一在这里管理` : "任务状态、失败原因和产出文件会集中显示在这里"}</span>
              </div>
              <button type="button" className="modalClose" title="关闭任务中心" aria-label="关闭任务中心" onClick={() => setTaskCenterOpen(false)}><X size={18} strokeWidth={2} /></button>
            </header>
            <div className="taskCenterDashboardSummary" aria-label="任务统计">
              <button type="button" className={taskCenterStatusFilter === "active" ? "active" : ""} aria-pressed={taskCenterStatusFilter === "active"} onClick={() => setTaskCenterStatusFilter("active")}><span>进行中</span><strong>{activeTaskCount}</strong></button>
              <button type="button" className={taskCenterStatusFilter === "completed" ? "active" : ""} aria-pressed={taskCenterStatusFilter === "completed"} onClick={() => setTaskCenterStatusFilter("completed")}><span>已完成</span><strong>{completedTaskCount}</strong></button>
              <button type="button" className={taskCenterStatusFilter === "failed" ? "attention active" : failedTaskCount > 0 ? "attention" : ""} aria-pressed={taskCenterStatusFilter === "failed"} onClick={() => setTaskCenterStatusFilter("failed")}><span>失败</span><strong>{failedTaskCount}</strong></button>
              <button type="button" className={cancelledTaskCount > 0 && taskCenterStatusFilter === "cancelled" ? "active" : ""} aria-pressed={taskCenterStatusFilter === "cancelled"} onClick={() => setTaskCenterStatusFilter("cancelled")}><span>已取消</span><strong>{cancelledTaskCount}</strong></button>
              <button type="button" className={taskCenterStatusFilter === "missing" ? "attention active" : missingTaskResultCount > 0 ? "attention" : ""} aria-pressed={taskCenterStatusFilter === "missing"} onClick={() => setTaskCenterStatusFilter("missing")}><span>文件缺失</span><strong>{missingTaskResultCount}</strong></button>
              <button type="button" className="taskCenterSummaryLink" onClick={() => { setTaskCenterOpen(false); openAudioLibrary(); }}>查看成果中心<ChevronRight size={15} strokeWidth={1.9} /></button>
            </div>
            <div className="taskCenterFilterBar" aria-label="任务筛选">
              <label className="taskCenterTaskSearch"><Search size={15} strokeWidth={1.9} /><input value={taskCenterTaskSearch} aria-label="搜索任务、错误或最近事件" placeholder="搜索任务、错误或最近事件" onChange={(event) => setTaskCenterTaskSearch(event.target.value)} /></label>
              <select value={taskCenterStatusFilter} onChange={(event) => setTaskCenterStatusFilter(event.target.value)} aria-label="任务状态">
                <option value="all">全部状态</option>
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
                <option value="failed">失败</option>
                <option value="attention">待处理 / 可重试</option>
                <option value="cancelled">已取消</option>
                <option value="missing">文件缺失</option>
              </select>
              <select value={taskCenterTaskSourceFilter} onChange={(event) => setTaskCenterTaskSourceFilter(event.target.value)} aria-label="任务类型">
                <option value="all">全部功能</option>
                <option value="batch">批量任务（旁白 / 电子书）</option>
                {taskCenterSources.map(({ source, count }) => <option key={source} value={source}>{taskSourceLabel(source)}（{count}）</option>)}
              </select>
               <button type="button" className="pathPickButton" disabled={taskCenterAction !== null || taskCenterRefreshing} onClick={() => void refreshTaskCenter()}><RefreshCw className={taskCenterRefreshing ? "spin" : undefined} size={15} strokeWidth={1.9} /><span>{taskCenterRefreshing ? "刷新中" : "刷新"}</span></button>
            </div>
            <div className="taskCenterFilterMeta"><span>显示 {visibleTaskCenterTasks.length} / {taskCenterTasks.length} 项任务</span>{taskCenterFiltersActive ? <button className="taskQueueLink taskCenterClearFilters" type="button" onClick={() => { setTaskCenterTaskSearch(""); setTaskCenterStatusFilter("all"); setTaskCenterTaskSourceFilter("all"); }}>清除筛选</button> : <span>失败任务会保留最近事件和日志入口，方便定位问题。</span>}</div>
            <div className="taskQueueBody">
              {taskHistoryClearConfirmOpen && (
                <div className="taskHistoryClearConfirm taskCenterInlineConfirm" role="alertdialog" aria-label="确认清理生成历史">
                  <Trash2 size={19} strokeWidth={1.8} />
                  <div><strong>清理 {clearableSpeechTaskCount} 条已结束的单句生成记录？</strong><span>只删除任务记录和诊断日志，输出目录里的音频文件会保留。</span></div>
                   <span className="taskHistoryClearActions"><button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => setTaskHistoryClearConfirmOpen(false)}>取消</button><button type="button" className="pathPickButton runtimeStopButton" disabled={taskCenterAction !== null} onClick={() => void onClearSpeechHistory()}>{taskCenterAction === "clear-history" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}<span>确认清理</span></button></span>
                </div>
              )}
              {(taskCenterError || taskCenterMessage) && <div role={taskCenterError ? "alert" : "status"} aria-live={taskCenterError ? "assertive" : "polite"} className={taskCenterError ? "settingsFeedback error" : "settingsFeedback"}>{taskCenterError ? <AlertCircle size={15} strokeWidth={1.9} /> : <CheckCircle2 size={15} strokeWidth={1.9} />}<span>{taskCenterError ?? taskCenterMessage}</span></div>}
              {taskSummariesLoading && taskCenterTasks.length === 0 ? (
                <div className="taskQueueEmpty"><Loader2 className="spin" size={25} strokeWidth={1.8} /><strong>正在读取任务记录</strong><span>正在同步任务状态和最近事件，请稍候。</span></div>
              ) : visibleTaskCenterTasks.length === 0 ? (
                <div className="taskQueueEmpty"><CheckCircle2 size={25} strokeWidth={1.8} /><strong>{taskCenterTasks.length === 0 ? (taskCenterError ? "任务记录读取失败" : "还没有任务记录") : "没有符合条件的任务"}</strong><span>{taskCenterTasks.length === 0 ? (taskCenterError ? "原有记录没有被清除，请点击“刷新”重试。" : "生成、转写、增强、分轨和媒体采样完成后，任务会自动出现在这里。") : "尝试切换状态、功能或搜索关键词。"}</span>{taskCenterFiltersActive && <button className="taskQueueLink" type="button" onClick={() => { setTaskCenterTaskSearch(""); setTaskCenterStatusFilter("all"); setTaskCenterTaskSourceFilter("all"); }}>清除筛选</button>}</div>
              ) : (
                visibleTaskCenterTasks.map((task) => {
                  const latestEvent = task.events[task.events.length - 1];
                  const isCancelling = taskCenterAction === `cancel-${task.id}`;
                  const isRetrying = taskCenterAction === `retry-${task.id}`;
                  const missingResultCount = (task.results ?? []).filter((result) => !result.exists).length;
                  const canClearMissing = missingResultCount > 0 && (["speech", "realtime"].includes(task.source) || (task.source === "batch_project" && task.id.startsWith("project:") && (task.results ?? []).some((result) => !result.exists && result.id.includes(":segment:"))));
                  const isClearingMissing = taskCenterAction === `clear-missing-${task.id}`;
                  const retryLabel = task.source === "batch_project" && task.status === "cancelled" ? "继续" : "重试";
                  const taskIsActive = ["queued", "running", "cancelling"].includes(task.status);
                  return (
                    <article key={task.id} className={`taskQueueItem source-${task.source} ${task.status}`}>
                      <header><div><span className={`taskSourceTag source-${task.source}`}>{taskSourceLabel(task.source)}</span><strong title={task.title}>{task.title}</strong></div><em className={task.status}>{taskStatusLabel(task.status)}</em></header>
                      {taskIsActive ? <div className="taskQueueProgress"><span style={{ width: `${task.progress_percent}%` }} /></div> : <div className={`taskQueueStateLine ${task.status}`}><span>{task.status === "failed" || task.status === "partial" ? "任务没有全部完成" : task.status === "cancelled" ? "任务已停止，可按需继续" : task.status === "paused" ? "任务已暂停，可继续预制" : "结果已写入成果中心"}</span><strong>{task.status === "succeeded" || task.status === "completed" ? "100%" : task.status === "failed" || task.status === "partial" ? "待处理" : task.status === "paused" ? "暂停" : "已取消"}</strong></div>}
                      <div className="taskQueueMeta"><span>{task.error ?? latestEvent?.message ?? "等待任务事件"}</span><strong>{taskIsActive ? `${task.progress_percent}%` : formatHistoryTime(task.updated_at)}</strong></div>
                      {task.error && <div className="taskQueueError"><AlertCircle size={14} strokeWidth={1.9} /><span>{task.error}</span></div>}
                      {task.events.length > 0 && (
                        <details className="taskQueueEventDisclosure" open={taskIsActive || task.status === "failed" || task.status === "partial"}>
                          <summary><span>最近事件</span><em>{Math.min(task.events.length, 3)} 条</em><ChevronDown size={14} strokeWidth={1.9} /></summary>
                          <div className="taskQueueEvents">{task.events.slice(-3).reverse().map((event, index) => <div key={`${event.occurred_at}-${index}`} className={event.level === "error" ? "error" : ""}><time>{formatHistoryTime(event.occurred_at)}</time><strong>{taskEventStageLabel(event.stage)}</strong><span>{event.message}</span></div>)}</div>
                        </details>
                      )}
                      <div className="taskQueueActions">
                        {(task.results?.length ?? 0) > 0 && <button type="button" className="taskQueueLink" onClick={() => { setTaskCenterOpen(false); openAudioLibrary(task.results?.[0]?.id ?? null); }}>查看成果 <ChevronRight size={14} strokeWidth={1.9} /></button>}
                        <button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void copyTaskDiagnostics(task)}><Copy size={15} strokeWidth={1.9} /><span>复制诊断</span></button>
                        {task.log_file && <button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void openTaskLog(task)}><FileText size={15} strokeWidth={1.9} /><span>打开日志</span></button>}
                        {task.cancelable && <button type="button" className="pathPickButton runtimeStopButton" disabled={taskCenterAction !== null} onClick={() => void onCancelTask(task)}>{isCancelling ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}<span>{isCancelling ? "取消中" : "取消"}</span></button>}
                        {task.retryable && <button type="button" className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void onRetryTask(task)}>{isRetrying ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}<span>{isRetrying ? `${retryLabel}中` : retryLabel}</span></button>}
                        {canClearMissing && <button type="button" className="pathPickButton taskQueueMissingAction" title={`清理 ${missingResultCount} 条缺失记录`} disabled={taskCenterAction !== null} onClick={() => void onClearMissingTaskRecords(task)}>{isClearingMissing ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}<span>{isClearingMissing ? "清理中" : "清理缺失"}</span></button>}
                      </div>
                    </article>
                  );
                })
              )}
              <span className={isPlaying ? "playerPulseBars active" : "playerPulseBars"} aria-label={isPlaying ? "正在播放" : "已暂停"}>
                <i /><i /><i />
              </span>
            </div>
            <footer className="taskCenterDrawerFooter"><button type="button" className="secondaryAction settingsAction" disabled={taskCenterAction !== null || clearableSpeechTaskCount === 0} onClick={() => { setTaskCenterError(null); setTaskCenterMessage(null); setTaskHistoryClearConfirmOpen(true); }}><Trash2 size={15} strokeWidth={1.9} /><span>清理已结束记录</span></button><button type="button" className="secondaryAction settingsAction" disabled={taskCenterAction !== null || retryableManageTaskCount === 0} onClick={() => void onRetryAllManageableTasks()}>{taskCenterAction === "retry-all" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}<span>{retryableManageTaskCount > 0 ? `批量重试 ${retryableManageTaskCount} 项` : "批量重试"}</span></button><span /><button type="button" className="secondaryAction settingsAction" onClick={() => { setTaskCenterOpen(false); openAudioLibrary(); }}><Library size={15} strokeWidth={1.9} /><span>成果中心</span></button><button type="button" className="primaryAction settingsAction" onClick={() => setTaskCenterOpen(false)}><X size={15} strokeWidth={1.9} /><span>关闭</span></button></footer>
          </aside>
        </div>
      )}

      {realtimeEntryConfirmOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="进入实时语音模式">
          <section className="settingsDialog modelSwitchDialog realtimeEntryDialog">
            <header className="settingsHeader">
              <div>
                <strong>进入实时语音模式</strong>
                <span>需要接管本机 GPU 运行时</span>
              </div>
              <button type="button" className="modalClose" title="暂不进入" aria-label="暂不进入" onClick={() => setRealtimeEntryConfirmOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="settingsBody modelSwitchBody">
              <div className="modelSwitchWarning">
                <AlertCircle size={20} strokeWidth={1.9} />
                <div>
                  <strong>实时对话将临时接管显存</strong>
                  <span>确认后会安全停止当前由 OpenTTS 托管的本地 TTS 运行时，释放显存后预热 Whispera 流式 VoxCPM2、SenseVoice 和 CUDA 图。</span>
                </div>
              </div>
              <p className="modelSwitchNote">预热期间不能使用普通本地生成；云端豆包不受影响。离开实时页面后，实时运行时会自动释放，不会在只是浏览页面时提前预热。</p>
            </div>
            <footer className="settingsFooter">
              <button type="button" className="secondaryAction settingsAction" onClick={() => setRealtimeEntryConfirmOpen(false)}>
                <span>暂不进入</span>
              </button>
              <button type="button" className="primaryAction settingsAction" onClick={confirmRealtimeWorkspace}>
                <Radio size={16} strokeWidth={1.9} />
                <span>确认并预热</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {pendingModelSwitch && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="确认切换模型">
          <section className="settingsDialog modelSwitchDialog">
            <header className="settingsHeader">
              <div>
                <strong>确认切换模型</strong>
                <span>显存与模型加载管理</span>
              </div>
              <button type="button" className="modalClose" title="取消" aria-label="取消模型切换" onClick={() => setPendingModelSwitch(null)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="settingsBody modelSwitchBody">
              <div className={pendingSwitchLoadedModels.length > 0 ? "modelSwitchWarning" : "modelSwitchWarning neutral"}>
                {pendingSwitchLoadedModels.length > 0 ? <AlertCircle size={20} strokeWidth={1.9} /> : <Info size={20} strokeWidth={1.9} />}
                <div>
                  <strong>
                    {pendingSwitchIsCloud
                      ? `切换到 ${pendingSwitchTarget?.display_name ?? "豆包 Web TTS"}`
                      : pendingSwitchLoadedModels.length > 0
                        ? `${pendingSwitchLoadedModels.join("、")} 仍在显存中`
                        : `准备切换到 ${pendingSwitchTarget?.display_name ?? pendingModelSwitch.targetModelId}`}
                  </strong>
                  <span>
                    {pendingSwitchIsCloud
                      ? "云端模型不会加载或释放本地 TTS 显存；本机模型会按当前空闲策略继续保留或自动释放。"
                      : pendingSwitchLoadedModels.length > 0
                        ? `确认后会释放这些由 OpenTTS 托管的模型，再预热 ${pendingSwitchTarget?.display_name ?? pendingModelSwitch.targetModelId}。`
                        : `确认后会预热 ${pendingSwitchTarget?.display_name ?? pendingModelSwitch.targetModelId}；若后台检测到其他本软件托管模型，仍会先安全释放。`}
                  </span>
                </div>
              </div>
              {!pendingSwitchIsCloud && <p className="modelSwitchNote">预热期间无法再次切换；完成后即可直接生成。之后切回其他本地模型时也会按相同规则确认。</p>}
            </div>
            <footer className="settingsFooter">
              <button type="button" className="secondaryAction settingsAction" onClick={() => setPendingModelSwitch(null)}>
                <span>保留当前模型</span>
              </button>
              <button type="button" className="primaryAction settingsAction" onClick={confirmModelSwitch}>
                <Cpu size={16} strokeWidth={1.9} />
                <span>确认切换</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {samplerOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="B 站取样">
          <section className="settingsDialog samplerDialog">
            <header className="settingsHeader">
              <div>
                <strong>B 站取样</strong>
                <span>{samplerBridgeAvailable ? samplerStageLabel(samplerState.taskStage) : "桌面桥接未接入"}</span>
              </div>
              <button
                type="button"
                className="modalClose"
                title={samplerExtracting ? "取消取样" : "关闭"}
                aria-label={samplerExtracting ? "取消取样" : "关闭"}
                disabled={samplerBusy && !samplerExtracting}
                onClick={() => void onSamplerCancel()}
              >
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody samplerBody">
              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <LogIn size={16} strokeWidth={1.9} />
                  <span>B 站登录</span>
                </div>
                <div className="samplerLoginRow">
                  <div className="samplerAccount">
                    <span className="samplerAccountAvatar">
                      {samplerState.loginSession.avatarUrl ? (
                        <img src={samplerState.loginSession.avatarUrl} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <LogIn size={17} strokeWidth={1.9} />
                      )}
                    </span>
                    <div>
                      <strong>{samplerState.loginSession.isLoggedIn ? samplerState.loginSession.nickname ?? "已登录" : "未登录"}</strong>
                      <span>
                        {samplerState.loginSession.expiresAt
                          ? `有效期：${new Date(samplerState.loginSession.expiresAt).toLocaleString()}`
                          : "公开视频可直接解析，受限内容请先登录"}
                      </span>
                    </div>
                  </div>
                  <div className="samplerLoginActions">
                    {samplerState.loginSession.isLoggedIn ? (
                      <button type="button" className="pathPickButton" disabled={samplerBusy} onClick={() => void onSamplerLogout()}>
                        {samplerPendingAction === "logout" ? <Loader2 className="spin" size={15} /> : <LogOut size={15} strokeWidth={1.9} />}
                        <span>退出</span>
                      </button>
                    ) : (
                      <button type="button" className="pathPickButton" disabled={samplerBusy} onClick={() => void onSamplerStartLogin()}>
                        {samplerPendingAction === "login" ? <Loader2 className="spin" size={15} /> : samplerQrPayload ? <RefreshCw size={15} strokeWidth={1.9} /> : <LogIn size={15} strokeWidth={1.9} />}
                        <span>{samplerQrPayload ? "刷新二维码" : "扫码登录"}</span>
                      </button>
                    )}
                  </div>
                </div>
                {samplerQrPayload && !samplerState.loginSession.isLoggedIn && (
                  <div className="samplerQrPanel">
                    <div className="samplerQrBox">
                      {samplerQrCodeUrl ? <img src={samplerQrCodeUrl} alt="B 站登录二维码" /> : <Loader2 className="spin" size={20} />}
                    </div>
                    <span>扫码并在手机确认，软件会自动完成登录。</span>
                  </div>
                )}
              </div>

              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <Link2 size={16} strokeWidth={1.9} />
                  <span>视频链接</span>
                </div>
                <div className="samplerLinkRow">
                  <input
                    value={samplerLink}
                    placeholder="https://www.bilibili.com/video/BV..."
                    onChange={(event) => setSamplerLink(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void onSamplerParseLink();
                      }
                    }}
                  />
                  <button type="button" className="pathPickButton" disabled={samplerBusy || !samplerLink.trim()} onClick={() => void onSamplerParseLink()}>
                    {samplerPendingAction === "parse" || samplerState.taskStage === "parsing" ? <Loader2 className="spin" size={15} /> : <Link2 size={15} strokeWidth={1.9} />}
                    <span>解析</span>
                  </button>
                </div>
              </div>

              {samplerState.parsedLink && (
                <div className="settingsGroup samplerPreview">
                  <div className="samplerPreviewHeader">
                    {samplerState.parsedLink.coverUrl ? (
                      <img className="samplerCover" src={samplerState.parsedLink.coverUrl} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="samplerCover samplerCoverPlaceholder">
                        <Link2 size={22} strokeWidth={1.8} />
                      </div>
                    )}
                    <div className="samplerMeta">
                      <strong>{samplerState.parsedLink.title ?? "B 站视频"}</strong>
                      <span>{samplerKindLabel(samplerState.parsedLink.kind)} · {formatSamplerItemMeta(samplerSelectedItem)}</span>
                      <span>{samplerSelectedItem?.title ?? "请选择条目"}</span>
                    </div>
                  </div>

                  <label className="settingsField samplerField">
                    <span>条目</span>
                    <select
                      value={samplerState.selection.itemId ?? samplerState.parsedLink.selectedItemId}
                      disabled={samplerBusy}
                      onChange={(event) => void onSamplerSelectItem(event.target.value)}
                    >
                      {samplerState.parsedLink.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {formatSamplerItemMeta(item)} · {item.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  {samplerMediaOptions?.selectedVideo && samplerMediaOptions.qnOptions.length > 0 && (
                    <label className="settingsField samplerField">
                      <span>视频清晰度</span>
                      <select
                        value={samplerMediaOptions.selectedVideo.qn}
                        disabled={samplerBusy}
                        onChange={(event) => void onSamplerSelectVideoQuality(Number(event.target.value))}
                      >
                        {samplerMediaOptions.qnOptions.map((option) => (
                          <option key={option.qn} value={option.qn}>
                            {option.label}{option.selected ? "（当前）" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {samplerState.audioOptionSummary && (
                    <div className={samplerState.audioOptionSummary.hasAudio ? "samplerAudioStatus ready" : "samplerAudioStatus warning"}>
                      {samplerState.audioOptionSummary.hasAudio ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <AlertCircle size={16} strokeWidth={1.9} />}
                      <span>{samplerState.audioOptionSummary.hasAudio ? "音频流可用" : samplerState.audioOptionSummary.disabledReason ?? "没有可用音频流"}</span>
                    </div>
                  )}

                  {samplerState.audioOptionSummary && (
                    <div className={samplerState.audioOptionSummary.hasVideo ? "samplerAudioStatus ready" : "samplerAudioStatus warning"}>
                      {samplerState.audioOptionSummary.hasVideo ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <AlertCircle size={16} strokeWidth={1.9} />}
                      <span>
                        {samplerState.audioOptionSummary.hasVideo
                          ? `视频流可用：${samplerMediaOptions?.selectedVideo ? formatSamplerVideoQuality(samplerMediaOptions.selectedVideo) : "可下载 MP4"}${samplerMediaOptions?.selectedVideo?.fellBack ? "（已按可用清晰度回退）" : ""}`
                          : samplerState.audioOptionSummary.videoDisabledReason ?? "没有可用视频流"}
                      </span>
                    </div>
                  )}

                  {samplerExtracting && (
                    <section className={`samplerDownloadProgress${samplerState.downloadProgress?.percent === null ? " indeterminate" : ""}`} aria-live="polite">
                      <div className="samplerDownloadProgressHeading">
                        <span>
                          <strong>{samplerStageLabel(samplerState.taskStage)}</strong>
                          <small>{samplerState.downloadProgress?.totalBytes ? `${formatSamplerTransferBytes(samplerState.downloadProgress.receivedBytes)} / ${formatSamplerTransferBytes(samplerState.downloadProgress.totalBytes)}` : "CDN 未提供总大小，仍在持续下载"}</small>
                        </span>
                        <strong>{samplerState.downloadProgress?.percent === null || samplerState.downloadProgress?.percent === undefined ? "进行中" : `${samplerState.downloadProgress.percent}%`}</strong>
                      </div>
                      <div className="samplerDownloadProgressTrack" role="progressbar" aria-label="B 站下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={samplerState.downloadProgress?.percent ?? undefined}>
                        <span style={{ width: `${samplerState.downloadProgress?.percent ?? 100}%` }} />
                      </div>
                      <small className="samplerDownloadProgressMeta">{formatSamplerTransferRate(samplerState.downloadProgress?.bytesPerSecond)}{samplerState.taskStage === "merging" ? " · 正在封装音视频" : ""}</small>
                    </section>
                  )}

                  {samplerVideoPreview && (
                    <section ref={samplerVideoPreviewPanelRef} className="samplerVideoPreview" aria-label="已下载视频预览">
                      <div className="samplerVideoPreviewHeading">
                        <div>
                          <strong>已下载视频</strong>
                          <span>{samplerVideoPreview.videoQuality ? formatSamplerVideoQuality(samplerVideoPreview.videoQuality) : "MP4"}</span>
                        </div>
                        <span className="samplerVideoPreviewTag">本地预览</span>
                      </div>
                      <div className="samplerVideoStage">
                        {samplerVideoPreview.previewUrl ? (
                          <video
                            ref={samplerVideoPreviewRef}
                            controls
                            preload="metadata"
                            src={samplerVideoPreview.previewUrl}
                            onLoadedMetadata={(event) => onSamplerVideoMetadataLoaded(event.currentTarget.duration)}
                            onTimeUpdate={(event) => setSamplerVideoCurrentTime(event.currentTarget.currentTime)}
                            onError={() => setSamplerVideoPreviewError("视频无法在软件内解码；文件已保存，可用“打开文件”交给系统播放器。")}
                          />
                        ) : (
                          <div className="samplerVideoUnavailable">当前运行时未提供本地视频预览。</div>
                        )}
                      </div>
                      <section className="samplerClipEditor" aria-label="音频波形选区">
                        <div className="samplerClipEditorHeading">
                          <div>
                            <strong>音频波形选区</strong>
                            <span>拖动两端绿线调整范围；拖动选区可整体平移，点击波形即可定位试听</span>
                          </div>
                          <span className="samplerClipSelectionLength">
                            {samplerVideoDuration > 0 ? `选中 ${formatSamplerClipSeconds(samplerSelectionEndSeconds - samplerSelectionStartSeconds)} 秒` : "读取时长中"}
                          </span>
                        </div>
                        <AudioWaveform
                          className="samplerClipWaveform"
                          peaks={samplerVideoWaveformPeaks}
                          status={samplerVideoWaveformStatus}
                          theme={theme}
                          progressRatio={samplerVideoDuration > 0 ? samplerVideoCurrentTime / samplerVideoDuration : 0}
                          selectionStartRatio={samplerVideoDuration > 0 ? samplerSelectionStartSeconds / samplerVideoDuration : 0}
                          selectionEndRatio={samplerVideoDuration > 0 ? samplerSelectionEndSeconds / samplerVideoDuration : 1}
                          editableSelection={samplerVideoDuration > 0}
                          onSeekRatio={seekSamplerVideoPreview}
                          onSelectionChange={updateSamplerVideoSelection}
                          onSelectionMove={moveSamplerVideoSelection}
                          ariaLabel="B 站视频真实音频波形；拖动两端调整范围，拖动选区整体移动，点击波形定位并试听"
                        />
                        {samplerVideoDuration > 0 && (
                          <div className="samplerClipRangeReadout" aria-live="polite">
                            <span>{formatSamplerClipSeconds(samplerSelectionStartSeconds)} 秒</span>
                            <span>至</span>
                            <span>{formatSamplerClipSeconds(samplerSelectionEndSeconds)} 秒</span>
                            <span>／视频总长 {formatSamplerClipSeconds(samplerVideoDuration)} 秒</span>
                          </div>
                        )}
                      </section>
                      <div className="samplerVideoPreviewFooter">
                        <span title={samplerVideoPreview.videoPath}>{samplerVideoPreview.itemTitle ?? samplerVideoPreview.title ?? "B 站视频"}</span>
                        <div>
                          <button className="samplerVideoPreviewAction" type="button" onClick={() => void onSamplerOpenDownloadedVideo()}>
                            <Play size={14} strokeWidth={1.9} />
                            <span>打开文件</span>
                          </button>
                          <button className="samplerVideoPreviewAction" type="button" onClick={() => void onSamplerRevealDownloadedVideo()}>
                            <FolderOpen size={14} strokeWidth={1.9} />
                            <span>文件位置</span>
                          </button>
                        </div>
                      </div>
                      {samplerVideoPreviewError && <p className="samplerVideoPreviewError">{samplerVideoPreviewError}</p>}
                    </section>
                  )}

                  <div className="samplerClipFineTune">
                    {samplerVideoPreview && <p>精确微调（秒）</p>}
                    <div className="samplerClipGrid">
                      <label className="settingsField samplerField">
                        <span>开始秒</span>
                        <input
                          type="number"
                          min={0}
                          max={samplerVideoDuration > 0 ? Math.max(0, samplerSelectionEndSeconds - SAMPLER_MIN_CLIP_SECONDS) : undefined}
                          step="0.1"
                          value={samplerStartSeconds}
                          placeholder="留空"
                          onChange={(event) => setSamplerStartSeconds(event.target.value)}
                        />
                      </label>
                      <label className="settingsField samplerField">
                        <span>结束秒</span>
                        <input
                          type="number"
                          min={samplerVideoDuration > 0 ? Math.min(samplerVideoDuration, samplerSelectionStartSeconds + SAMPLER_MIN_CLIP_SECONDS) : 0}
                          max={samplerVideoDuration > 0 ? samplerVideoDuration : undefined}
                          step="0.1"
                          value={samplerEndSeconds}
                          placeholder="留空"
                          onChange={(event) => setSamplerEndSeconds(event.target.value)}
                        />
                      </label>
                    </div>
                  </div>

                  <label className="settingsField samplerField">
                    <span>音色名称</span>
                    <input value={samplerName} maxLength={120} onChange={(event) => setSamplerName(event.target.value)} />
                  </label>

                  <label className="modelProfileField samplerTextField">
                    <span>参考文本</span>
                    <textarea
                      value={samplerReferenceText}
                      maxLength={1000}
                      rows={3}
                      placeholder="可选，用于极致克隆或后续标注"
                      onChange={(event) => setSamplerReferenceText(event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>

            {samplerFeedback && (
              <div role={samplerFeedbackIsError ? "alert" : "status"} aria-live={samplerFeedbackIsError ? "assertive" : "polite"} className={samplerFeedbackIsError ? "settingsFeedback error" : "settingsFeedback"}>
                {samplerFeedbackIsError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{samplerFeedback}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button
                type="button"
                className="secondaryAction settingsAction"
                disabled={samplerBusy && !samplerExtracting}
                onClick={() => void onSamplerCancel()}
              >
                {samplerPendingAction === "cancel-extract" ? <Loader2 className="spin" size={16} /> : <X size={16} strokeWidth={1.9} />}
                <span>{samplerExtracting ? "取消任务" : "关闭"}</span>
              </button>
              <button type="button" className="secondaryAction settingsAction" disabled={!samplerCanDownloadVideo} onClick={() => void onSamplerDownloadVideo()}>
                {samplerPendingAction === "download-video" ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                <span>{samplerPendingAction === "download-video" ? "下载中" : "下载 MP4"}</span>
              </button>
              <button type="button" className="primaryAction settingsAction" disabled={!samplerCanExtract} onClick={() => void onSamplerExtractAndSave()}>
                {samplerPendingAction === "extract" ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                <span>{samplerPendingAction === "extract" ? "取样中" : "取样入库"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="设置中心">
          <section className="settingsDialog settingsCenterDialog">
            <header className="settingsHeader settingsCenterHeader">
              <div>
                <strong>设置中心</strong>
              </div>
              <button type="button" className="modalClose" title="关闭设置中心" aria-label="关闭设置中心" onClick={() => void closeSettings()}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <section className="settingsOverview" aria-label="设置概览">
              <div className="settingsOverviewItems">
                <button type="button" className={settingsLlmConfigured ? "settingsOverviewItem ready" : "settingsOverviewItem"} aria-controls="settings-global-llm" onClick={() => navigateSettingsSection("common", "#settings-global-llm")}>
                  <span className="settingsOverviewItemIcon"><Sparkles size={16} strokeWidth={1.9} /></span>
                  <span className="settingsOverviewItemCopy"><small>全局 LLM</small><strong>{settingsLlmConfigured ? "已配置" : "未配置"}</strong><em>{globalLlmSettings.model || "填写模型名"}</em></span>
                  <ChevronRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button type="button" className="settingsOverviewItem ready" aria-controls="settings-generation-preferences" onClick={() => navigateSettingsSection("common", "#settings-generation-preferences")}>
                  <span className="settingsOverviewItemIcon"><Cpu size={16} strokeWidth={1.9} /></span>
                  <span className="settingsOverviewItemCopy"><small>默认 TTS</small><strong>{settingsDefaultModelName}</strong><em>{settingsDraft.prewarm_default_model_on_startup ? "启动时预热" : "按需加载"}</em></span>
                  <ChevronRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button type="button" className={settingsStorageConfigured ? "settingsOverviewItem ready" : "settingsOverviewItem"} aria-controls="settings-managed-storage" onClick={() => navigateSettingsSection("assets", "#settings-managed-storage")}>
                  <span className="settingsOverviewItemIcon"><FolderOpen size={16} strokeWidth={1.9} /></span>
                  <span className="settingsOverviewItemCopy"><small>统一资源库</small><strong>{settingsStorageConfigured ? "目录已连接" : "正在读取"}</strong><em>{settingsStorageConfigured ? "模型与成品集中管理" : "检查资源目录"}</em></span>
                  <ChevronRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
                <button type="button" className={online ? "settingsOverviewItem ready" : "settingsOverviewItem"} aria-controls="settings-api-service" onClick={() => navigateSettingsSection("system", "#settings-api-service")}>
                  <span className="settingsOverviewItemIcon"><Server size={16} strokeWidth={1.9} /></span>
                  <span className="settingsOverviewItemCopy"><small>本地服务</small><strong>{online ? "运行正常" : "等待后端"}</strong><em>{apiBaseLabel}</em></span>
                  <ChevronRight size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>
            </section>

            <nav className="settingsSections" aria-label="设置分组">
              {([
                ["common", "常用"],
                ["assets", "模型"],
                ["system", "系统"]
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={settingsSection === id ? "settingsSectionTab active" : "settingsSectionTab"}
                  aria-current={settingsSection === id ? "page" : undefined}
                  onClick={() => navigateSettingsSection(id)}
                >
                  <strong>{label}</strong>
                </button>
              ))}
            </nav>

            <div ref={settingsBodyRef} className="settingsBody" data-section={settingsSection}>
              <div className="settingsGroup appearanceSettingsGroup" data-settings-section="system">
                <div className="settingsGroupTitle">
                  <Palette size={16} strokeWidth={1.9} />
                  <span>界面外观</span>
                  <em>{theme === "dark" ? "夜间材质" : "日间材质"}</em>
                </div>
                <div className="accentThemeHeading">
                  <div>
                    <strong>强调色</strong>
                    <span>主操作、选中态、进度和已就绪提示会跟随此处统一切换。</span>
                  </div>
                  <span className="accentThemeCurrent" aria-live="polite">
                    {accentThemeOptions.find((option) => option.id === accentTheme)?.label}
                  </span>
                </div>
                <div className="accentThemeOptions" role="radiogroup" aria-label="选择强调色">
                  {accentThemeOptions.map((option) => {
                    const selected = option.id === accentTheme;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={selected ? "accentThemeOption active" : "accentThemeOption"}
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setAccentTheme(option.id)}
                      >
                        <span className="accentThemeSwatch" style={{ "--accent-option": option.preview } as CSSProperties} aria-hidden="true" />
                        <span className="accentThemeOptionCopy">
                          <strong>{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                        <CheckCircle2 className="accentThemeCheck" size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settingsGroup appUpdateGroup" data-settings-section="system">
                <div className="settingsGroupTitle">
                  <RefreshCw size={16} strokeWidth={1.9} />
                  <span>应用更新</span>
                  <em>GitHub 发布版</em>
                </div>
                <div className="appUpdateCard">
                  <div className="appUpdateSummary">
                    <div>
                      <strong>当前版本 {appUpdate?.currentVersion ?? "本地预览"}</strong>
                      <span className={appUpdate?.status === "error" ? "updateStatus error" : "updateStatus"}>
                        {appUpdate?.message ?? "正式安装包会从 GitHub 检查更新。"}
                      </span>
                    </div>
                    {appUpdate?.availableVersion && <span className="updateVersionBadge">v{appUpdate.availableVersion}</span>}
                  </div>
                  {appUpdate?.status === "downloading" && (
                    <div className="appUpdateProgress" aria-label="更新下载进度">
                      <span style={{ width: `${appUpdate.progressPercent ?? 0}%` }} />
                    </div>
                  )}
                  {appUpdate?.releaseNotes && <p className="appUpdateNotes">{appUpdate.releaseNotes}</p>}
                  <div className="appUpdateActions">
                    <button
                      className="secondaryAction settingsAction"
                      type="button"
                      disabled={!window.desktopUpdater || appUpdate?.status === "checking" || appUpdate?.status === "downloading" || appUpdate?.status === "installing"}
                      onClick={() => void onCheckAppUpdate()}
                    >
                      {appUpdate?.status === "checking" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} strokeWidth={1.9} />}
                      <span>检查更新</span>
                    </button>
                    {appUpdate?.status === "available" && (
                      <button className="primaryAction settingsAction" type="button" onClick={() => void onDownloadAppUpdate()}>
                        <Download size={16} strokeWidth={1.9} />
                        <span>下载更新</span>
                      </button>
                    )}
                    {appUpdate?.status === "downloading" && (
                      <button className="primaryAction settingsAction" type="button" disabled>
                        <Loader2 className="spin" size={16} />
                        <span>下载 {appUpdate.progressPercent ?? 0}%</span>
                      </button>
                    )}
                    {appUpdate?.status === "downloaded" && (
                      <button className="primaryAction settingsAction" type="button" onClick={() => void onInstallAppUpdate()}>
                        <RefreshCw size={16} strokeWidth={1.9} />
                        <span>重启并安装</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <details id="settings-generation-preferences" className="settingsGroup generationSettingsGroup" data-settings-section="common" data-settings-sections="common assets">
                <summary className="settingsGroupTitle settingsGroupSummary">
                  <Cpu size={16} strokeWidth={1.9} />
                  <span>生成偏好</span>
                  <em>{settingsDefaultModelName} · {settingsDraft.prewarm_default_model_on_startup ? "启动预热" : "按需加载"}</em>
                  <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
                </summary>
                <div className="startupModelSettings">
                  <label className="settingsField">
                    <span>启动默认模型</span>
                    <select
                      value={settingsDraft.default_model_id}
                      onChange={(event) => {
                        const modelId = event.target.value as SettingsDraft["default_model_id"];
                        setSettingsDraft((draft) => ({
                          ...draft,
                          default_model_id: modelId,
                          prewarm_default_model_on_startup: draft.prewarm_default_model_on_startup
                        }));
                      }}
                    >
                      {startupModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="startupPrewarmCard">
                    <div>
                      <strong>打开软件时预热默认模型</strong>
                      <span>后台加载本地模型权重，不会自动生成语音；会占用对应显存，并先处理其他本软件托管模型。</span>
                    </div>
                    <button
                      type="button"
                      className={settingsDraft.prewarm_default_model_on_startup ? "settingsPrewarmToggle active" : "settingsPrewarmToggle"}
                      aria-pressed={settingsDraft.prewarm_default_model_on_startup}
                      onClick={() =>
                        setSettingsDraft((draft) => ({
                          ...draft,
                          prewarm_default_model_on_startup: !draft.prewarm_default_model_on_startup
                        }))
                      }
                    >
                      <Cpu size={16} strokeWidth={1.9} />
                      <span>{settingsDraft.prewarm_default_model_on_startup ? "已开启" : "未开启"}</span>
                    </button>
                  </div>
                </div>
                <label className="settingsField settingsIdleTimeout">
                  <span>空闲后释放显存</span>
                  <div className="settingsNumberInput">
                    <input
                      type="number"
                      min={30}
                      max={86400}
                      step={30}
                      value={settingsDraft.indextts2_idle_timeout_seconds}
                      onChange={(event) => {
                        const seconds = Number(event.target.value);
                        setSettingsDraft((draft) => ({
                          ...draft,
                          indextts2_idle_timeout_seconds: seconds,
                          local_api_idle_timeout_seconds: seconds
                        }));
                      }}
                    />
                    <span>秒</span>
                  </div>
                  <small>生成结束后，所有由本软件托管的本地 TTS 模型都按这个时间释放显存。</small>
                </label>
                <label className="settingsField">
                  <span>本地 ASR 引擎</span>
                  <select
                    value={settingsDraft.asr_backend}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        asr_backend: event.target.value as SettingsDraft["asr_backend"]
                      }))
                    }
                  >
                    <option value="sensevoice">SenseVoiceSmall（轻量、快速）</option>
                    <option value="qwen3">Qwen3-ASR 1.7B（更重、适合精度优先）</option>
                  </select>
                  <small>
                    {settingsDraft.asr_backend === "qwen3"
                      ? appSettings?.qwen_asr_model_installed
                        ? "使用已配置的本地 Qwen3-ASR；只用于转写和音色库参考音频，不参与旁白强制对齐。"
                        : "Qwen3-ASR 尚未配置完整本地模型/运行时；保存前请按部署文档配置。"
                      : appSettings?.sensevoice_ready
                        ? "按需启动独立 SenseVoiceSmall；只用于转写和音色库参考音频，不参与旁白强制对齐。"
                        : "SenseVoiceSmall 尚未配置完整本地模型/运行时；保存前请按部署文档配置。"}
                  </small>
                  <small>转写运行模式：{qwenRuntimeLabel(appSettings?.qwen_runtime?.asr)}；旁白逐词对齐：{qwenRuntimeLabel(appSettings?.qwen_runtime?.alignment)}。</small>
                </label>
                <div className="enhancementSettingsSummary">
                  <div>
                    <strong>语音增强（本地）</strong>
                    <span>DeepFilterNet3 与 MossFormer2_SE_48K 会依次运行，不会与 TTS、ASR 同时争抢显存。</span>
                  </div>
                  <span className={appSettings?.audio_enhancement_ready ? "enhancementReadiness ready" : "enhancementReadiness incomplete"}>
                    {appSettings?.audio_enhancement_ready ? "双模型已就绪" : "需要配置"}
                  </span>
                </div>
                <details className="settingsAdvancedDetails settingsInlineDetails">
                  <summary>
                    <span className="settingsAdvancedIcon"><Wand2 size={16} strokeWidth={1.9} /></span>
                    <span className="settingsAdvancedSummary">
                      <strong>运行时与模型目录</strong>
                      <small>默认自动检测；只有排查或迁移时才需要修改</small>
                    </span>
                    <ChevronDown size={16} strokeWidth={2} />
                  </summary>
                <div className="enhancementSettingsGrid">
                  <label className="settingsField enhancementWideField">
                    <span>专用 Python 运行时</span>
                    <div className="settingsPathInput">
                      <input
                        value={settingsDraft.audio_enhancement_python}
                        placeholder="…\\audio-enhancement-runtime\\python.exe"
                        onChange={(event) => setSettingsDraft((draft) => ({ ...draft, audio_enhancement_python: event.target.value }))}
                      />
                      <button className="pathPickButton" type="button" onClick={() => void chooseAudioEnhancementPython()}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>选择</span>
                      </button>
                    </div>
                    <small>{appSettings?.audio_enhancement_runtime_installed ? "运行时文件已找到；仍会在首次执行时检查模型依赖。" : "请选择已安装 PyTorch、DeepFilterNet 与 ClearVoice 的 python.exe。"}</small>
                  </label>
                  <label className="settingsField">
                    <span>处理设备</span>
                    <select
                      value={settingsDraft.audio_enhancement_device}
                      onChange={(event) => setSettingsDraft((draft) => ({
                        ...draft,
                        audio_enhancement_device: event.target.value as SettingsDraft["audio_enhancement_device"]
                      }))}
                    >
                      <option value="auto">自动选择（推荐）</option>
                      <option value="cuda">NVIDIA CUDA</option>
                      <option value="cpu">CPU</option>
                    </select>
                    <small>自动优先使用可用 CUDA；CPU 适合兼容性排查，但处理较慢。</small>
                  </label>
                  <label className="settingsField enhancementWideField">
                    <span>DeepFilterNet3 模型目录</span>
                    <div className="settingsPathInput">
                      <input
                        value={settingsDraft.deepfilternet3_root}
                        onChange={(event) => setSettingsDraft((draft) => ({ ...draft, deepfilternet3_root: event.target.value }))}
                      />
                      <button className="pathPickButton" type="button" onClick={() => void chooseDirectoryForSetting("deepfilternet3_root")}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>选择</span>
                      </button>
                    </div>
                    <small className={appSettings?.deepfilternet3_model_installed ? "settingCheck ready" : "settingCheck"}>{appSettings?.deepfilternet3_model_installed ? "已找到 config.ini 与 checkpoints。" : "目录需要包含 config.ini 与 checkpoints。"}</small>
                  </label>
                  <label className="settingsField enhancementWideField">
                    <span>MossFormer2_SE_48K 权重目录</span>
                    <div className="settingsPathInput">
                      <input
                        value={settingsDraft.mossformer2_se_root}
                        onChange={(event) => setSettingsDraft((draft) => ({ ...draft, mossformer2_se_root: event.target.value }))}
                      />
                      <button className="pathPickButton" type="button" onClick={() => void chooseDirectoryForSetting("mossformer2_se_root")}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>选择</span>
                      </button>
                    </div>
                    <small className={appSettings?.mossformer2_se_model_installed ? "settingCheck ready" : "settingCheck"}>{appSettings?.mossformer2_se_model_installed ? "已找到 last_best_checkpoint 与 .pt 权重。" : "目录需要包含 last_best_checkpoint 与 last_best_checkpoint.pt。"}</small>
                  </label>
                </div>
                </details>
                <div className="enhancementSettingsSummary">
                  <div>
                    <strong>音频分轨（本地）</strong>
                    <span>MDX-Net / MDX23C 会单独占用推理资源，并在开始前检查人声与伴奏两条轨道所需的本地文件。</span>
                  </div>
                  <span className={appSettings?.audio_separation_ready ? "enhancementReadiness ready" : "enhancementReadiness incomplete"}>
                    {appSettings?.audio_separation_ready ? "至少一个模型已就绪" : "需要配置"}
                  </span>
                </div>
                <details className="settingsAdvancedDetails settingsInlineDetails">
                  <summary>
                    <span className="settingsAdvancedIcon"><Waves size={16} strokeWidth={1.9} /></span>
                    <span className="settingsAdvancedSummary">
                      <strong>运行时与模型目录</strong>
                      <small>默认自动检测；只有排查或迁移时才需要修改</small>
                    </span>
                    <ChevronDown size={16} strokeWidth={2} />
                  </summary>
                <div className="enhancementSettingsGrid">
                  <label className="settingsField enhancementWideField">
                    <span>分轨专用 Python 运行时</span>
                    <div className="settingsPathInput">
                      <input
                        value={settingsDraft.audio_separation_python}
                        placeholder="…\\audio-separation-runtime-full\\Scripts\\python.exe"
                        onChange={(event) => setSettingsDraft((draft) => ({ ...draft, audio_separation_python: event.target.value }))}
                      />
                      <button className="pathPickButton" type="button" onClick={() => void chooseAudioSeparationPython()}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>选择</span>
                      </button>
                    </div>
                    <small className={appSettings?.audio_separation_runtime_installed ? "settingCheck ready" : "settingCheck"}>{appSettings?.audio_separation_runtime_installed ? "已找到 Python 运行时。" : "请选择安装了 audio-separator 的 python.exe。"}</small>
                  </label>
                  <label className="settingsField">
                    <span>分轨设备</span>
                    <select value={settingsDraft.audio_separation_device} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, audio_separation_device: event.target.value as SettingsDraft["audio_separation_device"] }))}>
                      <option value="auto">自动选择（推荐）</option>
                      <option value="cuda">NVIDIA CUDA</option>
                      <option value="cpu">CPU</option>
                    </select>
                    <small>自动优先使用 CUDA；CPU 仅用于兼容性排查。</small>
                  </label>
                  <label className="settingsField enhancementWideField">
                    <span>MDX-Net 模型目录</span>
                    <div className="settingsPathInput">
                      <input value={settingsDraft.audio_separation_root} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, audio_separation_root: event.target.value }))} />
                      <button className="pathPickButton" type="button" onClick={() => void chooseDirectoryForSetting("audio_separation_root")}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>选择</span>
                      </button>
                    </div>
                    <small className={appSettings?.audio_separation_ready ? "settingCheck ready" : "settingCheck"}>{appSettings?.audio_separation_ready ? "已检测到可用模型与参数文件。" : "目录需包含权重及 model_data 参数文件。"}</small>
                  </label>
                </div>
                </details>
                <details className="settingsAdvancedDetails modelCenterDetails" data-settings-section="assets">
                  <summary>
                    <span className="settingsAdvancedIcon"><Settings size={16} strokeWidth={1.9} /></span>
                    <span className="settingsAdvancedSummary">
                      <strong>高级维护</strong>
                      <small>模型目录、运行状态和稳定包（{modelInstances.length} 个模型）</small>
                    </span>
                    <ChevronDown size={16} strokeWidth={2} />
                  </summary>
                <div className="modelCenterList">
                  {modelInstances.map((instance) => {
                    const healthResult = modelHealthResults[instance.model_id];
                    const modelInfo = models.find((model) => model.id === instance.model_id);
                    const draft = modelProfileDrafts[instance.model_id] ?? createModelProfileDraft(instance);
                    const profileChanged = modelProfileDraftChanged(instance, draft);
                    const healthHistory = instance.health_history ?? [];
                    const runtimeWorker = getWorkerStatusForModel(systemStatus, instance.model_id);
                    const runtimeControllable = isRuntimeControllable(instance.model_id);
                    const runtimeActionPending = runtimeActionModelId === instance.model_id;
                    return (
                      <div key={instance.model_id} className="modelCenterCard">
                        <div className="modelCenterHeader">
                          <div>
                            <strong>{instance.display_name}</strong>
                            <span>{runtimeTypeLabel(instance.runtime_type)}</span>
                          </div>
                          <span className={`modelState ${instance.status}`}>{modelInstanceStatusLabel(instance.status)}</span>
                        </div>
                        <div className="modelCenterPath">
                          <span>{instance.root_path ?? "未配置目录"}</span>
                        </div>
                        <div className="modelCenterMeta">
                          <span>{instance.enabled ? "已启用" : "已禁用"}</span>
                          <span>{instance.last_success_at ? `成功：${new Date(instance.last_success_at).toLocaleString()}` : "尚无成功记录"}</span>
                        </div>
                        <div className="modelCapabilityRow">
                          <span>{modelInfo ? `${modelInfo.recommended_vram_gb} GB 显存建议` : "显存建议未知"}</span>
                          <span>{modelInfo ? `${modelInfo.native_sample_rate} Hz` : "采样率未知"}</span>
                          <span>{commercialUseLabel(modelInfo)}</span>
                        </div>
                        {modelInfo && (
                          <div className="modelFeatureList">
                            {modelInfo.features.map((feature) => (
                              <span key={feature} className="featureTag">{featureLabel(feature)}</span>
                            ))}
                          </div>
                        )}
                        {runtimeControllable && (
                          <div className="modelRuntimeStatus">
                            <div className="modelRuntimeHeader">
                              <span>运行时</span>
                              <strong className={runtimeWorker?.loaded ? "ready" : ""}>{workerBadgeText(runtimeWorker, instance.model_id)}</strong>
                            </div>
                            <div className="modelRuntimeMeta">
                              <span>{workerReleaseText(runtimeWorker, instance.model_id)}</span>
                              {runtimeWorker?.managed && <span>本软件托管</span>}
                            </div>
                            <p>{workerDetailText(runtimeWorker, instance.model_id)}</p>
                            {runtimeWorker?.api_base && <code>{runtimeWorker.api_base}</code>}
                          </div>
                        )}
                        <div className="modelProfileGrid">
                          <label className="modelProfileField">
                            <span>稳定包标记</span>
                            <input
                              value={draft.package_label}
                              maxLength={120}
                              placeholder="例如 v2pro 20250604"
                              onChange={(event) => updateModelProfileDraft(instance.model_id, { package_label: event.target.value })}
                            />
                          </label>
                          <label className="modelProfileField wide">
                            <span>维护备注</span>
                            <textarea
                              value={draft.user_note}
                              maxLength={500}
                              rows={2}
                              placeholder="例如：当前稳定包，先不要替换。"
                              onChange={(event) => updateModelProfileDraft(instance.model_id, { user_note: event.target.value })}
                            />
                          </label>
                        </div>
                        {(healthResult?.repair_hint || instance.last_error) && (
                          <div className="modelRepairHint">{healthResult?.repair_hint ?? instance.last_error}</div>
                        )}
                        {healthResult && healthResult.checks.length > 0 && (
                          <div className="modelCheckList">
                            {healthResult.checks.map((check) => (
                              <span key={check.id} className={check.passed ? "checkItem passed" : "checkItem failed"}>
                                {check.label}
                              </span>
                            ))}
                          </div>
                        )}
                        {healthHistory.length > 0 && (
                          <div className="modelHistoryList">
                            {healthHistory.slice(0, 3).map((entry, index) => (
                              <div key={`${entry.checked_at}-${index}`} className={`modelHistoryItem ${entry.status}`}>
                                <span>{formatHistoryTime(entry.checked_at)}</span>
                                <strong>{modelInstanceStatusLabel(entry.status)}</strong>
                                <em>
                                  {entry.failed_check_ids.length > 0
                                    ? `失败项：${entry.failed_check_ids.join("、")}`
                                    : "检查通过"}
                                </em>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="modelCenterActions">
                          <button type="button" className="pathPickButton" onClick={() => void onCheckModelInstance(instance)} disabled={checkingModelId === instance.model_id}>
                            {checkingModelId === instance.model_id ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} strokeWidth={1.9} />}
                            <span>检查</span>
                          </button>
                          {runtimeControllable && (
                            <button
                              type="button"
                              className="pathPickButton"
                              title="仅在点击后启动本地模型或 API；为避免显存叠加，会先释放其他由本软件托管的模型。"
                              onClick={() => void onStartModelRuntime(instance)}
                              disabled={!instance.enabled || runtimeActionPending || Boolean(runtimeWorker?.loaded) || runtimeWorker?.state === "starting"}
                            >
                              {runtimeActionPending ? <Loader2 className="spin" size={15} /> : <Play size={15} strokeWidth={1.9} />}
                              <span>{instance.model_id === "indextts2" ? "预热模型" : "启动服务"}</span>
                            </button>
                          )}
                          {runtimeControllable && (
                            <button
                              type="button"
                              className="pathPickButton runtimeStopButton"
                              title={runtimeWorker?.managed ? "停止本软件托管的运行时并释放显存。" : "外部服务不会被本软件停止。"}
                              onClick={() => void onStopModelRuntime(instance)}
                              disabled={runtimeActionPending || !runtimeWorker?.can_stop}
                            >
                              {runtimeActionPending ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}
                              <span>{instance.model_id === "indextts2" ? "释放显存" : "停止服务"}</span>
                            </button>
                          )}
                          <button type="button" className="pathPickButton" onClick={() => void chooseModelInstanceDirectory(instance)}>
                            <FolderOpen size={15} strokeWidth={1.9} />
                            <span>选择目录</span>
                          </button>
                          <button
                            type="button"
                            className="pathPickButton"
                            onClick={() =>
                              void openModelDirectory({
                                id: instance.model_id,
                                display_name: instance.display_name,
                                path: instance.root_path ?? "",
                                exists: Boolean(instance.root_path),
                                kind: "model_root"
                              })
                            }
                            disabled={!instance.root_path}
                          >
                            <FolderOpen size={15} strokeWidth={1.9} />
                            <span>打开</span>
                          </button>
                          <button type="button" className="pathPickButton" onClick={() => void onToggleModelInstance(instance)}>
                            <ShieldCheck size={15} strokeWidth={1.9} />
                            <span>{instance.enabled ? "禁用" : "启用"}</span>
                          </button>
                          <button
                            type="button"
                            className="pathPickButton"
                            onClick={() => void onSaveModelProfile(instance)}
                            disabled={!profileChanged || savingProfileModelId === instance.model_id}
                          >
                            {savingProfileModelId === instance.model_id ? <Loader2 className="spin" size={15} /> : <Save size={15} strokeWidth={1.9} />}
                            <span>保存档案</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                </details>
              </details>

              <details className="settingsAdvancedDetails modelAssetsDetails" data-settings-section="assets">
                <summary>
                  <span className="settingsAdvancedIcon"><Library size={16} strokeWidth={1.9} /></span>
                  <span className="settingsAdvancedSummary">
                    <strong>模型包与目录</strong>
                    <small>登记、预检或切换稳定模型包（{modelPackages.length} 个已登记）</small>
                  </span>
                  <ChevronDown size={16} strokeWidth={2} />
                </summary>
              <div className="settingsGroup modelPackageGroup">
                <div className="settingsGroupTitle">
                  <Library size={16} strokeWidth={1.9} />
                  <span>模型包资产</span>
                  <em>{modelPackages.length} 个已登记</em>
                </div>
                <p className="modelPackageIntro">
                  登记模型目录或压缩包，先进行只读预检，再将验证通过的目录切换为稳定包；此处不会加载权重或占用显存。
                </p>
                <div className="modelPackageComposer">
                  <label className="settingsField">
                    <span>目标模型</span>
                    <select value={modelPackageModelId} onChange={(event) => setModelPackageModelId(event.target.value)}>
                      {modelInstances.map((instance) => <option key={instance.model_id} value={instance.model_id}>{instance.display_name}</option>)}
                    </select>
                  </label>
                  <label className="settingsField">
                    <span>版本标记</span>
                    <input value={modelPackageLabel} maxLength={120} placeholder="例如 v2pro 20250604" onChange={(event) => setModelPackageLabel(event.target.value)} />
                  </label>
                  <label className="settingsField modelPackageNoteField">
                    <span>维护备注</span>
                    <input value={modelPackageNote} maxLength={500} placeholder="可选：来源、版本或待验证事项" onChange={(event) => setModelPackageNote(event.target.value)} />
                  </label>
                </div>
                <div className="modelPackageRegisterActions">
                  <button type="button" className="secondaryAction settingsAction" disabled={modelPackageAction !== null || modelInstances.length === 0} onClick={() => void onRegisterModelPackage("directory")}>
                    {modelPackageAction === "register-directory" ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} strokeWidth={1.9} />}
                    <span>{modelPackageAction === "register-directory" ? "登记中" : "登记目录包"}</span>
                  </button>
                  <button type="button" className="secondaryAction settingsAction" disabled={modelPackageAction !== null || modelInstances.length === 0} onClick={() => void onRegisterModelPackage("archive")}>
                    {modelPackageAction === "register-archive" ? <Loader2 className="spin" size={16} /> : <Upload size={16} strokeWidth={1.9} />}
                    <span>{modelPackageAction === "register-archive" ? "登记中" : "登记压缩包"}</span>
                  </button>
                </div>
                {modelPackages.length > 0 && (
                  <div className="modelPackageList">
                    {modelPackages.map((modelPackage) => {
                      const packageModel = modelInstances.find((instance) => instance.model_id === modelPackage.model_id);
                      const actionPending = modelPackageAction?.endsWith(`-${modelPackage.id}`) ?? false;
                      const canActivate = modelPackage.source_kind === "directory" && modelPackage.inspection.ready_for_activation && modelPackage.state !== "stable";
                      return (
                        <div key={modelPackage.id} className={`modelPackageCard ${modelPackage.state}`}>
                          <div className="modelPackageHeader">
                            <div><strong>{packageModel?.display_name ?? modelPackage.model_id}</strong><span>{modelPackage.package_label || "未标记版本"}</span></div>
                            <span className={`modelPackageState ${modelPackage.state}`}>{modelPackageStateLabel(modelPackage.state)}</span>
                          </div>
                          <div className="modelPackagePath"><span>{modelPackage.path}</span></div>
                          <p className="modelPackageSummary">{modelPackage.inspection.summary}</p>
                          {modelPackage.user_note && <p className="modelPackageNote">{modelPackage.user_note}</p>}
                          <div className="modelPackageActions">
                            <button type="button" className="pathPickButton" disabled={modelPackageAction !== null} onClick={() => void onInspectModelPackage(modelPackage)}>
                              {modelPackageAction === `inspect-${modelPackage.id}` ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                              <span>预检</span>
                            </button>
                            <button type="button" className="pathPickButton" disabled={!modelPackage.inspection.exists || modelPackageAction !== null} onClick={() => void openModelDirectory({ id: modelPackage.id, display_name: modelPackage.package_label || packageModel?.display_name || modelPackage.model_id, path: modelPackage.path, exists: modelPackage.inspection.exists, kind: "model_package" })}>
                              <FolderOpen size={15} strokeWidth={1.9} />
                              <span>打开</span>
                            </button>
                            <button type="button" className="pathPickButton modelPackageActivateButton" disabled={!canActivate || modelPackageAction !== null} onClick={() => void onActivateModelPackage(modelPackage)}>
                              {modelPackageAction === `activate-${modelPackage.id}` ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} strokeWidth={1.9} />}
                              <span>启用稳定包</span>
                            </button>
                            <button type="button" className="pathPickButton" disabled={modelPackage.state === "stable" || modelPackageAction !== null || actionPending} onClick={() => void onArchiveModelPackage(modelPackage)}>
                              {modelPackageAction === `archive-${modelPackage.id}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}
                              <span>归档</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </details>

              <div id="settings-global-llm" className="settingsGroup llmSettingsGroup" data-settings-section="common">
                <div className="settingsGroupTitle">
                  <Sparkles size={16} strokeWidth={1.9} />
                  <span>全局 LLM</span>
                  <em>实时语音、配音稿与转写处理共用</em>
                </div>
                <div className="settingsInline">
                  <label className="settingsField">
                    <span>OpenAI 兼容地址</span>
                    <input value={globalLlmSettings.baseUrl} onChange={(event) => setGlobalLlmSettings((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="http://127.0.0.1:11434/v1" />
                  </label>
                  <label className="settingsField">
                    <span>模型名</span>
                    <input value={globalLlmSettings.model} onChange={(event) => setGlobalLlmSettings((current) => ({ ...current, model: event.target.value }))} placeholder="例如 qwen3:4b" />
                  </label>
                </div>
                <label className="settingsField">
                  <span>API Key（可选，本机加密保存）</span>
                  <input type="password" autoComplete="off" value={globalLlmSettings.apiKey} onChange={(event) => setGlobalLlmSettings((current) => ({ ...current, apiKey: event.target.value }))} placeholder="本地 Ollama 可留空" />
                </label>
                <div className="llmSettingsActions">
                  <button type="button" className="secondaryAction settingsAction" onClick={() => void onTestGlobalLlm()} disabled={globalLlmTesting || globalLlmLoading}>
                    {globalLlmTesting ? <Loader2 className="spin" size={16} /> : <Wifi size={16} strokeWidth={1.9} />}
                    <span>{globalLlmTesting ? "测试中" : "测试连接"}</span>
                  </button>
                  <button type="button" className="primaryAction settingsAction" onClick={() => void onSaveGlobalLlmSettings()} disabled={globalLlmSaving || globalLlmLoading}>
                    {globalLlmSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                    <span>{globalLlmSaving ? "保存中" : "保存 LLM"}</span>
                  </button>
                </div>
                {(globalLlmError || globalLlmMessage) && <div role={globalLlmError ? "alert" : "status"} aria-live={globalLlmError ? "assertive" : "polite"} className={globalLlmError ? "settingsFeedback error" : "settingsFeedback"}><span>{globalLlmError ?? globalLlmMessage}</span></div>}
              </div>

              <div id="settings-managed-storage" className="settingsGroup managedStorageSettingsGroup" data-settings-section="assets">
                <div className="settingsGroupTitle">
                  <FolderOpen size={16} strokeWidth={1.9} />
                  <span>统一资源库</span>
                </div>
                <p className="managedStorageHint">模型权重、模型专用运行时、任务缓存与成品输出由同一个资源库管理；升级不会再把新文件写到安装目录或另一套空目录。</p>
                <div className="managedStoragePaths">
                  <label className="settingsField">
                    <span>资源库根目录</span>
                    <div className="settingsPathInput">
                      <input value={appSettings?.storage_root ?? "正在读取…"} readOnly />
                      <button type="button" className="pathPickButton" onClick={() => void openModelDirectory({ id: "storage-root", display_name: "统一资源库", path: appSettings?.storage_root ?? "", exists: Boolean(appSettings?.storage_root), kind: "storage_root" })} disabled={!appSettings?.storage_root}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>打开</span>
                      </button>
                    </div>
                  </label>
                  <label className="settingsField">
                    <span>模型与专用运行时</span>
                    <div className="settingsPathInput">
                      <input value={appSettings?.model_store_root ?? "正在读取…"} readOnly />
                      <button type="button" className="pathPickButton" onClick={() => void openModelDirectory({ id: "model-store", display_name: "模型与专用运行时", path: appSettings?.model_store_root ?? "", exists: Boolean(appSettings?.model_store_root), kind: "model_store" })} disabled={!appSettings?.model_store_root}>
                        <FolderOpen size={15} strokeWidth={1.9} />
                        <span>打开</span>
                      </button>
                    </div>
                  </label>
                  <label className="settingsField">
                    <span>成品输出目录</span>
                    <div className="settingsPathInput">
                      <input value={appSettings?.output_dir ?? "正在读取…"} readOnly />
                      <button type="button" className="pathPickButton" onClick={() => void openModelDirectory({ id: "outputs", display_name: "成品输出", path: appSettings?.output_dir ?? "", exists: Boolean(appSettings?.output_dir), kind: "output" })} disabled={!appSettings?.output_dir}>
                      <FolderOpen size={15} strokeWidth={1.9} />
                      <span>打开</span>
                      </button>
                    </div>
                  </label>
                </div>
              </div>

              <div id="settings-api-service" className="settingsGroup apiSettingsGroup" data-settings-section="system">
                <div className="settingsGroupTitle">
                  <Server size={16} strokeWidth={1.9} />
                  <span>API 服务</span>
                </div>
                <div className="settingsInline">
                  <label className="settingsField">
                    <span>监听地址</span>
                    <input
                      value={settingsDraft.api_host}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, api_host: event.target.value }))}
                    />
                  </label>
                  <label className="settingsField">
                    <span>端口</span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={settingsDraft.api_port}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, api_port: Number(event.target.value) }))}
                    />
                  </label>
                </div>
                <div className="restartNotice">
                  <RefreshCw size={15} strokeWidth={1.9} />
                  <span>地址和端口会在重启桌面软件后生效</span>
                </div>
              </div>

              <div className="settingsGroup settingsMigrationGroup" data-settings-section="system">
                <div className="settingsGroupTitle">
                  <Save size={16} strokeWidth={1.9} />
                  <span>备份与迁移</span>
                </div>
                <p className="settingsMigrationDescription">
                  备份模型目录、启用状态、稳定包标记和运行时设置；不会包含 API 密钥、音色文件、生成音频或项目内容。
                </p>
                <div className="settingsMigrationActions">
                  <button
                    type="button"
                    className="secondaryAction settingsAction"
                    disabled={settingsMigrationAction !== null}
                    onClick={() => void onExportSettingsBackup()}
                  >
                    {settingsMigrationAction === "export" ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                    <span>{settingsMigrationAction === "export" ? "导出中" : "导出备份"}</span>
                  </button>
                  <button
                    type="button"
                    className="primaryAction settingsAction"
                    disabled={settingsMigrationAction !== null}
                    onClick={() => void onImportSettingsBackup()}
                  >
                    {settingsMigrationAction === "import" ? <Loader2 className="spin" size={16} /> : <Upload size={16} strokeWidth={1.9} />}
                    <span>{settingsMigrationAction === "import" ? "导入中" : "导入备份"}</span>
                  </button>
                </div>
                <div className="settingsMigrationNotice">
                  <RefreshCw size={15} strokeWidth={1.9} />
                  <span>导入会立即保存当前可迁移配置；若备份修改了 API 地址或端口，重启后生效。</span>
                </div>
              </div>

            </div>

            {(settingsError || settingsMessage) && (
              <div role={settingsError ? "alert" : "status"} aria-live={settingsError ? "assertive" : "polite"} className={settingsError ? "settingsFeedback error" : "settingsFeedback"}>
                {settingsError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{settingsError ?? settingsMessage}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button type="button" className="secondaryAction settingsAction" onClick={restoreSettingsDraft}>
                <RefreshCw size={16} strokeWidth={1.9} />
                <span>恢复</span>
              </button>
              <button type="button" className="primaryAction settingsAction" onClick={onSaveSettings} disabled={settingsSaving}>
                {settingsSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>{settingsSaving ? "保存中" : "保存设置"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}
      {appConfirmation && (
        <ConfirmationDialog
          request={appConfirmation}
          onCancel={() => settleConfirmation(false)}
          onConfirm={() => settleConfirmation(true)}
        />
      )}
      {globalRefreshMessage && (
        <div className={`globalToast ${globalRefreshMessage.tone === "error" ? "error" : ""}`} role={globalRefreshMessage.tone === "error" ? "alert" : "status"} aria-live={globalRefreshMessage.tone === "error" ? "assertive" : "polite"}>
          {globalRefreshMessage.tone === "error" ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
          <span>{globalRefreshMessage.text}</span>
        </div>
      )}
      {voiceMessage && (
        <div className="voiceToast" role="status" aria-live="polite">
          <CheckCircle2 size={16} strokeWidth={1.9} />
          <span>{voiceMessage}</span>
        </div>
      )}
    </main>
  );
}
