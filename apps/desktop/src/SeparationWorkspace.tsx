import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileAudio,
  FolderOpen,
  Loader2,
  RotateCw,
  Square,
  Upload,
  Volume2,
  Waves,
  X
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelAudioSeparationJob,
  createAudioSeparationJob,
  fetchAppSettings,
  fetchAudioSeparationJobs,
  retryAudioSeparationJob,
  toAudioUrl,
  uploadAudioSeparationInput
} from "./api";
import type {
  AudioSeparationInputInfo,
  AudioSeparationJob,
  AudioSeparationModel,
  AppSettings
} from "./types";

import "./enhancement-workspace.css";

type SeparationWorkspaceProps = {
  onClose: () => void;
};

type ManagedInput = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
};

const MODEL_OPTIONS: Array<{ id: AudioSeparationModel; name: string; detail: string }> = [
  { id: "mdx-vocals", name: "UVR-MDX-NET Vocals FT", detail: "以人声为主输出，适合提取人声、配音和采样。" },
  { id: "mdx-karaoke", name: "UVR-MDX-NET Karaoke 2", detail: "以伴奏为主输出，适合去人声与卡拉 OK。" },
  { id: "mdx23c-instvoc-hq", name: "MDX23C-InstVoc HQ", detail: "高质量两轨，复杂混音更干净；运行时间和显存占用更高。" }
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

function statusLabel(status: AudioSeparationJob["status"]): string {
  return { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消" }[status];
}

function stageLabel(stage: string): string {
  return {
    preparing_audio: "准备音频",
    waiting_for_gpu: "等待 GPU",
    running_mdx_net: "运行 MDX-Net",
    publishing_outputs: "写入结果",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "服务重启中断"
  }[stage] ?? "处理中";
}

function isActive(job: AudioSeparationJob | null): boolean {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

function stemLabel(stem: "vocals" | "instrumental"): string {
  return stem === "vocals" ? "人声" : "伴奏";
}

function outputFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "未命名音频";
}

export function SeparationWorkspace({ onClose }: SeparationWorkspaceProps) {
  const [media, setMedia] = useState<ManagedInput | null>(null);
  const [model, setModel] = useState<AudioSeparationModel>("mdx-vocals");
  const [jobs, setJobs] = useState<AudioSeparationJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Pick<AppSettings,
    "audio_separation_runtime_installed"
    | "audio_separation_mdx_vocals_installed"
    | "audio_separation_mdx_karaoke_installed"
    | "audio_separation_mdx23c_installed"
  > | null>(null);
  const browserFileRef = useRef<HTMLInputElement | null>(null);
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null, [jobs, selectedJobId]);

  const refreshJobs = async (quiet = false) => {
    try {
      const nextJobs = await fetchAudioSeparationJobs();
      setJobs(nextJobs);
      setSelectedJobId((current) => current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id || "");
      if (!quiet) setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "读取音频分轨任务失败。 ");
    }
  };

  useEffect(() => {
    void refreshJobs();
    void fetchAppSettings().then((settings) => setReadiness({
      audio_separation_runtime_installed: settings.audio_separation_runtime_installed,
      audio_separation_mdx_vocals_installed: settings.audio_separation_mdx_vocals_installed,
      audio_separation_mdx_karaoke_installed: settings.audio_separation_mdx_karaoke_installed,
      audio_separation_mdx23c_installed: settings.audio_separation_mdx23c_installed
    })).catch(() => setReadiness(null));
    const timer = window.setInterval(() => void refreshJobs(true), 1600);
    return () => window.clearInterval(timer);
  }, []);

  const selectMedia = () => {
    setError(null);
    setMessage(null);
    if (window.desktopFiles?.selectAudioSeparationMedia) {
      setPendingAction("select");
      void window.desktopFiles.selectAudioSeparationMedia()
        .then((picked) => {
          if (!picked) return;
          setMedia(picked);
          setMessage("媒体已在本地受控暂存，可开始本地人声与伴奏分轨。 ");
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : "无法导入本地媒体。 "))
        .finally(() => setPendingAction(null));
      return;
    }
    browserFileRef.current?.click();
  };

  const onMediaPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingAction("select");
    setError(null);
    try {
      const imported: AudioSeparationInputInfo = await uploadAudioSeparationInput(file);
      setMedia({ id: imported.id, fileName: imported.file_name, fileSizeBytes: imported.file_size_bytes });
      setMessage("媒体已受控暂存，可开始本地人声与伴奏分轨。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法导入本地媒体。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const updateJob = (job: AudioSeparationJob) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    setSelectedJobId(job.id);
  };

  const selectedModelInstalled = readiness === null ? undefined : {
    "mdx-vocals": readiness.audio_separation_mdx_vocals_installed,
    "mdx-karaoke": readiness.audio_separation_mdx_karaoke_installed,
    "mdx23c-instvoc-hq": readiness.audio_separation_mdx23c_installed
  }[model];
  const selectedModelReady = readiness === null ? undefined : Boolean(readiness.audio_separation_runtime_installed && selectedModelInstalled);

  const start = async () => {
    if (!media) {
      setError("请先选择一个本地音频或视频文件。 ");
      return;
    }
    if (selectedModelReady === false) {
      setError("当前分轨模型或专用运行时尚未就绪，请在设置中检查 MDX-Net 目录与 Python 运行时。 ");
      return;
    }
    setPendingAction("start");
    setError(null);
    setMessage(null);
    try {
      const job = await createAudioSeparationJob({ input_id: media.id, source_file_name: media.fileName, model });
      updateJob(job);
      setMessage("本地分轨任务已进入队列。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建本地音频分轨任务。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const cancel = async () => {
    if (!selectedJob || !isActive(selectedJob)) return;
    setPendingAction("cancel");
    setError(null);
    try {
      updateJob(await cancelAudioSeparationJob(selectedJob.id, selectedJob.status === "running"));
      setMessage("任务已取消。已经写出的结果会保留在输出目录。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "取消音频分轨任务失败。 ");
    } finally {
      setPendingAction(null);
    }
  };

  const retry = async () => {
    if (!selectedJob) return;
    setPendingAction("retry");
    setError(null);
    try {
      updateJob(await retryAudioSeparationJob(selectedJob.id));
      setMessage("音频分轨任务已重新加入本地队列。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重试音频分轨任务失败。 ");
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
      <section className="enhancementWorkspace" role="region" aria-label="人声伴奏分轨">
        <header className="enhancementHeader">
          <div className="enhancementHeading"><span className="enhancementHeadingIcon"><Waves size={20} /></span><span><strong>人声伴奏分轨</strong><small>本地 UVR 兼容 MDX / MDXC，原始媒体不会被覆盖。</small></span></div>
          <button className="enhancementIconButton" type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="enhancementBody">
          <section className="enhancementSetup">
            <div className="enhancementSectionHeading"><FileAudio size={17} /><span><strong>输入媒体</strong><small>仅在本机受控目录暂存</small></span></div>
            <button className="enhancementPicker" type="button" onClick={selectMedia} disabled={pendingAction === "select"}>
              {pendingAction === "select" ? <Loader2 className="spin" size={22} /> : <Upload size={22} />}
              <span>{media?.fileName || "选择音频或视频"}</span>
              <small>{media ? formatBytes(media.fileSizeBytes) : "支持常见音频、视频格式"}</small>
            </button>
            <input ref={browserFileRef} className="enhancementHiddenInput" type="file" accept="audio/*,video/*" aria-label="选择音频分轨素材" onChange={(event) => void onMediaPicked(event)} />

            <fieldset className="enhancementModels"><legend>分轨模型</legend>{MODEL_OPTIONS.map((option) => <label key={option.id} className={model === option.id ? "active" : ""}><input type="radio" name="audio-separation-model" checked={model === option.id} onChange={() => setModel(option.id)} /><span><strong>{option.name}</strong><small>{option.detail}</small></span></label>)}</fieldset>
            <button className="enhancementPrimaryButton" type="button" onClick={() => void start()} disabled={pendingAction === "start" || !media || selectedModelReady === false}>{pendingAction === "start" ? <Loader2 className="spin" size={16} /> : <Waves size={16} />}开始分轨</button>
            <p className="enhancementNote">每次会生成独立的人声和伴奏 WAV。模型会与 TTS、ASR 串行使用 GPU，音频不会上传。</p>
            {selectedModelReady === false && <p className="enhancementNote error">当前选择尚未就绪：{readiness?.audio_separation_runtime_installed ? "缺少对应 MDX-Net 权重或参数文件。" : "缺少 audio-separation-runtime 专用 Python 运行时。"}</p>}
          </section>

          <section className="enhancementResult">
            {selectedJob ? <>
              <div className="enhancementStatus"><span className={`enhancementStatusPill ${selectedJob.status}`}>{statusLabel(selectedJob.status)}</span><span>{stageLabel(selectedJob.stage)}</span><span>{selectedJob.progress_percent}%</span></div>
              <div className="enhancementProgress" role="progressbar" aria-label="音频分轨进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, selectedJob.progress_percent))}><span style={{ width: `${selectedJob.progress_percent}%` }} /></div>
              {selectedJob.error && <div className="enhancementFeedback error"><AlertCircle size={16} /><span>{selectedJob.error}</span></div>}
              {selectedJob.warnings.map((warning) => <div key={warning} className="enhancementFeedback warning"><AlertCircle size={16} /><span>{warning}</span></div>)}
              {selectedJob.outputs.length ? <div className="enhancementOutputs">{selectedJob.outputs.map((output) => <article key={output.stem}><div className="enhancementOutputHeader"><div><strong>{stemLabel(output.stem)}</strong><small>{outputFileName(output.file_path)}</small><small>{output.sample_rate / 1000} kHz · {formatTime(output.duration_seconds)} · {selectedJob.model_display_name}</small></div><button type="button" className="enhancementRevealButton" onClick={() => void revealOutput(output.file_path)} title={output.file_path}><FolderOpen size={14} />定位文件</button></div><audio controls preload="metadata" src={toAudioUrl(output.audio_url)} /></article>)}</div> : isActive(selectedJob) ? <div className="enhancementEmptyState"><Loader2 className="spin" size={30} /><strong>{selectedJob.status === "queued" ? "正在等待本地 GPU 槽位" : "正在分离人声与伴奏"}</strong><span>处理时会自动避免与 TTS、ASR 同时占用显存。</span></div> : <div className="enhancementEmptyState"><Volume2 size={31} /><strong>{selectedJob.status === "cancelled" ? "任务已取消" : "本次处理未完成"}</strong><span>检查本地 MDX-Net 模型与分轨运行时后可重试。</span></div>}
              <div className="enhancementActions">{isActive(selectedJob) && <button className="danger" type="button" onClick={() => void cancel()} disabled={pendingAction === "cancel"}>{pendingAction === "cancel" ? <Loader2 className="spin" size={15} /> : <Square size={14} />}取消</button>}{(selectedJob.status === "failed" || selectedJob.status === "cancelled") && <button type="button" onClick={() => void retry()} disabled={pendingAction === "retry"}>{pendingAction === "retry" ? <Loader2 className="spin" size={15} /> : <RotateCw size={15} />}重试</button>}</div>
            </> : <div className="enhancementEmptyState"><Waves size={32} /><strong>还没有音频分轨任务</strong><span>导入一条素材，选择分轨侧重后即可在本机生成两条音轨。</span><div className="enhancementEmptySteps" aria-label="开始音频分轨的步骤"><span className={media ? "ready" : ""}><Upload size={14} /><b>素材</b><em>{media ? "已选择" : "先选择"}</em></span><span className={selectedModelReady === true ? "ready" : ""}><CheckCircle2 size={14} /><b>模型</b><em>{selectedModelReady === true ? "已就绪" : "待检查"}</em></span><span className={media && selectedModelReady === true ? "ready" : ""}><Waves size={14} /><b>生成</b><em>{media && selectedModelReady === true ? "可以开始" : "等待前两步"}</em></span></div></div>}
          </section>

          <aside className="enhancementHistory"><div className="enhancementSectionHeading"><Clock3 size={17} /><span><strong>最近任务</strong><small>{jobs.length} 条记录</small></span></div><div>{jobs.map((job) => <button type="button" key={job.id} className={job.id === selectedJob?.id ? "active" : ""} aria-pressed={job.id === selectedJob?.id} onClick={() => setSelectedJobId(job.id)}><span className={`enhancementHistoryDot ${job.status}`} /><span><strong title={job.source_file_name}>{job.source_file_name}</strong><small>{job.model_display_name} · {statusLabel(job.status)}</small></span></button>)}{!jobs.length && <p>完成、失败和取消的记录会保留在本机。</p>}</div></aside>
        </div>

        {(message || error) && <footer role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} className={`enhancementFooter ${error ? "error" : ""}`}>{error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}<span>{error || message}</span></footer>}
      </section>
    </div>
  );
}
