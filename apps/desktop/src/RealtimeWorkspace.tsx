import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  KeyRound,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  UserRound,
  Volume2,
  Wifi,
  WifiOff
} from "lucide-react";

import { fetchVoices, getApiBase } from "./api";
import type { GlobalLlmSettings, VoiceInfo } from "./types";
import "./realtime-workspace.css";

type ConnectionState = "offline" | "connecting" | "ready" | "error";
type ChatRole = "user" | "assistant" | "system";
// Whispera occasionally emits several inference chunks in a burst. Starting
// after a wall-clock delay left only about one second of actual audio, so one
// slow CUDA block could still drain the AudioContext timeline. Buffer source
// audio instead: it is robust to uneven model/network delivery. One second is
// an intentionally aggressive trial now that the warmed VoxCPM2 path is
// keeping up with playback; if production stalls, playback will expose it.
const PLAYBACK_STARTUP_BUFFER_SECONDS = 1;
const PLAYBACK_START_DELAY_SECONDS = 0.05;
type RealtimeRuntimeState = "idle" | "reserving" | "ready" | "error";

type PendingPlaybackChunk = {
  payload: ArrayBuffer;
  sampleRate: number;
  durationSeconds: number;
};

type RealtimeWorkspaceProps = {
  runtimeState?: RealtimeRuntimeState;
  runtimeMessage?: string;
};

type RealtimeSessionSettings = {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  systemPrompt: string;
  voiceId: string;
  ttsEnabled: boolean;
  ttsBackend: string;
};

declare global {
  interface Window {
    desktopLlmSettings?: {
      load: () => Promise<GlobalLlmSettings>;
      save: (settings: GlobalLlmSettings) => Promise<unknown>;
    };
    desktopRealtimeSettings?: {
      load: () => Promise<RealtimeSessionSettings>;
      save: (settings: RealtimeSessionSettings) => Promise<unknown>;
    };
  }
}

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  pending?: boolean;
};

const DEFAULT_LLM_BASE_URL = "https://api.cdn-krill-ai.com/codex/v1";
const DEFAULT_SYSTEM_PROMPT = "你是一个自然、简洁的中文语音助手。回答适合直接朗读，避免使用 Markdown。";
const DEFAULT_LLM_SETTINGS: GlobalLlmSettings = {
  enabled: true,
  baseUrl: DEFAULT_LLM_BASE_URL,
  model: "gpt-5.6-luna",
  apiKey: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 512
};

