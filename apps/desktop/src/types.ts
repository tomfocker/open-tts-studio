export type ModelInfo = {
  id: string;
  display_name: string;
  priority: string;
  source_url: string;
  code_license: string;
  weights_license: string;
  commercial_use: "allowed" | "restricted" | "unknown";
  recommended_vram_gb: number;
  features: string[];
  request_capabilities?: string[];
  native_sample_rate: number;
  adapter: string;
};

export type SpeechResult = {
  audio_url: string;
  file_path: string;
  model: string;
  sample_rate: number;
  duration_seconds: number;
};

export type TranscriptionBackend = "sensevoice" | "qwen3";
export type TranscriptionOutputFormat = "txt" | "srt";
export type TranscriptionJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TranscriptionInputInfo = {
  id: string;
  file_name: string;
  file_size_bytes: number;
};

export type TranscriptionToken = {
  text: string;
  start_seconds: number;
  end_seconds: number;
};

export type TranscriptionSegment = {
  id: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
};

export type TranscriptionJobRequest = {
  input_id: string;
  source_file_name: string;
  backend: TranscriptionBackend;
  output_format: TranscriptionOutputFormat;
  language: string;
};

export type TranscriptionJob = {
  id: string;
  status: TranscriptionJobStatus;
  input_id: string;
  source_file_name: string;
  source_file_size_bytes: number;
  backend: TranscriptionBackend;
  output_format: TranscriptionOutputFormat;
  language: string;
  stage: string;
  progress_percent: number;
  model?: string | null;
  duration_seconds?: number | null;
  text?: string | null;
  tokens: TranscriptionToken[];
  segments: TranscriptionSegment[];
  warnings: string[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  retry_of?: string | null;
};

export type AudioEnhancementBackend = "deepfilternet3" | "mossformer2-se-48k";
export type AudioEnhancementPreset = "light" | "standard" | "strong";
export type AudioEnhancementJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AudioEnhancementInputInfo = {
  id: string;
  file_name: string;
  file_size_bytes: number;
};

export type AudioEnhancementOutput = {
  backend: AudioEnhancementBackend;
  model: string;
  audio_url: string;
  file_path: string;
  sample_rate: number;
  duration_seconds: number;
};

export type AudioEnhancementJobRequest = {
  input_id: string;
  source_file_name: string;
  backends: AudioEnhancementBackend[];
  preset: AudioEnhancementPreset;
};

export type AudioEnhancementJob = {
  id: string;
  status: AudioEnhancementJobStatus;
  input_id: string;
  source_file_name: string;
  source_file_size_bytes: number;
  backends: AudioEnhancementBackend[];
  preset: AudioEnhancementPreset;
  stage: string;
  progress_percent: number;
  outputs: AudioEnhancementOutput[];
  warnings: string[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  retry_of?: string | null;
};

export type AudioSeparationModel = "mdx-vocals" | "mdx-karaoke" | "mdx23c-instvoc-hq";
export type AudioSeparationJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AudioSeparationInputInfo = {
  id: string;
  file_name: string;
  file_size_bytes: number;
};

export type AudioSeparationOutput = {
  stem: "vocals" | "instrumental";
  audio_url: string;
  file_path: string;
  sample_rate: number;
  duration_seconds: number;
};

export type AudioSeparationJobRequest = {
  input_id: string;
  source_file_name: string;
  model: AudioSeparationModel;
};

export type AudioSeparationJob = {
  id: string;
  status: AudioSeparationJobStatus;
  input_id: string;
  source_file_name: string;
  source_file_size_bytes: number;
  model: AudioSeparationModel;
  model_display_name: string;
  stage: string;
  progress_percent: number;
  outputs: AudioSeparationOutput[];
  warnings: string[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  retry_of?: string | null;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type AppUpdateStatus = "unavailable" | "idle" | "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "installing" | "error";

export type AppUpdateState = {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion?: string | null;
  releaseNotes?: string | null;
  progressPercent?: number | null;
  message: string;
};

export type TaskEvent = {
  occurred_at: string;
  stage: string;
  message: string;
  level: string;
};

export type SpeechJob = {
  id: string;
  status: JobStatus;
  request: SpeechRequest;
  result?: SpeechResult | null;
  error?: string | null;
  stage: string;
  progress_percent: number;
  events: TaskEvent[];
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  log_file?: string | null;
  retry_of?: string | null;
};

export type AudioAsset = {
  file_name: string;
  file_path: string;
  audio_url: string;
  file_size_bytes: number;
  modified_at: string;
  source: "speech" | "batch_project" | "untracked" | string;
  model?: string | null;
  text?: string | null;
  duration_seconds?: number | null;
  task_id?: string | null;
  project_id?: string | null;
  project_title?: string | null;
};

export type TaskSummary = {
  id: string;
  source: "speech" | "batch_project" | "bilibili" | string;
  title: string;
  status: string;
  stage: string;
  progress_percent: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  log_file?: string | null;
  retryable: boolean;
  cancelable: boolean;
  events: TaskEvent[];
};

export type SpeechRequest = {
  model: string;
  input: string;
  voice?: string | null;
  voice_prompt?: string | null;
  reference_audio?: string | null;
  reference_text?: string | null;
  emotion?: string | null;
  language?: string | null;
  response_format?: string;
  speed?: number;
  pitch?: number;
  cfg?: number | null;
  inference_steps?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  num_beams?: number | null;
  repetition_penalty?: number | null;
  max_mel_tokens?: number | null;
  normalize?: boolean | null;
  denoise?: boolean | null;
  stream?: boolean;
};

export type BatchProjectStatus = "draft" | "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";

export type BatchSegmentStatus = "pending" | "running" | "succeeded" | "failed";

export type BatchSegmentDraft = {
  text: string;
};

export type BatchSegment = BatchSegmentDraft & {
  id: string;
  position: number;
  status: BatchSegmentStatus;
  attempts: number;
  result?: SpeechResult | null;
  error?: string | null;
};

export type BatchProject = {
  id: string;
  title: string;
  model: string;
  segments: BatchSegment[];
  reference_audio?: string | null;
  reference_text?: string | null;
  emotion?: string | null;
  voice?: string | null;
  pitch: number;
  response_format: "wav" | "mp3" | string;
  speed: number;
  cfg?: number | null;
  inference_steps?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  top_k?: number | null;
  num_beams?: number | null;
  repetition_penalty?: number | null;
  max_mel_tokens?: number | null;
  normalize?: boolean | null;
  denoise?: boolean | null;
  status: BatchProjectStatus;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
};

export type BatchProjectCreate = {
  title: string;
  model: string;
  segments: BatchSegmentDraft[];
  reference_audio?: string;
  reference_text?: string;
  emotion?: string;
  voice?: string;
  pitch?: number;
  response_format?: "wav" | "mp3";
  speed?: number;
  cfg?: number;
  inference_steps?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_beams?: number;
  repetition_penalty?: number;
  max_mel_tokens?: number;
  normalize?: boolean;
  denoise?: boolean;
};

export type BatchProjectUpdate = Partial<BatchProjectCreate>;

export type BatchProjectExport = {
  project_id: string;
  title: string;
  status: BatchProjectStatus;
  items: Array<{
    position: number;
    text: string;
    status: BatchSegmentStatus;
    audio_url?: string | null;
    file_path?: string | null;
    error?: string | null;
  }>;
};

export type VoiceReference = {
  id: string;
  name: string;
  reference_audio?: string | null;
  reference_text?: string | null;
  source_type: string;
  source_url?: string | null;
  original_reference_audio?: string | null;
  reference_audio_sha256?: string | null;
  reference_audio_managed: boolean;
  created_at: string;
  updated_at: string;
};

export type VoiceInfo = {
  id: string;
  name: string;
  reference_audio?: string | null;
  reference_text?: string | null;
  authorization_status: string;
  source_type: string;
  source_url?: string | null;
  original_reference_audio?: string | null;
  reference_audio_sha256?: string | null;
  reference_audio_managed: boolean;
  references: VoiceReference[];
  active_reference_id?: string | null;
  model_binding?: {
    model_id: string;
    weights: Record<string, string>;
  } | null;
  created_at: string;
  updated_at: string;
};

export type CreateVoiceRequest = {
  name: string;
  reference_audio?: string | null;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
  reference_text?: string | null;
  reference_name?: string | null;
  authorization_status: string;
  source_type?: string;
  source_url?: string | null;
  model_binding?: {
    model_id: string;
    weights: Record<string, string>;
  } | null;
};

export type UpdateVoiceRequest = Partial<Pick<VoiceInfo, "name" | "reference_audio" | "reference_text" | "authorization_status" | "source_type" | "source_url">> & {
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
};

export type CreateVoiceReferenceRequest = {
  name: string;
  reference_audio: string;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
  reference_text?: string | null;
  source_type?: string;
  source_url?: string | null;
};

export type UpdateVoiceReferenceRequest = Partial<Pick<VoiceReference, "name" | "reference_audio" | "reference_text" | "source_type" | "source_url">> & {
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
};

export type VoicePackageExport = {
  file_name: string;
  export_path: string;
};

export type VoiceQualityStatus = "ready" | "warning" | "error" | "unknown";

export type VoiceQualityReport = {
  voice_id: string;
  reference_audio?: string | null;
  exists: boolean;
  readable?: boolean | null;
  format?: string | null;
  file_size_bytes?: number | null;
  duration_seconds?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
  analyzed_seconds?: number | null;
  silence_ratio?: number | null;
  status: VoiceQualityStatus;
  warnings: string[];
};

export type VoiceAudioRepair = {
  voice: VoiceInfo;
  converted: boolean;
};

export type IpcResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type BilibiliLinkKind = "video" | "episode" | "season";

export type BilibiliSamplerStage =
  | "idle"
  | "parsing"
  | "loading-audio-options"
  | "downloading-video"
  | "downloading-audio"
  | "converting"
  | "merging"
  | "completed"
  | "failed"
  | "cancelled";

export type BilibiliLoginSession = {
  isLoggedIn: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  expiresAt: string | null;
};

export type BilibiliParsedPageItem = {
  id: string;
  kind: "page";
  title: string;
  page: number;
};

export type BilibiliParsedEpisodeItem = {
  id: string;
  kind: "episode";
  title: string;
  epId: string;
};

export type BilibiliParsedSeasonItem = {
  id: string;
  kind: "season";
  title: string;
  seasonId: string;
};

export type BilibiliParsedItem =
  | BilibiliParsedPageItem
  | BilibiliParsedEpisodeItem
  | BilibiliParsedSeasonItem;

export type BilibiliParsedLink =
  | {
      kind: "video";
      bvid: string;
      page?: number;
      title: string | null;
      coverUrl: string | null;
      items: BilibiliParsedPageItem[];
      selectedItemId: string;
    }
  | {
      kind: "episode";
      epId: string;
      title: string | null;
      coverUrl: string | null;
      items: BilibiliParsedEpisodeItem[];
      selectedItemId: string;
    }
  | {
      kind: "season";
      seasonId: string;
      title: string | null;
      coverUrl: string | null;
      items: BilibiliParsedSeasonItem[];
      selectedItemId: string;
    };

export type BilibiliAudioOptionSummary = {
  hasAudio: boolean;
  hasVideo: boolean;
  disabledReason: string | null;
  videoDisabledReason: string | null;
};

export type BilibiliAudioOption = {
  qn: number;
  label: string;
  selected: boolean;
  available: boolean;
};

export type BilibiliVideoQuality = {
  qn: number;
  label: string;
  width: number | null;
  height: number | null;
  codec: string | null;
  requestedQn: number;
  fellBack: boolean;
};

export type BilibiliAudioOptionsResult = {
  itemId: string;
  qnOptions: BilibiliAudioOption[];
  summary: BilibiliAudioOptionSummary;
  selectedVideo: BilibiliVideoQuality | null;
};

export type BilibiliSamplerState = {
  loginSession: BilibiliLoginSession;
  parsedLink: BilibiliParsedLink | null;
  selection: {
    itemId: string | null;
    qn: number | null;
  };
  audioOptionSummary: BilibiliAudioOptionSummary | null;
  taskStage: BilibiliSamplerStage;
  error: string | null;
};

export type BilibiliLoginQrPayload = {
  qrUrl: string;
  authCode: string;
};

export type BilibiliPollLoginPayload = {
  status: "pending" | "scanned" | "confirmed" | "expired" | "invalid";
  loginSession?: BilibiliLoginSession;
};

export type BilibiliExtractSampleRequest = {
  startSeconds?: number | null;
  endSeconds?: number | null;
  sampleName?: string;
};

export type BilibiliExtractSampleResult = {
  audioPath: string;
  sourceAudioPath: string;
  durationSeconds: number;
  sampleRate: number;
  title: string | null;
  itemTitle: string | null;
};

export type BilibiliExtractLocalSampleResult = {
  audioPath: string;
  durationSeconds: number;
  sampleRate: number;
};

export type BilibiliDownloadVideoRequest = {
  fileName?: string;
};

export type BilibiliDownloadVideoResult = {
  videoPath: string;
  title: string | null;
  itemTitle: string | null;
  videoQuality: BilibiliVideoQuality | null;
  previewUrl?: string | null;
};

export type BilibiliMediaHistoryEntry = {
  id: string;
  title: string | null;
  itemTitle: string | null;
  videoQuality: BilibiliVideoQuality | null;
  fileSizeBytes: number;
  downloadedAt: string;
  exists: boolean;
};

export type BilibiliMediaHistoryItem = BilibiliMediaHistoryEntry & {
  previewUrl: string;
};

export type WorkerStatus = {
  model: string;
  loaded: boolean;
  state: "loaded" | "released" | string;
  idle_timeout_seconds?: number;
  idle_seconds?: number | null;
  release_in_seconds?: number | null;
  last_started_at?: number | null;
  last_used_at?: number | null;
  api_base?: string;
  root?: string;
  managed?: boolean;
  can_stop?: boolean;
  active_requests?: number;
  health?: "ok" | "unresponsive" | "not_checked" | string;
};

export type ModelRuntimeActionResult = {
  model_id: string;
  action: "start" | "stop";
  released?: boolean;
  released_models?: string[];
  worker: WorkerStatus;
};

export type ModelInstanceStatus = "ready" | "untested" | "missing" | "broken" | "disabled";

export type RuntimeType = "worker_lazy_pack" | "lazy_pack_api" | "reserved";

export type ModelHealthCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string | null;
};

export type ModelHealthResult = {
  model_id: string;
  status: ModelInstanceStatus;
  checks: ModelHealthCheck[];
  repair_hint?: string | null;
  checked_at: string;
};

export type ModelHealthHistoryEntry = {
  status: ModelInstanceStatus;
  checked_at: string;
  repair_hint?: string | null;
  failed_check_ids: string[];
};

export type ModelInstanceProfile = {
  model_id: string;
  display_name: string;
  enabled: boolean;
  runtime_type: RuntimeType;
  root_path?: string | null;
  api_host?: string | null;
  api_port?: number | null;
  package_label?: string | null;
  user_note?: string | null;
  status: ModelInstanceStatus;
  last_health_check_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  health_history: ModelHealthHistoryEntry[];
};

export type ModelInstancesResponse = {
  instances: ModelInstanceProfile[];
};

export type ModelInstanceUpdate = {
  enabled?: boolean;
  root_path?: string | null;
  api_host?: string | null;
  api_port?: number | null;
  package_label?: string | null;
  user_note?: string | null;
};

export type SystemStatus = {
  api: {
    status: string;
    uptime_seconds: number;
    started_at: number;
  };
  system: {
    cpu_percent: number | null;
    memory_total_mb: number | null;
    memory_used_mb: number | null;
    memory_percent: number | null;
  };
  gpu: {
    available: boolean;
    name: string | null;
    utilization_percent: number | null;
    memory_used_mb: number | null;
    memory_total_mb: number | null;
    memory_percent: number | null;
  };
  workers: {
    indextts2: WorkerStatus;
    voxcpm2: WorkerStatus;
    gptsovits: WorkerStatus;
  };
  model_instances?: Record<
    string,
    Pick<
      ModelInstanceProfile,
      "enabled" | "status" | "root_path" | "last_health_check_at" | "last_success_at" | "last_error"
    >
  >;
};

export type AppSettings = {
  api_host: string;
  api_port: number;
  output_dir: string;
  model_store_root: string;
  indextts2_root: string;
  indextts2_idle_timeout_seconds: number;
  local_api_idle_timeout_seconds: number;
  asr_backend: "sensevoice" | "qwen3";
  sensevoice_model_installed: boolean;
  sensevoice_runtime_installed: boolean;
  sensevoice_ready: boolean;
  qwen_asr_model_installed: boolean;
  qwen_runtime: {
    cuda_available: boolean;
    cuda_python_installed: boolean;
    cuda_llama_backend_installed: boolean;
    dml_runtime_available: boolean;
    asr: QwenRuntimeResolution;
    alignment: QwenRuntimeResolution;
  };
  alignment_ready: boolean;
  audio_enhancement_python: string;
  audio_enhancement_runtime_installed: boolean;
  audio_enhancement_device: "auto" | "cuda" | "cpu";
  deepfilternet3_root: string;
  deepfilternet3_model_installed: boolean;
  mossformer2_se_root: string;
  mossformer2_se_model_installed: boolean;
  audio_enhancement_ready: boolean;
  voxcpm2_root: string;
  voxcpm2_api_host: string;
  voxcpm2_api_port: number;
  gptsovits_root: string;
  gptsovits_api_host: string;
  gptsovits_api_port: number;
  default_model_id: "indextts2" | "voxcpm2" | "gptsovits" | "doubao-web";
  prewarm_default_model_on_startup: boolean;
  settings_file: string;
  restart_required_fields: string[];
};

export type QwenRuntimeResolution = {
  requested_device: "auto" | "cuda" | "dml" | "cpu";
  active_device: "cuda" | "dml" | "cpu" | null;
  label: string;
  error: string | null;
};

export type AppSettingsUpdate = Partial<
  Pick<
    AppSettings,
    | "api_host"
    | "api_port"
    | "output_dir"
    | "indextts2_root"
    | "indextts2_idle_timeout_seconds"
    | "local_api_idle_timeout_seconds"
    | "asr_backend"
    | "audio_enhancement_python"
    | "audio_enhancement_device"
    | "deepfilternet3_root"
    | "mossformer2_se_root"
    | "voxcpm2_root"
    | "voxcpm2_api_host"
    | "voxcpm2_api_port"
    | "gptsovits_root"
    | "gptsovits_api_host"
    | "gptsovits_api_port"
    | "default_model_id"
    | "prewarm_default_model_on_startup"
  >
>;

export type SettingsBackupModelInstance = {
  enabled: boolean;
  root_path?: string | null;
  api_host?: string | null;
  api_port?: number | null;
  package_label?: string | null;
  user_note?: string | null;
};

export type SettingsBackup = {
  schema: "open-tts-studio-settings";
  version: 1;
  created_at: string;
  settings: Pick<
    AppSettings,
    | "api_host"
    | "api_port"
    | "output_dir"
    | "indextts2_idle_timeout_seconds"
    | "local_api_idle_timeout_seconds"
    | "asr_backend"
    | "audio_enhancement_python"
    | "audio_enhancement_device"
    | "deepfilternet3_root"
    | "mossformer2_se_root"
    | "default_model_id"
    | "prewarm_default_model_on_startup"
  >;
  model_instances: Record<string, SettingsBackupModelInstance>;
  model_packages?: ModelPackageRecord[];
};

export type ModelDirectory = {
  id: string;
  display_name: string;
  path: string;
  exists: boolean;
  kind: string;
};

export type ModelDirectoriesResponse = {
  directories: ModelDirectory[];
};

export type ModelPackageSourceKind = "directory" | "archive";

export type ModelPackageState = "candidate" | "stable" | "archived";

export type ModelPackageAdapterStatus = "ready" | "incomplete" | "reserved" | "archive";

export type ModelPackageCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string | null;
};

export type ModelPackageInspection = {
  exists: boolean;
  path_type: string;
  size_bytes?: number | null;
  file_count?: number | null;
  scan_complete: boolean;
  checks: ModelPackageCheck[];
  adapter_status: ModelPackageAdapterStatus;
  ready_for_activation: boolean;
  summary: string;
  inspected_at: string;
};

export type ModelPackageRecord = {
  id: string;
  model_id: string;
  path: string;
  source_kind: ModelPackageSourceKind;
  package_label?: string | null;
  user_note?: string | null;
  state: ModelPackageState;
  inspection: ModelPackageInspection;
  registered_at: string;
  updated_at: string;
};

export type ModelPackageCreate = {
  model_id: string;
  path: string;
  package_label?: string | null;
  user_note?: string | null;
};

export type ModelPackageUpdate = {
  package_label?: string | null;
  user_note?: string | null;
  state?: Exclude<ModelPackageState, "stable">;
};

export type ModelPackageActivation = {
  package: ModelPackageRecord;
  instance: ModelInstanceProfile;
};

export type DoubaoApiEnvelope<T> = {
  success: boolean;
  code?: number;
  data: T;
  message?: string;
  total?: number;
};

export type DoubaoCookieRotation = {
  strategy: string;
  autoRotate: boolean;
  usageLimitEnabled: boolean;
  usageCountPerCookie: number;
  currentIndex: number;
};

export type DoubaoCookieStats = {
  total: number;
  enabled: number;
  disabled: number;
  valid: number;
  invalid: number;
  active: { id: string; name: string } | null;
  totalRequests: number;
  totalRotations: number;
  averageSuccessRate: number;
  lastUpdated: string;
  rotation: DoubaoCookieRotation;
};

export type DoubaoCookieRecord = {
  id: string;
  name: string;
  value?: string;
  hasValue?: boolean;
  valuePreview?: string;
  description: string;
  status: {
    isActive: boolean;
    isValid: boolean;
    isDisabled: boolean;
    lastValidated: string | null;
    validationStatus: "pending" | "valid" | "invalid" | string;
    lastError: string | null;
    lastFailure: string | null;
  };
  usage: {
    usageCount: number;
    lastUsed: string | null;
    successCount: number;
    failureCount: number;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
    tags: string[];
    priority: number;
    weight: number;
  };
  limits: {
    maxUsageCount: number;
    maxRequestsPerMinute: number;
    currentMinuteCount: number;
    customUsageLimit: number;
  };
};

export type DoubaoStatus = {
  service: {
    status: string;
    uptimeMs: number;
    version: string;
  };
  provider: "doubao-web" | string;
  status: "ready" | "needs_cookie" | string;
  endpoint: string;
  cookies: DoubaoCookieStats;
  queue: { size: number };
};

export type DoubaoVoice = {
  id: string;
  name: string;
  language: string;
  language_code: string;
  style_id: string;
  gender: string;
  age: string;
  tags: string[];
};

export type DoubaoQrSession = {
  sessionId: string;
  qrCodeUrl: string;
  qrCodeImg: string;
  expiresIn: number;
};

export type DoubaoQrStatus = {
  status: "pending" | "scanned" | "confirmed" | "expired" | string;
  message: string;
};

export type LegadoBook = {
  bookUrl: string;
  name?: string;
  bookName?: string;
  author?: string;
  coverUrl?: string;
  coverUrlPath?: string;
  totalChapters?: number;
  durChapterIndex?: number;
  durChapterTitle?: string;
  [key: string]: unknown;
};

export type LegadoChapter = {
  index: number;
  title: string;
  url?: string;
  chapterIndex?: number;
  chapterTitle?: string;
  chapterUrl?: string;
  isVolume?: boolean;
  [key: string]: unknown;
};

export type DoubaoPrefetchChapterState = {
  chapterId: string;
  chapterTitle: string;
  chapterIndex?: number;
  status: string;
  completedSegments: number;
  totalSegments: number;
  error?: string | null;
};

export type DoubaoPrefetchTask = {
  taskId: string;
  bookInfo: {
    bookId: string;
    bookName?: string;
    name?: string;
    bookUrl: string;
  };
  status: "processing" | "paused" | "completed" | "partial" | "failed" | "cancelled" | "cancelling" | string;
  progress: {
    current: number;
    total: number;
    completed: string[];
    failed: Array<{ chapterId: string; error: string }>;
  };
  chapters: DoubaoPrefetchChapterState[];
  options?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DoubaoCachedBook = {
  bookId?: string;
  bookUrl?: string;
  name?: string;
  bookName?: string;
  author?: string;
  source?: "cache" | "prefetch" | string;
  status?: string;
  totalChapters?: number;
  cachedChapters?: number;
  totalSize?: number;
  size?: number;
  updatedAt?: string;
  cachedAt?: string;
  [key: string]: unknown;
};

export type DoubaoCachedChapter = {
  index: number;
  title: string;
  url?: string;
  chapterId?: string;
};

export type DoubaoPrefetchCacheDetail = {
  exists: boolean;
  index: {
    bookId?: string;
    chapterId?: string;
    chapterTitle?: string;
    content?: string;
    segments?: Array<{
      segmentId?: string;
      text?: string;
      audioFile?: string | null;
      fileSize?: number;
      error?: string | null;
    }>;
    metadata?: {
      status?: string;
      totalSegments?: number;
      completedSegments?: number;
      updatedAt?: string;
    };
  } | null;
};

export type DoubaoCacheStats = {
  totalBooks?: number;
  totalChapters?: number;
  totalSize?: number;
  cacheSize?: number;
  [key: string]: unknown;
};

export type DoubaoLegacySettings = {
  prefetch: { cacheConcurrent: number };
  tts: {
    requestDelay: number;
    requestIntervalDelay: number;
    maxRetries: number;
  };
  system: { logLevel: string };
  version: string;
  updatedAt: string;
};

export type DoubaoDeviceId = {
  deviceId: string;
  webId: string;
  autoGenerate: boolean;
  lastUpdated: string;
};

export type DoubaoDocument = {
  id: string;
  filename: string;
  name: string;
  path: string;
  downloadUrl?: string | null;
  size: number;
  modifiedTime: string;
  extension?: string;
  content?: string;
  createdTime?: string;
};
