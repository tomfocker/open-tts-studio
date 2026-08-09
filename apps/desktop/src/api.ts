import type {
  AudioEnhancementInputInfo,
  AudioEnhancementJob,
  AudioEnhancementJobRequest,
  AudioSeparationInputInfo,
  AudioSeparationJob,
  AudioSeparationJobRequest,
  AudioAsset,
  AppSettings,
  AppSettingsUpdate,
  BatchProject,
  BatchProjectCreate,
  BatchProjectExport,
  BatchProjectUpdate,
  CreateVoiceReferenceRequest,
  CreateVoiceRequest,
  DoubaoApiEnvelope,
  DoubaoCacheStats,
  DoubaoCachedBook,
  DoubaoCachedChapter,
  DoubaoCookieRecord,
  DoubaoCookieStats,
  DoubaoDeviceId,
  DoubaoDocument,
  DoubaoLegacySettings,
  DoubaoPrefetchTask,
  DoubaoPrefetchCacheDetail,
  DoubaoQrSession,
  DoubaoQrStatus,
  DoubaoStatus,
  DoubaoVoice,
  LegadoBook,
  LegadoChapter,
  ModelHealthResult,
  ModelDirectoriesResponse,
  ModelDirectory,
  ModelInfo,
  ModelInstanceProfile,
  ModelInstancesResponse,
  ModelInstanceUpdate,
  ModelPackageActivation,
  ModelPackageCreate,
  ModelPackageRecord,
  ModelPackageUpdate,
  ModelRuntimeActionResult,
  SettingsBackup,
  SpeechJob,
  SpeechResult,
  SystemStatus,
  TaskSummary,
  TranscriptionInputInfo,
  TranscriptionJob,
  TranscriptionJobRequest,
  UpdateVoiceRequest,
  UpdateVoiceReferenceRequest,
  VoiceAudioRepair,
  VoicePackageExport,
  VoiceQualityReport,
  VoiceInfo,
  GlobalLlmSettings,
  LlmPolishResult,
  LlmTextTransformOperation,
  LlmTextTransformResult
} from "./types";

declare global {
  interface Window {
    desktopConfig?: {
      apiBase: string;
    };
  }
}

const FALLBACK_API_BASE = "http://127.0.0.1:8765";

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`本地后端在 ${Math.ceil(timeoutMs / 1000)} 秒内未响应`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function getApiBase(): string {
  return window.desktopConfig?.apiBase ?? FALLBACK_API_BASE;
}

export function normalizeLegadoServiceBase(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export type GenerateSpeechOptions = {
  voice?: string;
  referenceAudio?: string;
  referenceText?: string;
  emotion?: string;
  speed?: number;
  pitch?: number;
  responseFormat?: "wav" | "mp3";
  cfg?: number;
  inferenceSteps?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  numBeams?: number;
  repetitionPenalty?: number;
  maxMelTokens?: number;
  normalize?: boolean;
  denoise?: boolean;
};

function buildSpeechPayload(model: string, input: string, options: GenerateSpeechOptions = {}) {
  return {
    model,
    input,
    voice: options.voice,
    reference_audio: options.referenceAudio,
    reference_text: options.referenceText,
    emotion: options.emotion,
    response_format: options.responseFormat ?? "wav",
    speed: options.speed ?? 1,
    pitch: options.pitch,
    cfg: options.cfg,
    inference_steps: options.inferenceSteps,
    temperature: options.temperature,
    top_p: options.topP,
    top_k: options.topK,
    num_beams: options.numBeams,
    repetition_penalty: options.repetitionPenalty,
    max_mel_tokens: options.maxMelTokens,
    normalize: options.normalize,
    denoise: options.denoise
  };
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetchWithTimeout(`${getApiBase()}/v1/tts/models`, undefined, 8_000);
  if (!response.ok) {
    throw new Error(`Failed to load models: ${response.status}`);
  }
  return response.json();
}

export async function fetchVoices(): Promise<VoiceInfo[]> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices`);
  if (!response.ok) {
    throw new Error(`Failed to load voices: ${response.status}`);
  }
  return response.json();
}

export async function createVoice(request: CreateVoiceRequest): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    throw new Error(`Failed to create voice: ${response.status}`);
  }
  return response.json();
}

export async function deleteVoice(voiceId: string): Promise<void> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`Failed to delete voice: ${response.status}`);
  }
}

export async function updateVoice(voiceId: string, request: UpdateVoiceRequest): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to update voice: ${response.status}`);
  }
  return response.json();
}

