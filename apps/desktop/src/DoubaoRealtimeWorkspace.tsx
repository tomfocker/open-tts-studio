import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  Cloud,
  Loader2,
  Pause,
  Play,
  Send,
  Square,
  Trash2,
  UserRound,
  Volume2
} from "lucide-react";

import { fetchDoubaoVoices, generateDoubaoRealtimeTurn, toAudioUrl } from "./api";
import type { DoubaoVoice, GlobalLlmSettings } from "./types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  pending?: boolean;
};

type StoredRealtimeOptions = {
  voiceId?: string;
  speechRate?: number;
  pitch?: number;
};

declare global {
  interface Window {
    desktopLlmSettings?: {
      load: () => Promise<GlobalLlmSettings>;
      save: (settings: GlobalLlmSettings) => Promise<unknown>;
    };
  }
}

const DEFAULT_LLM_SETTINGS: GlobalLlmSettings = {
  enabled: true,
  baseUrl: "https://api.cdn-krill-ai.com/codex/v1",
  model: "gpt-5.6-luna",
  apiKey: "",
  systemPrompt: "你是 OpenTTS Studio 的实时中文语音助手。用自然、友好、简洁的口语直接回答。避免 Markdown、标题、列表符号、代码块、表情和括号说明。每次优先一到三句，需要补充时用短句说明；不要复述用户的问题。",
  temperature: 0.7,
  maxTokens: 512
};

function loadStoredOptions(): StoredRealtimeOptions {
  try {
    return JSON.parse(window.localStorage.getItem("opentts-doubao-realtime-options") || "{}") as StoredRealtimeOptions;
  } catch {
    return {};
  }
}