function toRealtimeUrl(apiBase: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/realtime";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function downsamplePcm16(input: Float32Array, sourceSampleRate: number): ArrayBuffer {
  const ratio = sourceSampleRate / 16_000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.floor(index * ratio));
    const sample = Math.max(-1, Math.min(1, input[sourceIndex] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function createCaptureWorkletUrl(): string {
  const source = `
    class OpenTtsCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (channel && channel.length) this.port.postMessage(channel.slice(0));
        return true;
      }
    }
    registerProcessor("open-tts-capture", OpenTtsCaptureProcessor);
  `;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

export function RealtimeWorkspace({ runtimeState = "ready", runtimeMessage = "" }: RealtimeWorkspaceProps) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("offline");
  const [statusText, setStatusText] = useState("正在恢复上次的实时会话设置…");
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_LLM_BASE_URL);
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsBackend, setTtsBackend] = useState("auto");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [vadSpeaking, setVadSpeaking] = useState(false);
  const [sending, setSending] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(() => typeof window === "undefined" || !window.desktopRealtimeSettings);

  const socketRef = useRef<WebSocket | null>(null);
  const connectionPromiseRef = useRef<Promise<boolean> | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const captureWorkletUrlRef = useRef<string | null>(null);
  const capturePcmRef = useRef(new Int16Array(0));
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlaybackAtRef = useRef(0);
  const pendingPlaybackChunksRef = useRef<PendingPlaybackChunk[]>([]);
  const pendingPlaybackDurationRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const playbackAudioIdRef = useRef<string | null>(null);
  const settingsSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const llmAdvancedSettingsRef = useRef({ temperature: DEFAULT_LLM_SETTINGS.temperature, maxTokens: DEFAULT_LLM_SETTINGS.maxTokens, enabled: true });

  useEffect(() => {
    const legacyBridge = window.desktopRealtimeSettings;
    const llmBridge = window.desktopLlmSettings;
    if (!legacyBridge && !llmBridge) {
      setStatusText("填写本地或云端 LLM 后连接。");
      setSettingsReady(true);
      return;
    }
    let cancelled = false;
    void Promise.all([
      llmBridge?.load().catch(() => null),
      legacyBridge?.load().catch(() => null)
    ])
      .then(([globalSettings, legacySettings]) => {
        if (cancelled) return;
        const legacy = legacySettings as RealtimeSessionSettings | null;
        const global = (globalSettings as GlobalLlmSettings | null) ?? {
          ...DEFAULT_LLM_SETTINGS,
          baseUrl: legacy?.llmBaseUrl || DEFAULT_LLM_BASE_URL,
          model: legacy?.llmModel || "",
          apiKey: legacy?.llmApiKey || "",
          systemPrompt: legacy?.systemPrompt || DEFAULT_SYSTEM_PROMPT
        };
        llmAdvancedSettingsRef.current = { temperature: global.temperature, maxTokens: global.maxTokens, enabled: global.enabled };
        setLlmBaseUrl(global.baseUrl || DEFAULT_LLM_BASE_URL);
        setLlmModel(global.model);
        setLlmApiKey(global.apiKey);
        setSystemPrompt(global.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        setVoiceId(legacy?.voiceId || "");
        setTtsEnabled(legacy?.ttsEnabled ?? true);
        setTtsBackend(legacy?.ttsBackend || "auto");
        if (!globalSettings && llmBridge && (legacy?.llmModel || legacy?.llmApiKey)) {
          void llmBridge.save(global);
        }
        setStatusText(global.baseUrl && global.model
          ? "已恢复上次的模型接口，可直接开始对话。"
          : "填写本地或云端 LLM 后连接。"
        );
      })
      .finally(() => {
        if (!cancelled) setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const listener = () => {
      void window.desktopLlmSettings?.load().then((settings) => {
        llmAdvancedSettingsRef.current = { temperature: settings.temperature, maxTokens: settings.maxTokens, enabled: settings.enabled };
        setLlmBaseUrl(settings.baseUrl || DEFAULT_LLM_BASE_URL);
        setLlmModel(settings.model);
        setLlmApiKey(settings.apiKey);
        setSystemPrompt(settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        setStatusText(settings.baseUrl && settings.model ? "全局 LLM 设置已更新。" : "填写本地或云端 LLM 后连接。");
      }).catch(() => undefined);
    };
    window.addEventListener("opentts:llm-settings-changed", listener);
    return () => window.removeEventListener("opentts:llm-settings-changed", listener);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const legacyBridge = window.desktopRealtimeSettings;
    const llmBridge = window.desktopLlmSettings;
    const snapshot: RealtimeSessionSettings = { llmBaseUrl: "", llmModel: "", llmApiKey: "", systemPrompt: "", voiceId, ttsEnabled, ttsBackend };
    const llmSnapshot: GlobalLlmSettings = { ...llmAdvancedSettingsRef.current, baseUrl: llmBaseUrl, model: llmModel, apiKey: llmApiKey, systemPrompt };
    const timer = window.setTimeout(() => {
      settingsSaveQueueRef.current = settingsSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (llmBridge) await llmBridge.save(llmSnapshot);
          if (legacyBridge) await legacyBridge.save(snapshot);
        });
      void settingsSaveQueueRef.current.catch(() => {
        setStatusText("实时会话设置未能保存到本机；请检查系统凭据服务。");
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [llmApiKey, llmBaseUrl, llmModel, settingsReady, systemPrompt, ttsBackend, ttsEnabled, voiceId]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source that naturally ended cannot be stopped again.
      }
    }
    playbackSourcesRef.current.clear();
    const context = playbackContextRef.current;
    nextPlaybackAtRef.current = context ? context.currentTime : 0;
    pendingPlaybackChunksRef.current = [];
    pendingPlaybackDurationRef.current = 0;
    playbackStartedRef.current = false;
    playbackAudioIdRef.current = null;
  }, []);

  const activatePlayback = useCallback(async (): Promise<AudioContext> => {
    let context = playbackContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      playbackContextRef.current = context;
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    return context;
  }, []);

  const schedulePcmChunk = useCallback(async (payload: ArrayBuffer, sampleRate: number) => {
    const context = await activatePlayback();
    const samples = new Int16Array(payload);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / (samples[index] < 0 ? 0x8000 : 0x7fff);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    // The response was held until it contained actual source audio. Later
    // chunks reuse this one timeline; no per-chunk delay is introduced.
    const playbackFloor = nextPlaybackAtRef.current > context.currentTime
      ? nextPlaybackAtRef.current
      : context.currentTime + PLAYBACK_START_DELAY_SECONDS;
    const startAt = Math.max(playbackFloor, nextPlaybackAtRef.current);
    nextPlaybackAtRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.onended = () => playbackSourcesRef.current.delete(source);
    source.start(startAt);
  }, [activatePlayback]);

  const flushPlaybackBuffer = useCallback(async () => {
    if (playbackStartedRef.current || !pendingPlaybackChunksRef.current.length) return;
    playbackStartedRef.current = true;
    const pending = pendingPlaybackChunksRef.current;
    pendingPlaybackChunksRef.current = [];
    pendingPlaybackDurationRef.current = 0;
    for (const chunk of pending) {
      await schedulePcmChunk(chunk.payload, chunk.sampleRate);
    }
  }, [schedulePcmChunk]);

  const playPcmChunk = useCallback(async (payload: ArrayBuffer, sampleRate: number) => {
    if (playbackStartedRef.current) {
      await schedulePcmChunk(payload, sampleRate);
      return;
    }
    const durationSeconds = payload.byteLength / (2 * sampleRate);
    if (!durationSeconds) return;
    pendingPlaybackChunksRef.current.push({ payload, sampleRate, durationSeconds });
    pendingPlaybackDurationRef.current += durationSeconds;
    if (pendingPlaybackDurationRef.current >= PLAYBACK_STARTUP_BUFFER_SECONDS) {
      await flushPlaybackBuffer();
    }
  }, [flushPlaybackBuffer, schedulePcmChunk]);

  const beginPlaybackResponse = useCallback((audioId: string) => {
    if (playbackAudioIdRef.current === audioId) return;
    playbackAudioIdRef.current = audioId;
    pendingPlaybackChunksRef.current = [];
    pendingPlaybackDurationRef.current = 0;
    playbackStartedRef.current = false;
  }, []);

  const sessionPayload = useCallback(() => ({
    type: "session.configure",
    llm_base_url: llmBaseUrl.trim(),
    llm_model: llmModel.trim(),
    llm_api_key: llmApiKey,
    system_prompt: systemPrompt.trim(),
    voice_id: voiceId || null,
    tts_enabled: ttsEnabled,
    tts_backend: ttsBackend
  }), [llmApiKey, llmBaseUrl, llmModel, systemPrompt, ttsBackend, ttsEnabled, voiceId]);

  const configureOpenSession = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && llmBaseUrl.trim() && llmModel.trim()) {
      socket.send(JSON.stringify(sessionPayload()));
    }
  }, [llmBaseUrl, llmModel, sessionPayload]);

  const disconnect = useCallback(() => {
    connectionPromiseRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.stop" }));
    }
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
    setConnectionState("offline");
    setVadSpeaking(false);
    setSending(false);
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    const current = socketRef.current;
    if (current?.readyState === WebSocket.OPEN) {
      configureOpenSession();
      return true;
    }
    if (connectionPromiseRef.current) return connectionPromiseRef.current;
    if (!llmBaseUrl.trim() || !llmModel.trim()) {
      setConnectionState("error");
      setStatusText("请先填写 OpenAI 兼容 LLM 地址和模型名。");
      return false;
    }
    if (ttsEnabled && runtimeState !== "ready") {
      setConnectionState(runtimeState === "error" ? "error" : "offline");
      setStatusText(runtimeMessage || (runtimeState === "reserving"
        ? "正在预约实时流式 VoxCPM2 的显存，请稍候。"
        : "实时语音尚未取得 VoxCPM2 显存使用权。"));
      return false;
    }
    setConnectionState("connecting");
    setStatusText("正在建立实时会话…");
    const promise = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        connectionPromiseRef.current = null;
        resolve(value);
      };
      let socket: WebSocket;
      try {
        socket = new WebSocket(toRealtimeUrl(getApiBase()));
      } catch {
        setConnectionState("error");
        setStatusText("实时地址无效，无法建立连接。");
        settle(false);
        return;
      }
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify(sessionPayload()));
        setConnectionState("ready");
        setStatusText("已连接，等待你说话或输入文字。");
        settle(true);
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          void playPcmChunk(event.data, (socket as WebSocket & { __openTtsSampleRate?: number }).__openTtsSampleRate ?? 24_000)
            .catch(() => {
              setPlaybackError("系统阻止了音频播放；请再点击一次麦克风或发送按钮后重试。");
              setStatusText("音频播放初始化失败。文字回复仍可使用。");
            });
          return;
        }
        if (typeof event.data !== "string") return;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(payload.type || "");
        if (type === "server.ready") {
          if (payload.vad_error) {
            setStatusText(`文字对话可用；麦克风暂不可用：${String(payload.vad_error)}`);
          }
          return;
        }
        if (type === "session.ready") {
          const backend = String(payload.tts_backend || "auto");
          setStatusText(Boolean(payload.tts_enabled) ? `会话已就绪，支持语音打断（${backend === "compatibility" ? "兼容语音" : "Whispera 流式语音"}）。` : "会话已就绪，当前仅输出文字。");
          return;
        }
        if (type === "vad") {
          const speaking = Boolean(payload.speaking);
          setVadSpeaking(speaking);
          if (String(payload.transition || "") === "speech_start") setStatusText("正在聆听…");
          if (String(payload.transition || "") === "speech_end") setStatusText("正在识别语音…");
          return;
        }
        if (type === "asr.started") {
          setSending(true);
          setStatusText("正在用 VoxCPM2 识别语音…");
          return;
        }
        if (type === "asr.completed") {
          const text = String(payload.text || "");
          if (text) appendMessage({ id: `user-${Date.now()}`, role: "user", text });
          setStatusText("识别完成，正在生成回复…");
          return;
        }
        if (type === "assistant.started") {
          const turnId = String(payload.turn_id || crypto.randomUUID());
          setSending(true);
          appendMessage({ id: turnId, role: "assistant", text: "", pending: true });
          return;
        }
        if (type === "assistant.delta") {
          const turnId = String(payload.turn_id || "");
          const delta = String(payload.text || "");
          setMessages((current) => current.map((message) => (
            message.id === turnId ? { ...message, text: `${message.text}${delta}`, pending: false } : message
          )));
          setStatusText("正在流式生成回复…");
          return;
        }
        if (type === "assistant.audio.generating") {
          setStatusText("回复已完成，正在生成整段语音…");
          return;
        }
        if (type === "assistant.audio.preparing") {
          setStatusText(String(payload.message || "正在准备实时流式 VoxCPM2…"));
          return;
        }
        if (type === "assistant.audio.start") {
          const sampleRate = Number(payload.sample_rate) || 24_000;
          beginPlaybackResponse(String(payload.audio_id || crypto.randomUUID()));
          (socket as WebSocket & { __openTtsSampleRate?: number }).__openTtsSampleRate = sampleRate;
          setPlaybackError(null);
          setStatusText("正在积攒约 1 秒语音缓冲，随后连续播放；直接开口即可打断。");
          return;
        }
        if (type === "assistant.audio.completed") {
          void flushPlaybackBuffer().catch(() => {
            setPlaybackError("系统阻止了音频播放；请再点击一次麦克风或发送按钮后重试。");
            setStatusText("音频播放初始化失败。文字回复仍可使用。");
          });
          return;
        }
        if (type === "assistant.audio.error") {
          setStatusText(`本句语音未能生成：${String(payload.message || "VoxCPM2 返回了错误")}；文字回复仍可继续使用。`);
          return;
        }
        if (type === "assistant.audio.fallback") {
          setStatusText(String(payload.message || "流式语音不可用，已切换到兼容模式。"));
          return;
        }
        if (type === "assistant.completed") {
          setSending(false);
          setStatusText(Boolean(payload.interrupted) ? "已被新的输入打断。" : "本轮对话完成。");
          return;
        }
        if (type === "interrupt.ack") {
          stopPlayback();
          setStatusText("已停止播放，正在切换到你的新输入。");
          return;
        }
        if (type === "turn.dropped") {
          setStatusText(String(payload.message || "排队输入过多，已丢弃最早的一条输入。"));
          return;
        }
        if (type === "asr.error" || type === "assistant.error" || type === "error") {
          setSending(false);
          setConnectionState(type === "error" ? "error" : "ready");
          setStatusText(String(payload.message || "实时会话发生错误。"));
        }
      };
      socket.onerror = () => {
        setConnectionState("error");
        setStatusText("无法连接本地实时后端，请确认 OpenTTS 后端在线。");
        settle(false);
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        setMicrophoneActive(false);
        setVadSpeaking(false);
        setSending(false);
        setConnectionState((state) => state === "error" ? "error" : "offline");
        settle(false);
      };
    });
    connectionPromiseRef.current = promise;
    return promise;
  }, [appendMessage, beginPlaybackResponse, configureOpenSession, flushPlaybackBuffer, llmBaseUrl, llmModel, playPcmChunk, runtimeMessage, runtimeState, sessionPayload, stopPlayback, ttsEnabled]);

  const stopMicrophone = useCallback(async () => {
    captureNodeRef.current?.disconnect();
    captureNodeRef.current = null;
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    if (captureWorkletUrlRef.current) {
      URL.revokeObjectURL(captureWorkletUrlRef.current);
      captureWorkletUrlRef.current = null;
    }
    const context = captureContextRef.current;
    captureContextRef.current = null;
    if (context && context.state !== "closed") await context.close();
    capturePcmRef.current = new Int16Array(0);
    setMicrophoneActive(false);
    setVadSpeaking(false);
  }, []);

  const startMicrophone = useCallback(async () => {
    if (microphoneActive) {
      await stopMicrophone();
      return;
    }
    // Chromium only permits resuming an AudioContext from a direct user
    // gesture. Whispera's first chunk can arrive tens of seconds later, so
    // unlock playback now rather than from the websocket callback.
    void activatePlayback().catch(() => {
      setPlaybackError("无法激活系统音频输出；请检查应用音量和默认播放设备。");
    });
    const connected = await connect();
    if (!connected) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusText("当前运行环境不支持麦克风采集。仍可使用文字对话。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      const context = new AudioContext();
      const workletUrl = createCaptureWorkletUrl();
      await context.audioWorklet.addModule(workletUrl);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "open-tts-capture", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const socket = socketRef.current;
        if (socket?.readyState !== WebSocket.OPEN) return;
        const converted = new Int16Array(downsamplePcm16(event.data, context.sampleRate));
        const pending = capturePcmRef.current;
        const combined = new Int16Array(pending.length + converted.length);
        combined.set(pending);
        combined.set(converted, pending.length);
        const frameSamples = 1_024;
        let offset = 0;
        while (combined.length - offset >= frameSamples) {
          // A complete 64 ms Silero window avoids fake zero-padded frames
          // and reduces WebSocket traffic from hundreds to ~16 packets/sec.
          socket.send(combined.slice(offset, offset + frameSamples).buffer);
          offset += frameSamples;
        }
        capturePcmRef.current = combined.slice(offset);
      };
      source.connect(node);
      microphoneStreamRef.current = stream;
      captureContextRef.current = context;
      captureNodeRef.current = node;
      captureWorkletUrlRef.current = workletUrl;
      setMicrophoneActive(true);
      setStatusText("麦克风已开启。停顿后将自动识别，AI 说话时直接开口即可打断。");
    } catch (error) {
      await stopMicrophone();
      setStatusText(error instanceof Error ? `无法启用麦克风：${error.message}` : "无法启用麦克风，请检查系统权限。");
    }
  }, [activatePlayback, connect, microphoneActive, stopMicrophone]);

  const sendText = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    // Keep this before the first await so the browser associates AudioContext
    // activation with the user's send-button/Enter gesture.
    void activatePlayback().catch(() => {
      setPlaybackError("无法激活系统音频输出；请检查应用音量和默认播放设备。");
    });
    const connected = await connect();
    const socket = socketRef.current;
    if (!connected || socket?.readyState !== WebSocket.OPEN) return;
    appendMessage({ id: `user-${Date.now()}`, role: "user", text });
    socket.send(JSON.stringify({ type: "text.input", text }));
    setDraft("");
    setSending(true);
    setStatusText("正在发送文字…");
  }, [activatePlayback, appendMessage, connect, draft]);

  const requestInterrupt = useCallback(() => {
    stopPlayback();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "interrupt" }));
  }, [stopPlayback]);

  const clearConversation = useCallback(() => {
    stopPlayback();
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "context.clear" }));
    setMessages([]);
    setSending(false);
    setStatusText("已清除本次会话上下文。");
  }, [stopPlayback]);

  useEffect(() => {
    void fetchVoices().then((items) => {
      setVoices(items.filter((voice) => Boolean(voice.reference_audio && voice.reference_text) && !voice.model_binding));
    }).catch(() => setVoices([]));
  }, []);

  useEffect(() => {
    configureOpenSession();
  }, [configureOpenSession]);

  useEffect(() => () => {
    void stopMicrophone();
    disconnect();
    stopPlayback();
    const context = playbackContextRef.current;
    if (context && context.state !== "closed") void context.close();
  }, [disconnect, stopMicrophone, stopPlayback]);

  const activeVoice = voices.find((voice) => voice.id === voiceId);
  const statusClass = connectionState === "ready" ? "ready" : connectionState === "connecting" ? "connecting" : connectionState === "error" ? "error" : "offline";
  const realtimeBackendLabel = !ttsEnabled
    ? "文字回复"
    : ttsBackend === "compatibility"
      ? "兼容整句语音"
      : "Whispera 流式语音";
  const runtimeStatusLabel = runtimeState === "ready"
    ? "ASR + Whispera 已预热"
    : runtimeState === "reserving"
      ? "正在预热 ASR + Whispera"
    : runtimeState === "error"
        ? "实时模型预热失败"
        : "未预热 ASR + Whispera";

  return (
    <section className="realtimeWorkspace" aria-label="实时语音交互">
      <aside className="realtimeSettingsPanel">
        <div className="realtimePanelHeading">
          <div className="realtimeIcon"><Radio size={18} strokeWidth={2} /></div>
          <div><span>实时语音交互</span><strong>Voice Conversation</strong></div>
        </div>

        <label className="realtimeField">
          <span>全局 LLM 地址</span>
          <input value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434/v1" />
        </label>
        <label className="realtimeField">
          <span>全局 LLM 模型</span>
          <input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="例如 qwen3:4b" />
        </label>
        <label className="realtimeField">
          <span><KeyRound size={13} /> API Key（全局加密保存）</span>
          <input type="password" autoComplete="off" value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} placeholder="本地服务可留空" />
          <small>地址、模型和密钥与“设置 → 全局 LLM”共用；密钥仅加密保存在当前 Windows 用户中，不会导出到设置备份。</small>
        </label>
        <label className="realtimeField">
          <span>回答音色</span>
          <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={!ttsEnabled}>
            <option value="">VoxCPM2 默认音色</option>
            {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
          </select>
          {ttsEnabled && !activeVoice && <small>选择已校对文本的音色，可使用现有克隆角色。</small>}
        </label>
        <label className="realtimeField">
          <span>实时 TTS 后端</span>
          <select value={ttsBackend} onChange={(event) => setTtsBackend(event.target.value)} disabled={!ttsEnabled}>
            <option value="auto">Whispera 流式（自动回退）</option>
            <option value="streaming">Whispera 流式（不回退）</option>
            <option value="compatibility">兼容模式（整句 WAV）</option>
          </select>
          <small>默认直接使用 Whispera 的模型流式模块；不兼容时自动切换现有 VoxCPM2 服务。</small>
        </label>
        <label className="realtimeField realtimePromptField">
          <span><SlidersHorizontal size={13} /> 系统提示词</span>
          <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={4} />
        </label>
        <label className="realtimeSwitch">
          <input type="checkbox" checked={ttsEnabled} onChange={(event) => setTtsEnabled(event.target.checked)} />
          <span><Volume2 size={15} /> 生成并播放 VoxCPM2 语音</span>
        </label>

        <div className={`realtimeConnection ${statusClass}`}>
          {connectionState === "ready" ? <Wifi size={16} /> : connectionState === "connecting" ? <Loader2 className="spin" size={16} /> : <WifiOff size={16} />}
          <span>{connectionState === "ready" ? "实时后端已连接" : connectionState === "connecting" ? "正在连接" : "尚未连接"}</span>
        </div>
        <button className="secondaryAction realtimeConnectButton" onClick={() => void connect()} disabled={!settingsReady || connectionState === "connecting" || (ttsEnabled && runtimeState === "reserving")}>
          {connectionState === "ready" ? <Wifi size={16} /> : <Radio size={16} />}
          <span>{connectionState === "ready" ? "重新应用会话设置" : "连接实时后端"}</span>
        </button>
        {connectionState !== "offline" && <button className="realtimeDisconnect" onClick={disconnect}>断开会话</button>}
      </aside>

      <main className="realtimeConversationPanel">
        <header className="realtimeConversationHeader">
          <div>
            <span className={`realtimeLiveDot ${microphoneActive ? "active" : ""}`} />
            <strong>{microphoneActive ? (vadSpeaking ? "正在聆听" : "麦克风已开启") : "实时对话待命"}</strong>
            <small>{activeVoice ? `使用 ${activeVoice.name} 回答` : ttsEnabled ? "使用 VoxCPM2 默认音色回答" : "当前只输出文字"}</small>
          </div>
          <div className="realtimeHeaderActions">
            {sending && <button className="realtimeIconButton stop" title="停止当前回答" aria-label="停止当前回答" onClick={requestInterrupt}><Square size={15} fill="currentColor" /></button>}
            <button className="realtimeIconButton" title="清除会话" aria-label="清除会话" onClick={clearConversation}><Trash2 size={16} /></button>
          </div>
        </header>

        <div className="realtimeStatus" role="status">
          {connectionState === "error" ? <CircleAlert size={16} /> : <Radio size={16} />}
          <span>{statusText}</span>
        </div>

        <div className="realtimeActivityDock" aria-label="实时会话状态">
          <span><Radio size={14} /> {realtimeBackendLabel}</span>
          <span className={runtimeState === "ready" ? "active" : runtimeState === "reserving" ? "busy" : runtimeState === "error" ? "error" : ""}><Radio size={14} /> {runtimeStatusLabel}</span>
          <span className={microphoneActive ? "active" : ""}>{microphoneActive ? <Mic size={14} /> : <MicOff size={14} />}{microphoneActive ? (vadSpeaking ? "正在聆听" : "麦克风就绪") : "文字输入就绪"}</span>
          <span className={playbackError ? "error" : sending ? "busy" : ""}>{playbackError ? <CircleAlert size={14} /> : sending ? <Loader2 className="spin" size={14} /> : <Volume2 size={14} />}{playbackError ?? (sending ? "回复处理中，可随时打断" : "语音队列空闲")}</span>
        </div>

        <div className="realtimeMessageList" aria-live="polite">
          {!messages.length && (
            <div className="realtimeEmptyState">
              <button
                type="button"
                className="realtimeEmptyStart"
                onClick={() => void startMicrophone()}
                disabled={!settingsReady || connectionState === "connecting" || (ttsEnabled && runtimeState === "reserving")}
                aria-label="开启麦克风并开始实时对话"
              >
                <Mic size={25} strokeWidth={1.8} />
                <span>{connectionState === "connecting" ? "正在连接…" : "开启麦克风"}</span>
              </button>
              <h2>开始一段自然对话</h2>
              <p>先配置一个 OpenAI 兼容 LLM；开启麦克风后，停顿会自动送去识别，AI 回答时直接开口即可打断。</p>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`realtimeMessage ${message.role}`}>
              <span className="realtimeMessageAvatar">{message.role === "user" ? <UserRound size={16} /> : message.role === "assistant" ? <Bot size={16} /> : <Radio size={16} />}</span>
              <div><strong>{message.role === "user" ? "你" : message.role === "assistant" ? "助手" : "系统"}</strong><p>{message.text || (message.pending ? "正在思考…" : "")}</p></div>
            </article>
          ))}
        </div>

        <footer className="realtimeComposer">
          <button
            className={microphoneActive ? "realtimeMicButton active" : "realtimeMicButton"}
            onClick={() => void startMicrophone()}
            aria-pressed={microphoneActive}
            title={microphoneActive ? "停止麦克风" : "开启麦克风"}
            disabled={!settingsReady || (ttsEnabled && runtimeState === "reserving")}
          >
            {microphoneActive ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendText();
              }
            }}
            placeholder="也可以先输入一段文字测试会话…"
            rows={2}
          />
          <button className="primaryAction realtimeSendButton" disabled={!settingsReady || !draft.trim() || (ttsEnabled && runtimeState === "reserving")} onClick={() => void sendText()}>
            <Send size={17} /><span>发送</span>
          </button>
        </footer>
      </main>
    </section>
  );
}