export async function createVoiceReference(voiceId: string, request: CreateVoiceReferenceRequest): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to add voice reference: ${response.status}`);
  }
  return response.json();
}

export async function updateVoiceReference(voiceId: string, referenceId: string, request: UpdateVoiceReferenceRequest): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/references/${referenceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to update voice reference: ${response.status}`);
  }
  return response.json();
}

export async function activateVoiceReference(voiceId: string, referenceId: string): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/references/${referenceId}/activate`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to activate voice reference: ${response.status}`);
  }
  return response.json();
}

export async function deleteVoiceReference(voiceId: string, referenceId: string): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/references/${referenceId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to delete voice reference: ${response.status}`);
  }
  return response.json();
}

export async function exportVoicePackage(voiceId: string): Promise<VoicePackageExport> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/export`, {
    method: "POST",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to export voice package: ${response.status}`);
  }
  return response.json();
}

export async function importVoicePackage(packagePath: string): Promise<VoiceInfo> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ package_path: packagePath })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to import voice package: ${response.status}`);
  }
  return response.json();
}

export async function fetchVoiceQuality(voiceId: string): Promise<VoiceQualityReport> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/quality`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to inspect voice quality: ${response.status}`);
  }
  return response.json();
}

export async function repairVoiceAudio(voiceId: string): Promise<VoiceAudioRepair> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/repair-audio`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to repair voice audio: ${response.status}`);
  }
  return response.json();
}

export async function recognizeVoiceReference(voiceId: string): Promise<{ voice_id: string; text: string }> {
  const response = await fetchWithTimeout(
    `${getApiBase()}/v1/tts/voices/${voiceId}/recognize`,
    { method: "POST" },
    360_000
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to recognize voice reference: ${response.status}`);
  }
  return response.json();
}

export async function recognizeVoiceReferenceClip(voiceId: string, referenceId: string): Promise<{ voice_id: string; reference_id: string; text: string }> {
  const response = await fetchWithTimeout(
    `${getApiBase()}/v1/tts/voices/${voiceId}/references/${referenceId}/recognize`,
    { method: "POST" },
    360_000
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to recognize voice reference: ${response.status}`);
  }
  return response.json();
}

export async function generateSpeech(
  model: string,
  input: string,
  options: GenerateSpeechOptions = {}
): Promise<SpeechResult> {
  const response = await fetch(`${getApiBase()}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSpeechPayload(model, input, options))
  });
  if (!response.ok) {
    throw new Error(`Failed to generate speech: ${response.status}`);
  }
  return response.json();
}

async function jobRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Task request failed: ${response.status}`);
  }
  return response.json();
}

export function createSpeechJob(model: string, input: string, options: GenerateSpeechOptions = {}): Promise<SpeechJob> {
  return jobRequest<SpeechJob>("/v1/tts/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSpeechPayload(model, input, options))
  });
}

export function fetchSpeechJob(jobId: string): Promise<SpeechJob> {
  return jobRequest<SpeechJob>(`/v1/tts/jobs/${jobId}`);
}

export function cancelSpeechJob(jobId: string, force = false): Promise<SpeechJob> {
  const suffix = force ? "?force=true" : "";
  return jobRequest<SpeechJob>(`/v1/tts/jobs/${jobId}/cancel${suffix}`, { method: "POST" });
}

export function retrySpeechJob(jobId: string): Promise<SpeechJob> {
  return jobRequest<SpeechJob>(`/v1/tts/jobs/${jobId}/retry`, { method: "POST" });
}

export async function uploadTranscriptionInput(file: File): Promise<TranscriptionInputInfo> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await fetchWithTimeout(`${getApiBase()}/v1/transcriptions/uploads`, { method: "POST", body: formData }, 15 * 60_000);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `媒体导入失败：${response.status}`);
  }
  return response.json();
}

export function createTranscriptionJob(request: TranscriptionJobRequest): Promise<TranscriptionJob> {
  return jobRequest<TranscriptionJob>("/v1/transcriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export function fetchTranscriptionJobs(): Promise<TranscriptionJob[]> {
  return jobRequest<TranscriptionJob[]>("/v1/transcriptions");
}

export function fetchTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return jobRequest<TranscriptionJob>(`/v1/transcriptions/${jobId}`);
}

export function cancelTranscriptionJob(jobId: string, force = false): Promise<TranscriptionJob> {
  const suffix = force ? "?force=true" : "";
  return jobRequest<TranscriptionJob>(`/v1/transcriptions/${jobId}/cancel${suffix}`, { method: "POST" });
}

