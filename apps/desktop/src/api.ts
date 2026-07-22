import type {
  AudioAsset,
  AppSettings,
  AppSettingsUpdate,
  BatchProject,
  BatchProjectCreate,
  BatchProjectExport,
  BatchProjectUpdate,
  CreateVoiceRequest,
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
  VoiceQualityReport,
  VoiceInfo
} from "./types";

declare global {
  interface Window {
    desktopConfig?: {
      apiBase: string;
    };
  }
}

const FALLBACK_API_BASE = "http://127.0.0.1:8765";

export function getApiBase(): string {
  return window.desktopConfig?.apiBase ?? FALLBACK_API_BASE;
}

export type GenerateSpeechOptions = {
  referenceAudio?: string;
  referenceText?: string;
  emotion?: string;
  speed?: number;
  cfg?: number;
  inferenceSteps?: number;
  normalize?: boolean;
  denoise?: boolean;
};

function buildSpeechPayload(model: string, input: string, options: GenerateSpeechOptions = {}) {
  return {
    model,
    input,
    reference_audio: options.referenceAudio,
    reference_text: options.referenceText,
    emotion: options.emotion,
    response_format: "wav",
    speed: options.speed ?? 1,
    cfg: options.cfg,
    inference_steps: options.inferenceSteps,
    normalize: options.normalize,
    denoise: options.denoise
  };
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(`${getApiBase()}/v1/tts/models`);
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

export async function fetchVoiceQuality(voiceId: string): Promise<VoiceQualityReport> {
  const response = await fetch(`${getApiBase()}/v1/tts/voices/${voiceId}/quality`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(payload?.detail ?? `Failed to inspect voice quality: ${response.status}`);
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

export function cancelSpeechJob(jobId: string): Promise<SpeechJob> {
  return jobRequest<SpeechJob>(`/v1/tts/jobs/${jobId}/cancel`, { method: "POST" });
}

export function retrySpeechJob(jobId: string): Promise<SpeechJob> {
  return jobRequest<SpeechJob>(`/v1/tts/jobs/${jobId}/retry`, { method: "POST" });
}

export async function fetchTaskSummaries(): Promise<TaskSummary[]> {
  const payload = await jobRequest<{ tasks: TaskSummary[] }>("/v1/tasks");
  return payload.tasks;
}

export async function fetchAudioAssets(): Promise<AudioAsset[]> {
  const payload = await jobRequest<{ assets: AudioAsset[] }>("/v1/audio-assets");
  return payload.assets;
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

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await fetch(`${getApiBase()}/v1/system/status`);
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
