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

export type VoiceInfo = {
  id: string;
  name: string;
  reference_audio?: string | null;
  reference_text?: string | null;
  authorization_status: string;
};

export type CreateVoiceRequest = {
  name: string;
  reference_audio?: string | null;
  reference_text?: string | null;
  authorization_status: string;
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
  | "downloading-audio"
  | "converting"
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
  disabledReason: string | null;
};

export type BilibiliAudioOption = {
  qn: number;
  label: string;
  selected: boolean;
  available: boolean;
};

export type BilibiliAudioOptionsResult = {
  itemId: string;
  qnOptions: BilibiliAudioOption[];
  summary: BilibiliAudioOptionSummary;
};

export type BilibiliSamplerState = {
  loginSession: BilibiliLoginSession;
  parsedLink: BilibiliParsedLink | null;
  selection: {
    itemId: string | null;
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
};

export type ModelRuntimeActionResult = {
  model_id: string;
  action: "start" | "stop";
  released?: boolean;
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
  indextts2_root: string;
  indextts2_idle_timeout_seconds: number;
  local_api_idle_timeout_seconds: number;
  voxcpm2_root: string;
  voxcpm2_api_host: string;
  voxcpm2_api_port: number;
  gptsovits_root: string;
  gptsovits_api_host: string;
  gptsovits_api_port: number;
  settings_file: string;
  restart_required_fields: string[];
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
    | "voxcpm2_root"
    | "voxcpm2_api_host"
    | "voxcpm2_api_port"
    | "gptsovits_root"
    | "gptsovits_api_host"
    | "gptsovits_api_port"
  >
>;

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