export function retryTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return jobRequest<TranscriptionJob>(`/v1/transcriptions/${jobId}/retry`, { method: "POST" });
}

export async function fetchTranscriptionExport(jobId: string, format: "txt" | "srt"): Promise<string> {
  const response = await fetchWithTimeout(`${getApiBase()}/v1/transcriptions/${encodeURIComponent(jobId)}/export.${format}`, undefined, 30_000);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `导出失败：${response.status}`);
  }
  return response.text();
}

export async function uploadAudioEnhancementInput(file: File): Promise<AudioEnhancementInputInfo> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await fetchWithTimeout(`${getApiBase()}/v1/audio-enhancements/uploads`, { method: "POST", body: formData }, 15 * 60_000);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `媒体导入失败：${response.status}`);
  }
  return response.json();
}

export function createAudioEnhancementJob(request: AudioEnhancementJobRequest): Promise<AudioEnhancementJob> {
  return jobRequest<AudioEnhancementJob>("/v1/audio-enhancements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export function fetchAudioEnhancementJobs(): Promise<AudioEnhancementJob[]> {
  return jobRequest<AudioEnhancementJob[]>("/v1/audio-enhancements");
}

export function cancelAudioEnhancementJob(jobId: string, force = false): Promise<AudioEnhancementJob> {
  const suffix = force ? "?force=true" : "";
  return jobRequest<AudioEnhancementJob>(`/v1/audio-enhancements/${jobId}/cancel${suffix}`, { method: "POST" });
}

export function retryAudioEnhancementJob(jobId: string): Promise<AudioEnhancementJob> {
  return jobRequest<AudioEnhancementJob>(`/v1/audio-enhancements/${jobId}/retry`, { method: "POST" });
}

export async function uploadAudioSeparationInput(file: File): Promise<AudioSeparationInputInfo> {
  const formData = new FormData();
  formData.set("file", file, file.name);
  const response = await fetchWithTimeout(`${getApiBase()}/v1/audio-separations/uploads`, { method: "POST", body: formData }, 15 * 60_000);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `媒体导入失败：${response.status}`);
  }
  return response.json();
}

export function createAudioSeparationJob(request: AudioSeparationJobRequest): Promise<AudioSeparationJob> {
  return jobRequest<AudioSeparationJob>("/v1/audio-separations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export function fetchAudioSeparationJobs(): Promise<AudioSeparationJob[]> {
  return jobRequest<AudioSeparationJob[]>("/v1/audio-separations");
}

export function cancelAudioSeparationJob(jobId: string, force = false): Promise<AudioSeparationJob> {
  const suffix = force ? "?force=true" : "";
  return jobRequest<AudioSeparationJob>(`/v1/audio-separations/${jobId}/cancel${suffix}`, { method: "POST" });
}

export function retryAudioSeparationJob(jobId: string): Promise<AudioSeparationJob> {
  return jobRequest<AudioSeparationJob>(`/v1/audio-separations/${jobId}/retry`, { method: "POST" });
}

export function clearSpeechJobHistory(): Promise<{
  removed_jobs: number;
  removed_logs: number;
  retained_active_jobs: number;
}> {
  return jobRequest("/v1/tts/jobs/history", { method: "DELETE" });
}

export async function fetchTaskSummaries(): Promise<TaskSummary[]> {
  const payload = await jobRequest<{ tasks: TaskSummary[] }>("/v1/tasks");
  return payload.tasks;
}

export async function fetchAudioAssets(): Promise<AudioAsset[]> {
  const payload = await jobRequest<{ assets: AudioAsset[] }>("/v1/audio-assets");
  return payload.assets;
}

export async function deleteAudioAsset(assetId: string): Promise<void> {
  const response = await fetch(`${getApiBase()}/v1/audio-assets?asset_id=${encodeURIComponent(assetId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `删除本地音频文件失败：${response.status}`);
  }
}

async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Project request failed: ${response.status}`);
  }
  return response.json();
}

export function fetchBatchProjects(): Promise<BatchProject[]> {
  return projectRequest<BatchProject[]>("/v1/projects");
}

