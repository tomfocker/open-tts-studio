import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  FileAudio,
  FileText,
  Film,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  X
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelTranscriptionJob,
  createTranscriptionJob,
  fetchAppSettings,
  fetchTranscriptionExport,
  fetchTranscriptionJobs,
  retryTranscriptionJob,
  uploadTranscriptionInput,
  transformLlmText
} from "./api";
import type {
  AppSettings,
  TranscriptionBackend,
  TranscriptionInputInfo,
  TranscriptionJob,
  TranscriptionOutputFormat,
  GlobalLlmSettings,
  LlmTextTransformOperation,
  LlmTextTransformResult
} from "./types";

import "./transcription-workspace.css";

type TranscriptionWorkspaceProps = {
  onClose: () => void;
};

type ManagedDesktopInput = {
  id: string;
  fileName: string;
  fileSizeBytes: number;
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function formatTime(value?: number | null): string {
  const total = Math.max(0, Number(value || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

function statusLabel(status: TranscriptionJob["status"]): string {
  return {
    queued: "排队中",
    running: "识别中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  }[status];
}

function outputTitle(value: string): string {
  const noExtension = value.replace(/\.[^/.]+$/, "").trim();
  const safe = noExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  return safe || "未命名";
}

function publishedExportName(sourceFileName: string, extension: "txt" | "srt", now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${timestamp}-${outputTitle(sourceFileName)}.${extension}`;
}

function isActive(job: TranscriptionJob | null): boolean {
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

export function TranscriptionWorkspace({ onClose }: TranscriptionWorkspaceProps) {
  const [media, setMedia] = useState<ManagedDesktopInput | null>(null);
  const [outputFormat, setOutputFormat] = useState<TranscriptionOutputFormat>("txt");
  const [backend, setBackend] = useState<TranscriptionBackend>("sensevoice");
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeReadiness, setRuntimeReadiness] = useState<Pick<AppSettings, "sensevoice_ready" | "qwen_asr_model_installed"> | null>(null);
  const [llmSettings, setLlmSettings] = useState<GlobalLlmSettings | null>(null);
  const [editedText, setEditedText] = useState<string | null>(null);
  const [transformBusy, setTransformBusy] = useState<LlmTextTransformOperation | null>(null);
  const [transformResult, setTransformResult] = useState<LlmTextTransformResult | null>(null);
  const [transformTargetLanguage, setTransformTargetLanguage] = useState("英文");
  const [transformError, setTransformError] = useState<string | null>(null);
  const browserFileRef = useRef<HTMLInputElement | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

  const refreshJobs = async (quiet = false) => {
    try {
      const nextJobs = await fetchTranscriptionJobs();
      setJobs(nextJobs);
      setSelectedJobId((current) => current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id || "");
      if (!quiet) setError(null);
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "读取转写任务失败。");
    }
  };

  const refreshRuntimeReadiness = async () => {
    try {
      const settings = await fetchAppSettings();
      setRuntimeReadiness({
        sensevoice_ready: settings.sensevoice_ready,
        qwen_asr_model_installed: settings.qwen_asr_model_installed
      });
    } catch {
      // The transcription endpoint remains the authoritative fallback for
      // callers outside Electron. Avoid obscuring an otherwise usable page
      // when the optional readiness request cannot be refreshed.
    }
  };

  useEffect(() => {
    void refreshJobs();
    void refreshRuntimeReadiness();
    const timer = window.setInterval(() => void refreshJobs(true), 1800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const bridge = window.desktopLlmSettings;
    if (!bridge) return undefined;
    const load = () => void bridge.load().then(setLlmSettings).catch(() => setLlmSettings(null));
    load();
    const listener = () => load();
    window.addEventListener("opentts:llm-settings-changed", listener);
    return () => window.removeEventListener("opentts:llm-settings-changed", listener);
  }, []);

  useEffect(() => {
    setEditedText(null);
    setTransformResult(null);
    setTransformError(null);
  }, [selectedJobId]);

  useEffect(() => {
    if (outputFormat === "srt") {
      setBackend("qwen3");
    }
  }, [outputFormat]);

  const selectedBackendReady = backend === "qwen3"
    ? runtimeReadiness?.qwen_asr_model_installed
    : runtimeReadiness?.sensevoice_ready;
  const displayedText = editedText ?? selectedJob?.text ?? "";
  const selectedJobHasLegacyQwenPathError = Boolean(
    selectedJob?.backend === "qwen3"
    && selectedJob.status === "failed"
    && /Qwen3-ASR.*(?:目录不存在|MODEL_DIR)/i.test(selectedJob.error || "")
  );

  const selectMedia = async () => {
    setError(null);
    setMessage(null);
    if (window.desktopFiles?.selectTranscriptionMedia) {
      try {
        setPendingAction("select");
        const picked = await window.desktopFiles.selectTranscriptionMedia();
        if (picked) {
          setMedia(picked);
          setMessage("媒体已在本地受控暂存，可开始转写。");
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法导入本地媒体。");
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
      const imported: TranscriptionInputInfo = await uploadTranscriptionInput(file);
      setMedia({ id: imported.id, fileName: imported.file_name, fileSizeBytes: imported.file_size_bytes });
      setMessage("媒体已在本地受控暂存，可开始转写。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法导入本地媒体。");
    } finally {
      setPendingAction(null);
    }
  };

  const start = async () => {
    if (!media) {
      setError("请先选择一个本地音频或视频文件。");
      return;
    }
    setPendingAction("start");
    setError(null);
    setMessage(null);
    try {
      const job = await createTranscriptionJob({
        input_id: media.id,
        source_file_name: media.fileName,
        backend,
        output_format: outputFormat,
        language: "zh"
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setMessage(outputFormat === "srt" ? "真实字幕时间轴任务已进入本地队列。" : "本地文本转写任务已进入队列。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法创建转写任务。");
    } finally {
      setPendingAction(null);
    }
  };

  const updateJob = (next: TranscriptionJob) => {
    setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    setSelectedJobId(next.id);
  };

  const cancel = async () => {
    if (!selectedJob || !isActive(selectedJob)) return;
    setPendingAction("cancel");
    setError(null);
    try {
      const cancelled = await cancelTranscriptionJob(selectedJob.id, selectedJob.status === "running");
      updateJob(cancelled);
      setMessage("任务已取消。已完成的内容会保留，未完成的任务可重试。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "取消转写任务失败。");
    } finally {
      setPendingAction(null);
    }
  };

  const retry = async () => {
    if (!selectedJob) return;
    setPendingAction("retry");
    setError(null);
    try {
      const retried = await retryTranscriptionJob(selectedJob.id);
      updateJob(retried);
      setMessage("转写任务已重新加入本地队列。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重试转写任务失败。");
    } finally {
      setPendingAction(null);
    }
  };

  const transformSelectedText = async (operation: LlmTextTransformOperation) => {
    const source = (editedText ?? selectedJob?.text ?? "").trim();
    if (!source) {
      setTransformError("当前没有可处理的转写文本。");
      return;
    }
    if (!llmSettings?.baseUrl.trim() || !llmSettings.model.trim()) {
      setTransformError("请先在设置 → 全局 LLM 中配置接口地址和模型名。");
      return;
    }
    setTransformBusy(operation);
    setTransformError(null);
    setTransformResult(null);
    try {
      const result = await transformLlmText(llmSettings, source, operation, {
        targetLanguage: operation === "translate" ? transformTargetLanguage : "中文",
        style: operation === "proofread" ? "尽量保留原说话风格，只修正识别错误和标点" : undefined
      });
      setTransformResult(result);
    } catch (reason) {
      setTransformError(reason instanceof Error ? reason.message : "文本处理失败");
    } finally {
      setTransformBusy(null);
    }
  };

  const exportResult = async (format: "txt" | "srt") => {
    if (!selectedJob) return;
    setPendingAction(`export-${format}`);
    setError(null);
    try {
      const content = format === "txt" && editedText !== null
        ? editedText
        : await fetchTranscriptionExport(selectedJob.id, format);
      const defaultName = publishedExportName(selectedJob.source_file_name, format);
      let saved: string | null = null;
      if (window.desktopFiles?.saveTranscriptionExport) {
        saved = await window.desktopFiles.saveTranscriptionExport(content, defaultName, format);
      } else {
        const blob = new Blob([content], { type: format === "srt" ? "application/x-subrip" : "text/plain" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = defaultName;
        anchor.click();
        URL.revokeObjectURL(url);
        saved = defaultName;
      }
      if (saved) setMessage(`${format.toUpperCase()} 已导出。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出失败。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="transcriptionOverlay" role="dialog" aria-modal="true" aria-label="音视频转写">
      <section className="transcriptionWorkspace">
        <header className="transcriptionHeader">
          <div className="transcriptionHeading">
            <span className="transcriptionHeadingIcon"><FileAudio size={20} strokeWidth={1.9} /></span>
            <div>
              <strong>音视频转写</strong>
              <span>本地识别 · TXT / 真实时间轴 SRT</span>
            </div>
          </div>
          <button type="button" className="transcriptionIconButton" title="关闭" aria-label="关闭音视频转写" onClick={onClose}><X size={19} /></button>
        </header>

        <div className="transcriptionBody">
          <section className="transcriptionSetup" aria-label="创建转写任务">
            <div className="transcriptionSectionHeading"><div><Upload size={17} /><span><strong>选择媒体</strong><small>音频或视频仅在本机处理</small></span></div></div>
            <button className="transcriptionPicker" type="button" disabled={pendingAction === "select"} onClick={() => void selectMedia()}>
              {pendingAction === "select" ? <Loader2 className="spin" size={20} /> : media ? <Film size={20} /> : <Upload size={20} />}
              <span>{media ? media.fileName : "选择本地音频或视频"}</span>
              <small>{media ? formatBytes(media.fileSizeBytes) : "MP4、MOV、MKV、MP3、WAV 等"}</small>
            </button>
            <input ref={browserFileRef} className="transcriptionHiddenInput" type="file" accept="audio/*,video/*" aria-label="选择转写媒体文件" onChange={(event) => void onBrowserMediaPicked(event)} />

            <fieldset className="transcriptionFormatPicker">
              <legend>导出类型</legend>
              <label className={outputFormat === "txt" ? "active" : ""}>
                <input type="radio" name="transcription-format" value="txt" checked={outputFormat === "txt"} onChange={() => setOutputFormat("txt")} />
                <FileText size={16} /><span><strong>TXT</strong><small>纯文本</small></span>
              </label>
              <label className={outputFormat === "srt" ? "active" : ""}>
                <input type="radio" name="transcription-format" value="srt" checked={outputFormat === "srt"} onChange={() => setOutputFormat("srt")} />
                <Clock3 size={16} /><span><strong>SRT</strong><small>真实字幕时间轴</small></span>
              </label>
            </fieldset>

            <label className="transcriptionBackendField">
              <span>识别引擎</span>
              <select value={backend} disabled={outputFormat === "srt"} onChange={(event) => setBackend(event.target.value as TranscriptionBackend)}>
                <option value="sensevoice">SenseVoiceSmall · 快速文本</option>
                <option value="qwen3">Qwen3-ASR · 本地高精度</option>
              </select>
              {outputFormat === "srt" ? <small><ShieldCheck size={13} />SRT 固定使用 Qwen3-ASR + ForcedAligner，不估算时间。</small> : <small>TXT 不会启动强制对齐模型。</small>}
              {selectedBackendReady === false && <small className="transcriptionBackendUnavailable"><AlertCircle size={13} />{backend === "qwen3" ? "Qwen3-ASR 的本地模型、运行时或引擎尚未就绪，请先在设置中检查模型目录。" : "SenseVoiceSmall 的本地模型或运行时尚未就绪，请先在设置中检查模型目录。"}</small>}
            </label>

            <button className="transcriptionPrimaryButton" type="button" disabled={!media || pendingAction === "start" || selectedBackendReady === false} onClick={() => void start()}>
              {pendingAction === "start" ? <Loader2 className="spin" size={17} /> : <FileAudio size={17} />}
              <span>{pendingAction === "start" ? "正在创建" : "开始本地转写"}</span>
            </button>
          </section>

          <section className="transcriptionResult" aria-live="polite">
            <div className="transcriptionSectionHeading">
              <div><FileText size={17} /><span><strong>转写结果</strong><small>{selectedJob ? selectedJob.source_file_name : "选择媒体后创建任务"}</small></span></div>
              <button type="button" className="transcriptionIconButton" title="刷新任务" aria-label="刷新转写任务" onClick={() => void refreshJobs()}><RefreshCw size={16} /></button>
            </div>

            {selectedJob ? (
              <>
                <div className="transcriptionJobStatus">
                  <span className={`transcriptionStatusPill ${selectedJob.status}`}>{selectedJob.status === "running" && <Loader2 className="spin" size={13} />}{selectedJob.status === "completed" && <CheckCircle2 size={13} />}{selectedJob.status === "failed" && <AlertCircle size={13} />}{statusLabel(selectedJob.status)}</span>
                  <span>{selectedJob.model || (selectedJob.backend === "qwen3" ? "Qwen3 本地识别" : "SenseVoiceSmall")}</span>
                  {selectedJob.duration_seconds != null && <span>{formatTime(selectedJob.duration_seconds)}</span>}
                </div>
                {isActive(selectedJob) && <div className="transcriptionProgress" role="progressbar" aria-label="转写进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, selectedJob.progress_percent))}><span style={{ width: `${Math.max(8, selectedJob.progress_percent)}%` }} /></div>}
                {selectedJob.error && <div className="transcriptionFeedback error" role="alert" aria-live="assertive"><AlertCircle size={15} /><span>{selectedJob.error}</span></div>}
                {selectedJobHasLegacyQwenPathError && runtimeReadiness?.qwen_asr_model_installed && (
                  <div className="transcriptionFeedback warning"><RefreshCw size={15} /><span>这是旧版本留下的 Qwen3 失败记录。当前本地 Qwen3 组件已就绪；若原媒体仍在本地暂存，可按当前配置重试。</span></div>
                )}
                {selectedJob.warnings.map((warning) => <div className="transcriptionFeedback warning" key={warning}><AlertCircle size={15} /><span>{warning}</span></div>)}

                {selectedJob.status === "completed" ? (
                  <>
                    <div className="transcriptionAiToolbar">
                      <span><Sparkles size={14} /> LLM 后处理</span>
                      <button type="button" onClick={() => void transformSelectedText("proofread")} disabled={transformBusy !== null || !displayedText.trim()}>{transformBusy === "proofread" ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}校对</button>
                      <button type="button" onClick={() => void transformSelectedText("summarize")} disabled={transformBusy !== null || !displayedText.trim()}>{transformBusy === "summarize" ? <Loader2 className="spin" size={14} /> : <FileText size={14} />}摘要</button>
                      <label className="transcriptionTranslateControl"><select value={transformTargetLanguage} onChange={(event) => setTransformTargetLanguage(event.target.value)}><option>英文</option><option>日文</option><option>韩文</option></select><button type="button" onClick={() => void transformSelectedText("translate")} disabled={transformBusy !== null || !displayedText.trim()}>{transformBusy === "translate" ? <Loader2 className="spin" size={14} /> : <Download size={14} />}翻译</button></label>
                    </div>
                    {transformError && <div className="transcriptionFeedback error"><AlertCircle size={15} /><span>{transformError}</span></div>}
                    <article className="transcriptionTextResult"><pre>{displayedText || "未识别到文本。"}</pre></article>
                    {transformResult && (
                      <div className="transcriptionTransformPreview">
                        <header><div><strong>{transformResult.operation === "proofread" ? "校对结果" : transformResult.operation === "summarize" ? "摘要结果" : `${transformResult.target_language}翻译`}</strong><small>{transformResult.model}</small></div><div><button type="button" onClick={() => void transformSelectedText(transformResult.operation)} disabled={transformBusy !== null}>重新生成</button><button type="button" className="primary" onClick={() => { setEditedText(transformResult.text); setTransformResult(null); setTransformError(null); }}>采用结果</button></div></header>
                        <pre>{transformResult.text}</pre>
                      </div>
                    )}
                    {selectedJob.segments.length > 0 && <div className="transcriptionCuePreview">{selectedJob.segments.slice(0, 6).map((segment) => <span key={segment.id}><code>{formatTime(segment.start_seconds)}</code>{segment.text}</span>)}{selectedJob.segments.length > 6 && <small>另有 {selectedJob.segments.length - 6} 条字幕</small>}</div>}
                    <div className="transcriptionActions">
                      <button type="button" onClick={() => void exportResult("txt")} disabled={pendingAction === "export-txt"}>{pendingAction === "export-txt" ? <Loader2 className="spin" size={15} /> : <Download size={15} />}导出 TXT</button>
                      {selectedJob.segments.length > 0 && <button className="primary" type="button" onClick={() => void exportResult("srt")} disabled={pendingAction === "export-srt"}>{pendingAction === "export-srt" ? <Loader2 className="spin" size={15} /> : <Download size={15} />}导出 SRT</button>}
                    </div>
                  </>
                ) : isActive(selectedJob) ? (
                  <div className="transcriptionEmptyState"><Loader2 className="spin" size={28} /><strong>{selectedJob.status === "queued" ? "正在等待本地模型" : "正在识别媒体音轨"}</strong><span>不会上传到外部服务。</span></div>
                ) : (
                  <div className="transcriptionEmptyState"><AlertCircle size={27} /><strong>{selectedJob.status === "cancelled" ? "任务已取消" : "本次转写未完成"}</strong><span>可检查本地模型安装后重试。</span></div>
                )}
                <div className="transcriptionActions secondary">
                  {isActive(selectedJob) && <button type="button" className="danger" disabled={pendingAction === "cancel"} onClick={() => void cancel()}>{pendingAction === "cancel" ? <Loader2 className="spin" size={15} /> : <Square size={14} />}取消任务</button>}
                  {(selectedJob.status === "failed" || selectedJob.status === "cancelled") && <button type="button" disabled={pendingAction === "retry"} onClick={() => void retry()}>{pendingAction === "retry" ? <Loader2 className="spin" size={15} /> : <RotateCw size={15} />}{selectedJob.backend === "qwen3" ? "按当前 Qwen 配置重试" : "按当前配置重试"}</button>}
                </div>
              </>
            ) : <div className="transcriptionEmptyState"><FileAudio size={30} /><strong>还没有转写任务</strong><span>选择真实音频或视频后即可在本机生成文本或字幕。</span></div>}
          </section>

          <aside className="transcriptionHistory" aria-label="最近转写任务">
            <div className="transcriptionSectionHeading"><div><Clock3 size={17} /><span><strong>最近任务</strong><small>{jobs.length} 条记录</small></span></div></div>
            <div className="transcriptionHistoryList">
              {jobs.map((job) => <button type="button" key={job.id} className={job.id === selectedJob?.id ? "active" : ""} aria-pressed={job.id === selectedJob?.id} onClick={() => setSelectedJobId(job.id)}><span className={`transcriptionHistoryDot ${job.status}`} /><span><strong title={job.source_file_name}>{job.source_file_name}</strong><small>{job.output_format.toUpperCase()} · {statusLabel(job.status)}</small></span></button>)}
              {!jobs.length && <div className="transcriptionHistoryEmpty">最近完成、失败和取消的任务会保留在本机。</div>}
            </div>
          </aside>
        </div>

        {(message || error) && <footer role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} className={`transcriptionFooter ${error ? "error" : ""}`}>{error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}<span>{error || message}</span></footer>}
      </section>
    </div>
  );
}