export function DoubaoRealtimeWorkspace() {
  const storedOptions = useMemo(loadStoredOptions, []);
  const [llmSettings, setLlmSettings] = useState<GlobalLlmSettings>(DEFAULT_LLM_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(() => !window.desktopLlmSettings);
  const [voices, setVoices] = useState<DoubaoVoice[]>([]);
  const [voiceId, setVoiceId] = useState(storedOptions.voiceId || "");
  const [speechRate, setSpeechRate] = useState(Number.isFinite(storedOptions.speechRate) ? Number(storedOptions.speechRate) : 0);
  const [pitch, setPitch] = useState(Number.isFinite(storedOptions.pitch) ? Number(storedOptions.pitch) : 0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("正在读取全局 LLM 与豆包音色…");
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.style_id === voiceId) ?? voices[0] ?? null,
    [voiceId, voices]
  );
  const llmReady = Boolean(llmSettings.enabled && llmSettings.baseUrl.trim() && llmSettings.model.trim());

  const loadLlmSettings = useCallback(async () => {
    try {
      const loaded = await window.desktopLlmSettings?.load();
      if (loaded) setLlmSettings({ ...DEFAULT_LLM_SETTINGS, ...loaded });
    } catch {
      setStatus("未能读取全局 LLM 设置，请在设置中心检查接口配置。");
    } finally {
      setSettingsReady(true);
    }
  }, []);

  useEffect(() => {
    void loadLlmSettings();
    const listener = () => void loadLlmSettings();
    window.addEventListener("opentts:llm-settings-changed", listener);
    return () => window.removeEventListener("opentts:llm-settings-changed", listener);
  }, [loadLlmSettings]);

  useEffect(() => {
    void fetchDoubaoVoices()
      .then((items) => {
        setVoices(items);
        setVoiceId((current) => current || storedOptions.voiceId || items[0]?.style_id || "");
        setStatus("云端实时对话已就绪：输入文字后会自动朗读回复。");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "无法加载豆包音色。");
      });
  }, [storedOptions.voiceId]);

  useEffect(() => {
    window.localStorage.setItem("opentts-doubao-realtime-options", JSON.stringify({ voiceId, speechRate, pitch }));
  }, [pitch, speechRate, voiceId]);

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayingId(null);
  }, []);

  const playMessage = useCallback(async (message: ChatMessage) => {
    if (!message.audioUrl) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === message.id && !audio.paused) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = message.audioUrl;
    try {
      await audio.play();
      setPlayingId(message.id);
      setStatus("正在播放豆包语音；随时可以暂停或继续输入下一句。");
    } catch (cause) {
      setPlayingId(null);
      setStatus("语音已生成，但系统没有允许自动播放；点击回复旁的播放按钮即可。" + (cause instanceof Error ? `（${cause.message}）` : ""));
    }
  }, [playingId]);

  const sendTurn = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !selectedVoice) return;
    if (!llmReady) {
      setError("请先在设置中心完成全局 LLM 配置后再开始云端实时对话。");
      return;
    }
    stopPlayback();
    const userMessage: ChatMessage = { id: `user-${crypto.randomUUID()}`, role: "user", text };
    const assistantId = `assistant-${crypto.randomUUID()}`;
    const history = [...messages, userMessage]
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-16)
      .map((message) => ({ role: message.role, text: message.text }));
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", text: "正在生成回复与语音…", pending: true }]);
    setDraft("");
    setSending(true);
    setError(null);
    setStatus("正在请求全局 LLM；完成后交给豆包整段合成，不会占用本地 GPU。 ");
    try {
      const result = await generateDoubaoRealtimeTurn(llmSettings, {
        messages: history,
        voiceId: selectedVoice.style_id,
        speechRate,
        pitch,
        responseFormat: "mp3"
      });
      const audioUrl = toAudioUrl(result.audio.audio_url);
      const responseMessage: ChatMessage = { id: assistantId, role: "assistant", text: result.assistantText, audioUrl };
      setMessages((current) => current.map((message) => message.id === assistantId ? responseMessage : message));
      setStatus(`回复已生成（${result.model}），正在准备播放。`);
      // Native desktop builds usually permit this. If Chromium rejects it, the
      // message keeps an explicit play button rather than dropping the audio.
      window.setTimeout(() => void playMessage(responseMessage), 0);
    } catch (cause) {
      setMessages((current) => current.map((message) => message.id === assistantId
        ? { ...message, text: "本轮生成失败，请检查网络、LLM 配置和豆包账号。", pending: false }
        : message));
      setError(cause instanceof Error ? cause.message : "云端实时对话失败。");
      setStatus("本轮未生成音频；可直接修改后重新发送。");
    } finally {
      setSending(false);
    }
  }, [draft, llmReady, llmSettings, messages, pitch, playMessage, selectedVoice, sending, speechRate, stopPlayback]);

  return (
    <div className="doubaoRealtimeLayout">
      <aside className="doubaoPanel doubaoRealtimeSettings">
        <div className="doubaoSectionHeading">
          <div><Cloud size={18} /><span><strong>云端实时对话</strong><small>全局 LLM 回复 + 豆包网页端整段朗读</small></span></div>
        </div>
        <div className="doubaoRealtimeNotice">
          <CircleAlert size={16} />
          <span>不加载 Whispera、Vox 或本地 ASR，不占显存。豆包网页端目前按整段返回 AAC，因此这里优先保证完整、连续的回复播放。</span>
        </div>
        <div className="doubaoRealtimeLlmState">
          <span>全局 LLM</span>
          <strong>{settingsReady ? (llmReady ? llmSettings.model : "尚未配置") : "读取中…"}</strong>
          <small>{llmReady ? llmSettings.baseUrl : "请到设置中心的“全局 LLM”完成配置"}</small>
        </div>
        <label className="doubaoField">
          <span>回答音色</span>
          <select value={selectedVoice?.style_id || ""} onChange={(event) => setVoiceId(event.target.value)} disabled={!voices.length || sending}>
            {voices.map((voice) => <option key={voice.style_id} value={voice.style_id}>{voice.name} · {voice.gender || "通用"}</option>)}
          </select>
        </label>
        <label className="doubaoField">
          <span>语速 {speechRate > 0 ? `+${speechRate}` : speechRate}</span>
          <input type="range" min={-25} max={50} step={5} value={speechRate} onChange={(event) => setSpeechRate(Number(event.target.value))} disabled={sending} />
        </label>
        <label className="doubaoField">
          <span>音调 {pitch > 0 ? `+${pitch}` : pitch}</span>
          <input type="range" min={-12} max={12} step={1} value={pitch} onChange={(event) => setPitch(Number(event.target.value))} disabled={sending} />
        </label>
        <button type="button" className="doubaoSecondaryButton" onClick={stopPlayback} disabled={!playingId}><Square size={15} fill="currentColor" /><span>停止播放</span></button>
        <small className="doubaoRealtimeFootnote">这不是本地实时语音交互的替代：若需要麦克风、打断和逐块流式音频，仍使用“本地 TTS → 实时语音交互”。</small>
      </aside>

      <section className="doubaoPanel doubaoRealtimeConversation">
        <header className="doubaoRealtimeHeader">
          <div><span className={sending ? "doubaoRealtimeDot active" : "doubaoRealtimeDot"} /><strong>实时朗读会话</strong><small>每轮均使用当前全局 LLM 与当前豆包音色</small></div>
          <button type="button" className="doubaoIconButton" title="清空会话" aria-label="清空会话" onClick={() => { stopPlayback(); setMessages([]); setStatus("已清除本次会话上下文。"); }} disabled={!messages.length || sending}><Trash2 size={16} /></button>
        </header>
        <div className="doubaoRealtimeFeedback">
          <div className="doubaoRealtimeStatus" role="status"><Cloud size={15} /><span>{status}</span></div>
          {error && <div className="doubaoRealtimeError" role="alert" aria-live="assertive"><CircleAlert size={15} /><span>{error}</span></div>}
        </div>
        <div className="doubaoRealtimeMessages" aria-live="polite">
          {!messages.length && (
            <div className="doubaoRealtimeEmpty"><Volume2 size={30} /><strong>输入一句话开始对话</strong><span>AI 的完整回复会由豆包自动朗读，并保留在本次会话中。</span></div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`doubaoRealtimeMessage ${message.role}${message.pending ? " pending" : ""}`}>
              <span className="doubaoRealtimeAvatar">{message.role === "user" ? <UserRound size={16} /> : <Bot size={16} />}</span>
              <div><p>{message.text}</p>{message.audioUrl && <button type="button" className="doubaoRealtimePlay" onClick={() => void playMessage(message)}>{playingId === message.id ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}<span>{playingId === message.id ? "暂停朗读" : "播放朗读"}</span></button>}</div>
            </article>
          ))}
        </div>
        <footer className="doubaoRealtimeComposer">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendTurn(); } }} placeholder="输入一句话，Enter 发送；Shift + Enter 换行" disabled={sending || !settingsReady} />
          <button type="button" className="doubaoPrimaryButton" disabled={sending || !draft.trim() || !selectedVoice || !llmReady || !settingsReady} onClick={() => void sendTurn()}>{sending ? <Loader2 className="spin" size={17} /> : <Send size={17} />}<span>{sending ? "生成中" : "发送并朗读"}</span></button>
        </footer>
        <audio ref={audioRef} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} />
      </section>
    </div>
  );
}
