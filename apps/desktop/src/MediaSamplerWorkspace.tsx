import { Clock3, Download, FileText, Film, History, Loader2, Play, RefreshCw, Scissors, Sparkles, Trash2, X } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import { createTranscriptionJob, fetchTranscriptionExport, fetchTranscriptionJobs } from "./api";
import type { BilibiliAudioOptionsResult, BilibiliLoginQrPayload, BilibiliLoginSession, BilibiliMediaHistoryEntry, BilibiliMediaHistoryItem, BilibiliParsedLink, BilibiliSamplerState, TranscriptionJob } from "./types";
import "./media-sampler-workspace.css";

type VoiceSample = { audioPath: string; name: string; durationSeconds: number };
type Props = { onClose: () => void; onCreateVoiceFromSample: (sample: VoiceSample) => Promise<string> };

function clamp(value: number, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, value)); }

function WaveformEditor({ source, duration, start, end, current, onSeek, onChange }: { source: string; duration: number; start: number; end: number; current: number; onSeek: (value: number) => void; onChange: (start: number, end: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<"start" | "end" | "move" | null>(null);
  const anchor = useRef(0);
  const original = useRef([0, 1]);
  const moved = useRef(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [waveformState, setWaveformState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    setWaveformState("loading");
    setPeaks([]);
    void fetch(source)
      .then(async (response) => {
        if (!response.ok) throw new Error("media response failed");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 128 * 1024 * 1024) throw new Error("media too large for waveform");
        const context = new AudioContext();
        try {
          const data = await context.decodeAudioData(bytes);
          const samples = data.getChannelData(0);
          const count = 360;
          const size = Math.max(1, Math.floor(samples.length / count));
          const next = Array.from({ length: count }, (_, index) => {
            let peak = 0;
            const stride = Math.max(1, Math.floor(size / 400));
            for (let cursor = index * size; cursor < Math.min(samples.length, (index + 1) * size); cursor += stride) peak = Math.max(peak, Math.abs(samples[cursor] ?? 0));
            return peak;
          });
          const max = Math.max(...next, 0);
          if (!cancelled) {
            setPeaks(max ? next.map((value) => value / max) : next);
            setWaveformState("ready");
          }
        } finally {
          await context.close();
        }
      })
      .catch(() => { if (!cancelled) setWaveformState("unavailable"); });
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const context = canvas.getContext("2d");
      if (!context || !rect.width) return;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = rect.width * pixelRatio;
      canvas.height = rect.height * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = "#101923";
      context.fillRect(0, 0, rect.width, rect.height);
      const startRatio = duration ? start / duration : 0;
      const endRatio = duration ? end / duration : 1;
      peaks.forEach((peak, index) => {
        const x = index / Math.max(1, peaks.length - 1) * rect.width;
        const height = Math.max(2, peak * (rect.height - 12));
        context.fillStyle = x >= startRatio * rect.width && x <= endRatio * rect.width ? "#60ca89" : "#607487";
        context.fillRect(x, (rect.height - height) / 2, Math.max(1, rect.width / Math.max(1, peaks.length) - 1), height);
      });
      context.fillStyle = "rgba(9,18,27,.52)";
      context.fillRect(0, 0, startRatio * rect.width, rect.height);
      context.fillRect(endRatio * rect.width, 0, rect.width - endRatio * rect.width, rect.height);
      context.fillStyle = "#72de9d";
      context.fillRect(startRatio * rect.width - 1, 0, 2, rect.height);
      context.fillRect(endRatio * rect.width - 1, 0, 2, rect.height);
      context.fillStyle = "#a7d5ee";
      context.fillRect((duration ? current / duration : 0) * rect.width - 1, 0, 2, rect.height);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [current, duration, end, peaks, start]);

  const ratio = (event: PointerEvent<HTMLButtonElement>) => clamp((event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width);
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (!duration) return;
    const value = ratio(event);
    const startRatio = start / duration;
    const endRatio = end / duration;
    if (Math.abs(value - startRatio) < 0.035) drag.current = "start";
    else if (Math.abs(value - endRatio) < 0.035) drag.current = "end";
    else if (value > startRatio && value < endRatio) {
      drag.current = "move";
      anchor.current = value;
      original.current = [startRatio, endRatio];
      moved.current = false;
    } else onSeek(value * duration);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || !duration) return;
    const value = ratio(event);
    if (drag.current === "start") onChange(clamp(value * duration, 0, Math.max(0, end - 0.1)), end);
    else if (drag.current === "end") onChange(start, clamp(value * duration, Math.min(duration, start + 0.1), duration));
    else {
      const width = original.current[1] - original.current[0];
      const next = clamp(original.current[0] + value - anchor.current, 0, Math.max(0, 1 - width));
      onChange(next * duration, (next + width) * duration);
      moved.current = true;
    }
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current === "move" && !moved.current) onSeek(ratio(event) * duration);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const helper = waveformState === "loading" ? "正在分析真实波形…" : waveformState === "unavailable" ? "无法分析此媒体的波形；视频仍可播放和取样。" : null;
  return <button className="mediaSamplerWaveform" type="button" aria-label="真实音频波形，可调整或移动选区" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><canvas ref={canvasRef} />{helper && <span>{helper}</span>}</button>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
}

function formatTransferRate(value: number | null | undefined) {
  if (!value || value <= 0) return "速度计算中";
  return `${formatBytes(value)}/s`;
}

function safeSampleName(value: string | null | undefined) {
  const cleaned = (value ?? "B站片段").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "B站片段";
}

function publishedExportName(title: string | null | undefined, extension: "txt" | "srt", now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${timestamp}-${safeSampleName(title).slice(0, 48)}.${extension}`;
}

function parsedLinkItems(parsed: BilibiliParsedLink | null): BilibiliParsedLink["items"] {
  // The native bridge is an IPC boundary, so do not let a partial payload turn
  // into a renderer exception. This keeps an invalid B 站 response visible as
  // an actionable parse error instead of taking down the whole workspace.
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

function videoQualityOptions(options: BilibiliAudioOptionsResult | null) {
  return Array.isArray(options?.qnOptions) ? options.qnOptions : [];
}

function BilibiliDownloadPanel({ onClose, onDownloaded }: { onClose: () => void; onDownloaded: () => Promise<void> }) {
  const [link, setLink] = useState("");
  const [session, setSession] = useState<BilibiliLoginSession | null>(null);
  const [qrPayload, setQrPayload] = useState<BilibiliLoginQrPayload | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<BilibiliParsedLink | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mediaOptions, setMediaOptions] = useState<BilibiliAudioOptionsResult | null>(null);
  const [pending, setPending] = useState<"login" | "parse" | "load" | "download" | null>(null);
  const [samplerState, setSamplerState] = useState<BilibiliSamplerState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => parsedLinkItems(parsed), [parsed]);
  const qualityOptions = useMemo(() => videoQualityOptions(mediaOptions), [mediaOptions]);
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null, [items, selectedItemId]);
  const downloadProgress = samplerState?.downloadProgress;
  const downloadStage = samplerState?.taskStage;

  const refreshSession = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) return;
    const response = await bridge.getSession();
    if (!response.success || !response.data) throw new Error(response.error ?? "无法读取 B 站登录状态");
    setSession(response.data);
  };
  const loadOptions = async (source: BilibiliParsedLink, itemId: string, qn?: number) => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) return;
    setPending("load");
    try {
      const response = await bridge.loadAudioOptions(source.kind, itemId, qn);
      if (!response.success || !response.data) throw new Error(response.error ?? "无法读取该视频的音视频流");
      if (!response.data.summary || typeof response.data.summary.hasAudio !== "boolean" || typeof response.data.summary.hasVideo !== "boolean") {
        throw new Error("B 站返回的音视频信息不完整，请重新解析链接。");
      }
      setMediaOptions(response.data);
      setSelectedItemId(response.data.itemId);
      if (response.data.selectedVideo?.fellBack) {
        setNotice(`B 站只返回 ${response.data.selectedVideo.label}（请求 ${response.data.selectedVideo.requestedQn} 未获授权或当前视频不提供）；可在登录后重试更高清晰度。`);
      } else {
        setNotice(response.data.summary.hasVideo ? "音视频流已就绪，可下载为本地 MP4。" : response.data.summary.videoDisabledReason ?? "当前条目没有可用视频流。");
      }
    } finally { setPending(null); }
  };
  const parse = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !link.trim()) return;
    setPending("parse"); setError(null); setNotice(null);
    try {
      const response = await bridge.parseLink(link.trim());
      if (!response.success || !response.data) throw new Error(response.error ?? "解析 B 站链接失败");
      const source = response.data;
      const sourceItems = parsedLinkItems(source);
      const itemId = source.selectedItemId && sourceItems.some((item) => item.id === source.selectedItemId)
        ? source.selectedItemId
        : sourceItems[0]?.id;
      if (!itemId) throw new Error("这个链接没有可下载的条目");
      setParsed(source); setSelectedItemId(itemId); setMediaOptions(null);
      await loadOptions(source, itemId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "解析 B 站链接失败"); }
    finally { setPending(null); }
  };
  const startLogin = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) return;
    setPending("login"); setError(null);
    try {
      const response = await bridge.startLogin();
      if (!response.success || !response.data) throw new Error(response.error ?? "无法生成登录二维码");
      setQrPayload(response.data); setNotice("请使用 B 站 App 扫码确认，登录信息仅保留在本机。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法启动扫码登录"); }
    finally { setPending(null); }
  };
  const download = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !parsed || !selectedItem || !mediaOptions?.summary.hasVideo) return;
    setPending("download"); setError(null);
    try {
      const response = await bridge.downloadVideo({ fileName: safeSampleName(`${parsed.title ?? "B站视频"} ${selectedItem.title}`) });
      if (!response.success) throw new Error(response.error ?? "下载 MP4 失败");
      await onDownloaded();
      setNotice("MP4 已保存到本地下载历史，并已在工作台中可用。");
      setParsed(null); setMediaOptions(null); setLink("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "下载 MP4 失败"); }
    finally { setPending(null); }
  };

  useEffect(() => { void refreshSession().catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取登录状态")); }, []);
  useEffect(() => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge?.onStateChanged) return undefined;
    return bridge.onStateChanged((state) => setSamplerState(state));
  }, []);
  useEffect(() => {
    let disposed = false;
    if (!qrPayload?.qrUrl) { setQrCodeUrl(null); return undefined; }
    void QRCode.toDataURL(qrPayload.qrUrl, { margin: 1, width: 128, color: { dark: "#263441", light: "#f7fbff" } }).then((value) => { if (!disposed) setQrCodeUrl(value); }).catch(() => { if (!disposed) setQrCodeUrl(null); });
    return () => { disposed = true; };
  }, [qrPayload?.qrUrl]);
  useEffect(() => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !qrPayload?.authCode || session?.isLoggedIn) return undefined;
    let disposed = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const response = await bridge.pollLogin();
        if (disposed) return;
        if (!response.success || !response.data) throw new Error(response.error ?? "登录二维码失效，请重新生成");
        if (response.data.loginSession) setSession(response.data.loginSession);
        if (response.data.status === "confirmed") { setQrPayload(null); setNotice("B 站登录成功。"); return; }
        if (response.data.status === "expired" || response.data.status === "invalid") { setQrPayload(null); setNotice("二维码已失效，请重新生成。"); return; }
        timer = window.setTimeout(() => void poll(), 1400);
      } catch (reason) { if (!disposed) { setQrPayload(null); setError(reason instanceof Error ? reason.message : "扫码登录失败"); } }
    };
    timer = window.setTimeout(() => void poll(), 500);
    return () => { disposed = true; if (timer !== null) window.clearTimeout(timer); };
  }, [qrPayload?.authCode, session?.isLoggedIn]);

  return <section className="mediaSamplerDownloader" aria-label="B站视频下载">
    <div className="mediaSamplerDownloaderHeading"><div><strong>添加 B 站视频</strong><span>{session?.isLoggedIn ? `已登录：${session.nickname ?? "B站账号"}` : "公开视频可直接解析；受限内容请扫码登录"}</span></div><button className="icon" type="button" onClick={onClose} aria-label="收起下载面板"><X size={16} /></button></div>
    <div className="mediaSamplerDownloadControls"><label><span>B 站链接</span><input value={link} placeholder="粘贴 bilibili.com 视频链接" onChange={(event) => setLink(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void parse(); }} /></label><button type="button" disabled={Boolean(pending) || !link.trim()} onClick={() => void parse()}>{pending === "parse" ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}解析</button><button type="button" className="quiet" disabled={Boolean(pending)} onClick={() => void startLogin()}>{pending === "login" ? <Loader2 className="spin" size={15} /> : <History size={15} />}{qrPayload ? "刷新二维码" : session?.isLoggedIn ? "重新登录" : "扫码登录"}</button></div>
    {qrPayload && <div className="mediaSamplerQr"><div>{qrCodeUrl ? <img src={qrCodeUrl} alt="B站登录二维码" /> : <Loader2 className="spin" size={18} />}</div><span>扫码后请在手机确认；Cookie 不会传出本机。</span></div>}
    {parsed && <div className="mediaSamplerDownloadResult"><div><strong>{parsed.title ?? "B站视频"}</strong><small>{selectedItem?.title ?? "正在选择条目"}</small></div><label>条目<select value={selectedItemId ?? ""} disabled={Boolean(pending)} onChange={(event) => { const id = event.target.value; setSelectedItemId(id); setError(null); void loadOptions(parsed, id).catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取视频流")); }}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{qualityOptions.length ? <label>清晰度<select value={mediaOptions?.selectedVideo?.qn ?? ""} disabled={Boolean(pending)} onChange={(event) => { const qn = Number(event.target.value); if (selectedItemId) void loadOptions(parsed, selectedItemId, qn).catch((reason) => setError(reason instanceof Error ? reason.message : "无法切换清晰度")); }}>{qualityOptions.map((option) => <option key={option.qn} value={option.qn}>{option.label}</option>)}</select></label> : null}<button className="primary" type="button" disabled={Boolean(pending) || !mediaOptions?.summary.hasVideo} onClick={() => void download()}>{pending === "download" ? <Loader2 className="spin" size={15} /> : <Download size={15} />}下载 MP4</button></div>}
    {pending === "download" && (
      <div className={`mediaSamplerDownloadProgress${downloadProgress?.percent === null || downloadStage === "merging" ? " indeterminate" : ""}`} aria-live="polite">
        <div className="mediaSamplerDownloadProgressHeading">
          <span><strong>{downloadStage === "downloading-audio" ? "正在下载音频流" : downloadStage === "merging" ? "正在封装 MP4" : "正在下载视频流"}</strong><small>{downloadProgress?.totalBytes ? `${formatBytes(downloadProgress.receivedBytes)} / ${formatBytes(downloadProgress.totalBytes)}` : "CDN 未提供总大小，仍在持续下载"}</small></span>
          <strong>{downloadStage === "merging" ? "处理中" : downloadProgress?.percent === null || downloadProgress?.percent === undefined ? "进行中" : `${downloadProgress.percent}%`}</strong>
        </div>
        <div className="mediaSamplerDownloadProgressTrack" role="progressbar" aria-label="B站下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadStage === "merging" ? undefined : downloadProgress?.percent ?? undefined}><span style={{ width: `${downloadStage === "merging" ? 100 : downloadProgress?.percent ?? 100}%` }} /></div>
        <small className="mediaSamplerDownloadProgressMeta">{formatTransferRate(downloadProgress?.bytesPerSecond)}{downloadStage === "merging" ? " · 正在合并视频和音频" : ""}</small>
      </div>
    )}
    {(notice || error) && <p className={error ? "error" : ""}>{error ?? notice}</p>}
  </section>;
}

export function MediaSamplerWorkspace({ onClose, onCreateVoiceFromSample }: Props) {
  const [history, setHistory] = useState<BilibiliMediaHistoryEntry[]>([]);
  const [selected, setSelected] = useState<BilibiliMediaHistoryItem | null>(null);
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewEndRef = useRef<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [sampleName, setSampleName] = useState("");
  const [downloaderOpen, setDownloaderOpen] = useState(false);

  const selectedJob = useMemo(() => selectedJobId ? jobs.find((job) => job.id === selectedJobId) ?? null : null, [jobs, selectedJobId]);
  const selectedDuration = Math.max(0, range[1] - range[0]);

  const refresh = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) return;
    const [entries, transcriptionJobs] = await Promise.all([bridge.listHistory(), fetchTranscriptionJobs()]);
    if (!entries.success) throw new Error(entries.error ?? "读取下载历史失败");
    setHistory(entries.data ?? []);
    setJobs(transcriptionJobs);
  };

  const openHistory = async (entry: BilibiliMediaHistoryEntry) => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !entry.exists) return;
    setPending(`open:${entry.id}`);
    setError(null);
    try {
      const result = await bridge.getHistoryItem(entry.id);
      if (!result.success || !result.data) throw new Error(result.error ?? "无法打开本地视频");
      setSelected(result.data);
      setSelectedJobId(null);
      setDuration(0);
      setCurrent(0);
      setRange([0, 0]);
      setSampleName(safeSampleName(result.data.title ?? result.data.itemTitle));
      setMessage("已载入本地下载视频，可选取片段、识别字幕或创建音色参考。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法打开本地视频"); }
    finally { setPending(null); }
  };

  const updateRange = (nextStart: number, nextEnd: number) => {
    if (duration <= 0) return;
    const minimum = Math.min(0.1, duration);
    const start = clamp(nextStart, 0, Math.max(0, duration - minimum));
    const end = clamp(nextEnd, Math.min(duration, start + minimum), duration);
    setRange([start, end]);
  };

  const seekAndPlay = (value: number) => {
    previewEndRef.current = null;
    if (videoRef.current) {
      videoRef.current.currentTime = clamp(value, 0, duration);
      void videoRef.current.play().catch(() => undefined);
    }
  };

  const previewSelection = () => {
    if (!videoRef.current || selectedDuration <= 0) return;
    previewEndRef.current = range[1];
    videoRef.current.currentTime = range[0];
    void videoRef.current.play().catch(() => undefined);
  };

  const startAsr = async (format: "txt" | "srt") => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !selected) return;
    setPending(`asr:${format}`);
    setError(null);
    try {
      const staged = await bridge.stageTranscription(selected.id);
      if (!staged.success || !staged.data) throw new Error(staged.error ?? "无法准备本地转写媒体");
      const job = await createTranscriptionJob({ input_id: staged.data.id, source_file_name: staged.data.fileName, backend: format === "srt" ? "qwen3" : "sensevoice", output_format: format, language: "zh" });
      setSelectedJobId(job.id);
      setJobs((items) => [job, ...items.filter((item) => item.id !== job.id)]);
      setMessage(format === "srt" ? "真实字幕时间轴已加入本地队列。" : "本地 ASR 文本识别已加入队列。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建识别任务"); }
    finally { setPending(null); }
  };

  const exportTranscript = async (format: "txt" | "srt") => {
    if (!selectedJob || selectedJob.status !== "completed") return;
    setPending(`export:${format}`);
    setError(null);
    try {
      const content = await fetchTranscriptionExport(selectedJob.id, format);
      const defaultName = publishedExportName(selected?.title ?? selected?.itemTitle, format);
      const target = await window.desktopFiles?.saveTranscriptionExport(content, defaultName, format);
      setMessage(target ? `已导出 ${format.toUpperCase()} 文件。` : "已取消导出。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "导出失败"); }
    finally { setPending(null); }
  };

  const createVoiceFromSelection = async () => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge || !selected || selectedDuration < 0.1) return;
    setPending("extract-voice");
    setError(null);
    try {
      const result = await bridge.extractHistorySample(selected.id, { startSeconds: range[0], endSeconds: range[1], sampleName: safeSampleName(sampleName) });
      if (!result.success || !result.data) throw new Error(result.error ?? "无法提取本地片段");
      const voiceName = await onCreateVoiceFromSample({ audioPath: result.data.audioPath, name: safeSampleName(sampleName), durationSeconds: result.data.durationSeconds });
      setMessage(`已将 ${result.data.durationSeconds.toFixed(1)} 秒片段加入音色库：${voiceName}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建音色参考"); }
    finally { setPending(null); }
  };

  const removeHistory = async (entry: BilibiliMediaHistoryEntry) => {
    const bridge = window.desktopBilibiliSampler;
    if (!bridge) return;
    setPending(`remove:${entry.id}`);
    setError(null);
    try {
      const result = await bridge.removeHistory(entry.id);
      if (!result.success) throw new Error(result.error ?? "无法移除下载记录");
      setHistory((items) => items.filter((item) => item.id !== entry.id));
      if (entry.id === selected?.id) {
        setSelected(null);
        setSelectedJobId(null);
      }
      setMessage("已移除下载记录；本地 MP4 文件保持不变。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法移除下载记录"); }
    finally { setPending(null); }
  };

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "读取媒体记录失败"));
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (!selected && history[0]) void openHistory(history[0]); }, [history, selected]);

  return <div className="mediaSamplerOverlay" role="dialog" aria-modal="true" aria-label="媒体取样工作台">
    <section className={downloaderOpen ? "mediaSamplerWorkspace withDownloader" : "mediaSamplerWorkspace"}>
      <header className="mediaSamplerHeader"><div className="mediaSamplerHeading"><span className="mediaSamplerHeadingIcon"><Film size={20} strokeWidth={1.9} /></span><span><strong>媒体取样</strong><small>本地视频 · 波形选区 · ASR / SRT · 音色参考</small></span></div><div><button type="button" onClick={() => setDownloaderOpen((open) => !open)}><Sparkles size={16} />从 B 站下载</button><button className="icon" type="button" aria-label="关闭媒体取样" onClick={onClose}><X size={18} /></button></div></header>
      {downloaderOpen && <BilibiliDownloadPanel onClose={() => setDownloaderOpen(false)} onDownloaded={async () => { await refresh(); const entries = await window.desktopBilibiliSampler?.listHistory(); if (entries?.success && entries.data?.[0]) await openHistory(entries.data[0]); setDownloaderOpen(false); }} />}
      <main className="mediaSamplerGrid">
        <section className="mediaSamplerPreview">
          <div className="mediaSamplerSectionTitle"><span><Play size={16} />当前媒体</span>{selected && <small>{selected.title ?? selected.itemTitle ?? "B 站视频"}</small>}</div>
          {selected ? <>
            <video ref={videoRef} controls preload="metadata" src={selected.previewUrl} onLoadedMetadata={(event) => { const value = event.currentTarget.duration; setDuration(value); setRange([0, value]); }} onTimeUpdate={(event) => { const next = event.currentTarget.currentTime; setCurrent(next); if (previewEndRef.current !== null && next >= previewEndRef.current) { event.currentTarget.pause(); previewEndRef.current = null; } }} />
            <WaveformEditor source={selected.previewUrl} duration={duration} start={range[0]} end={range[1]} current={current} onSeek={seekAndPlay} onChange={updateRange} />
            <div className="mediaSamplerWaveformNote"><Sparkles size={15} /><span>选区 {range[0].toFixed(1)}–{range[1].toFixed(1)} 秒（{selectedDuration.toFixed(1)} 秒）；拖动两端调整，拖动中间可整体移动。</span></div>
          </> : <div className="mediaSamplerEmpty"><History size={32} /><strong>还没有本地下载视频</strong><span>从 B 站下载完成后，视频会自动加入本机历史。</span></div>}
        </section>
        <aside className="mediaSamplerSide">
          <section className="mediaSamplerHistorySection"><div className="mediaSamplerSectionTitle"><span><History size={16} />下载历史</span><button className="icon" type="button" title="刷新历史" onClick={() => void refresh()}><RefreshCw size={15} /></button></div><div className="mediaSamplerHistory">{history.map((entry) => <article key={entry.id} className={entry.id === selected?.id ? "active" : ""}><button className="mediaSamplerHistoryOpen" disabled={!entry.exists || pending === `open:${entry.id}`} onClick={() => void openHistory(entry)}><span><strong>{entry.title ?? entry.itemTitle ?? "B 站视频"}</strong><small>{entry.videoQuality?.label ?? "MP4"} · {formatBytes(entry.fileSizeBytes)} · {formatDate(entry.downloadedAt)}</small></span>{pending === `open:${entry.id}` && <Loader2 className="spin" size={14} />}</button><button className="mediaSamplerHistoryDelete" type="button" title="移除下载记录（不删除本地 MP4）" disabled={Boolean(pending)} onClick={() => void removeHistory(entry)}><Trash2 size={14} /></button></article>)}{!history.length && <p>下载记录保存在本机；不会保存账号 Cookie、CDN 地址或参考音频。</p>}</div></section>
          <section className="mediaSamplerClip"><div className="mediaSamplerSectionTitle"><span><Scissors size={16} />已选片段</span>{selected && <small>{selectedDuration.toFixed(1)} 秒</small>}</div>{selected ? <><div className="mediaSamplerRangeFields"><label>开始<input type="number" min="0" max={Math.max(0, range[1] - 0.1)} step="0.1" value={range[0].toFixed(1)} onChange={(event) => updateRange(Number(event.target.value), range[1])} /></label><label>结束<input type="number" min={Math.min(duration, range[0] + 0.1)} max={duration || undefined} step="0.1" value={range[1].toFixed(1)} onChange={(event) => updateRange(range[0], Number(event.target.value))} /></label></div><label className="mediaSamplerSampleName">音色名称<input value={sampleName} maxLength={80} onChange={(event) => setSampleName(event.target.value)} /></label><div className="mediaSamplerActions"><button type="button" disabled={Boolean(pending) || selectedDuration < 0.1} onClick={previewSelection}><Play size={15} />试听片段</button><button className="primary" type="button" disabled={Boolean(pending) || selectedDuration < 0.1} onClick={() => void createVoiceFromSelection}>{pending === "extract-voice" ? <Loader2 className="spin" size={15} /> : <Scissors size={15} />}提取并入库</button></div></> : <p>打开本地视频后即可调整并保存选区。</p>}</section>
          <section className="mediaSamplerAsr"><div className="mediaSamplerSectionTitle"><span><FileText size={16} />识别与字幕</span></div>{selected ? <><div className="mediaSamplerActions"><button type="button" disabled={Boolean(pending)} onClick={() => void startAsr("txt")}>{pending === "asr:txt" ? <Loader2 className="spin" size={15} /> : <FileText size={15} />}识别文字</button><button className="primary" type="button" disabled={Boolean(pending)} onClick={() => void startAsr("srt")}>{pending === "asr:srt" ? <Loader2 className="spin" size={15} /> : <Clock3 size={15} />}生成 SRT</button></div>{selectedJob && <article className="mediaSamplerTranscript"><small>{selectedJob.status === "running" ? "本地识别中…" : selectedJob.status === "completed" ? "识别完成" : selectedJob.status === "failed" ? "识别失败" : "等待识别"}</small><p>{selectedJob.error ?? selectedJob.text ?? "识别结果会显示在这里。"}</p>{selectedJob.status === "completed" && <div className="mediaSamplerExports"><button type="button" onClick={() => void exportTranscript("txt")} disabled={Boolean(pending)}><Download size={13} />TXT</button>{selectedJob.output_format === "srt" && <button type="button" onClick={() => void exportTranscript("srt")} disabled={Boolean(pending)}><Download size={13} />SRT</button>}</div>}</article>}</> : <p>选择一条下载历史后即可启动本地 ASR。</p>}</section>
        </aside>
      </main>
      {(message || error) && <footer className={error ? "error" : ""}>{error ?? message}</footer>}
    </section>
  </div>;
}
