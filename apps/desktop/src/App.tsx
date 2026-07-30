import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  Download,
  FileText,
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
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  Waves,
  X
} from "lucide-react";
import QRCode from "qrcode";
import { CSSProperties, ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  activateModelPackage,
  cancelBatchProject,
  cancelSpeechJob,
  checkModelInstance,
  clearSpeechJobHistory,
  createSpeechJob,
  createVoice,
  createBatchProject,
  deleteVoice,
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
  getApiBase,
  importSettingsBackup,
  importVoicePackage,
  inspectModelPackage,
  registerModelPackage,
  retryBatchProject,
  retrySpeechJob,
  recognizeVoiceReference,
  runBatchProject,
  resumeBatchProject,
  saveAppSettings,
  startModelRuntime,
  stopModelRuntime,
  toAudioUrl,
  updateBatchProject,
  updateModelPackage,
  updateModelInstance,
  updateVoice,
  type GenerateSpeechOptions
} from "./api";
import { DoubaoWorkspace } from "./DoubaoWorkspace";
import type {
  AudioAsset,
  AppUpdateState,
  AppSettings,
  BatchProject,
  BilibiliAudioOptionsResult,
  BilibiliExtractSampleRequest,
  BilibiliExtractSampleResult,
  BilibiliLoginQrPayload,
  BilibiliLoginSession,
  BilibiliParsedItem,
  BilibiliParsedLink,
  BilibiliPollLoginPayload,
  BilibiliSamplerState,
  DoubaoStatus,
  DoubaoVoice,
  ModelDirectory,
  ModelHealthResult,
  ModelInfo,
  ModelInstanceProfile,
  ModelPackageRecord,
  IpcResponse,
  SpeechResult,
  SpeechJob,
  SettingsBackup,
  SystemStatus,
  TaskSummary,
  VoiceInfo,
  VoiceQualityReport,
  WorkerStatus
} from "./types";

declare global {
  interface Window {
    desktopWindow?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
    desktopFiles?: {
      openPath: (targetPath: string) => Promise<string>;
      selectDirectory: () => Promise<string | null>;
      selectModelArchive: () => Promise<string | null>;
      selectReferenceAudio: () => Promise<string | null>;
      readSelectedAudio: (targetPath: string) => Promise<Uint8Array>;
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
      loadAudioOptions: (kind: BilibiliParsedLink["kind"], itemId: string) => Promise<IpcResponse<BilibiliAudioOptionsResult>>;
      extractSample: (request: BilibiliExtractSampleRequest) => Promise<IpcResponse<BilibiliExtractSampleResult>>;
      cancelExtract: () => Promise<IpcResponse>;
      onStateChanged: (listener: (state: BilibiliSamplerState) => void) => () => void;
    };
  }
}

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
  modelBinding?: {
    modelId: string;
    weights: Record<string, string>;
  };
};

type VoiceManagerDraft = {
  name: string;
  referenceText: string;
};

type ReferenceAudioEditorTarget =
  | { kind: "create" }
  | { kind: "replace"; voiceId: string };

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

type AudioWaveformProps = {
  peaks: number[];
  status: WaveformStatus;
  progressRatio?: number;
  selectionStartRatio?: number;
  selectionEndRatio?: number;
  editableSelection?: boolean;
  onSeekRatio?: (ratio: number) => void;
  onSelectionChange?: (boundary: "start" | "end", ratio: number) => void;
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

async function decodeWaveformPeaks(audioData: ArrayBuffer) {
  if (audioData.byteLength > WAVEFORM_MAX_ANALYSIS_BYTES) {
    throw new Error("参考音频较大，已跳过波形分析");
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
  progressRatio = 0,
  selectionStartRatio = 0,
  selectionEndRatio = 1,
  editableSelection = false,
  onSeekRatio,
  onSelectionChange,
  ariaLabel,
  className
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragBoundaryRef = useRef<"start" | "end" | null>(null);
  const startRatio = clampWaveformRatio(selectionStartRatio, 0);
  const endRatio = Math.max(startRatio, clampWaveformRatio(selectionEndRatio, 1));
  const currentRatio = clampWaveformRatio(progressRatio, 0);
  const interactive = Boolean(onSeekRatio || onSelectionChange);

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
      context.fillStyle = "rgba(222, 231, 239, 0.68)";
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
          context.fillStyle = insideSelection ? "rgba(69, 157, 101, 0.82)" : "rgba(115, 137, 157, 0.44)";
          context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
        }
      } else {
        context.fillStyle = "rgba(115, 137, 157, 0.36)";
        context.fillRect(0, Math.floor(height / 2), width, 1);
      }

      if (editableSelection) {
        context.fillStyle = "rgba(54, 68, 82, 0.15)";
        context.fillRect(0, 0, selectedStart, height);
        context.fillRect(selectedEnd, 0, Math.max(0, width - selectedEnd), height);
        context.fillStyle = "rgba(44, 127, 77, 0.9)";
        context.fillRect(selectedStart - 1, 0, 2, height);
        context.fillRect(selectedEnd - 1, 0, 2, height);
      }

      if (currentRatio > 0) {
        const currentX = currentRatio * width;
        context.fillStyle = "rgba(39, 76, 104, 0.92)";
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
  }, [currentRatio, editableSelection, endRatio, peaks, startRatio]);

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
        onSeekRatio?.(ratio);
      }
    } else {
      onSeekRatio?.(ratio);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const boundary = dragBoundaryRef.current;
    if (!boundary || !onSelectionChange) {
      return;
    }
    onSelectionChange(boundary, getPointerRatio(event));
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragBoundaryRef.current = null;
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
  output_dir: string;
  indextts2_root: string;
  indextts2_idle_timeout_seconds: number;
  local_api_idle_timeout_seconds: number;
  voxcpm2_root: string;
  voxcpm2_api_host: string;
  voxcpm2_api_port: number;
  gptsovits_root: string;
  gptsovits_api_host: string;
  gptsovits_api_port: number;
  default_model_id: "indextts2" | "voxcpm2" | "gptsovits" | "doubao-web";
  prewarm_default_model_on_startup: boolean;
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
    background: "linear-gradient(135deg, #59616c 0%, #c8cfd6 100%)"
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
      itemId: null
    },
    audioOptionSummary: null,
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
    case "downloading-audio":
      return "下载音频";
    case "converting":
      return "转码切分";
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
  return {
    api_host: settings?.api_host ?? "127.0.0.1",
    api_port: settings?.api_port ?? 8765,
    output_dir: settings?.output_dir ?? "D:\\code\\tts\\data\\outputs",
    indextts2_root: settings?.indextts2_root ?? `${modelStoreRoot}\\IndexTTS2`,
    indextts2_idle_timeout_seconds: settings?.indextts2_idle_timeout_seconds ?? 600,
    local_api_idle_timeout_seconds: settings?.local_api_idle_timeout_seconds ?? 600,
    voxcpm2_root: settings?.voxcpm2_root ?? `${modelStoreRoot}\\VoxCPM2`,
    voxcpm2_api_host: settings?.voxcpm2_api_host ?? "127.0.0.1",
    voxcpm2_api_port: settings?.voxcpm2_api_port ?? 8000,
    gptsovits_root: settings?.gptsovits_root ?? `${modelStoreRoot}\\GPT-SoVITS`,
    gptsovits_api_host: settings?.gptsovits_api_host ?? "127.0.0.1",
    gptsovits_api_port: settings?.gptsovits_api_port ?? 9880,
    default_model_id: settings?.default_model_id ?? "indextts2",
    prewarm_default_model_on_startup: settings?.prewarm_default_model_on_startup ?? false
  };
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
  return {
    id: voice.id,
    name: voice.name,
    subtitle: modelBinding
      ? `${modelBinding.modelId === "gptsovits" ? "GPT-SoVITS" : modelBinding.modelId} · 专属权重`
      : voiceSourceLabel(voice.source_type),
    initials: voice.name.trim().slice(0, 1) || "音",
    background: voiceColorFromId(voice.id),
    referenceAudio: voice.reference_audio,
    referenceText: voice.reference_text ?? undefined,
    authorizationStatus: voice.authorization_status,
    sourceType: voice.source_type,
    sourceUrl: voice.source_url ?? undefined,
    referenceAudioManaged: voice.reference_audio_managed,
    originalReferenceAudio: voice.original_reference_audio ?? undefined,
    modelBinding
  };
}

function createVoiceManagerDraft(voice: VoicePreset | null): VoiceManagerDraft {
  return {
    name: voice?.name ?? "",
    referenceText: voice?.referenceText ?? ""
  };
}

function createGeneratedVoiceName(modelName: string, sourceVoiceName: string) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;
  return `${modelName}-${sourceVoiceName}-${time}`;
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

