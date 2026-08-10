import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileAudio,
  FolderOpen,
  Loader2,
  RotateCw,
  Sparkles,
  Square,
  Upload,
  X
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelAudioEnhancementJob,
  createAudioEnhancementJob,
  fetchAppSettings,
  fetchAudioEnhancementJobs,
  retryAudioEnhancementJob,
  toAudioUrl,
  uploadAudioEnhancementInput
} from "./api";
import type {
  AudioEnhancementBackend,
  AudioEnhancementInputInfo,
  AudioEnhancementJob,
  AudioEnhancementPreset,
  AppSettings
} from "./types";

import "./enhancement-workspace.css";

type EnhancementWorkspaceProps = {
  onClose: () => void;
};

type ManagedDesktopInput = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
};

const MODEL_OPTIONS: Array<{ id: AudioEnhancementBackend; name: string; detail: string }> = [
  { id: "deepfilternet3", name: "DeepFilterNet3", detail: "快速、保守，适合轻度降噪与试听。" },
  { id: "mossformer2-se-48k", name: "MossFormer2_SE_48K", detail: "48 kHz 高质量增强，适合离线对比。" }
];

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function formatTime(value?: number | null): string {
  const total = Math.max(0, Number(value || 0));
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function statusLabel(status: AudioEnhancementJob["status"]): string {
  return { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消" }[status];
}

function stageLabel(stage: string): string {
  return {
    preparing_audio: "准备音频",
    waiting_for_gpu: "等待 GPU",
    running_deepfilternet3: "运行 DeepFilterNet3",
    running_mossformer2_se_48k: "运行 MossFormer2_SE_48K",
    publishing_outputs: "写入结果",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "服务重启中断"
  }[stage] ?? "处理中";
}

function backendLabel(backend: AudioEnhancementBackend): string {
  return MODEL_OPTIONS.find((option) => option.id === backend)?.name ?? "增强模型";
}

function isActive(job: AudioEnhancementJob | null): boolean {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

function outputFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "未命名音频";
}

export function EnhancementWorkspace({ onClose }: EnhancementWorkspaceProps) {
  const [media, setMedia] = useState<ManagedDesktopInput | null>(null);
  const [backends, setBackends] = useState<AudioEnhancementBackend[]>(["deepfilternet3", "mossformer2-se-48k"]);
  const [preset, setPreset] = useState<AudioEnhancementPreset>("standard");
  const [jobs, setJobs] = useState<AudioEnhancementJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Pick<AppSettings,
    "audio_enhancement_runtime_installed"
    | "deepfilternet3_model_installed"
    | "mossformer2_se_model_installed"
  > | null>(null);
  const browserFileRef = useRef<HTMLInputElement | null>(null);
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null, [jobs, selectedJobId]);
  const actionBusy = pendingAction !== null;

  const refreshJobs = async (quiet = false) => {
    try {
      const nextJobs = await fetchAudioEnhancementJobs();
      setJobs(nextJobs);
      setSelectedJobId((current) => current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id || "");
      if (!quiet) setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "读取语音增强任务失败。");
    }
  };

  useEffect(() => {
    void refreshJobs();
    void fetchAppSettings().then((settings) => setReadiness({
      audio_enhancement_runtime_installed: settings.audio_enhancement_runtime_installed,
      deepfilternet3_model_installed: settings.deepfilternet3_model_installed,
      mossformer2_se_model_installed: settings.mossformer2_se_model_installed
    })).catch(() => setReadiness(null));
    const timer = window.setInterval(() => void refreshJobs(true), 1600);
    return () => window.clearInterval(timer);
  }, []);

  const selectMedia = async () => {
    setError(null);
    setMessage(null);
    if (window.desktopFiles?.selectAudioEnhancementMedia) {
      try {
        setPendingAction("select");
        const picked = await window.desktopFiles.selectAudioEnhancementMedia();
        if (picked) {
          setMedia(picked);
          setMessage("媒体已在本地受控暂存，可生成模型对比结果。 ");
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法导入本地媒体。 ");
      } finally {
        setPendingAction(null);
      }
      return;
    }
    browserFileRef.current?.click();
  };

  const onBrowserMediaPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingAction("select");
    setError(null);
    try {
      const imported: AudioEnhancementInputInfo = await uploadAudioEnhancementInput(file);
      setMedia({ id: imported.id, fileName: imported.file_name, fileSizeBytes: imported.file_size_bytes });
      setMessage("媒体已在本地受控暂存，可生成模型对比结果。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法导入本地媒体。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const toggleBackend = (backend: AudioEnhancementBackend) => {
    const ready = readiness === null ? true : readiness.audio_enhancement_runtime_installed && (
      backend === "deepfilternet3" ? readiness.deepfilternet3_model_installed : readiness.mossformer2_se_model_installed
    );
    setBackends((current) => {
      if (current.includes(backend)) return current.filter((item) => item !== backend);
      return ready ? [...current, backend] : current;
    });
  };

  const backendReady = (backend: AudioEnhancementBackend): boolean | undefined => {
    if (readiness === null) return undefined;
    return readiness.audio_enhancement_runtime_installed && (
      backend === "deepfilternet3" ? readiness.deepfilternet3_model_installed : readiness.mossformer2_se_model_installed
    );
  };
  const selectedBackendsReady = backends.every((backend) => backendReady(backend) !== false);

  const updateJob = (job: AudioEnhancementJob) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    setSelectedJobId(job.id);
  };

  const start = async () => {
    if (!media) {
      setError("请先选择一个本地音频或视频文件。 ");
      return;
    }
    if (!backends.length) {
      setError("请至少选择一个增强模型。 ");
      return;
    }
    if (!selectedBackendsReady) {
      setError("所选增强模型或专用运行时尚未就绪，请在设置中检查模型目录。 ");
      return;
    }
    setPendingAction("start");
    setError(null);
    setMessage(null);
    try {
      const job = await createAudioEnhancementJob({
        input_id: media.id,
        source_file_name: media.fileName,
        backends,
        preset
      });
      updateJob(job);
      setMessage(backends.length === 2 ? "双模型对比任务已进入本地队列。" : "本地语音增强任务已进入队列。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建语音增强任务。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const cancel = async () => {
    if (!selectedJob || !isActive(selectedJob)) return;
    setPendingAction("cancel");
    setError(null);
    try {
      const cancelled = await cancelAudioEnhancementJob(selectedJob.id, selectedJob.status === "running");
      updateJob(cancelled);
      setMessage("任务已取消。已经写出的结果会保留在输出目录。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "取消语音增强任务失败。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const retry = async () => {
    if (!selectedJob) return;
    setPendingAction("retry");
    setError(null);
    try {
      updateJob(await retryAudioEnhancementJob(selectedJob.id));
      setMessage("语音增强任务已重新加入本地队列。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重试语音增强任务失败。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const revealOutput = async (filePath: string) => {
    if (!window.desktopFiles?.revealInFolder) {
      setError("请在桌面软件中定位生成文件。 ");
      return;
    }
    setError(null);
    try {
      await window.desktopFiles.revealInFolder(filePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法定位生成文件。 ");
    }
  };

  return (
    <div className="enhancementOverlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="enhancementWorkspace" role="region" aria-label="语音增强对比">
        <header className="enhancementHeader">
          <div className="enhancementHeading"><span className="enhancementHeadingIcon"><Sparkles size={20} /></span><span><strong>语音增强对比</strong><small>本地降噪与增强，原始媒体不会被覆盖。</small></span></div>
          <button className="enhancementIconButton" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="enhancementBody">
          <section className="enhancementSetup">
            <div className="enhancementSectionHeading"><FileAudio size={17} /><span><strong>输入媒体</strong><small>仅在本机受控目录暂存</small></span></div>
            <button className="enhancementPicker" type="button" onClick={() => void selectMedia()} disabled={actionBusy}>
              {pendingAction === "select" ? <Loader2 className="spin" size={22} /> : <Upload size={22} />}
              <span>{media?.fileName || "选择音频或视频"}</span>
              <small>{media ? formatBytes(media.fileSizeBytes) : "支持常见音频、视频格式"}</small>
            </button>
            <input ref={browserFileRef} className="enhancementHiddenInput" type="file" accept="audio/*,video/*" aria-label="选择语音增强素材" onChange={(event) => void onBrowserMediaPicked(event)} />

            <fieldset className="enhancementModels" disabled={actionBusy}><legend>对比模型</legend>{MODEL_OPTIONS.map((model) => <label key={model.id} className={backends.includes(model.id) ? "active" : ""}><input type="checkbox" checked={backends.includes(model.id)} disabled={backendReady(model.id) === false && !backends.includes(model.id)} onChange={() => toggleBackend(model.id)} /><span><strong>{model.name}</strong><small>{backendReady(model.id) === false ? (readiness?.audio_enhancement_runtime_installed ? "模型目录不完整，请到设置中修复。" : "缺少专用 Python 运行时，请到设置中修复。") : model.detail}</small></span></label>)}</fieldset>

            <label className="enhancementPreset"><span>处理预设</span><select value={preset} disabled={actionBusy} onChange={(event) => setPreset(event.target.value as AudioEnhancementPreset)}><option value="light">轻度：保留更多原始音色</option><option value="standard">标准：降噪与清晰度平衡</option><option value="strong">强力：更积极地压低噪声</option></select></label>
            <button className="enhancementPrimaryButton" type="button" onClick={() => void start()} disabled={actionBusy || !media || !backends.length || !selectedBackendsReady}>{pendingAction === "start" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}生成对比结果</button>
            <p className="enhancementNote">模型与专用运行时均就绪后才可开始；音频不会上传。</p>
          </section>

          <section className="enhancementResult">
            {selectedJob ? <>
              <div className="enhancementStatus"><span className={`enhancementStatusPill ${selectedJob.status}`}>{statusLabel(selectedJob.status)}</span><span>{stageLabel(selectedJob.stage)}</span><span>{selectedJob.progress_percent}%</span></div>
              <div className="enhancementProgress" role="progressbar" aria-label="语音增强进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, selectedJob.progress_percent))}><span style={{ width: `${selectedJob.progress_percent}%` }} /></div>
              {selectedJob.error && <div className="enhancementFeedback error"><AlertCircle size={16} /><span>{selectedJob.error}</span></div>}
              {selectedJob.warnings.map((warning) => <div key={warning} className="enhancementFeedback warning"><AlertCircle size={16} /><span>{warning}</span></div>)}
              {selectedJob.outputs.length ? <div className="enhancementOutputs">{selectedJob.outputs.map((output) => <article key={output.backend}><div className="enhancementOutputHeader"><div><strong>{output.model}</strong><small>{outputFileName(output.file_path)}</small><small>{output.sample_rate / 1000} kHz · {formatTime(output.duration_seconds)}</small></div><button type="button" className="enhancementRevealButton" onClick={() => void revealOutput(output.file_path)} title={output.file_path}><FolderOpen size={14} />定位文件</button></div><audio controls preload="metadata" src={toAudioUrl(output.audio_url)} /></article>)}</div> : isActive(selectedJob) ? <div className="enhancementEmptyState"><Loader2 className="spin" size={30} /><strong>{selectedJob.status === "queued" ? "正在等待本地 GPU 槽位" : "正在生成语音增强结果"}</strong><span>模型会依次运行，避免与 TTS、ASR 争抢显存。</span></div> : <div className="enhancementEmptyState"><FileAudio size={31} /><strong>{selectedJob.status === "cancelled" ? "任务已取消" : "本次处理未完成"}</strong><span>检查模型目录和增强运行时后可重试。</span></div>}
              <div className="enhancementActions">{isActive(selectedJob) && <button className="danger" type="button" onClick={() => void cancel()} disabled={actionBusy}>{pendingAction === "cancel" ? <Loader2 className="spin" size={15} /> : <Square size={14} />}取消</button>}{(selectedJob.status === "failed" || selectedJob.status === "cancelled") && <button type="button" onClick={() => void retry()} disabled={actionBusy}>{pendingAction === "retry" ? <Loader2 className="spin" size={15} /> : <RotateCw size={15} />}重试</button>}</div>
            </> : <div className="enhancementEmptyState"><Sparkles size={32} /><strong>还没有语音增强任务</strong><span>导入一条素材，选择一个或两个模型后即可开始本地对比。</span><div className="enhancementEmptySteps" aria-label="开始语音增强的步骤"><span className={media ? "ready" : ""}><Upload size={14} /><b>素材</b><em>{media ? "已选择" : "先选择"}</em></span><span className={backends.length && selectedBackendsReady ? "ready" : ""}><CheckCircle2 size={14} /><b>模型</b><em>{backends.length && selectedBackendsReady ? "已就绪" : "待检查"}</em></span><span className={media && backends.length && selectedBackendsReady ? "ready" : ""}><Sparkles size={14} /><b>生成</b><em>{media && backends.length && selectedBackendsReady ? "可以开始" : "等待前两步"}</em></span></div></div>}
          </section>

          <aside className="enhancementHistory"><div className="enhancementSectionHeading"><Clock3 size={17} /><span><strong>最近任务</strong><small>{jobs.length} 条记录</small></span></div><div>{jobs.map((job) => <button type="button" key={job.id} className={job.id === selectedJob?.id ? "active" : ""} aria-pressed={job.id === selectedJob?.id} disabled={actionBusy} onClick={() => setSelectedJobId(job.id)}><span className={`enhancementHistoryDot ${job.status}`} /><span><strong title={job.source_file_name}>{job.source_file_name}</strong><small>{job.backends.length === 2 ? "双模型对比" : backendLabel(job.backends[0])} · {statusLabel(job.status)}</small></span></button>)}{!jobs.length && <p>完成、失败和取消的记录会保留在本机。</p>}</div></aside>
        </div>

        {(message || error) && <footer role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} className={`enhancementFooter ${error ? "error" : ""}`}>{error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}<span>{error || message}</span></footer>}
      </section>
    </div>
  );
}