export function createBatchProject(payload: BatchProjectCreate): Promise<BatchProject> {
  return projectRequest<BatchProject>("/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateBatchProject(projectId: string, payload: BatchProjectUpdate): Promise<BatchProject> {
  return projectRequest<BatchProject>(`/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function runBatchProject(projectId: string): Promise<BatchProject> {
  return projectRequest<BatchProject>(`/v1/projects/${projectId}/run`, { method: "POST" });
}

export function retryBatchProject(projectId: string): Promise<BatchProject> {
  return projectRequest<BatchProject>(`/v1/projects/${projectId}/retry`, { method: "POST" });
}

export function cancelBatchProject(projectId: string): Promise<BatchProject> {
  return projectRequest<BatchProject>(`/v1/projects/${projectId}/cancel`, { method: "POST" });
}

export function resumeBatchProject(projectId: string): Promise<BatchProject> {
  return projectRequest<BatchProject>(`/v1/projects/${projectId}/resume`, { method: "POST" });
}

export function fetchBatchProjectExport(projectId: string): Promise<BatchProjectExport> {
  return projectRequest<BatchProjectExport>(`/v1/projects/${projectId}/export`);
}

export async function fetchModelDirectories(): Promise<ModelDirectory[]> {
  const response = await fetch(`${getApiBase()}/v1/model-directories`);
  if (!response.ok) {
    throw new Error(`Failed to load model directories: ${response.status}`);
  }
  const payload = (await response.json()) as ModelDirectoriesResponse;
  return payload.directories;
}

export async function fetchModelInstances(): Promise<ModelInstanceProfile[]> {
  const response = await fetch(`${getApiBase()}/v1/model-instances`);
  if (!response.ok) {
    throw new Error(`Failed to load model instances: ${response.status}`);
  }
  const payload = (await response.json()) as ModelInstancesResponse;
  return payload.instances;
}

export async function updateModelInstance(
  modelId: string,
  update: ModelInstanceUpdate
): Promise<ModelInstanceProfile> {
  const response = await fetch(`${getApiBase()}/v1/model-instances/${modelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    throw new Error(`Failed to update model instance: ${response.status}`);
  }
  return response.json();
}

export async function checkModelInstance(modelId: string): Promise<ModelHealthResult> {
  const response = await fetch(`${getApiBase()}/v1/model-instances/${modelId}/check`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to check model instance: ${response.status}`);
  }
  return response.json();
}

async function modelPackageRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Model package request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchModelPackages(): Promise<ModelPackageRecord[]> {
  const payload = await modelPackageRequest<{ packages: ModelPackageRecord[] }>("/v1/model-packages");
  return payload.packages;
}

export function registerModelPackage(payload: ModelPackageCreate): Promise<ModelPackageRecord> {
  return modelPackageRequest<ModelPackageRecord>("/v1/model-packages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function updateModelPackage(packageId: string, payload: ModelPackageUpdate): Promise<ModelPackageRecord> {
  return modelPackageRequest<ModelPackageRecord>(`/v1/model-packages/${packageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function inspectModelPackage(packageId: string): Promise<ModelPackageRecord> {
  return modelPackageRequest<ModelPackageRecord>(`/v1/model-packages/${packageId}/inspect`, { method: "POST" });
}

export function activateModelPackage(packageId: string): Promise<ModelPackageActivation> {
  return modelPackageRequest<ModelPackageActivation>(`/v1/model-packages/${packageId}/activate`, { method: "POST" });
}

export async function startModelRuntime(modelId: string): Promise<ModelRuntimeActionResult> {
  const response = await fetch(`${getApiBase()}/v1/runtime/models/${modelId}/start`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to start model runtime: ${response.status}`);
  }
  return response.json();
}

export async function stopModelRuntime(modelId: string): Promise<ModelRuntimeActionResult> {
  const response = await fetch(`${getApiBase()}/v1/runtime/models/${modelId}/stop`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to stop model runtime: ${response.status}`);
  }
  return response.json();
}

export type RealtimeRuntimeReservation = {
  reserved: boolean;
  released_models?: string[];
  released_worker?: boolean;
  released_asr?: boolean;
};

export type RealtimeRuntimePrewarm = {
  ready: boolean;
  compile_enabled?: boolean;
  compile_warmed?: boolean;
  compile_seconds?: number | null;
  worker?: {
    loaded?: boolean;
    state?: string;
    managed?: boolean;
    external?: boolean;
  };
  asr?: {
    ready?: boolean;
    device?: "auto" | "cuda" | "cpu";
    cpu_fallback?: boolean;
    worker?: {
      loaded?: boolean;
      state?: string;
      managed?: boolean;
      device?: string;
    };
  };
};

export async function reserveRealtimeRuntime(): Promise<RealtimeRuntimeReservation> {
  const response = await fetch(`${getApiBase()}/v1/realtime/runtime/reserve`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to reserve realtime runtime: ${response.status}`);
  }
  return response.json();
}

export async function prewarmRealtimeRuntime(): Promise<RealtimeRuntimePrewarm> {
  const response = await fetch(`${getApiBase()}/v1/realtime/runtime/prewarm`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to prewarm realtime runtime: ${response.status}`);
  }
  return response.json();
}

export async function releaseRealtimeRuntime(): Promise<RealtimeRuntimeReservation> {
  const response = await fetch(`${getApiBase()}/v1/realtime/runtime/release`, {
    method: "POST"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to release realtime runtime: ${response.status}`);
  }
  return response.json();
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await fetchWithTimeout(`${getApiBase()}/v1/system/status`, undefined, 3_000);
  if (!response.ok) {
    throw new Error(`Failed to load system status: ${response.status}`);
  }
  return response.json();
}

export async function fetchAppSettings(): Promise<AppSettings> {
  const response = await fetch(`${getApiBase()}/v1/settings`);
  if (!response.ok) {
    throw new Error(`Failed to load settings: ${response.status}`);
  }
  return response.json();
}

export async function saveAppSettings(update: AppSettingsUpdate): Promise<AppSettings> {
  const response = await fetch(`${getApiBase()}/v1/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    throw new Error(`Failed to save settings: ${response.status}`);
  }
  return response.json();
}

export type LlmRequestOptions = {
  modelName?: string;
  mode?: string;
};

async function llmRequest<T>(path: string, body: Record<string, unknown>, timeoutMs = 90_000): Promise<T> {
  const response = await fetchWithTimeout(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, timeoutMs);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `LLM 请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function testLlmConnection(settings: GlobalLlmSettings): Promise<{ ok: boolean; model: string; reply: string }> {
  return llmRequest("/v1/llm/test", {
    base_url: settings.baseUrl.trim(),
    model: settings.model.trim(),
    api_key: settings.apiKey,
    temperature: settings.temperature,
    max_tokens: 16
  }, 35_000);
}

export async function polishVoicePrompt(settings: GlobalLlmSettings, keywords: string, options: LlmRequestOptions = {}): Promise<LlmPolishResult> {
  return llmRequest("/v1/llm/polish-prompt", {
    base_url: settings.baseUrl.trim(),
    model: settings.model.trim(),
    api_key: settings.apiKey,
    temperature: settings.temperature,
    max_tokens: Math.max(settings.maxTokens, 256),
    keywords,
    model_name: options.modelName ?? "VoxCPM2",
    mode: options.mode ?? "音色设计"
  });
}

export async function transformLlmText(
  settings: GlobalLlmSettings,
  text: string,
  operation: LlmTextTransformOperation,
  options: { targetLanguage?: string; style?: string } = {}
): Promise<LlmTextTransformResult> {
  return llmRequest("/v1/llm/transform-text", {
    base_url: settings.baseUrl.trim(),
    model: settings.model.trim(),
    api_key: settings.apiKey,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    operation,
    text,
    target_language: options.targetLanguage ?? "中文",
    style: options.style ?? "自然、适合直接朗读"
  }, 130_000);
}

export async function exportSettingsBackup(): Promise<SettingsBackup> {
  const response = await fetch(`${getApiBase()}/v1/settings/export`);
  if (!response.ok) {
    throw new Error(`Failed to export settings: ${response.status}`);
  }
  return response.json();
}

export async function importSettingsBackup(backup: SettingsBackup): Promise<AppSettings> {
  const response = await fetch(`${getApiBase()}/v1/settings/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(backup)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to import settings: ${response.status}`);
  }
  return response.json();
}

export function toAudioUrl(audioUrl: string): string {
  return `${getApiBase()}${audioUrl}`;
}

async function doubaoRequest<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const response = await fetchWithTimeout(`${getApiBase()}${path}`, init, timeoutMs);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string | Array<{ msg?: string }>; message?: string }
      | null;
    const detail = Array.isArray(payload?.detail)
      ? payload?.detail.map((item) => item.msg).filter(Boolean).join("；")
      : payload?.detail;
    throw new Error(detail || payload?.message || `豆包服务请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function doubaoData<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const payload = await doubaoRequest<DoubaoApiEnvelope<T>>(path, init, timeoutMs);
  if (!payload.success) {
    throw new Error(payload.message || "豆包服务返回失败");
  }
  return payload.data;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

export function fetchDoubaoStatus(): Promise<DoubaoStatus> {
  return doubaoData<DoubaoStatus>("/v1/doubao/status");
}

export async function fetchDoubaoVoices(query = "", gender = ""): Promise<DoubaoVoice[]> {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("query", query.trim());
  if (gender) parameters.set("gender", gender);
  const suffix = parameters.size ? `?${parameters}` : "";
  return doubaoData<DoubaoVoice[]>(`/v1/doubao/voices${suffix}`);
}

export async function generateDoubaoSpeech(options: {
  input: string;
  voice: string;
  speed: number;
  pitch: number;
  responseFormat: "mp3" | "wav";
}): Promise<SpeechResult> {
  return doubaoRequest<SpeechResult>(
    "/v1/audio/speech",
    jsonRequest("POST", {
      model: "doubao-web",
      input: options.input,
      voice: options.voice,
      speed: options.speed,
      pitch: options.pitch,
      response_format: options.responseFormat
    }),
    120_000
  );
}

export async function fetchDoubaoCookies(): Promise<{ cookies: DoubaoCookieRecord[]; stats: DoubaoCookieStats }> {
  const payload = await doubaoRequest<DoubaoApiEnvelope<DoubaoCookieRecord[]> & { stats: DoubaoCookieStats }>(
    "/v1/doubao/cookies"
  );
  return { cookies: payload.data, stats: payload.stats };
}

export function fetchDoubaoCookie(cookieId: string, reveal = true): Promise<DoubaoCookieRecord> {
  return doubaoData<DoubaoCookieRecord>(`/v1/doubao/cookies/${encodeURIComponent(cookieId)}?reveal=${reveal}`);
}

export function createDoubaoCookie(payload: { name: string; value: string; description?: string }): Promise<DoubaoCookieRecord> {
  return doubaoData<DoubaoCookieRecord>("/v1/doubao/cookies", jsonRequest("POST", payload));
}

export function updateDoubaoCookie(
  cookieId: string,
  payload: { name?: string; value?: string; description?: string }
): Promise<DoubaoCookieRecord> {
  return doubaoData<DoubaoCookieRecord>(
    `/v1/doubao/cookies/${encodeURIComponent(cookieId)}`,
    jsonRequest("PUT", payload)
  );
}

export function deleteDoubaoCookie(cookieId: string): Promise<unknown> {
  return doubaoRequest(`/v1/doubao/cookies/${encodeURIComponent(cookieId)}`, { method: "DELETE" });
}

export function clearDoubaoCookies(): Promise<{ deleted: number }> {
  return doubaoData<{ deleted: number }>("/v1/doubao/cookies", { method: "DELETE" });
}

export function testDoubaoCookie(cookieId: string): Promise<DoubaoCookieRecord & { isValid: boolean; validationMessage: string }> {
  return doubaoData(`/v1/doubao/cookies/${encodeURIComponent(cookieId)}/test`, { method: "POST" }, 60_000);
}

export function testAllDoubaoCookies(indexes: number[]): Promise<{
  successCount: number;
  failCount: number;
  total: number;
  results: Array<{
    index: number;
    cookieId?: string;
    name?: string;
    success: boolean;
    error?: string;
    result?: { isValid: boolean; message: string; checkedAt: string | null; duration: number | null };
  }>;
}> {
  return doubaoData("/v1/doubao/cookies/batch/test", jsonRequest("POST", { indexes }), 120_000);
}

export function toggleDoubaoCookie(cookieId: string): Promise<DoubaoCookieRecord> {
  return doubaoData(`/v1/doubao/cookies/${encodeURIComponent(cookieId)}/toggle`, { method: "POST" });
}

export function rotateDoubaoCookie(cookieId?: string): Promise<DoubaoCookieRecord> {
  return doubaoData("/v1/doubao/cookies/rotate", jsonRequest("POST", { cookieId: cookieId || null }));
}

export function configureDoubaoCookieRotation(payload: {
  usageLimitEnabled: boolean;
  usageCountPerCookie: number;
}): Promise<DoubaoCookieStats["rotation"]> {
  return doubaoData("/v1/doubao/cookies/rotation-config", jsonRequest("POST", payload));
}

export function setDoubaoCookieUsageLimit(cookieId: string, limit: number): Promise<{ id: string; name: string; limit: number }> {
  return doubaoData(
    `/v1/doubao/cookies/${encodeURIComponent(cookieId)}/usage-limit`,
    jsonRequest("PUT", { limit })
  );
}

export function startDoubaoQrLogin(): Promise<DoubaoQrSession> {
  return doubaoData("/v1/doubao/auth/qr-code", { method: "POST" }, 45_000);
}

export function pollDoubaoQrLogin(sessionId: string): Promise<DoubaoQrStatus> {
  return doubaoData("/v1/doubao/auth/qr-status", jsonRequest("POST", { sessionId }), 45_000);
}

export function confirmDoubaoQrLogin(sessionId: string, cookieName: string): Promise<{ id: string; name: string }> {
  return doubaoData("/v1/doubao/auth/qr-confirm", jsonRequest("POST", { sessionId, cookieName }));
}

export function fetchLegadoBooks(serverIp: string, serverPort: number): Promise<LegadoBook[]> {
  return doubaoData("/api/legado/proxy/bookshelf", jsonRequest("POST", { serverIp, serverPort }), 60_000);
}

export function fetchLegadoChapters(serverIp: string, serverPort: number, bookUrl: string): Promise<LegadoChapter[]> {
  return doubaoData(
    "/api/legado/proxy/chapters",
    jsonRequest("POST", { serverIp, serverPort, bookUrl }),
    60_000
  );
}

export function fetchLegadoChapterContent(
  serverIp: string,
  serverPort: number,
  bookUrl: string,
  chapterIndex: number
): Promise<unknown> {
  return doubaoData(
    "/api/legado/proxy/content",
    jsonRequest("POST", { serverIp, serverPort, bookUrl, chapterIndex }),
    60_000
  );
}

export function generateLegadoBookId(bookUrl: string): Promise<{ bookId: string; bookUrl: string }> {
  return doubaoData(`/api/legado/book-id/generate?bookUrl=${encodeURIComponent(bookUrl)}`);
}

export function startDoubaoPrefetch(payload: {
  bookInfo: { bookId: string; bookName: string; bookUrl: string };
  chaptersInfo: Array<{
    chapterId: string;
    chapterTitle: string;
    chapterUrl?: string;
    chapterIndex: number;
  }>;
  options: Record<string, unknown>;
}): Promise<{ taskId: string; status: string; progress: { total: number; completed: number; failed: number } }> {
  return doubaoData("/api/legado/prefetch/batch-start", jsonRequest("POST", payload));
}

export function fetchDoubaoPrefetchTasks(): Promise<DoubaoPrefetchTask[]> {
  return doubaoData("/api/legado/prefetch/tasks");
}

export function pauseDoubaoPrefetch(taskId: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/prefetch/pause/${encodeURIComponent(taskId)}`, { method: "POST" });
}

export function resumeDoubaoPrefetch(taskId: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/prefetch/resume/${encodeURIComponent(taskId)}`, { method: "POST" });
}

export function cancelDoubaoPrefetch(taskId: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/prefetch/cancel/${encodeURIComponent(taskId)}`, { method: "POST" });
}

export function retryDoubaoPrefetch(taskId: string, chapterId?: string): Promise<unknown> {
  return doubaoRequest(
    `/api/legado/prefetch/retry/${encodeURIComponent(taskId)}`,
    jsonRequest("POST", chapterId ? { chapterId } : {})
  );
}

export function deleteDoubaoPrefetchTask(taskId: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/prefetch/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export function deleteDoubaoPrefetchFiles(taskId: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/prefetch/files/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export function fetchDoubaoPrefetchCacheDetail(bookId: string, chapterId: string): Promise<DoubaoPrefetchCacheDetail> {
  return doubaoData(
    `/api/legado/prefetch/cache/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`
  );
}

export function deleteDoubaoPrefetchChapter(bookId: string, chapterId: string): Promise<unknown> {
  return doubaoRequest(
    `/api/legado/prefetch/chapter/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`,
    { method: "DELETE" }
  );
}

export function startLegadoBookCache(
  bookInfo: LegadoBook,
  serverIp: string,
  serverPort: number
): Promise<Record<string, unknown>> {
  return doubaoData(
    "/api/legado/book-cache/start",
    jsonRequest("POST", { bookInfo, serverIp, serverPort }),
    30 * 60_000
  );
}

export function cancelLegadoBookCache(bookUrl: string): Promise<unknown> {
  return doubaoRequest("/api/legado/book-cache/cancel", jsonRequest("POST", { bookUrl }));
}

export function fetchDoubaoCachedBooks(source?: "cache" | "prefetch"): Promise<DoubaoCachedBook[]> {
  const suffix = source ? `?source=${source}` : "";
  return doubaoData(`/api/legado/book-cache/list${suffix}`);
}

export function fetchDoubaoCacheStats(): Promise<DoubaoCacheStats> {
  return doubaoData("/api/legado/book-cache/stats");
}

export function fetchDoubaoCachedChapters(
  bookUrl: string,
  source?: "cache" | "prefetch" | string
): Promise<DoubaoCachedChapter[]> {
  const parameters = new URLSearchParams({ bookUrl });
  if (source) parameters.set("source", source);
  return doubaoData(`/api/legado/book-cache/chapters?${parameters}`);
}

export function fetchDoubaoCachedChapter(bookUrl: string, chapterIndex: number): Promise<Record<string, unknown>> {
  const parameters = new URLSearchParams({ bookUrl, chapterIndex: String(chapterIndex) });
  return doubaoData(`/api/legado/book-cache/chapter?${parameters}`);
}

export function deleteDoubaoCachedBook(bookUrl: string): Promise<unknown> {
  return doubaoRequest(`/api/legado/book-cache/delete?bookUrl=${encodeURIComponent(bookUrl)}`, { method: "DELETE" });
}

export function clearDoubaoBookCache(type: "cache" | "prefetch" | "all"): Promise<{
  cacheDeletedCount: number;
  prefetchDeletedCount: number;
  totalDeletedCount: number;
}> {
  return doubaoData(`/api/legado/book-cache/clear?type=${type}`, { method: "DELETE" });
}

export function fetchDoubaoLegacySettings(): Promise<DoubaoLegacySettings> {
  return doubaoData("/api/settings");
}

export function saveDoubaoLegacySettings(settings: Partial<DoubaoLegacySettings>): Promise<DoubaoLegacySettings> {
  return doubaoData("/api/settings", jsonRequest("POST", settings));
}

export function resetDoubaoLegacySettings(): Promise<DoubaoLegacySettings> {
  return doubaoData("/api/settings/reset", { method: "POST" });
}

export function fetchDoubaoDeviceId(): Promise<DoubaoDeviceId> {
  return doubaoData("/api/settings/device-id");
}

export function regenerateDoubaoDeviceId(): Promise<DoubaoDeviceId> {
  return doubaoData("/api/settings/device-id/regenerate", { method: "POST" });
}

export function setDoubaoDeviceIdAutoGenerate(enabled: boolean): Promise<DoubaoDeviceId> {
  return doubaoData("/api/settings/device-id/auto-generate", jsonRequest("POST", { enabled }));
}

export function fetchDoubaoDocuments(query = ""): Promise<DoubaoDocument[]> {
  return query.trim()
    ? doubaoData(`/api/docs/search?q=${encodeURIComponent(query.trim())}`)
    : doubaoData("/api/docs");
}

export function fetchDoubaoDocument(documentId: string): Promise<DoubaoDocument> {
  return doubaoData(`/api/docs/${encodeURIComponent(documentId)}`);
}

export function cleanDoubaoLogCache(): Promise<{ deletedCount: number; totalSize: number }> {
  return doubaoData("/api/console/clean-cache");
}

export function deleteDoubaoAudio(filename: string): Promise<{ deleted: boolean }> {
  return doubaoData(`/api/audio/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export function getLegadoRealtimeConfigUrl(voiceId: string, delay: number, serviceBase = getApiBase()): string {
  const base = normalizeLegadoServiceBase(serviceBase);
  if (!base) return "";
  const parameters = new URLSearchParams({ voiceId, delay: String(delay) });
  return `${base}/api/legado/tts-config?${parameters}`;
}

export function getLegadoPrefabConfigUrl(serviceBase = getApiBase()): string {
  const base = normalizeLegadoServiceBase(serviceBase);
  return base ? `${base}/api/legado/tts-config-prefab` : "";
}

export function getLegadoImportUrl(configUrl: string): string {
  const trimmed = configUrl.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
  return `legado://import/httpTTS?src=${encodeURIComponent(parsed.toString())}`;
}

export async function testLegadoTtsConfig(configUrl: string): Promise<{ name: string; streamUrl: string }> {
  const response = await fetchWithTimeout(configUrl, { headers: { Accept: "application/json" } }, 12_000);
  if (!response.ok) {
    throw new Error(`阅读配置地址返回 ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as { name?: unknown; url?: unknown } | null;
  if (!payload || typeof payload.name !== "string" || !payload.name.trim() || typeof payload.url !== "string" || !payload.url.trim()) {
    throw new Error("配置响应缺少有效的 name 或 url 字段");
  }
  return { name: payload.name, streamUrl: payload.url };
}
