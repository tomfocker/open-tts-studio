"""Realtime voice-conversation websocket.

This route deliberately lives beside, rather than inside, the OpenAI-compatible
``/v1/audio/speech`` API.  A turn has different lifetime and cancellation rules:
microphone frames arrive continuously, an LLM produces deltas, and audio is
played while the next user interruption may arrive at any point.

Wire protocol
-------------
Client -> server uses JSON control frames plus raw 16 kHz mono PCM16LE binary
frames.  Server -> client uses JSON control frames plus raw PCM16LE binary
frames after ``assistant.audio.start``.  Binary frames avoid base64 inflation
on the latency-sensitive path.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import tempfile
import wave
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Iterator
from urllib.parse import urlparse
from uuid import uuid4

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from tts_api.adapters.asr import get_local_transcriber
from tts_api.adapters.voxcpm2 import VoxCpm2Adapter
from tts_api.adapters.whispera_streaming import (
    WhisperaStreamingGenerationError,
    WhisperaStreamingUnavailable,
    get_whispera_streaming_service_manager,
    release_whispera_streaming_service,
    stream_whispera_tts,
)
from tts_api.config import Settings, get_settings
from tts_api.model_health import check_model_instance
from tts_api.model_instances import get_model_instance
from tts_api.realtime_vad import RealtimeSession as WhisperaRealtimeSession
from tts_api.runtime_memory import (
    is_realtime_runtime_reserved,
    get_realtime_asr_settings,
    local_gpu_generation_lock,
    release_conflicting_runtimes,
    release_realtime_asr,
    release_realtime_runtime_reservation,
    prewarm_realtime_asr,
    reserve_realtime_runtime,
    resolve_runtime_settings,
)
from tts_api.schemas import SpeechRequest
from tts_api.voice_library import find_stored_voice


router = APIRouter()

PCM_SAMPLE_RATE = 16_000
PCM_BYTES_PER_SAMPLE = 2
PCM_CHUNK_FRAMES = 2_048
MAX_PENDING_TURNS = 3
MAX_QUEUED_TTS_SEGMENTS = 3
# Keep a very small look-ahead window around each independently synthesised
# sentence. It lets us discard model-added padding silence without waiting for
# an entire sentence and without reintroducing per-chunk server pacing.
SEAM_LEADING_LOOKAHEAD_SECONDS = 0.14
SEAM_MAX_LEADING_SILENCE_SECONDS = 0.12
SEAM_TAIL_HOLD_SECONDS = 0.28
SEAM_EDGE_SECONDS = 0.025
SEAM_SILENCE_THRESHOLD = 0.0025

# Compatibility mode still calls the pre-existing whole-WAV HTTP adapter.
# Keep it pinned to one worker; Whispera's model-level streaming route manages
# its own isolated process and uses the same shared GPU lock instead.
_tts_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="opentts-realtime-tts")


@router.post("/v1/realtime/runtime/reserve")
def reserve_realtime_runtime_worker() -> dict:
    try:
        released_models = reserve_realtime_runtime(resolve_runtime_settings(get_settings()))
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"reserved": True, "released_models": released_models}


@router.post("/v1/realtime/runtime/prewarm")
def prewarm_realtime_runtime_worker() -> dict:
    """Load the realtime Whispera + SenseVoice pair after GPU reservation."""
    if not is_realtime_runtime_reserved():
        raise HTTPException(status_code=409, detail="请先进入实时语音模式并预约 VoxCPM2 显存。")

    settings = resolve_runtime_settings(get_settings())
    manager = get_whispera_streaming_service_manager(settings)
    try:
        with local_gpu_generation_lock:
            release_conflicting_runtimes("voxcpm2_streaming", settings)
            warmup = manager.prewarm_model()
            asr = prewarm_realtime_asr(settings)
    except Exception as exc:
        # A partially started worker must not remain resident after a failed
        # prewarm; otherwise it can block normal mode after the user leaves.
        with contextlib.suppress(Exception):
            manager.shutdown(force=True)
        with contextlib.suppress(Exception):
            release_realtime_asr()
        raise HTTPException(status_code=409, detail=f"实时语音模型预热失败：{exc}") from exc
    return {
        "ready": True,
        "worker": manager.status(),
        "compile_enabled": warmup.get("compile_enabled"),
        "compile_warmed": warmup.get("compile_warmed"),
        "compile_seconds": warmup.get("compile_seconds"),
        "asr": asr,
    }


@router.post("/v1/realtime/runtime/release")
def release_realtime_runtime_worker() -> dict:
    # Prewarming makes Whispera resident before the first reply. Release our
    # managed worker as soon as realtime closes so ordinary generation is not
    # left waiting for the idle timeout. Externally owned workers stay intact.
    settings = resolve_runtime_settings(get_settings())
    released_worker = release_whispera_streaming_service(settings)
    released_asr = release_realtime_asr()
    release_realtime_runtime_reservation()
    return {"reserved": False, "released_worker": released_worker, "released_asr": released_asr}


@dataclass
class RealtimeOptions:
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    system_prompt: str = "你是一个自然、简洁的中文语音助手。回答适合直接朗读，避免使用 Markdown。"
    voice_id: str | None = None
    tts_enabled: bool = True
    # ``auto`` prefers Whispera's model-level streaming worker and retains the
    # established VoxCPM2 HTTP adapter as a safe fallback.
    tts_backend: str = "auto"


@dataclass
class RealtimeConversation:
    options: RealtimeOptions = field(default_factory=RealtimeOptions)
    history: list[dict[str, str]] = field(default_factory=list)
    vad: WhisperaRealtimeSession | None = None
    pending_turns: deque[tuple[str, str | bytes]] = field(default_factory=deque)

    def build_messages(self, user_text: str, system_prompt: str | None = None) -> list[dict[str, str]]:
        system = (system_prompt if system_prompt is not None else self.options.system_prompt).strip()
        system = system or "你是一个自然、简洁的中文语音助手。"
        return [{"role": "system", "content": system}, *self.history[-12:], {"role": "user", "content": user_text}]

    def add_turn(self, role: str, content: str) -> None:
        value = content.strip()
        if value:
            self.history.append({"role": role, "content": value})
            self.history = self.history[-12:]


def _resolve_vad_model_path(settings: Settings) -> Path:
    """Find the Silero asset copied from Whispera without downloading a model."""
    configured = os.environ.get("OPEN_TTS_REALTIME_VAD_MODEL", "").strip()
    candidates = [
        Path(configured).expanduser() if configured else None,
        settings.workspace_root / "models" / "realtime" / "silero_vad.onnx",
        # The research checkout lets contributors exercise the direct reuse
        # before the binary asset is included in the desktop runtime bundle.
        settings.workspace_root / ".research" / "Whispera" / "model" / "vad" / "silero_vad.onnx",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    raise RuntimeError(
        "未找到 Silero VAD 模型。请把 Whispera 的 model/vad/silero_vad.onnx 放到 models/realtime/，"
        "或设置 OPEN_TTS_REALTIME_VAD_MODEL。"
    )


def _create_vad_session() -> WhisperaRealtimeSession:
    settings = get_settings()
    return WhisperaRealtimeSession(str(_resolve_vad_model_path(settings)))


def _pcm16_to_float32(payload: bytes) -> np.ndarray:
    usable = len(payload) - (len(payload) % PCM_BYTES_PER_SAMPLE)
    if usable <= 0:
        return np.array([], dtype=np.float32)
    return np.frombuffer(payload[:usable], dtype="<i2").astype(np.float32) / 32768.0


def _float32_to_pcm16(payload: np.ndarray) -> bytes:
    samples = np.asarray(payload, dtype=np.float32).reshape(-1)
    return (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


class StreamingPcmSeamFilter:
    """Trim only confirmed padding silence at independent TTS boundaries.

    Whispera delivers continuous chunks inside one request, but the realtime
    reply queue uses a new request for each text segment. Holding a short tail
    gives us enough evidence to remove artificial start/end silence from those
    seams. It never sleeps or resamples, so continuous speech remains ordered
    and delivery speed stays GPU-bound.
    """

    def __init__(self, sample_rate: int):
        self.sample_rate = sample_rate
        self._leading_pending = np.array([], dtype=np.float32)
        self._tail = np.array([], dtype=np.float32)
        self._started = False
        self._leading_lookahead_frames = max(1, round(sample_rate * SEAM_LEADING_LOOKAHEAD_SECONDS))
        self._max_leading_silence_frames = max(0, round(sample_rate * SEAM_MAX_LEADING_SILENCE_SECONDS))
        self._tail_hold_frames = max(1, round(sample_rate * SEAM_TAIL_HOLD_SECONDS))
        self._edge_frames = max(1, round(sample_rate * SEAM_EDGE_SECONDS))

    @staticmethod
    def _as_mono_float32(samples: np.ndarray) -> np.ndarray:
        return np.ascontiguousarray(np.asarray(samples, dtype=np.float32).reshape(-1))

    def _trim_leading_padding(self, samples: np.ndarray) -> np.ndarray:
        if not samples.size:
            return samples
        search_end = min(samples.size, self._max_leading_silence_frames)
        active = np.flatnonzero(np.abs(samples[:search_end]) >= SEAM_SILENCE_THRESHOLD)
        if active.size:
            cut = max(0, int(active[0]) - self._edge_frames)
        else:
            # Do not erase a deliberately quiet utterance. At most remove
            # known model padding and retain a small natural lead-in.
            cut = max(0, search_end - self._edge_frames)
        return samples[cut:]

    def _hold_tail(self, samples: np.ndarray) -> list[np.ndarray]:
        combined = samples if not self._tail.size else np.concatenate((self._tail, samples))
        if combined.size <= self._tail_hold_frames:
            self._tail = combined
            return []
        output = combined[:-self._tail_hold_frames]
        self._tail = combined[-self._tail_hold_frames:]
        return [output]

    def push(self, samples: np.ndarray) -> list[np.ndarray]:
        values = self._as_mono_float32(samples)
        if not values.size:
            return []
        if not self._started:
            self._leading_pending = np.concatenate((self._leading_pending, values))
            if self._leading_pending.size < self._leading_lookahead_frames:
                return []
            values = self._trim_leading_padding(self._leading_pending)
            self._leading_pending = np.array([], dtype=np.float32)
            self._started = True
            return self._hold_tail(values)
        return self._hold_tail(values)

    def finish(self) -> list[np.ndarray]:
        if not self._started and self._leading_pending.size:
            self._tail = self._trim_leading_padding(self._leading_pending)
            self._leading_pending = np.array([], dtype=np.float32)
            self._started = True
        if not self._tail.size:
            return []
        active = np.flatnonzero(np.abs(self._tail) >= SEAM_SILENCE_THRESHOLD)
        if active.size:
            end = min(self._tail.size, int(active[-1]) + self._edge_frames + 1)
        else:
            end = min(self._tail.size, self._edge_frames)
        output = self._tail[:end]
        self._tail = np.array([], dtype=np.float32)
        return [output] if output.size else []


def _next_or_done(iterator: Iterator[str]) -> tuple[bool, str]:
    try:
        return False, next(iterator)
    except StopIteration:
        return True, ""


def _normalise_llm_endpoint(raw_value: object) -> str:
    value = str(raw_value or "").strip().rstrip("/")
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("LLM 地址必须是完整的 http(s) OpenAI 兼容地址，例如 http://127.0.0.1:11434/v1。")
    if parsed.query or parsed.fragment:
        raise ValueError("LLM 地址不能包含查询参数或片段。")
    return value


def _stream_openai_compatible(options: RealtimeOptions, messages: list[dict[str, str]]) -> Iterator[str]:
    if not options.llm_base_url or not options.llm_model:
        raise RuntimeError("请先填写 OpenAI 兼容 LLM 地址和模型名。")
    endpoint = f"{options.llm_base_url}/chat/completions"
    headers = {"Accept": "text/event-stream"}
    if options.llm_api_key:
        headers["Authorization"] = f"Bearer {options.llm_api_key}"
    payload = {"model": options.llm_model, "messages": messages, "stream": True, "temperature": 0.7}
    timeout = httpx.Timeout(connect=12.0, read=120.0, write=20.0, pool=20.0)
    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", endpoint, json=payload, headers=headers) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line:
                    continue
                value = line[5:].strip() if line.startswith("data:") else line.strip()
                if value == "[DONE]":
                    return
                try:
                    item = json.loads(value)
                except json.JSONDecodeError:
                    continue
                choices = item.get("choices") if isinstance(item, dict) else None
                if not isinstance(choices, list) or not choices:
                    continue
                delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
                text = delta.get("content") if isinstance(delta, dict) else None
                if isinstance(text, str) and text:
                    yield text


def _save_pcm16_wav(payload: bytes) -> Path:
    temporary = tempfile.NamedTemporaryFile(prefix="opentts-realtime-", suffix=".wav", delete=False)
    path = Path(temporary.name)
    temporary.close()
    try:
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(PCM_BYTES_PER_SAMPLE)
            output.setframerate(PCM_SAMPLE_RATE)
            output.writeframes(payload)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path


def _run_asr(payload: bytes) -> str:
    audio_path = _save_pcm16_wav(payload)
    try:
        settings = get_realtime_asr_settings(resolve_runtime_settings(get_settings()))
        with local_gpu_generation_lock:
            transcriber = get_local_transcriber(settings)
            release_conflicting_runtimes(
                transcriber.runtime_model_id,
                settings,
                preserve_realtime_pair=True,
            )
            return transcriber.transcribe_path(audio_path, language="zh")
    finally:
        audio_path.unlink(missing_ok=True)


def _resolve_realtime_voice(settings: Settings, voice_id: str | None) -> tuple[str | None, str | None]:
    if not voice_id:
        return None, None
    voice = find_stored_voice(voice_id, settings)
    if voice is None:
        raise RuntimeError("选择的音色已不存在，请重新选择。")
    if voice.model_binding is not None:
        raise RuntimeError("模型专属音色暂不支持实时 VoxCPM2 对话。")
    if not voice.reference_audio or not voice.reference_text:
        raise RuntimeError("实时克隆需要音色库中的参考音频和已校对的参考文本。")
    return voice.reference_audio, voice.reference_text


def _run_tts(text: str, options: RealtimeOptions):
    settings = resolve_runtime_settings(get_settings())
    instance = get_model_instance("voxcpm2", settings=settings)
    if not instance.enabled:
        raise RuntimeError("VoxCPM2 已被禁用，请先在模型设置中启用它。")
    health = check_model_instance(instance)
    if health.status != "ready":
        raise RuntimeError(health.repair_hint or "VoxCPM2 模型目录尚未准备完成。")
    reference_audio, reference_text = _resolve_realtime_voice(settings, options.voice_id)
    request = SpeechRequest(
        model="voxcpm2",
        input=text,
        reference_audio=reference_audio,
        reference_text=reference_text,
        cfg=2.0,
        inference_steps=10,
        normalize=True,
        denoise=False,
    )
    with local_gpu_generation_lock:
        release_conflicting_runtimes("voxcpm2", settings)
        return VoxCpm2Adapter(settings=settings).synthesize(request)


def _read_pcm16_wav(path: str) -> tuple[int, list[bytes]]:
    with wave.open(path, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != PCM_BYTES_PER_SAMPLE or source.getcomptype() != "NONE":
            raise RuntimeError("实时播放目前需要 VoxCPM2 输出单声道 PCM16 WAV。")
        sample_rate = source.getframerate()
        chunks: list[bytes] = []
        while frames := source.readframes(PCM_CHUNK_FRAMES):
            chunks.append(frames)
        return sample_rate, chunks


@router.websocket("/v1/realtime")
async def realtime_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    conversation = RealtimeConversation()
    vad_error: str | None = None
    try:
        conversation.vad = _create_vad_session()
    except Exception as exc:
        # Text chat remains usable; the renderer receives a precise readiness
        # state before it asks for microphone permission.
        vad_error = str(exc)
    send_lock = asyncio.Lock()
    active_task: asyncio.Task[None] | None = None
    active_cancel_event: asyncio.Event | None = None
    closed = False

    async def send_event(event_type: str, **payload: object) -> None:
        async with send_lock:
            await websocket.send_json({"type": event_type, **payload})

    async def send_audio(payload: bytes) -> None:
        async with send_lock:
            await websocket.send_bytes(payload)

    async def acquire_generation_slot(cancel_event: asyncio.Event) -> bool:
        """Acquire the shared GPU lock without making an interrupt wait forever."""
        while not cancel_event.is_set():
            acquired = await asyncio.to_thread(local_gpu_generation_lock.acquire, True, 0.1)
            if acquired:
                return True
        return False

    async def emit_compatibility_audio(
        turn_id: str,
        text: str,
        options: RealtimeOptions,
        cancel_event: asyncio.Event,
    ) -> None:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_tts_executor, _run_tts, text, options)
        # The inference in the VoxCPM HTTP worker cannot be cancelled halfway
        # through.  The per-turn event is deliberately kept after a new turn
        # starts so an old executor future can never send stale audio later.
        if cancel_event.is_set():
            return
        sample_rate, chunks = await asyncio.to_thread(_read_pcm16_wav, result.file_path)
        audio_id = f"audio-{uuid4().hex[:10]}"
        await send_event(
            "assistant.audio.start",
            turn_id=turn_id,
            audio_id=audio_id,
            sample_rate=sample_rate,
            audio_format="pcm_s16le",
            text=text,
        )
        sent_chunks = 0
        for chunk in chunks:
            if cancel_event.is_set():
                break
            await send_audio(chunk)
            sent_chunks += 1
            # Do not dump a complete WAV into the browser at once.  Besides
            # ballooning the AudioContext schedule, that caused a later
            # sentence to interrupt a sentence that had not finished playing.
            # Pacing from the server keeps latency low and makes barge-in
            # deterministic on ordinary local WebSocket connections.
            await asyncio.sleep(len(chunk) / (sample_rate * PCM_BYTES_PER_SAMPLE))
        await send_event(
            "assistant.audio.completed",
            turn_id=turn_id,
            audio_id=audio_id,
            chunks=sent_chunks,
            interrupted=cancel_event.is_set(),
        )

    async def emit_whispera_streaming_audio(
        turn_id: str,
        text: str,
        options: RealtimeOptions,
        cancel_event: asyncio.Event,
    ) -> None:
        settings = resolve_runtime_settings(get_settings())
        instance = get_model_instance("voxcpm2", settings=settings)
        if not instance.enabled:
            raise RuntimeError("VoxCPM2 已被禁用，请先在模型设置中启用它。")
        health = check_model_instance(instance)
        if health.status != "ready":
            raise RuntimeError(health.repair_hint or "VoxCPM2 模型目录尚未准备完成。")
        reference_audio, reference_text = _resolve_realtime_voice(settings, options.voice_id)
        if not await acquire_generation_slot(cancel_event):
            return

        audio_id = f"audio-{uuid4().hex[:10]}"
        sample_rate: int | None = None
        seam_filter: StreamingPcmSeamFilter | None = None
        sent_chunks = 0
        started_audio = False

        async def send_samples(samples: np.ndarray, current_sample_rate: int) -> None:
            nonlocal started_audio, sent_chunks
            payload = _float32_to_pcm16(samples)
            if not payload:
                return
            if not started_audio:
                # The short seam look-ahead removes only model padding. The
                # AudioContext then keeps every subsequent chunk and sentence
                # on the same continuous playback timeline.
                await send_event(
                    "assistant.audio.start",
                    turn_id=turn_id,
                    audio_id=audio_id,
                    sample_rate=current_sample_rate,
                    audio_format="pcm_s16le",
                    text=text,
                    streaming=True,
                )
                started_audio = True
            await send_audio(payload)
            sent_chunks += 1

        try:
            # The upstream worker runs in a separate VoxCPM2 Python runtime.
            # Treat it as a distinct GPU occupant so the existing HTTP worker
            # is released before it loads the same weights.
            await send_event(
                "assistant.audio.preparing",
                turn_id=turn_id,
                backend="streaming",
                message="正在准备 Whispera 流式 VoxCPM2…",
            )
            released_models = await asyncio.to_thread(
                release_conflicting_runtimes,
                "voxcpm2_streaming",
                settings,
                preserve_realtime_pair=True,
            )
            if released_models:
                await send_event(
                    "assistant.audio.preparing",
                    turn_id=turn_id,
                    backend="streaming",
                    message=f"已释放 {'、'.join(released_models)}，正在加载实时流式 VoxCPM2…",
                    released_models=released_models,
                )
            async for chunk in stream_whispera_tts(
                settings,
                text=text,
                reference_audio=reference_audio,
                reference_text=reference_text,
                cancel_event=cancel_event,
            ):
                if cancel_event.is_set():
                    break
                if sample_rate is None:
                    sample_rate = chunk.sample_rate
                    seam_filter = StreamingPcmSeamFilter(sample_rate)
                elif sample_rate != chunk.sample_rate:
                    raise WhisperaStreamingGenerationError("Whispera 流式 TTS 在同一请求中改变了采样率。")
                assert seam_filter is not None
                for filtered in seam_filter.push(chunk.samples):
                    await send_samples(filtered, sample_rate)
            if seam_filter is not None and sample_rate is not None and not cancel_event.is_set():
                for filtered in seam_filter.finish():
                    await send_samples(filtered, sample_rate)
            if not started_audio and not cancel_event.is_set():
                raise WhisperaStreamingGenerationError("Whispera 流式 TTS 未生成可播放音频。")
        finally:
            local_gpu_generation_lock.release()

        if started_audio:
            await send_event(
                "assistant.audio.completed",
                turn_id=turn_id,
                audio_id=audio_id,
                chunks=sent_chunks,
                interrupted=cancel_event.is_set(),
                streaming=True,
            )

    async def emit_audio(
        turn_id: str,
        text: str,
        options: RealtimeOptions,
        cancel_event: asyncio.Event,
    ) -> None:
        backend = options.tts_backend
        if backend != "compatibility":
            try:
                await emit_whispera_streaming_audio(turn_id, text, options, cancel_event)
                return
            except WhisperaStreamingUnavailable as exc:
                if backend == "streaming":
                    raise
                if cancel_event.is_set():
                    return
                await send_event(
                    "assistant.audio.fallback",
                    turn_id=turn_id,
                    message=f"Whispera 流式 TTS 暂不可用，已切换到兼容模式：{exc}",
                )
        await emit_compatibility_audio(turn_id, text, options, cancel_event)

    async def run_text_turn(
        user_text: str,
        cancel_event: asyncio.Event,
        source_turn_id: str | None = None,
    ) -> None:
        turn_id = source_turn_id or f"turn-{uuid4().hex[:10]}"
        request_id = f"assistant-{uuid4().hex[:10]}"
        # Reconfiguring the UI must affect the next turn only.  Capturing the
        # endpoint, prompt and voice here prevents a reply from changing voice
        # or model halfway through a sentence queue.
        turn_options = RealtimeOptions(**conversation.options.__dict__)
        history_before_turn = list(conversation.history)
        history_committed = False
        conversation.add_turn("user", user_text)
        await send_event("assistant.started", turn_id=turn_id, request_id=request_id)
        started = perf_counter()
        full_text = ""
        audio_queue: asyncio.Queue[str | None] | None = None
        audio_worker: asyncio.Task[None] | None = None

        if conversation.options.tts_enabled:
            audio_queue = asyncio.Queue(maxsize=MAX_QUEUED_TTS_SEGMENTS)

            async def synthesize_queued_audio() -> None:
                assert audio_queue is not None
                while True:
                    segment = await audio_queue.get()
                    try:
                        if segment is None or cancel_event.is_set():
                            return
                        await emit_audio(turn_id, segment, turn_options, cancel_event)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        if not cancel_event.is_set():
                            await send_event(
                                "assistant.audio.error",
                                turn_id=turn_id,
                                text=segment,
                                message=str(exc),
                            )
                    finally:
                        audio_queue.task_done()

            audio_worker = asyncio.create_task(synthesize_queued_audio())

        async def queue_audio(segment: str) -> None:
            if not segment or cancel_event.is_set() or audio_queue is None:
                return
            await send_event("assistant.audio.generating", turn_id=turn_id, text=segment)
            # A bounded queue applies back-pressure to very fast LLMs instead
            # of accumulating unlimited TTS work and stale audio in memory.
            # Polling keeps an interrupt from deadlocking the producer when
            # the worker has stopped after an in-flight model request.
            while not cancel_event.is_set():
                try:
                    await asyncio.wait_for(audio_queue.put(segment), timeout=0.1)
                    return
                except TimeoutError:
                    continue

        try:
            stream = _stream_openai_compatible(
                turn_options,
                conversation.build_messages(user_text, system_prompt=turn_options.system_prompt),
            )
            while not cancel_event.is_set():
                done, delta = await asyncio.to_thread(_next_or_done, stream)
                if cancel_event.is_set():
                    break
                if done:
                    break
                if not delta:
                    continue
                full_text += delta
                await send_event("assistant.delta", turn_id=turn_id, request_id=request_id, text=delta)
            # Whispera currently receives a complete text field at tts.start;
            # it cannot append later LLM deltas to the same acoustic request.
            # Send one full reply once the LLM finishes, rather than cutting
            # at punctuation and audibly resetting Vox between sentences.
            if full_text and audio_queue is not None and not cancel_event.is_set():
                await queue_audio(full_text)
            if audio_queue is not None and not cancel_event.is_set():
                await audio_queue.put(None)
                if audio_worker is not None:
                    await audio_worker
            if full_text and not cancel_event.is_set():
                conversation.add_turn("assistant", full_text)
                history_committed = True
            await send_event(
                "assistant.completed",
                turn_id=turn_id,
                request_id=request_id,
                interrupted=cancel_event.is_set(),
                elapsed_ms=round((perf_counter() - started) * 1000),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await send_event("assistant.error", turn_id=turn_id, request_id=request_id, message=str(exc))
        finally:
            # An interrupted/failed question has no corresponding assistant
            # answer.  Do not leak that partial turn into the next prompt.
            if not history_committed:
                conversation.history = history_before_turn
            if audio_worker is not None and not audio_worker.done():
                audio_worker.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await audio_worker

    async def run_audio_turn(audio: bytes, cancel_event: asyncio.Event) -> None:
        turn_id = f"turn-{uuid4().hex[:10]}"
        await send_event("asr.started", turn_id=turn_id)
        try:
            text = await asyncio.to_thread(_run_asr, audio)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await send_event("asr.error", turn_id=turn_id, message=str(exc))
            return
        if cancel_event.is_set():
            return
        await send_event("asr.completed", turn_id=turn_id, text=text)
        await run_text_turn(text, cancel_event, source_turn_id=turn_id)

    async def start_queued_turn(kind: str, value: str | bytes, turn_id: str | None = None) -> None:
        nonlocal active_task, active_cancel_event
        cancel_event = asyncio.Event()
        active_cancel_event = cancel_event
        if kind == "audio":
            active_task = asyncio.create_task(run_audio_turn(value if isinstance(value, bytes) else b"", cancel_event))
        else:
            active_task = asyncio.create_task(
                run_text_turn(value if isinstance(value, str) else "", cancel_event, source_turn_id=turn_id)
            )

        async def continue_after_turn(task: asyncio.Task[None]) -> None:
            nonlocal active_task, active_cancel_event
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
            if active_task is task:
                active_task = None
                active_cancel_event = None
            if closed or not conversation.pending_turns:
                return
            next_kind, next_value = conversation.pending_turns.popleft()
            await start_queued_turn(next_kind, next_value)

        asyncio.create_task(continue_after_turn(active_task))

    async def interrupt(reason: str) -> None:
        if active_cancel_event is not None:
            active_cancel_event.set()
        await send_event(
            "interrupt.ack",
            accepted=bool(active_task and not active_task.done()),
            reason=reason,
        )

    async def enqueue_pending_turn(kind: str, value: str | bytes, source: str) -> None:
        if len(conversation.pending_turns) >= MAX_PENDING_TURNS:
            conversation.pending_turns.popleft()
            await send_event(
                "turn.dropped",
                source=source,
                message="排队输入过多，已丢弃最早的一条未处理输入。",
            )
        conversation.pending_turns.append((kind, value))

    await send_event(
        "server.ready",
        protocol="opentts-realtime-v1",
        microphone_format={"sample_rate": PCM_SAMPLE_RATE, "audio_format": "pcm_s16le", "channels": 1},
        capabilities={
            "vad": "silero" if conversation.vad else "unavailable",
            "asr": "sensevoice",
            "tts": "voxcpm2",
            "tts_backends": ["auto", "streaming", "compatibility"],
            "llm": "openai-compatible",
        },
        vad_error=vad_error,
    )
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw_audio = message.get("bytes")
            if isinstance(raw_audio, bytes):
                vad = conversation.vad
                if vad is None:
                    await send_event("error", message=vad_error or "Silero VAD 尚未准备完成，无法处理麦克风音频。")
                    continue
                was_speaking = vad.speaking
                vad.generating = bool(active_task and not active_task.done())
                transition = vad.push_chunk(_pcm16_to_float32(raw_audio))
                if not was_speaking and vad.speaking:
                    await send_event("vad", speaking=True, transition="speech_start")
                if transition == "interrupt" and active_cancel_event is not None and not active_cancel_event.is_set():
                    await interrupt("vad_barge_in")
                if transition == "speech_end":
                    await send_event("vad", speaking=False, transition="speech_end")
                    audio = _float32_to_pcm16(vad.get_audio())
                    if active_task is not None and not active_task.done():
                        await enqueue_pending_turn("audio", audio, "microphone")
                        await send_event("turn.queued", source="microphone")
                    else:
                        await start_queued_turn("audio", audio)
                continue

            text_message = message.get("text")
            if not isinstance(text_message, str):
                await send_event("error", message="只支持 JSON 控制帧或 PCM16LE 二进制音频帧。")
                continue
            try:
                payload = json.loads(text_message)
            except json.JSONDecodeError:
                await send_event("error", message="控制帧必须是 JSON。")
                continue
            if not isinstance(payload, dict):
                await send_event("error", message="控制帧必须是 JSON 对象。")
                continue
            message_type = payload.get("type")
            if message_type == "session.configure":
                try:
                    conversation.options.llm_base_url = _normalise_llm_endpoint(payload.get("llm_base_url"))
                    conversation.options.llm_model = str(payload.get("llm_model") or "").strip()
                    conversation.options.llm_api_key = str(payload.get("llm_api_key") or "")
                    conversation.options.system_prompt = str(payload.get("system_prompt") or conversation.options.system_prompt).strip()
                    raw_voice_id = payload.get("voice_id")
                    conversation.options.voice_id = str(raw_voice_id).strip() if raw_voice_id else None
                    conversation.options.tts_enabled = bool(payload.get("tts_enabled", True))
                    requested_backend = str(payload.get("tts_backend") or "auto").strip().lower()
                    if requested_backend not in {"auto", "streaming", "compatibility"}:
                        raise ValueError("TTS 后端只支持 auto、streaming 或 compatibility。")
                    conversation.options.tts_backend = requested_backend
                    if not conversation.options.llm_model:
                        raise ValueError("请填写 LLM 模型名。")
                except ValueError as exc:
                    await send_event("error", message=str(exc))
                    continue
                await send_event(
                    "session.ready",
                    llm_base_url=conversation.options.llm_base_url,
                    llm_model=conversation.options.llm_model,
                    tts_enabled=conversation.options.tts_enabled,
                    tts_backend=conversation.options.tts_backend,
                    api_key_persisted=False,
                )
                continue
            if message_type == "text.input":
                user_text = str(payload.get("text") or "").strip()
                if not user_text:
                    await send_event("error", message="请输入要发送的内容。")
                    continue
                if active_task is not None and not active_task.done():
                    # Explicit text is an intentional replacement for any
                    # previously captured but not yet processed microphone
                    # turns.  Keeping them would make the assistant answer a
                    # stale conversation after the user has moved on.
                    conversation.pending_turns.clear()
                    await enqueue_pending_turn("text", user_text, "text")
                    await interrupt("new_text_input")
                    await send_event("turn.queued", source="text")
                else:
                    await start_queued_turn("text", user_text)
                continue
            if message_type == "interrupt":
                await interrupt("client_request")
                continue
            if message_type == "context.clear":
                await interrupt("context_clear")
                conversation.history.clear()
                conversation.pending_turns.clear()
                if conversation.vad is not None:
                    conversation.vad.reset()
                await send_event("context.cleared")
                continue
            if message_type == "ping":
                await send_event("pong")
                continue
            if message_type == "session.stop":
                await interrupt("session_stop")
                break
            await send_event("error", message=f"不支持的消息类型：{message_type}")
    except WebSocketDisconnect:
        pass
    finally:
        closed = True
        if active_cancel_event is not None:
            active_cancel_event.set()
        if active_task is not None:
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await active_task