function isRuntimeControllable(modelId: string) {
  return modelId === "indextts2" || isLocalApiModel(modelId);
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
  return status || "未知";
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
  return "本地任务";
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
    queued: { phaseIndex: 0, phaseTitle: "任务已进入本地队列", estimate: "等待前序任务完成" },
    validating: { phaseIndex: 0, phaseTitle: isCloudJob ? "校验豆包账号与请求" : "校验本地模型与请求", estimate: "正在读取真实后端状态" },
    waiting_generation_slot: { phaseIndex: 0, phaseTitle: "等待串行生成槽位", estimate: isCloudJob ? "等待前序语音任务结束" : "避免多个本地模型争抢显存" },
    preparing_memory: { phaseIndex: 1, phaseTitle: isCloudJob ? "准备云端请求" : "整理模型显存", estimate: isCloudJob ? "本地 GPU 模型保持不变" : "避免模型之间争抢显存" },
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
  if (stage === "downloading-audio") {
    return 58;
  }
  if (stage === "converting") {
    return 82;
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

function audioAssetSourceLabel(source: AudioAsset["source"]) {
  if (source === "speech") {
    return "单句生成";
  }
  if (source === "batch_project") {
    return "批量旁白";
  }
  return "输出目录文件";
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
    return "推荐只写一种明确情绪；留空会跟随参考音频的原始表达。";
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("indextts2");
  const [pendingModelSwitch, setPendingModelSwitch] = useState<PendingModelSwitch | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("custom");
  const [customVoices, setCustomVoices] = useState<VoicePreset[]>([]);
  const [voiceManagerOpen, setVoiceManagerOpen] = useState(false);
  const [managedVoiceId, setManagedVoiceId] = useState<string | null>(null);
  const [voiceManagerDraft, setVoiceManagerDraft] = useState<VoiceManagerDraft>(() => createVoiceManagerDraft(null));
  const [voiceManagerAction, setVoiceManagerAction] = useState<string | null>(null);
  const [voiceManagerMessage, setVoiceManagerMessage] = useState<string | null>(null);
  const [voiceManagerError, setVoiceManagerError] = useState<string | null>(null);
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
  const [drawCount, setDrawCount] = useState<2 | 3 | 4>(3);
  const [drawSession, setDrawSession] = useState<DrawSession | null>(null);
  const [drawCandidates, setDrawCandidates] = useState<DrawCandidate[]>([]);
  const [selectedDrawCandidateId, setSelectedDrawCandidateId] = useState<string | null>(null);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [remoteTasks, setRemoteTasks] = useState<TaskSummary[]>([]);
  const [taskCenterAction, setTaskCenterAction] = useState<string | null>(null);
  const [taskCenterError, setTaskCenterError] = useState<string | null>(null);
  const [taskCenterMessage, setTaskCenterMessage] = useState<string | null>(null);
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
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [modelInstances, setModelInstances] = useState<ModelInstanceProfile[]>([]);
  const [modelPackages, setModelPackages] = useState<ModelPackageRecord[]>([]);
  const [modelProfileDrafts, setModelProfileDrafts] = useState<Record<string, ModelProfileDraft>>({});
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => createSettingsDraft(null));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMigrationAction, setSettingsMigrationAction] = useState<"export" | "import" | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateState | null>(null);
  const defaultModelAppliedRef = useRef(false);
  const startupPrewarmAttemptedRef = useRef(false);
  const startupModelHealthCheckedRef = useRef(false);
  const systemStatusRequestRef = useRef(false);
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
  const [referenceAudioEditor, setReferenceAudioEditor] = useState<ReferenceAudioEditorState | null>(null);
  const [referenceAudioEditorSaving, setReferenceAudioEditorSaving] = useState(false);
  const [referenceAudioEditorError, setReferenceAudioEditorError] = useState<string | null>(null);
  const [referenceAudioPreviewTime, setReferenceAudioPreviewTime] = useState(0);
  const [referenceAudioPreviewPlaying, setReferenceAudioPreviewPlaying] = useState(false);
  const [referenceAudioWaveformPeaks, setReferenceAudioWaveformPeaks] = useState<number[]>([]);
  const [referenceAudioWaveformStatus, setReferenceAudioWaveformStatus] = useState<WaveformStatus>("idle");
  const [recognizingVoiceIds, setRecognizingVoiceIds] = useState<string[]>([]);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [voiceQuality, setVoiceQuality] = useState<VoiceQualityReport | null>(null);
  const [voiceQualityLoading, setVoiceQualityLoading] = useState(false);
  const [samplerOpen, setSamplerOpen] = useState(false);
  const [samplerState, setSamplerState] = useState<BilibiliSamplerState>(() => createDefaultBilibiliSamplerState());
  const [samplerLink, setSamplerLink] = useState("");
  const [samplerQrPayload, setSamplerQrPayload] = useState<BilibiliLoginQrPayload | null>(null);
  const [samplerQrCodeUrl, setSamplerQrCodeUrl] = useState<string | null>(null);
  const [samplerPendingAction, setSamplerPendingAction] = useState<string | null>(null);
  const [samplerStartSeconds, setSamplerStartSeconds] = useState("");
  const [samplerEndSeconds, setSamplerEndSeconds] = useState("");
  const [samplerName, setSamplerName] = useState("");
  const [samplerReferenceText, setSamplerReferenceText] = useState("");
  const [samplerMessage, setSamplerMessage] = useState<string | null>(null);
  const [batchProjectOpen, setBatchProjectOpen] = useState(false);
  const [doubaoWorkspaceOpen, setDoubaoWorkspaceOpen] = useState(false);
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
  const referenceAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const referenceAudioPreviewUrlRef = useRef<string | null>(null);
  const referenceAudioWaveformRequestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSamplerDefaultNameRef = useRef("");
  const selectedModelRef = useRef(selectedModel);
  const selectedVoiceRef = useRef(selectedVoice);
  const managedVoiceIdRef = useRef(managedVoiceId);
  const voiceRecognitionRequestsRef = useRef(new Map<string, Promise<void>>());
  const pendingModelWarmupRef = useRef<string | null>(null);
  const drawSessionRef = useRef<DrawSession | null>(null);

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel),
    [models, selectedModel]
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

  const visibleManagedVoices = useMemo(
    () => customVoices.filter((voice) => !voice.modelBinding || voice.modelBinding.modelId === selectedModel),
    [customVoices, selectedModel]
  );
  const availableVoices = useMemo(() => {
    const importVoice = voicePresets.find((voice) => voice.id === "custom");
    return importVoice ? [...visibleManagedVoices, importVoice] : visibleManagedVoices;
  }, [visibleManagedVoices]);

  const selectedVoiceInfo = useMemo(
    () => availableVoices.find((voice) => voice.id === selectedVoice) ?? availableVoices[0] ?? voicePresets[0],
    [availableVoices, selectedVoice]
  );
  const managedVoice = useMemo(
    () => visibleManagedVoices.find((voice) => voice.id === managedVoiceId) ?? visibleManagedVoices[0] ?? null,
    [visibleManagedVoices, managedVoiceId]
  );
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

  const supportedCloneModes = useMemo(() => getSupportedCloneModes(selectedModelInfo), [selectedModelInfo]);
  const startupModelOptions = useMemo(() => {
    const enabledModelIds = new Set(modelInstances.filter((instance) => instance.enabled).map((instance) => instance.model_id));
    const enabledModels = models.filter((model) => model.id === "doubao-web" || enabledModelIds.has(model.id));
    return enabledModels.length > 0 ? enabledModels : models;
  }, [modelInstances, models]);
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
  const showVoiceLibrary = !isDoubao && needsReferenceAudio;
  const showCfgSteps = selectedModel === "voxcpm2";
  const showIndexSampling = selectedModel === "indextts2";
  const showSpeedControl = isDoubao || hasFeature(selectedModelInfo, "duration_control");
  const showNormalizeToggle = selectedModel === "voxcpm2";
  const showDenoiseToggle = selectedModel === "voxcpm2";
  const hasParameterControls = showCfgSteps || showIndexSampling || showSpeedControl || showNormalizeToggle || showDenoiseToggle || isDoubao;
  const hasActiveBatchGeneration = batchProjects.some((project) =>
    project.status === "queued" || project.status === "running" || project.status === "cancelling"
  );
  const modelWarmupBusy = modelWarmupState?.status === "waiting" || modelWarmupState?.status === "warming";
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
  const workerStatus =
    isDoubao
      ? undefined
      : selectedModel === "voxcpm2"
      ? systemStatus?.workers.voxcpm2
      : selectedModel === "gptsovits"
        ? systemStatus?.workers.gptsovits
        : systemStatus?.workers.indextts2;
  const pendingSwitchLoadedModels = (pendingModelSwitch?.loadedModelIds ?? []).map(
    (modelId) => models.find((model) => model.id === modelId)?.display_name ?? modelId
  );
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
  const samplerClipError =
    Number.isNaN(samplerStartValue)
      ? "开始时间必须是数字"
      : Number.isNaN(samplerEndValue)
        ? "结束时间必须是数字"
        : samplerStartValue !== null && samplerStartValue < 0
          ? "开始时间不能小于 0"
          : samplerEndValue !== null && samplerEndValue <= (samplerStartValue ?? 0)
            ? "结束时间必须大于开始时间"
            : null;
  const samplerExtracting = samplerState.taskStage === "downloading-audio" || samplerState.taskStage === "converting";
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
      cancelable: stage === "downloading-audio" || stage === "converting",
      events: [{ occurred_at: now, stage, message, level: samplerState.error ? "error" : "info" }]
    };
  }, [samplerPendingAction, samplerState]);
  const taskCenterTasks = useMemo(() => {
    const allTasks = samplerTask ? [samplerTask, ...remoteTasks] : remoteTasks;
    return [...allTasks].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  }, [remoteTasks, samplerTask]);
  const clearableSpeechTaskCount = useMemo(
    () => remoteTasks.filter(
      (task) => task.source === "speech" && ["succeeded", "failed", "cancelled"].includes(task.status)
    ).length,
    [remoteTasks]
  );
  const visibleAudioAssets = useMemo(() => {
    const search = audioLibrarySearch.trim().toLocaleLowerCase();
    return audioAssets.filter((asset) => {
      if (audioLibrarySource !== "all" && asset.source !== audioLibrarySource) {
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
              <span className={isDoubao ? (doubaoUsable ? "workerBadge loaded" : "workerBadge warning") : workerStatus?.loaded ? "workerBadge loaded" : "workerBadge"}>
                {isDoubao ? (doubaoUsable ? "云端就绪" : "需要登录") : workerBadgeText(workerStatus, selectedModel)}
              </span>
              <strong>{workerReleaseText(workerStatus, selectedModel)}</strong>
            </div>
            <span className="workerDetail">
              {isDoubao && doubaoStateError ? doubaoStateError : workerDetailText(workerStatus, selectedModel)}
            </span>
          </div>
          <div className="inspectorRows">
            <div>
              <span>当前模型</span>
              <strong>{selectedModelInfo?.display_name ?? selectedModel}</strong>
            </div>
            <div>
              <span>模型健康</span>
              <strong>{isDoubao ? (doubaoUsable ? "账号可用" : "等待账号") : modelInstanceStatusLabel(selectedModelInstance?.status)}</strong>
            </div>
            <div>
              <span>后端运行</span>
              <strong>{systemStatus ? formatUptime(systemStatus.api.uptime_seconds) : "-"}</strong>
            </div>
            <div>
              <span>显存建议</span>
              <strong>{isDoubao ? "不占用本地显存" : selectedModelInfo ? `${selectedModelInfo.recommended_vram_gb} GB` : "-"}</strong>
            </div>
            <div>
              <span>采样率</span>
              <strong>{selectedModelInfo ? `${selectedModelInfo.native_sample_rate} Hz` : "-"}</strong>
            </div>
            <div>
              <span>商用状态</span>
              <strong>{selectedModelInfo?.commercial_use ?? "-"}</strong>
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
                <strong>{loading ? generationProgress.phaseTitle : result ? "生成完成" : "等待任务"}</strong>
                <span>
                  {loading
                    ? generationProgress.detail
                    : result
                      ? "音频已写入本地输出目录。"
                      : "输入文本后点击开始生成。"}
                </span>
              </div>
            </div>
            <div className="sideProgress">
              <span style={{ width: `${loading ? generationProgress.percent : result ? 100 : 0}%` }} />
            </div>
          </div>
          <div className="meterMeta">
            <span>{loading ? "推理中" : "空闲"}</span>
            <strong>{loading ? formatDuration(elapsedSeconds) : result ? formatDuration(result.duration_seconds) : "0:00"}</strong>
          </div>
        </section>

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
      const preferred = loaded.find((model) => model.id === "indextts2") ?? loaded[0];
      if (preferred && !loaded.some((model) => model.id === selectedModel)) {
        setSelectedModel(preferred.id);
      }
    } catch (err) {
      setBackendError(err instanceof Error ? err.message : "无法连接本地 API");
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
    } catch {
      setCustomVoices([]);
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

  function mergeManagedVoice(voice: VoiceInfo, select = false) {
    const preset = createImportedVoicePreset(voice);
    if (!preset) {
      return;
    }
    setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
    managedVoiceIdRef.current = preset.id;
    setManagedVoiceId(preset.id);
    setVoiceManagerDraft(createVoiceManagerDraft(preset));
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
      setVoiceManagerDraft((draft) => ({ ...draft, referenceText: preset.referenceText ?? "" }));
    }
  }

  function startAutomaticVoiceRecognition(voice: VoiceInfo) {
    if (!voice.reference_audio || voiceRecognitionRequestsRef.current.has(voice.id)) {
      return;
    }

    setRecognizingVoiceIds((ids) => [...new Set([...ids, voice.id])]);
    if (selectedVoiceRef.current === voice.id) {
      setVoiceMessage(`${voice.name} 已导入，正在后台识别参考文本…`);
    }
    if (managedVoiceIdRef.current === voice.id) {
      setVoiceManagerError(null);
      setVoiceManagerMessage("新参考音频已保存，正在后台识别对应原文…");
    }

    const recognition = (async () => {
      try {
        const result = await recognizeVoiceReference(voice.id);
        const updated = await updateVoice(voice.id, { reference_text: result.text });
        applyRecognizedVoice(updated);
        if (selectedVoiceRef.current === voice.id) {
          setVoiceMessage(`${voice.name} 的参考文本已自动识别，请在生成前核对。`);
        }
        if (managedVoiceIdRef.current === voice.id) {
          setVoiceManagerMessage("参考文本已自动识别并保存，建议核对后再用于极致克隆。");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "参考音频识别失败";
        if (selectedVoiceRef.current === voice.id) {
          setVoiceMessage(`自动识别未完成：${message}。可以稍后在音色库中重试。`);
        }
        if (managedVoiceIdRef.current === voice.id) {
          setVoiceManagerError(`自动识别未完成：${message}`);
        }
      } finally {
        voiceRecognitionRequestsRef.current.delete(voice.id);
        setRecognizingVoiceIds((ids) => ids.filter((id) => id !== voice.id));
        if (voiceRecognitionRequestsRef.current.size === 0 && pendingModelWarmupRef.current) {
          const modelId = pendingModelWarmupRef.current;
          void runModelWarmup(modelId);
        }
      }
    })();

    voiceRecognitionRequestsRef.current.set(voice.id, recognition);
    queueModelWarmup(selectedModelRef.current);
  }

  function openVoiceManager() {
    const preferred = visibleManagedVoices.find((voice) => voice.id === selectedVoice) ?? visibleManagedVoices[0] ?? null;
    setManagedVoiceId(preferred?.id ?? null);
    setVoiceManagerDraft(createVoiceManagerDraft(preferred));
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
    setVoiceManagerOpen(true);
    void loadVoices();
  }

  function selectManagedVoice(voice: VoicePreset) {
    setManagedVoiceId(voice.id);
    setVoiceManagerDraft(createVoiceManagerDraft(voice));
    setVoiceManagerError(null);
    setVoiceManagerMessage(null);
  }

  async function onSaveVoiceManagerDetails() {
    if (!managedVoice) {
      return;
    }
    if (!voiceManagerDraft.name.trim()) {
      setVoiceManagerError("请填写音色名称。");
      return;
    }
    setVoiceManagerAction("save");
    setVoiceManagerError(null);
    try {
      const updated = await updateVoice(managedVoice.id, {
        name: voiceManagerDraft.name.trim(),
        reference_text: voiceManagerDraft.referenceText.trim() || null
      });
      mergeManagedVoice(updated, selectedVoice === updated.id);
      setVoiceManagerMessage("名称和参考文本已保存。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "保存音色失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function openReferenceAudioEditor(sourcePath: string, target: ReferenceAudioEditorTarget) {
    if (!window.desktopFiles?.readSelectedAudio) {
      throw new Error("此版本暂不支持导入前试听，请更新桌面软件后重试。");
    }
    const audioBytes = await window.desktopFiles.readSelectedAudio(sourcePath);
    const previewUrl = URL.createObjectURL(new Blob([audioBytes], { type: getAudioMimeType(sourcePath) }));
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
      setReferenceAudioEditorError("请填写音色名称。");
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
      } else {
        const updated = await updateVoice(editor.target.voiceId, {
          reference_audio: editor.sourcePath,
          reference_text: null,
          ...trimPayload
        });
        mergeManagedVoice(updated, selectedVoice === updated.id);
        setVoiceManagerDraft((draft) => ({ ...draft, referenceText: "" }));
        if (selectedVoice === updated.id) {
          setReferenceText("");
        }
        setVoiceManagerMessage(
          editor.autoRecognize
            ? "参考音频已替换，正在识别选中片段的参考文本。"
            : "参考音频已替换。需要时可点击“识别参考文本”。"
        );
        if (editor.autoRecognize) {
          startAutomaticVoiceRecognition(updated);
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
    if (!managedVoice || !window.desktopFiles?.selectReferenceAudio) {
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
      await openReferenceAudioEditor(audioPath, { kind: "replace", voiceId: managedVoice.id });
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "替换参考音频失败");
    } finally {
      setVoiceManagerAction(null);
    }
  }

  async function onRecognizeManagedVoiceReference() {
    if (!managedVoice?.referenceAudio) {
      setVoiceManagerError("该音色没有可识别的参考音频。");
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
      const result = await recognizeVoiceReference(managedVoice.id);
      setVoiceManagerDraft((draft) => ({ ...draft, referenceText: result.text }));
      if (selectedVoice === managedVoice.id) {
        setReferenceText(result.text);
      }
      setVoiceManagerMessage("参考文本已识别并填入草稿，请核对后点击保存。");
    } catch (err) {
      setVoiceManagerError(err instanceof Error ? err.message : "参考音频识别失败");
    } finally {
      setVoiceManagerAction(null);
      queueModelWarmup(selectedModelRef.current);
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
    if (!managedVoice || !window.confirm(`删除音色「${managedVoice.name}」？已托管的音频文件会保留，避免误删。`)) {
      return;
    }
    setVoiceManagerAction("delete");
    setVoiceManagerError(null);
    try {
      await deleteVoice(managedVoice.id);
      setCustomVoices((voices) => voices.filter((voice) => voice.id !== managedVoice.id));
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
    } catch {
      setVoiceQuality(null);
    } finally {
      setVoiceQualityLoading(false);
    }
  }

  async function loadBatchProjects() {
    try {
      const projects = await fetchBatchProjects();
      setBatchProjects(projects);
    } catch (err) {
      setBatchProjectError(err instanceof Error ? err.message : "无法读取批量项目");
    }
  }

  function openBatchProjectWorkspace() {
    setBatchProjectOpen(true);
    setBatchProjectError(null);
    setBatchProjectMessage(null);
    setEditingBatchProjectId(null);
    setBatchProjectTitle(`配音项目 ${new Date().toLocaleDateString()}`);
    setBatchProjectModel(selectedModel);
    setBatchProjectDoubaoVoiceId(selectedDoubaoVoice?.style_id ?? "");
    setBatchProjectDoubaoPitch(doubaoPitch);
    setBatchProjectDoubaoFormat(doubaoFormat);
    setBatchProjectSegments(parseBatchSegments(input));
    void loadBatchProjects();
  }

  function editBatchProject(project: BatchProject) {
    setEditingBatchProjectId(project.id);
    setBatchProjectTitle(project.title);
    setBatchProjectModel(project.model);
    setBatchProjectSegments(project.segments.map((segment) => segment.text));
    if (project.model === "doubao-web") {
      setBatchProjectDoubaoVoiceId(project.voice ?? doubaoVoices[0]?.style_id ?? "");
      setBatchProjectDoubaoPitch(project.pitch ?? 0);
      setBatchProjectDoubaoFormat(project.response_format === "wav" ? "wav" : "mp3");
      setSpeed(project.speed ?? 1);
    } else if (project.model === "voxcpm2") {
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
    if (shouldRun && batchProjectModel === "doubao-web" && !doubaoUsable) {
      setBatchProjectError("豆包当前没有可用账号，请先到豆包管理中心登录或添加 Cookie");
      return;
    }
    if (batchProjectModel === "doubao-web" && !batchProjectDoubaoVoice) {
      setBatchProjectError("请选择豆包预设音色");
      return;
    }
    setBatchProjectAction(shouldRun ? "run" : "save");
    setBatchProjectError(null);
    try {
      const payload = {
        title: batchProjectTitle.trim(),
        model: batchProjectModel,
        segments: segments.map((text) => ({ text })),
        voice: batchProjectModel === "doubao-web"
          ? batchProjectDoubaoVoice?.style_id
          : batchProjectModel === "gptsovits"
            ? selectedVoice
            : undefined,
        pitch: batchProjectModel === "doubao-web" ? batchProjectDoubaoPitch : undefined,
        response_format: batchProjectModel === "doubao-web" ? batchProjectDoubaoFormat : "wav",
        reference_audio: batchProjectModel === "doubao-web" ? undefined : selectedVoiceInfo.referenceAudio,
        reference_text: batchProjectModel === "doubao-web" ? undefined : effectiveReferenceText.trim() || undefined,
        emotion: batchProjectModel === "doubao-web" ? undefined : showControlPrompt ? controlPrompt.trim() || undefined : undefined,
        speed: batchProjectModel === "doubao-web" || showSpeedControl ? speed : 1,
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
    } catch {
      // Keep the last resource snapshot visible while a local model is busy.
    } finally {
      systemStatusRequestRef.current = false;
    }
  }

  async function loadAppSettings() {
    try {
      const loadedSettings = await fetchAppSettings();
      setAppSettings(loadedSettings);
      setSettingsDraft(createSettingsDraft(loadedSettings));
    } catch {
      setAppSettings(null);
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
    } catch {
      setModelInstances([]);
    }
  }

  async function loadModelPackages() {
    try {
      setModelPackages(await fetchModelPackages());
    } catch {
      setModelPackages([]);
    }
  }

  async function loadTaskSummaries() {
    try {
      setRemoteTasks(await fetchTaskSummaries());
    } catch {
      setRemoteTasks([]);
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
    } finally {
      setAudioLibraryLoading(false);
    }
  }

  function openAudioLibrary() {
    setAudioLibraryError(null);
    setAudioLibraryMessage(null);
    setAudioLibraryOpen(true);
    void loadAudioAssets();
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

  async function onAddAudioAssetToVoiceLibrary(asset: AudioAsset) {
    setAudioLibraryAction(`voice-${asset.file_path}`);
    setAudioLibraryError(null);
    try {
      const voice = await createVoice({
        name: createGeneratedVoiceName(asset.model ?? "本地音频", getFileBaseName(asset.file_name)),
        reference_audio: asset.file_path,
        reference_text: asset.text ?? undefined,
        authorization_status: asset.source === "untracked" ? "user_managed_output" : "generated_local",
        source_type: asset.source === "untracked" ? "local_output" : "generated"
      });
      const preset = createImportedVoicePreset(voice);
      if (preset) {
        setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
        selectedVoiceRef.current = preset.id;
        setSelectedVoice(preset.id);
        if (preset.referenceText) {
          setReferenceText(preset.referenceText);
        }
      }
      setAudioLibraryMessage(`${asset.file_name} 已加入音色库。`);
      if (!asset.text) {
        startAutomaticVoiceRecognition(voice);
      }
    } catch (err) {
      setAudioLibraryError(err instanceof Error ? err.message : "将音频加入音色库失败");
    } finally {
      setAudioLibraryAction(null);
    }
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
      setSamplerMessage("二维码已生成，扫码后点击确认");
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "生成 B 站登录二维码失败");
    } finally {
      setSamplerPendingAction(null);
    }
  }

  async function onSamplerPollLogin() {
    const sampler = requireSamplerBridge();
    if (!sampler) {
      return;
    }
    setSamplerPendingAction("poll-login");
    setSamplerMessage(null);
    setSamplerState((state) => ({ ...state, error: null }));
    try {
      const response = await sampler.pollLogin();
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "确认 B 站登录失败");
      }
      if (response.data.loginSession) {
        setSamplerState((state) => ({
          ...state,
          loginSession: response.data!.loginSession!,
          error: null
        }));
      }
      if (response.data.status === "confirmed") {
        setSamplerQrPayload(null);
      }
      setSamplerMessage(samplerPollStatusLabel(response.data.status));
    } catch (err) {
      setSamplerFailure(err instanceof Error ? err.message : "确认 B 站登录失败");
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
        selection: { itemId: parsedLink.selectedItemId },
        audioOptionSummary: null,
        taskStage: "idle",
        error: null
      }));

      const audioResponse = await sampler.loadAudioOptions(parsedLink.kind, parsedLink.selectedItemId);
      if (!audioResponse.success || !audioResponse.data) {
        throw new Error(audioResponse.error ?? "加载音频流失败");
      }
      setSamplerState((state) => ({
        ...state,
        selection: { itemId: audioResponse.data!.itemId },
        audioOptionSummary: audioResponse.data!.summary,
        taskStage: "idle",
        error: null
      }));
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
      selection: { itemId },
      audioOptionSummary: null,
      error: null
    }));
    try {
      const response = await sampler.loadAudioOptions(samplerState.parsedLink.kind, itemId);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "加载音频流失败");
      }
      setSamplerState((state) => ({
        ...state,
        selection: { itemId: response.data!.itemId },
        audioOptionSummary: response.data!.summary,
        taskStage: "idle",
        error: null
      }));
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

  async function onSamplerCancel() {
    if (!samplerExtracting) {
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

  async function onAddResultToVoiceLibrary() {
    if (!result || resultSavedToVoiceLibrary) {
      return;
    }
    setVoiceSaving(true);
    setVoiceMessage(null);
    setError(null);
    try {
      const voice = await createVoice({
        name: createGeneratedVoiceName(resultModelName || selectedModelInfo?.display_name || result.model, resultVoiceName || selectedVoiceInfo.name),
        reference_audio: result.file_path,
        reference_text: resultReferenceText || input.trim() || undefined,
        authorization_status: "generated_local",
        source_type: "generated"
      });
      const preset = createImportedVoicePreset(voice);
      if (preset) {
        setCustomVoices((voices) => [...voices.filter((item) => item.id !== preset.id), preset]);
        setSelectedVoice(preset.id);
        if (preset.referenceText) {
          setReferenceText(preset.referenceText);
        }
        setSavedVoicePath(result.file_path);
        setVoiceMessage(`已加入音色库：${preset.name}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入音色库失败");
    } finally {
      setVoiceSaving(false);
    }
  }

  function openSettings() {
    setSettingsDraft(createSettingsDraft(appSettings));
    setSettingsError(null);
    setSettingsMessage(null);
    void loadModelInstances();
    void loadModelPackages();
    setSettingsOpen(true);
  }

  async function onSaveSettings() {
    if (
      !settingsDraft.output_dir.trim() ||
      !settingsDraft.api_host.trim()
    ) {
      setSettingsError("路径和地址不能为空");
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const savedSettings = await saveAppSettings({
        api_host: settingsDraft.api_host.trim(),
        api_port: Number(settingsDraft.api_port),
        output_dir: settingsDraft.output_dir.trim(),
        indextts2_idle_timeout_seconds: Number(settingsDraft.indextts2_idle_timeout_seconds),
        local_api_idle_timeout_seconds: Number(settingsDraft.local_api_idle_timeout_seconds),
        default_model_id: settingsDraft.default_model_id,
        prewarm_default_model_on_startup: settingsDraft.prewarm_default_model_on_startup
      });
      setAppSettings(savedSettings);
      setSettingsDraft(createSettingsDraft(savedSettings));
      if (models.some((model) => model.id === savedSettings.default_model_id)) {
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

  async function chooseDirectoryForSetting(field: "indextts2_root" | "voxcpm2_root" | "gptsovits_root" | "output_dir") {
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
      setSystemStatus((current) =>
        current ? { ...current, workers: { ...current.workers, [modelId]: result.worker } } : current
      );
      setModelWarmupState({ modelId, status: "ready", message: `${displayName} 已预热，可以直接开始生成。` });
      await loadSystemStatus();
    } catch (err) {
      setModelWarmupState({
        modelId,
        status: "failed",
        message: err instanceof Error ? `预热失败：${err.message}` : `${displayName} 预热失败。`
      });
    }
  }

  function queueModelWarmup(modelId: string) {
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
    if (targetModelId === selectedModel) {
      return;
    }
    if (modelSwitchLocked) {
      return;
    }
    if (targetModelId === "doubao-web") {
      selectModel(targetModelId);
      setModelWarmupState(null);
      void loadDoubaoState();
      return;
    }
    const workers = systemStatus?.workers;
    const loadedModelIds = workers
      ? (["indextts2", "voxcpm2", "gptsovits"] as const).filter(
          (modelId) => modelId !== targetModelId && workers[modelId]?.loaded
        )
      : [];
    if (loadedModelIds.length > 0) {
      setPendingModelSwitch({ targetModelId, loadedModelIds });
      return;
    }
    selectModel(targetModelId);
    queueModelWarmup(targetModelId);
  }

  function confirmModelSwitch() {
    if (!pendingModelSwitch || modelSwitchLocked) {
      return;
    }
    selectModel(pendingModelSwitch.targetModelId);
    if (pendingModelSwitch.targetModelId !== "doubao-web") {
      queueModelWarmup(pendingModelSwitch.targetModelId);
    }
    setPendingModelSwitch(null);
  }

  function createCurrentSpeechOptions(): GenerateSpeechOptions {
    return {
      voice: isDoubao ? selectedDoubaoVoice?.style_id : selectedModel === "gptsovits" ? selectedVoice : undefined,
      referenceAudio: needsReferenceAudio ? selectedVoiceInfo.referenceAudio : undefined,
      referenceText: needsExtremeReferenceText || selectedModel === "gptsovits" ? effectiveReferenceText.trim() || undefined : undefined,
      emotion: showControlPrompt ? controlPrompt.trim() || undefined : undefined,
      speed: showSpeedControl ? speed : 1,
      pitch: isDoubao ? doubaoPitch : undefined,
      responseFormat: isDoubao ? doubaoFormat : "wav",
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

  async function onDrawGenerate() {
    if (!canGenerate) {
      return;
    }
    const requestText = input.trim();
    const session: DrawSession = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      total: drawCount,
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
    if (!window.confirm(drawMessage)) {
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
    loadModels();
    loadVoices();
    void loadDoubaoState();
    loadSystemStatus();
    loadAppSettings();
    loadModelInstances();
    loadModelPackages();
    loadTaskSummaries();
    void loadBatchProjects();
    void refreshSamplerSession(false);
  }, []);

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
    if (defaultModelAppliedRef.current || !appSettings || models.length === 0) {
      return;
    }
    const configuredModel = models.find((model) => model.id === appSettings.default_model_id);
    if (configuredModel) {
      setSelectedModel(configuredModel.id);
    }
    defaultModelAppliedRef.current = true;
  }, [appSettings, models]);

  useEffect(() => {
    if (
      startupPrewarmAttemptedRef.current ||
      !appSettings?.prewarm_default_model_on_startup ||
      models.length === 0
    ) {
      return;
    }
    if (appSettings.default_model_id === "doubao-web") {
      startupPrewarmAttemptedRef.current = true;
      setSelectedModel("doubao-web");
      setSettingsMessage("豆包是云端模型，无需加载权重；账号状态与预设音色已在后台检查。");
      void loadDoubaoState();
      return;
    }
    if (modelInstances.length === 0) {
      return;
    }
    startupPrewarmAttemptedRef.current = true;
    const model = models.find((candidate) => candidate.id === appSettings.default_model_id);
    const instance = modelInstances.find((candidate) => candidate.model_id === appSettings.default_model_id);
    if (!model || !instance || !isModelInstanceUsable(instance)) {
      setSettingsMessage("启动预热已跳过：默认模型未启用或尚不可用。");
      return;
    }
    setSelectedModel(model.id);
    void onStartModelRuntime(instance);
  }, [appSettings, modelInstances, models]);

  useEffect(() => {
    if (!window.desktopBilibiliSampler?.onStateChanged) {
      return undefined;
    }
    return window.desktopBilibiliSampler.onStateChanged((state) => {
      setSamplerState(state);
    });
  }, []);

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
    const shouldPoll = taskCenterOpen || Boolean(activeSpeechJob) || hasActiveBatch || samplerBusy;
    if (!shouldPoll) {
      return undefined;
    }
    void loadTaskSummaries();
    const timer = window.setInterval(() => void loadTaskSummaries(), 1200);
    return () => window.clearInterval(timer);
  }, [activeSpeechJob, batchProjects, samplerBusy, taskCenterOpen]);

  useEffect(() => {
    if (!batchProjectOpen) {
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
  }, [batchProjectOpen, batchProjects]);

  useEffect(() => {
    setIsPlaying(false);
    setPlaybackTime(0);
  }, [audioUrl]);

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

  return (
    <main className="studioShell">
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

        <div className="topStatus">
          <span className={online ? "statusDot online" : "statusDot"} />
          <span>{online ? "本地后端在线" : "等待后端"}</span>
          <code>{apiBaseLabel}</code>
        </div>

        <div className="windowTools">
          <div className="toolGroup workspaceToolGroup" role="group" aria-label="工作台工具">
            <button className="toolButton" title="刷新状态" onClick={() => {
              void loadModels();
              void loadSystemStatus();
              void loadModelInstances();
              void loadModelPackages();
              void loadTaskSummaries();
              void loadDoubaoState();
            }}>
              <RefreshCw size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton" title="任务中心" onClick={() => {
              setTaskCenterError(null);
              setTaskCenterMessage(null);
              setTaskHistoryClearConfirmOpen(false);
              void loadTaskSummaries();
              setTaskCenterOpen(true);
            }}>
              <Gauge size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton" title="批量项目" onClick={openBatchProjectWorkspace}>
              <FileText size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton" title="豆包账号、阅读与缓存管理" onClick={() => setDoubaoWorkspaceOpen(true)}>
              <Cloud size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton" title="音频资产库" onClick={openAudioLibrary}>
              <Library size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton" title="设置" onClick={openSettings}>
              <Settings size={17} strokeWidth={1.9} />
            </button>
            <button className="toolButton monitorToolButton" title="系统监控" onClick={() => setMonitorPanelOpen(true)}>
              <Cpu size={17} strokeWidth={1.9} />
              <span className={online ? "toolStatusDot online" : "toolStatusDot"} aria-hidden="true" />
            </button>
          </div>
          <div className="toolGroup windowControlGroup" role="group" aria-label="窗口控制">
            <button className="toolButton" title="最小化" onClick={() => window.desktopWindow?.minimize()}>
              <Minus size={18} strokeWidth={2} />
            </button>
            <button className="toolButton" title="最大化" onClick={() => window.desktopWindow?.maximize()}>
              <Maximize2 size={16} strokeWidth={1.9} />
            </button>
            <button className="toolButton close" title="关闭" onClick={() => window.desktopWindow?.close()}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      <section className="workbench">
        <aside className="leftRail">
          <section className="softPanel voicePanel">
            <div className="panelTitle voicePanelTitle">
              <span className="panelTitleGroup">
                {isDoubao ? <Cloud size={17} strokeWidth={1.9} /> : <Library size={17} strokeWidth={1.9} />}
                <span>{isDoubao ? "豆包预设音色" : "音色库"}</span>
              </span>
              <div className="voicePanelActions">
                {isDoubao ? (
                  <button className="voiceImportButton cloudManageButton" onClick={() => setDoubaoWorkspaceOpen(true)}>
                    <LogIn size={14} strokeWidth={1.9} />
                    <span>账号管理</span>
                  </button>
                ) : (
                  <>
                    <button className="voiceImportButton" disabled={voiceImporting || modelWarmupBusy} onClick={() => void onImportVoice()} title={modelWarmupBusy ? "模型预热完成后再导入参考音频" : "导入后自动识别参考文本"}>
                      {voiceImporting ? <Loader2 className="spin" size={14} /> : <Upload size={14} strokeWidth={1.9} />}
                      <span>导入</span>
                    </button>
                    <button className="voiceImportButton" onClick={openSampler}>
                      <Download size={14} strokeWidth={1.9} />
                      <span>取样</span>
                    </button>
                    <button className="voiceImportButton" onClick={openVoiceManager}>
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
                        className={voice.style_id === selectedDoubaoVoice?.style_id ? "doubaoVoiceCard active" : "doubaoVoiceCard"}
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
            ) : showVoiceLibrary ? (
              <div className="voiceGrid compactVoiceGrid">
                {availableVoices.map((voice) => (
                  <button
                    key={voice.id}
                    className={voice.id === selectedVoice ? "voiceCard active" : "voiceCard"}
                    onClick={() => {
                      if (voice.id === "custom") {
                        void onImportVoice();
                        return;
                      }
                      setSelectedVoice(voice.id);
                      if (voice.modelBinding) {
                        setReferenceText(voice.referenceText ?? "");
                      }
                    }}
                    disabled={voice.id === "custom" && voiceImporting}
                    title={voice.name}
                    >
                      <span
                      className="voiceAvatar"
                      style={{ "--avatar-bg": voice.background } as CSSProperties}
                      aria-hidden="true"
                    >
                      {voice.initials}
                      </span>
                      <span className="voiceName">{voice.name}</span>
                      {voice.modelBinding && <span className="voiceModelWeightBadge">专属权重</span>}
                      <small>{voice.subtitle}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="voiceEmptyState">
                <Mic2 size={20} strokeWidth={1.9} />
                <strong>{selectedModelInfo?.display_name ?? selectedModel}</strong>
                <span>{capabilityHint(selectedModelInfo, cloneMode)}</span>
              </div>
            )}
            {!isDoubao && voiceMessage && <div className="voiceNotice">{voiceMessage}</div>}
            {!isDoubao && voiceQualityLoading && (
              <div className="voiceQualityNotice loading">
                <Loader2 className="spin" size={15} />
                <span>正在检查参考音频</span>
              </div>
            )}
            {!isDoubao && voiceQuality && (
              <div className={`voiceQualityNotice ${voiceQuality.status}`}>
                <Gauge size={16} strokeWidth={1.9} />
                <div>
                  <strong>{voiceQualityLabel(voiceQuality)}</strong>
                  <span>
                    {voiceSourceLabel(selectedVoiceInfo.sourceType)}
                    {voiceQuality.duration_seconds ? ` · ${formatDuration(voiceQuality.duration_seconds)}` : ""}
                    {voiceQuality.sample_rate ? ` · ${voiceQuality.sample_rate} Hz` : ""}
                    {typeof voiceQuality.silence_ratio === "number" ? ` · 静音 ${Math.round(voiceQuality.silence_ratio * 100)}%` : ""}
                  </span>
                  {voiceQuality.warnings[0] && <em>{voiceQuality.warnings[0]}</em>}
                </div>
              </div>
            )}
          </section>

          <section className="softPanel controlPanel">
            <div
              className="segmented"
              style={{ "--segment-count": supportedCloneModes.length } as CSSProperties}
            >
              {supportedCloneModes.map((mode) => (
                <button
                  key={mode}
                  className={mode === cloneMode ? "segment active" : "segment"}
                  onClick={() => setCloneMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            {showControlPrompt ? (
              <>
                <textarea
                  className="controlPrompt"
                  value={controlPrompt}
                  onChange={(event) => setControlPrompt(event.target.value)}
                  placeholder={controlPromptPlaceholder(selectedModelInfo, cloneMode)}
                  aria-label={`${selectedModelInfo?.display_name ?? selectedModel} ${cloneMode}提示词`}
                />
                {controlPromptPresets.length > 0 && (
                  <div className="promptPresetSection">
                    <div className="promptPresetHeader">
                      <span><Wand2 size={15} strokeWidth={1.9} />快速预设</span>
                      <small>{controlPromptGuide(selectedModelInfo, cloneMode)}</small>
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
                placeholder="参考音频对应原文（可在音色库中一键识别并校对）"
              />
            )}
            {selectedModel === "indextts2" && showControlPrompt && (
              <div className="capabilityNote compactCapabilityNote">
                <Sparkles size={17} strokeWidth={1.9} />
                <span>情绪文本控制来自 IndexTTS2 上游实验能力；建议使用惊讶、愤怒、悲伤、恐惧或平静。留空则完整复刻参考音色及表达。</span>
              </div>
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
                <div className="capabilityNote compactCapabilityNote indexSamplingNote">
                  <Info size={17} strokeWidth={1.9} />
                  <span>IndexTTS2 是自回归模型，没有扩散“步数”；以下参数控制 GPT 音频 Token 采样。</span>
                </div>
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
                      <button key={format} className={doubaoFormat === format ? "active" : ""} onClick={() => setDoubaoFormat(format)}>
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <small>{doubaoFormat === "mp3" ? "体积小" : "无损 PCM"}</small>
                </div>
                <div className={doubaoUsable ? "doubaoAccountNote ready" : "doubaoAccountNote warning"}>
                  {doubaoUsable ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <AlertCircle size={16} strokeWidth={1.9} />}
                  <span>{doubaoUsable ? `云端服务可用 · ${doubaoStatus?.cookies.valid ?? 0} 个有效账号` : doubaoStateError ?? "没有有效 Cookie，登录后才能生成"}</span>
                  {!doubaoUsable && <button onClick={() => setDoubaoWorkspaceOpen(true)}>去登录</button>}
                </div>
              </>
            )}

            {(showNormalizeToggle || showDenoiseToggle) && (
              <div className="toggleRow">
                {showNormalizeToggle && (
                  <button
                    className={normalizeText ? "toggle active parameterHint" : "toggle parameterHint"}
                    data-tooltip={voxcpm2ParameterHints.normalize}
                    onClick={() => setNormalizeText((value) => !value)}
                  >
                    <CheckCircle2 size={16} strokeWidth={1.9} />
                    <span>文本正则化</span>
                  </button>
                )}
                {showDenoiseToggle && (
                  <button
                    className={denoise ? "toggle active parameterHint tooltipEnd" : "toggle parameterHint tooltipEnd"}
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
              <button className="secondaryAction" disabled={!result} onClick={() => void openOutputDirectory()}>
                <FolderOpen size={17} strokeWidth={1.9} />
                <span>查看成品</span>
              </button>
            </div>
          </section>
        </aside>

        <section className="mainStage">
          <section className="softPanel canvasPanel">
            <div className="engineStrip">
              <div className="engineHeader">
                <Cpu size={18} strokeWidth={1.9} />
                <div>
                  <span>模型引擎</span>
                  {modelSwitchLocked && (
                    <small className="modelSwitchLock" title={modelSwitchLockMessage}>
                      <Lock size={12} strokeWidth={2} />
                      模型切换已锁定
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
                {models.map((model) => (
                  <button
                    key={model.id}
                    className={model.id === selectedModel ? "modelPill active" : "modelPill"}
                    aria-pressed={model.id === selectedModel}
                    onClick={() => requestModelSwitch(model.id)}
                    title={
                      model.id === "doubao-web"
                        ? "切换到豆包云端模型；不会释放当前本地 GPU 模型"
                        : modelSwitchLocked && model.id !== selectedModel
                          ? modelSwitchLockMessage
                          : model.display_name
                    }
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
            </div>

            <div className="taskCanvas">
              {loading ? (
                <div className="generatingState">
                  <div className="pulseBadge">
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
                    <div className="generationProgressBar" aria-label="生成进度">
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
                  <button className="secondaryAction forceStopGeneration" onClick={() => void onForceStopActiveGeneration()}>
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
                </div>
              )}
            </div>

            <div className="editorDock">
              <div className="editorTools">
                <button className="dockButton" onClick={() => fileInputRef.current?.click()}>
                  <FileText size={17} strokeWidth={1.9} />
                  <span>导入 TXT</span>
                </button>
                <button className="dockButton" onClick={() => setInput("")}>
                  <Trash2 size={17} strokeWidth={1.9} />
                  <span>清空文本</span>
                </button>
                <button className="roundAdd" title="创建批量任务" onClick={openBatchProjectWorkspace}>
                  <Plus size={18} strokeWidth={2} />
                </button>
                <div className="drawControl" role="group" aria-label="抽卡生成条数" title="同一参数串行生成多条候选；不会并行占用显存。">
                  <span>抽卡</span>
                  {([2, 3, 4] as const).map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={drawCount === count ? "active" : ""}
                      disabled={loading}
                      aria-pressed={drawCount === count}
                      onClick={() => setDrawCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <button className="secondaryAction drawGenerateButton" disabled={!canGenerate} onClick={() => void onDrawGenerate()} title="同一参数串行生成多条候选，完成后可挑选试听">
                  {loading ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} strokeWidth={1.9} />}
                  <span>抽 {drawCount} 条</span>
                </button>
                <button className="primaryAction editorGenerateButton" disabled={!canGenerate} onClick={onGenerate}>
                  {loading ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} strokeWidth={1.9} />}
                  <span>{loading ? "生成中" : "开始生成"}</span>
                </button>
                <input ref={fileInputRef} className="hiddenFile" type="file" accept=".txt,text/plain" onChange={onImportText} />
              </div>
              <textarea
                className="targetText"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="目标文本"
              />
              <div className="editorFoot">
                <span>{input.trim().length} 字</span>
                {showNormalizeToggle && <span>{normalizeText ? "文本正则化开" : "文本正则化关"}</span>}
                {showDenoiseToggle && <span>{denoise ? "降噪开" : "降噪关"}</span>}
              </div>
            </div>
          </section>

          <section className="softPanel playerPanel">
            <button className="playButton" disabled={!result} onClick={togglePlayback}>
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
              className={resultSavedToVoiceLibrary ? "voiceSaveButton saved" : "voiceSaveButton"}
              disabled={!result || voiceSaving || resultSavedToVoiceLibrary}
              onClick={() => void onAddResultToVoiceLibrary()}
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
          </section>
        </section>

        <aside className="rightRail" aria-label="运行与系统监控">
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
              <button className="modalClose" title="关闭系统监控" onClick={() => setMonitorPanelOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="monitorDrawerBody">
              {renderSystemMonitorPanels()}
            </div>
          </aside>
        </div>
      )}

      {voiceManagerOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="音色库管理">
          <section className="settingsDialog voiceManagerDialog">
            <header className="settingsHeader">
              <div>
                <strong>音色库管理</strong>
                <span>每个音色只保留一条参考音频及对应提示词，可直接打包到其他生产环境。</span>
              </div>
              <button className="modalClose" title="关闭" onClick={() => setVoiceManagerOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody voiceManagerBody">
              {visibleManagedVoices.length === 0 ? (
                <div className="voiceManagerEmpty">
                  <Library size={24} strokeWidth={1.7} />
                  <strong>还没有已保存的音色</strong>
                  <span>可以从左侧导入参考音频、B 站取样，或把生成结果加入音色库。</span>
                </div>
              ) : (
                <div className="voiceManagerLayout">
                  <aside className="voiceManagerList" aria-label="音色列表">
                    {visibleManagedVoices.map((voice) => (
                      <button
                        key={voice.id}
                        type="button"
                        className={voice.id === managedVoice?.id ? "voiceManagerListItem active" : "voiceManagerListItem"}
                        onClick={() => selectManagedVoice(voice)}
                      >
                        <span className="voiceAvatar" style={{ "--avatar-bg": voice.background } as CSSProperties} aria-hidden="true">{voice.initials}</span>
                        <span>
                          <strong>{voice.name}</strong>
                          <small>{voice.modelBinding ? "GPT-SoVITS 专属权重" : voice.referenceAudioManaged ? "参考音频已托管" : "外部参考路径"}</small>
                        </span>
                      </button>
                    ))}
                  </aside>

                  {managedVoice && (
                    <section className="voiceManagerDetail">
                      <div className="voiceManagerSummary">
                        <div>
                          <strong>{managedVoice.referenceAudioManaged ? "文件已托管" : "外部路径"}</strong>
                          <span>{getFileBaseName(managedVoice.referenceAudio ?? "本地音色")}</span>
                        </div>
                        <button className="pathPickButton" type="button" disabled={voiceManagerAction !== null || recognizingVoiceIds.includes(managedVoice.id)} onClick={() => void onReplaceVoiceReference()}>
                          {voiceManagerAction === "replace-audio" ? <Loader2 className="spin" size={15} /> : <Upload size={15} strokeWidth={1.9} />}
                          <span>替换音频</span>
                        </button>
                      </div>
                      <p className="voiceManagerHint">
                        替换时可先试听和裁切，再保存到音色目录；是否识别参考文字由你在保存前决定。极致克隆和 GPT-SoVITS 使用前仍建议核对文本。
                      </p>
                      <label className="settingsField">
                        <span>音色名称（可重命名）</span>
                        <input value={voiceManagerDraft.name} onChange={(event) => setVoiceManagerDraft((draft) => ({ ...draft, name: event.target.value }))} />
                      </label>
                      <label className="settingsField voiceManagerPromptField">
                        <span>参考音频原文</span>
                        <textarea
                          value={voiceManagerDraft.referenceText}
                          placeholder="填写这条参考音频实际说的内容"
                          disabled={recognizingVoiceIds.includes(managedVoice.id)}
                          onChange={(event) => setVoiceManagerDraft((draft) => ({ ...draft, referenceText: event.target.value }))}
                        />
                      </label>
                      <button
                        className="pathPickButton"
                        type="button"
                        disabled={voiceManagerAction !== null || !managedVoice.referenceAudio || recognizingVoiceIds.includes(managedVoice.id)}
                        onClick={() => void onRecognizeManagedVoiceReference()}
                      >
                        {voiceManagerAction === "recognize" || recognizingVoiceIds.includes(managedVoice.id) ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} strokeWidth={1.9} />}
                        <span>{recognizingVoiceIds.includes(managedVoice.id) ? "正在自动识别" : "识别参考文本"}</span>
                      </button>
                      <div className="voiceManagerMetadata">
                        <span>来源：{voiceSourceLabel(managedVoice.sourceType)}</span>
                        {managedVoice.modelBinding && <span>限定模型：GPT-SoVITS</span>}
                        <span>授权：{managedVoice.authorizationStatus ?? "未标注"}</span>
                      </div>
                    </section>
                  )}
                </div>
              )}

              {(voiceManagerError || voiceManagerMessage) && (
                <div className={voiceManagerError ? "settingsFeedback error" : "settingsFeedback"}>
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
              <button className="primaryAction settingsAction" type="button" disabled={!managedVoice || voiceManagerAction !== null} onClick={() => void onSaveVoiceManagerDetails()}>
                {voiceManagerAction === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>保存名称和原文</span>
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
              <button className="modalClose" title="取消导入" disabled={referenceAudioEditorSaving} onClick={closeReferenceAudioEditor}>
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
                <span>音色名称</span>
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
                  <small>会按需启动 VoxCPM2 识别当前选中片段；识别结果仍可在音色库中校对和修改。</small>
                </span>
              </label>

              {referenceAudioEditorError && (
                <div className="settingsFeedback error">
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
                <span>{referenceAudioEditorSaving ? "正在保存" : "保存到音色库"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {doubaoWorkspaceOpen && <DoubaoWorkspace initialTab="accounts" onClose={() => {
        setDoubaoWorkspaceOpen(false);
        void loadDoubaoState();
      }} />}

      {audioLibraryOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="音频资产库">
          <section className="settingsDialog audioLibraryDialog">
            <header className="settingsHeader">
              <div>
                <strong>音频资产库</strong>
                <span>输出目录 · 本地预览 · 任务可追溯</span>
              </div>
              <button className="modalClose" title="关闭" onClick={() => setAudioLibraryOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody audioLibraryBody">
              <div className="audioLibraryControls">
                <label className="audioLibraryField audioLibrarySearchField">
                  <span>搜索音频</span>
                  <input
                    value={audioLibrarySearch}
                    placeholder="文件名、模型、文本或项目名称"
                    onChange={(event) => setAudioLibrarySearch(event.target.value)}
                  />
                </label>
                <label className="audioLibraryField">
                  <span>来源</span>
                  <select value={audioLibrarySource} onChange={(event) => setAudioLibrarySource(event.target.value)}>
                    <option value="all">全部来源</option>
                    <option value="speech">单句生成</option>
                    <option value="batch_project">批量旁白</option>
                    <option value="untracked">输出目录文件</option>
                  </select>
                </label>
                <button className="pathPickButton audioLibraryRefresh" disabled={audioLibraryLoading || audioLibraryAction !== null} onClick={() => void loadAudioAssets()}>
                  {audioLibraryLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                  <span>刷新</span>
                </button>
              </div>

              <div className="audioLibraryCount">
                <span>显示 {visibleAudioAssets.length} / {audioAssets.length} 个 WAV 资产</span>
                <span>只读扫描，不会移动或删除文件</span>
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
                  <strong>{audioAssets.length === 0 ? "输出目录中暂无 WAV 音频" : "没有匹配的音频资产"}</strong>
                  <span>{audioAssets.length === 0 ? "完成一次生成后，音频会自动出现在这里。" : "尝试调整搜索词或来源筛选。"}</span>
                </div>
              ) : (
                <div className="audioLibraryLayout">
                  <div className="audioAssetList" aria-label="音频资产列表">
                    {visibleAudioAssets.map((asset) => (
                      <button
                        key={asset.file_path}
                        className={asset.file_path === selectedAudioAsset?.file_path ? "audioAssetRow active" : "audioAssetRow"}
                        onClick={() => setSelectedAudioAssetPath(asset.file_path)}
                      >
                        <div>
                          <strong>{asset.file_name}</strong>
                          <span>{asset.model ?? "未关联模型"} · {formatAssetSize(asset.file_size_bytes)} · {formatHistoryTime(asset.modified_at)}</span>
                        </div>
                        <em className={asset.source}>{audioAssetSourceLabel(asset.source)}</em>
                      </button>
                    ))}
                  </div>

                  {selectedAudioAsset && (
                    <aside className="audioAssetPreview">
                      <div className="audioAssetPreviewHeader">
                        <div>
                          <strong>{selectedAudioAsset.file_name}</strong>
                          <span>{audioAssetSourceLabel(selectedAudioAsset.source)}</span>
                        </div>
                        <span>{selectedAudioAsset.duration_seconds ? formatDuration(selectedAudioAsset.duration_seconds) : formatAssetSize(selectedAudioAsset.file_size_bytes)}</span>
                      </div>
                      <audio controls preload="metadata" src={toAudioUrl(selectedAudioAsset.audio_url)} />
                      <div className="audioAssetMeta">
                        <span>模型</span><strong>{selectedAudioAsset.model ?? "未关联"}</strong>
                        <span>生成时间</span><strong>{formatHistoryTime(selectedAudioAsset.modified_at)}</strong>
                        <span>来源</span><strong>{selectedAudioAsset.project_title ?? audioAssetSourceLabel(selectedAudioAsset.source)}</strong>
                      </div>
                      <p className="audioAssetText">{selectedAudioAsset.text || "该文件不带任务文本记录。"}</p>
                      <div className="audioAssetActions">
                        <button className="pathPickButton" disabled={audioLibraryAction !== null} onClick={() => void onOpenAudioAsset(selectedAudioAsset)}>
                          {audioLibraryAction === `open-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} strokeWidth={1.9} />}
                          <span>打开音频</span>
                        </button>
                        <button className="pathPickButton" disabled={audioLibraryAction !== null} onClick={() => void onAddAudioAssetToVoiceLibrary(selectedAudioAsset)}>
                          {audioLibraryAction === `voice-${selectedAudioAsset.file_path}` ? <Loader2 className="spin" size={15} /> : <Save size={15} strokeWidth={1.9} />}
                          <span>加入音色库</span>
                        </button>
                      </div>
                    </aside>
                  )}
                </div>
              )}
            </div>

            {(audioLibraryError || audioLibraryMessage) && (
              <div className={audioLibraryError ? "settingsFeedback error" : "settingsFeedback"}>
                {audioLibraryError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{audioLibraryError ?? audioLibraryMessage}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" onClick={() => setAudioLibraryOpen(false)}>
                <X size={16} strokeWidth={1.9} />
                <span>关闭</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {taskCenterOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="任务中心">
          <section className="settingsDialog taskCenterDialog">
            <header className="settingsHeader">
              <div>
                <strong>任务中心</strong>
                <span>真实后端阶段 · 串行队列 · 失败诊断</span>
              </div>
              <button className="modalClose" title="关闭" onClick={() => {
                setTaskHistoryClearConfirmOpen(false);
                setTaskCenterOpen(false);
              }}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody taskCenterBody">
              <div className="taskCenterSummary">
                <div>
                  <span>当前任务</span>
                  <strong>{taskCenterTasks.length}</strong>
                </div>
                <div>
                  <span>进行中</span>
                  <strong>{taskCenterTasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "cancelling").length}</strong>
                </div>
                <div>
                  <span>可重试</span>
                  <strong>{taskCenterTasks.filter((task) => task.retryable).length}</strong>
                </div>
                <span className="taskCenterSummaryActions">
                  <button className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void loadTaskSummaries()}>
                    <RefreshCw size={15} strokeWidth={1.9} />
                    <span>刷新</span>
                  </button>
                  <button
                    className="pathPickButton runtimeStopButton"
                    disabled={taskCenterAction !== null || clearableSpeechTaskCount === 0}
                    onClick={() => {
                      setTaskCenterError(null);
                      setTaskCenterMessage(null);
                      setTaskHistoryClearConfirmOpen(true);
                    }}
                  >
                    <Trash2 size={15} strokeWidth={1.9} />
                    <span>清理历史</span>
                  </button>
                </span>
              </div>

              {taskHistoryClearConfirmOpen && (
                <div className="taskHistoryClearConfirm" role="alertdialog" aria-label="确认清理生成历史">
                  <Trash2 size={21} strokeWidth={1.8} />
                  <div>
                    <strong>清理 {clearableSpeechTaskCount} 条已结束的单句生成记录？</strong>
                    <span>任务记录和诊断日志会删除，输出目录中的 WAV 音频不会删除；排队及生成中的任务也会保留。</span>
                  </div>
                  <span className="taskHistoryClearActions">
                    <button className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => setTaskHistoryClearConfirmOpen(false)}>
                      取消
                    </button>
                    <button className="pathPickButton runtimeStopButton" disabled={taskCenterAction !== null} onClick={() => void onClearSpeechHistory()}>
                      {taskCenterAction === "clear-history" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}
                      <span>{taskCenterAction === "clear-history" ? "清理中" : "确认清理"}</span>
                    </button>
                  </span>
                </div>
              )}

              {taskCenterTasks.length === 0 ? (
                <div className="taskCenterEmpty">
                  <Gauge size={22} strokeWidth={1.7} />
                  <strong>暂无可追踪任务</strong>
                  <span>单句生成、批量旁白和 B 站取样开始后，会在这里显示真实状态与诊断信息。</span>
                </div>
              ) : (
                <div className="taskCenterList">
                  {taskCenterTasks.map((task) => {
                    const latestEvent = task.events[task.events.length - 1];
                    const isCancelling = taskCenterAction === `cancel-${task.id}`;
                    const isRetrying = taskCenterAction === `retry-${task.id}`;
                    const retryLabel = task.source === "batch_project" && task.status === "cancelled" ? "继续" : "重试";
                    return (
                      <article key={task.id} className={`taskCenterItem ${task.status}`}>
                        <div className="taskCenterItemHeader">
                          <div>
                            <strong>{task.title}</strong>
                            <span>{taskSourceLabel(task.source)} · {task.stage}</span>
                          </div>
                          <span className={`taskCenterStatus ${task.status}`}>{taskStatusLabel(task.status)}</span>
                        </div>
                        <div className="taskCenterProgress" aria-label={`${task.title} 进度`}>
                          <span style={{ width: `${task.progress_percent}%` }} />
                        </div>
                        <div className="taskCenterProgressMeta">
                          <span>{latestEvent?.message ?? "等待任务事件"}</span>
                          <strong>{task.progress_percent}%</strong>
                        </div>
                        {task.error && <div className="taskCenterError"><AlertCircle size={15} strokeWidth={1.9} /><span>{task.error}</span></div>}
                        {task.events.length > 0 && (
                          <div className="taskEventList">
                            {task.events.slice(-3).reverse().map((event, index) => (
                              <div key={`${event.occurred_at}-${index}`} className={event.level === "error" ? "error" : ""}>
                                <span>{formatHistoryTime(event.occurred_at)}</span>
                                <strong>{event.stage}</strong>
                                <em>{event.message}</em>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="taskCenterActions">
                          <button className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void copyTaskDiagnostics(task)}>
                            {taskCenterAction === `copy-${task.id}` ? <Loader2 className="spin" size={15} /> : <Copy size={15} strokeWidth={1.9} />}
                            <span>复制诊断</span>
                          </button>
                          {task.log_file && (
                            <button className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void openTaskLog(task)}>
                              <FileText size={15} strokeWidth={1.9} />
                              <span>打开日志</span>
                            </button>
                          )}
                          {task.cancelable && (
                            <button className="pathPickButton runtimeStopButton" disabled={taskCenterAction !== null} onClick={() => void onCancelTask(task)}>
                              {isCancelling ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}
                              <span>{isCancelling ? "取消中" : "取消"}</span>
                            </button>
                          )}
                          {task.retryable && (
                            <button className="pathPickButton" disabled={taskCenterAction !== null} onClick={() => void onRetryTask(task)}>
                              {isRetrying ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                              <span>{isRetrying ? `${retryLabel}中` : retryLabel}</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {(taskCenterError || taskCenterMessage) && (
              <div className={taskCenterError ? "settingsFeedback error" : "settingsFeedback"}>
                {taskCenterError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{taskCenterError ?? taskCenterMessage}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" onClick={() => {
                setTaskHistoryClearConfirmOpen(false);
                setTaskCenterOpen(false);
              }}>
                <X size={16} strokeWidth={1.9} />
                <span>关闭</span>
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
              <button className="modalClose" title="取消" onClick={() => setPendingModelSwitch(null)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>
            <div className="settingsBody modelSwitchBody">
              <div className="modelSwitchWarning">
                <AlertCircle size={20} strokeWidth={1.9} />
                <div>
                  <strong>{pendingSwitchLoadedModels.join("、")} 仍在显存中</strong>
                  <span>
                    切换到 {models.find((model) => model.id === pendingModelSwitch.targetModelId)?.display_name ?? pendingModelSwitch.targetModelId}
                    后会立即释放这些由 OpenTTS 托管的模型，并开始预热新模型，避免生成时才临时加载。
                  </span>
                </div>
              </div>
              <p className="modelSwitchNote">
                预热期间模型切换会暂时锁定；完成后可以直接生成。以后切回原模型时仍需重新加载到显存。
              </p>
            </div>
            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" onClick={() => setPendingModelSwitch(null)}>
                <span>保留当前模型</span>
              </button>
              <button className="primaryAction settingsAction" onClick={confirmModelSwitch}>
                <Cpu size={16} strokeWidth={1.9} />
                <span>确认切换</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {batchProjectOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="批量项目">
          <section className="settingsDialog batchProjectDialog">
            <header className="settingsHeader">
              <div>
                <strong>批量项目</strong>
                <span>TXT / SRT · 串行队列 · 安全停止与断点继续</span>
              </div>
              <button className="modalClose" title="关闭" onClick={() => setBatchProjectOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody batchProjectBody">
              <div className="settingsGroup batchProjectSetup">
                <div className="settingsGroupTitle">
                  <FileText size={16} strokeWidth={1.9} />
                  <span>项目配置</span>
                </div>
                <div className="batchProjectConfigGrid">
                  <label className="settingsField">
                    <span>项目名称</span>
                    <input value={batchProjectTitle} disabled={batchProjectLocked} onChange={(event) => setBatchProjectTitle(event.target.value)} />
                  </label>
                  <label className="settingsField">
                    <span>模型</span>
                    <select value={batchProjectModel} disabled={batchProjectLocked} onChange={(event) => {
                      const modelId = event.target.value;
                      setBatchProjectModel(modelId);
                      if (modelId === "doubao-web" && !batchProjectDoubaoVoiceId) {
                        setBatchProjectDoubaoVoiceId(selectedDoubaoVoice?.style_id ?? doubaoVoices[0]?.style_id ?? "");
                      }
                    }}>
                      {models.map((model) => <option key={model.id} value={model.id}>{model.display_name}</option>)}
                    </select>
                  </label>
                </div>
                {batchProjectModel === "doubao-web" ? (
                  <div className="batchDoubaoConfig">
                    <label className="settingsField">
                      <span>豆包预设音色</span>
                      <select value={batchProjectDoubaoVoice?.style_id ?? ""} disabled={batchProjectLocked} onChange={(event) => setBatchProjectDoubaoVoiceId(event.target.value)}>
                        {doubaoVoices.map((voice) => <option key={voice.id} value={voice.style_id}>{voice.name} · {[voice.gender, voice.age].filter(Boolean).join(" ")}</option>)}
                      </select>
                    </label>
                    <label className="settingsField">
                      <span>音调（-12 至 12）</span>
                      <input type="number" min={-12} max={12} value={batchProjectDoubaoPitch} disabled={batchProjectLocked} onChange={(event) => setBatchProjectDoubaoPitch(Number(event.target.value))} />
                    </label>
                    <label className="settingsField">
                      <span>语速倍率</span>
                      <input type="number" min={0.5} max={2} step={0.05} value={speed} disabled={batchProjectLocked} onChange={(event) => setSpeed(Number(event.target.value))} />
                    </label>
                    <label className="settingsField">
                      <span>输出格式</span>
                      <select value={batchProjectDoubaoFormat} disabled={batchProjectLocked} onChange={(event) => setBatchProjectDoubaoFormat(event.target.value === "wav" ? "wav" : "mp3")}>
                        <option value="mp3">MP3 · 体积小</option>
                        <option value="wav">WAV · 无损 PCM</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="batchProjectReference">
                    <span>当前音色</span>
                    <strong>{selectedVoiceInfo.name}</strong>
                    <em>{selectedVoiceInfo.referenceAudio ? "会随项目保存参考音频" : "未配置参考音频"}</em>
                  </div>
                )}
                {batchProjectModel === "doubao-web" && (
                  <div className={doubaoUsable ? "batchProjectReference doubaoReady" : "batchProjectReference doubaoWarning"}>
                    <span>云端账号</span>
                    <strong>{doubaoUsable ? `${doubaoStatus?.cookies.valid ?? 0} 个有效 Cookie` : "尚不可用"}</strong>
                    <em>{doubaoUsable ? "批量片段会进入现有串行任务队列" : "草稿可保存，开始生成前需要登录"}</em>
                  </div>
                )}
              </div>

              <div className="settingsGroup modelPackageGroup">
                <div className="settingsGroupTitle">
                  <Library size={16} strokeWidth={1.9} />
                  <span>模型包资产</span>
                  <em>{modelPackages.length} 个已登记</em>
                </div>
                <p className="modelPackageIntro">
                  登记目录或压缩包并保留版本档案。检查仅读取路径、文件大小和适配器所需标记，不加载权重、不占用显存；压缩包不会自动解压。
                </p>
                <div className="modelPackageComposer">
                  <label className="settingsField">
                    <span>目标模型</span>
                    <select value={modelPackageModelId} onChange={(event) => setModelPackageModelId(event.target.value)}>
                      {modelInstances.map((instance) => (
                        <option key={instance.model_id} value={instance.model_id}>{instance.display_name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settingsField">
                    <span>版本标记</span>
                    <input
                      value={modelPackageLabel}
                      maxLength={120}
                      placeholder="例如 v2pro 20250604"
                      onChange={(event) => setModelPackageLabel(event.target.value)}
                    />
                  </label>
                  <label className="settingsField modelPackageNoteField">
                    <span>登记备注</span>
                    <input
                      value={modelPackageNote}
                      maxLength={500}
                      placeholder="可选，例如来源、版本或待验证事项"
                      onChange={(event) => setModelPackageNote(event.target.value)}
                    />
                  </label>
                </div>
                <div className="modelPackageRegisterActions">
                  <button
                    className="secondaryAction settingsAction"
                    disabled={modelPackageAction !== null || modelInstances.length === 0}
                    onClick={() => void onRegisterModelPackage("directory")}
                  >
                    {modelPackageAction === "register-directory" ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} strokeWidth={1.9} />}
                    <span>{modelPackageAction === "register-directory" ? "登记中" : "登记目录包"}</span>
                  </button>
                  <button
                    className="secondaryAction settingsAction"
                    disabled={modelPackageAction !== null || modelInstances.length === 0}
                    onClick={() => void onRegisterModelPackage("archive")}
                  >
                    {modelPackageAction === "register-archive" ? <Loader2 className="spin" size={16} /> : <Upload size={16} strokeWidth={1.9} />}
                    <span>{modelPackageAction === "register-archive" ? "登记中" : "登记压缩包"}</span>
                  </button>
                </div>
                <div className="modelPackageList">
                  {modelPackages.length === 0 ? (
                    <div className="modelPackageEmpty">
                      <strong>尚未发现可管理的模型包</strong>
                      <span>先登记现有目录或本地压缩包；当前已配置目录会在后端可用时自动入库。</span>
                    </div>
                  ) : (
                    modelPackages.map((modelPackage) => {
                      const packageModel = modelInstances.find((instance) => instance.model_id === modelPackage.model_id);
                      const inspectionPending = modelPackageAction === `inspect-${modelPackage.id}`;
                      const activationPending = modelPackageAction === `activate-${modelPackage.id}`;
                      const archivePending = modelPackageAction === `archive-${modelPackage.id}`;
                      const actionPending = inspectionPending || activationPending || archivePending;
                      const canActivate = modelPackage.source_kind === "directory"
                        && modelPackage.inspection.ready_for_activation
                        && modelPackage.state !== "stable";
                      return (
                        <div key={modelPackage.id} className={`modelPackageCard ${modelPackage.state}`}>
                          <div className="modelPackageHeader">
                            <div>
                              <strong>{packageModel?.display_name ?? modelPackage.model_id}</strong>
                              <span>{modelPackage.package_label || "未标记版本"}</span>
                            </div>
                            <span className={`modelPackageState ${modelPackage.state}`}>{modelPackageStateLabel(modelPackage.state)}</span>
                          </div>
                          <div className="modelPackagePath"><span>{modelPackage.path}</span></div>
                          <div className="modelPackageMeta">
                            <span>{modelPackageSourceLabel(modelPackage.source_kind)}</span>
                            <span>{formatPackageSize(modelPackage.inspection.size_bytes, modelPackage.inspection.scan_complete)}</span>
                            {modelPackage.inspection.file_count !== null && modelPackage.inspection.file_count !== undefined && (
                              <span>{modelPackage.inspection.scan_complete ? "文件" : "已扫"} {modelPackage.inspection.file_count}</span>
                            )}
                            <span className={`modelPackageAdapter ${modelPackage.inspection.adapter_status}`}>{modelPackageAdapterLabel(modelPackage.inspection.adapter_status)}</span>
                          </div>
                          <p className="modelPackageSummary">{modelPackage.inspection.summary}</p>
                          {modelPackage.user_note && <p className="modelPackageNote">{modelPackage.user_note}</p>}
                          {modelPackage.inspection.checks.length > 0 && (
                            <div className="modelPackageChecks">
                              {modelPackage.inspection.checks.map((check) => (
                                <span key={check.id} className={check.passed ? "checkItem passed" : "checkItem failed"}>{check.label}</span>
                              ))}
                            </div>
                          )}
                          <div className="modelPackageActions">
                            <button
                              className="pathPickButton"
                              disabled={modelPackageAction !== null}
                              onClick={() => void onInspectModelPackage(modelPackage)}
                            >
                              {inspectionPending ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                              <span>预检</span>
                            </button>
                            <button
                              className="pathPickButton"
                              disabled={!modelPackage.inspection.exists || modelPackageAction !== null}
                              onClick={() =>
                                void openModelDirectory({
                                  id: modelPackage.id,
                                  display_name: modelPackage.package_label || packageModel?.display_name || modelPackage.model_id,
                                  path: modelPackage.path,
                                  exists: modelPackage.inspection.exists,
                                  kind: "model_package"
                                })
                              }
                            >
                              <FolderOpen size={15} strokeWidth={1.9} />
                              <span>打开</span>
                            </button>
                            <button
                              className="pathPickButton modelPackageActivateButton"
                              title="切换会更新当前模型目录和稳定包标记，不会启动模型。"
                              disabled={!canActivate || modelPackageAction !== null}
                              onClick={() => void onActivateModelPackage(modelPackage)}
                            >
                              {activationPending ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} strokeWidth={1.9} />}
                              <span>启用稳定包</span>
                            </button>
                            <button
                              className="pathPickButton"
                              disabled={modelPackage.state === "stable" || modelPackageAction !== null || actionPending}
                              onClick={() => void onArchiveModelPackage(modelPackage)}
                            >
                              {archivePending ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} strokeWidth={1.9} />}
                              <span>归档</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <Upload size={16} strokeWidth={1.9} />
                  <span>导入与分段</span>
                </div>
                <div className="batchProjectImportRow">
                  <button className="pathPickButton" disabled={batchProjectLocked} onClick={() => batchFileInputRef.current?.click()}>
                    <FileText size={15} strokeWidth={1.9} />
                    <span>导入 TXT / SRT</span>
                  </button>
                  <button className="pathPickButton" disabled={batchProjectLocked} onClick={() => setBatchProjectSegments((segments) => [...segments, ""])}>
                    <Plus size={15} strokeWidth={1.9} />
                    <span>新增片段</span>
                  </button>
                  <input ref={batchFileInputRef} className="hiddenFile" type="file" accept=".txt,.srt,.vtt,text/plain" onChange={onImportBatchSource} />
                  <span>{batchProjectSegmentCount} 个有效片段</span>
                </div>
                {batchProjectSegments.length === 0 ? (
                  <div className="batchProjectEmpty">
                    <FileText size={20} strokeWidth={1.8} />
                    <strong>导入文本或字幕开始项目</strong>
                    <span>TXT 按行/段落分段，SRT/VTT 会自动去除时间轴。</span>
                  </div>
                ) : (
                  <div className="batchSegmentList">
                    {batchProjectSegments.map((segment, index) => {
                      const segmentState = editingBatchProject?.segments[index];
                      return (
                        <div key={`${editingBatchProjectId ?? "new"}-${index}`} className="batchSegmentItem">
                          <span>{index + 1}</span>
                          <textarea
                            value={segment}
                            rows={2}
                            disabled={batchProjectLocked}
                            placeholder="输入本段文本"
                            onChange={(event) => updateBatchSegment(index, event.target.value)}
                          />
                          {segmentState && <em className={`batchSegmentState ${segmentState.status}`}>{batchSegmentStatusLabel(segmentState.status)}</em>}
                          <button className="pathPickButton batchSegmentRemove" disabled={batchProjectLocked || batchProjectSegments.length === 1} onClick={() => removeBatchSegment(index)} title="移除片段">
                            <Trash2 size={15} strokeWidth={1.9} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <Library size={16} strokeWidth={1.9} />
                  <span>项目队列</span>
                </div>
                {batchProjects.length === 0 ? (
                  <div className="batchProjectEmpty compact">
                    <Library size={19} strokeWidth={1.8} />
                    <span>尚无已保存的批量项目</span>
                  </div>
                ) : (
                  <div className="batchProjectList">
                    {batchProjects.slice(0, 8).map((project) => {
                      const progress = batchProjectProgress(project);
                      return (
                        <div key={project.id} className={project.id === editingBatchProjectId ? "batchProjectRow active" : "batchProjectRow"}>
                          <button className="batchProjectSelect" onClick={() => editBatchProject(project)}>
                            <div>
                              <strong>{project.title}</strong>
                              <span>{project.model} · {progress.completed}/{progress.total} 完成{progress.failed ? ` · ${progress.failed} 失败` : ""}</span>
                            </div>
                            <em className={project.status}>{batchProjectStatusLabel(project.status)}</em>
                          </button>
                          <div className="batchProjectRowActions">
                            {project.status === "failed" ? (
                              <button className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onRunExistingBatchProject(project, true)}>
                                {batchProjectAction === "retry" ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} strokeWidth={1.9} />}
                                <span>重试</span>
                              </button>
                            ) : project.status === "cancelled" ? (
                              <button className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onResumeBatchProject(project)}>
                                {batchProjectAction === "resume" ? <Loader2 className="spin" size={15} /> : <Play size={15} strokeWidth={1.9} />}
                                <span>继续</span>
                              </button>
                            ) : project.status === "cancelling" ? (
                              <button className="pathPickButton runtimeStopButton" disabled>
                                <Loader2 className="spin" size={15} />
                                <span>停止中</span>
                              </button>
                            ) : project.status === "queued" || project.status === "running" ? (
                              <button className="pathPickButton runtimeStopButton" disabled={Boolean(batchProjectAction)} onClick={() => void onCancelBatchProject(project)}>
                                {batchProjectAction === "cancel" ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}
                                <span>{project.status === "running" ? "安全停止" : "取消队列"}</span>
                              </button>
                            ) : (
                              <button className="pathPickButton" disabled={Boolean(batchProjectAction)} onClick={() => void onRunExistingBatchProject(project)}>
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
              </div>
            </div>

            {(batchProjectError || batchProjectMessage) && (
              <div className={batchProjectError ? "settingsFeedback error" : "settingsFeedback"}>
                {batchProjectError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{batchProjectError ?? batchProjectMessage}</span>
              </div>
            )}

            <footer className="settingsFooter batchProjectFooter">
              <button className="secondaryAction settingsAction" onClick={() => void openBatchOutputDirectory()}>
                <FolderOpen size={16} strokeWidth={1.9} />
                <span>打开输出</span>
              </button>
              {batchProjectCanStop && editingBatchProject && (
                <button className="secondaryAction settingsAction runtimeStopButton" disabled={Boolean(batchProjectAction)} onClick={() => void onCancelBatchProject(editingBatchProject)}>
                  {batchProjectAction === "cancel" ? <Loader2 className="spin" size={16} /> : <Pause size={16} strokeWidth={1.9} />}
                  <span>{editingBatchProject.status === "running" ? "当前段后停止" : "取消队列"}</span>
                </button>
              )}
              {batchProjectCanResume && editingBatchProject && (
                <button className="secondaryAction settingsAction" disabled={Boolean(batchProjectAction)} onClick={() => void onResumeBatchProject(editingBatchProject)}>
                  {batchProjectAction === "resume" ? <Loader2 className="spin" size={16} /> : <Play size={16} strokeWidth={1.9} />}
                  <span>继续生成</span>
                </button>
              )}
              <button className="secondaryAction settingsAction" disabled={batchProjectLocked || Boolean(batchProjectAction)} onClick={() => void saveBatchProject(false)}>
                {batchProjectAction === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>保存草稿</span>
              </button>
              <button className="primaryAction settingsAction" disabled={batchProjectLocked || Boolean(batchProjectAction)} onClick={() => void saveBatchProject(true)}>
                {batchProjectAction === "run" ? <Loader2 className="spin" size={16} /> : <Play size={16} strokeWidth={1.9} />}
                <span>保存并生成</span>
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
                className="modalClose"
                title={samplerExtracting ? "取消取样" : "关闭"}
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
                      <button className="pathPickButton" disabled={samplerBusy} onClick={() => void onSamplerLogout()}>
                        {samplerPendingAction === "logout" ? <Loader2 className="spin" size={15} /> : <LogOut size={15} strokeWidth={1.9} />}
                        <span>退出</span>
                      </button>
                    ) : (
                      <>
                        <button className="pathPickButton" disabled={samplerBusy} onClick={() => void onSamplerStartLogin()}>
                          {samplerPendingAction === "login" ? <Loader2 className="spin" size={15} /> : <LogIn size={15} strokeWidth={1.9} />}
                          <span>扫码登录</span>
                        </button>
                        <button className="pathPickButton" disabled={samplerBusy || !samplerQrPayload} onClick={() => void onSamplerPollLogin()}>
                          {samplerPendingAction === "poll-login" ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} strokeWidth={1.9} />}
                          <span>确认</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {samplerQrPayload && !samplerState.loginSession.isLoggedIn && (
                  <div className="samplerQrPanel">
                    <div className="samplerQrBox">
                      {samplerQrCodeUrl ? <img src={samplerQrCodeUrl} alt="B 站登录二维码" /> : <Loader2 className="spin" size={20} />}
                    </div>
                    <span>扫码并在手机确认后，点击确认。</span>
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
                  <button className="pathPickButton" disabled={samplerBusy || !samplerLink.trim()} onClick={() => void onSamplerParseLink()}>
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

                  {samplerState.audioOptionSummary && (
                    <div className={samplerState.audioOptionSummary.hasAudio ? "samplerAudioStatus ready" : "samplerAudioStatus warning"}>
                      {samplerState.audioOptionSummary.hasAudio ? <CheckCircle2 size={16} strokeWidth={1.9} /> : <AlertCircle size={16} strokeWidth={1.9} />}
                      <span>{samplerState.audioOptionSummary.hasAudio ? "音频流可用" : samplerState.audioOptionSummary.disabledReason ?? "没有可用音频流"}</span>
                    </div>
                  )}

                  <div className="samplerClipGrid">
                    <label className="settingsField samplerField">
                      <span>开始秒</span>
                      <input
                        type="number"
                        min={0}
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
                        min={0}
                        step="0.1"
                        value={samplerEndSeconds}
                        placeholder="留空"
                        onChange={(event) => setSamplerEndSeconds(event.target.value)}
                      />
                    </label>
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
              <div className={samplerFeedbackIsError ? "settingsFeedback error" : "settingsFeedback"}>
                {samplerFeedbackIsError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{samplerFeedback}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button
                className="secondaryAction settingsAction"
                disabled={samplerBusy && !samplerExtracting}
                onClick={() => void onSamplerCancel()}
              >
                {samplerPendingAction === "cancel-extract" ? <Loader2 className="spin" size={16} /> : <X size={16} strokeWidth={1.9} />}
                <span>{samplerExtracting ? "取消任务" : "关闭"}</span>
              </button>
              <button className="primaryAction settingsAction" disabled={!samplerCanExtract} onClick={() => void onSamplerExtractAndSave()}>
                {samplerPendingAction === "extract" || samplerExtracting ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                <span>{samplerPendingAction === "extract" || samplerExtracting ? "取样中" : "取样入库"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="设置">
          <section className="settingsDialog">
            <header className="settingsHeader">
              <div>
                <strong>设置</strong>
                <span>{appSettings?.settings_file ?? "本地用户配置"}</span>
              </div>
              <button className="modalClose" title="关闭" onClick={() => setSettingsOpen(false)}>
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="settingsBody">
              <div className="settingsGroup appUpdateGroup">
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

              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <Cpu size={16} strokeWidth={1.9} />
                  <span>本地模型</span>
                </div>
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
                          <button className="pathPickButton" onClick={() => void onCheckModelInstance(instance)} disabled={checkingModelId === instance.model_id}>
                            {checkingModelId === instance.model_id ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} strokeWidth={1.9} />}
                            <span>检查</span>
                          </button>
                          {runtimeControllable && (
                            <button
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
                              className="pathPickButton runtimeStopButton"
                              title={runtimeWorker?.managed ? "停止本软件托管的运行时并释放显存。" : "外部服务不会被本软件停止。"}
                              onClick={() => void onStopModelRuntime(instance)}
                              disabled={runtimeActionPending || !runtimeWorker?.can_stop}
                            >
                              {runtimeActionPending ? <Loader2 className="spin" size={15} /> : <Pause size={15} strokeWidth={1.9} />}
                              <span>{instance.model_id === "indextts2" ? "释放显存" : "停止服务"}</span>
                            </button>
                          )}
                          <button className="pathPickButton" onClick={() => void chooseModelInstanceDirectory(instance)}>
                            <FolderOpen size={15} strokeWidth={1.9} />
                            <span>选择目录</span>
                          </button>
                          <button
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
                          <button className="pathPickButton" onClick={() => void onToggleModelInstance(instance)}>
                            <ShieldCheck size={15} strokeWidth={1.9} />
                            <span>{instance.enabled ? "禁用" : "启用"}</span>
                          </button>
                          <button
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
                          prewarm_default_model_on_startup: modelId === "doubao-web" ? false : draft.prewarm_default_model_on_startup
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
                      <span>{settingsDraft.default_model_id === "doubao-web" ? "豆包是云端模型，不需要加载权重；启动时只会检查账号与音色状态。" : "后台加载模型权重，不会自动生成语音；会占用对应显存，并先处理其他本软件托管模型。"}</span>
                    </div>
                    <button
                      type="button"
                      className={settingsDraft.prewarm_default_model_on_startup ? "settingsPrewarmToggle active" : "settingsPrewarmToggle"}
                      aria-pressed={settingsDraft.prewarm_default_model_on_startup}
                      disabled={settingsDraft.default_model_id === "doubao-web"}
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
                <label className="settingsField">
                  <span>IndexTTS2 空闲释放显存</span>
                  <input
                    type="number"
                    min={30}
                    max={86400}
                    step={30}
                    value={settingsDraft.indextts2_idle_timeout_seconds}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        indextts2_idle_timeout_seconds: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label className="settingsField">
                  <span>VoxCPM2 / GPT-SoVITS 空闲停止服务</span>
                  <input
                    type="number"
                    min={30}
                    max={86400}
                    step={30}
                    value={settingsDraft.local_api_idle_timeout_seconds}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        local_api_idle_timeout_seconds: Number(event.target.value)
                      }))
                    }
                  />
                </label>
              </div>

              <div className="settingsGroup">
                <div className="settingsGroupTitle">
                  <FolderOpen size={16} strokeWidth={1.9} />
                  <span>文件输出</span>
                </div>
                <label className="settingsField">
                  <span>输出目录</span>
                  <div className="settingsPathInput">
                    <input
                      value={settingsDraft.output_dir}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, output_dir: event.target.value }))}
                    />
                    <button className="pathPickButton" onClick={() => void chooseDirectoryForSetting("output_dir")}>
                      <FolderOpen size={15} strokeWidth={1.9} />
                      <span>选择</span>
                    </button>
                  </div>
                </label>
              </div>

              <div className="settingsGroup">
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

              <div className="settingsGroup settingsMigrationGroup">
                <div className="settingsGroupTitle">
                  <Save size={16} strokeWidth={1.9} />
                  <span>备份与迁移</span>
                </div>
                <p className="settingsMigrationDescription">
                  备份模型目录、启用状态、稳定包标记和运行时设置；不会包含 API 密钥、音色文件、生成音频或项目内容。
                </p>
                <div className="settingsMigrationActions">
                  <button
                    className="secondaryAction settingsAction"
                    disabled={settingsMigrationAction !== null}
                    onClick={() => void onExportSettingsBackup()}
                  >
                    {settingsMigrationAction === "export" ? <Loader2 className="spin" size={16} /> : <Download size={16} strokeWidth={1.9} />}
                    <span>{settingsMigrationAction === "export" ? "导出中" : "导出备份"}</span>
                  </button>
                  <button
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
              <div className={settingsError ? "settingsFeedback error" : "settingsFeedback"}>
                {settingsError ? <AlertCircle size={16} strokeWidth={1.9} /> : <CheckCircle2 size={16} strokeWidth={1.9} />}
                <span>{settingsError ?? settingsMessage}</span>
              </div>
            )}

            <footer className="settingsFooter">
              <button className="secondaryAction settingsAction" onClick={() => setSettingsDraft(createSettingsDraft(appSettings))}>
                <RefreshCw size={16} strokeWidth={1.9} />
                <span>恢复</span>
              </button>
              <button className="primaryAction settingsAction" onClick={onSaveSettings} disabled={settingsSaving}>
                {settingsSaving ? <Loader2 className="spin" size={16} /> : <Save size={16} strokeWidth={1.9} />}
                <span>{settingsSaving ? "保存中" : "保存设置"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
