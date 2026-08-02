import time
from types import SimpleNamespace

import numpy as np
from fastapi.testclient import TestClient

from tts_api import realtime_vad
from tts_api.realtime_vad import RealtimeSession, VADConfig
from tts_api.realtime_text_segmenter import StreamingTextSegmenter
from tts_api.routes import realtime
from tts_api.adapters.whispera_streaming import WhisperaPcmChunk
from tts_api.routes.realtime import _normalise_llm_endpoint
from tts_api.main import create_app


def test_segmenter_prefers_sentence_boundaries_and_flushes_tail():
    segmenter = StreamingTextSegmenter(hard_limit=12)

    assert segmenter.feed("第一句。第二") == ["第一句。"]
    assert segmenter.feed("句还没结束") == []
    assert segmenter.flush() == "第二句还没结束"


def test_segmenter_keeps_words_intact_at_hard_limit():
    segmenter = StreamingTextSegmenter(hard_limit=12)

    assert segmenter.feed("one two three four") == ["one two"]
    assert segmenter.flush() == "three four"


def test_segmenter_merges_short_sentences_for_realtime_cadence():
    segmenter = StreamingTextSegmenter(min_chunk_chars=18, preferred_chunk_chars=42)

    assert segmenter.feed("好的。明白。") == []
    assert segmenter.feed("接下来我会继续帮你处理这个问题。") == ["好的。明白。接下来我会继续帮你处理这个问题。"]


def test_streaming_pcm_seam_filter_removes_padding_but_keeps_a_natural_edge():
    seam_filter = realtime.StreamingPcmSeamFilter(sample_rate=1_000)
    samples = np.concatenate((np.zeros(100, dtype=np.float32), np.full(200, 0.1, dtype=np.float32), np.zeros(200, dtype=np.float32)))

    emitted = [*seam_filter.push(samples), *seam_filter.finish()]
    joined = np.concatenate(emitted)

    # Preserve 25 ms on both sides of speech, rather than cutting the word
    # onset/end. The 100 ms and 200 ms model padding is removed.
    assert joined.size == 250
    np.testing.assert_allclose(joined[:25], 0)
    np.testing.assert_allclose(joined[25:225], 0.1)
    np.testing.assert_allclose(joined[225:], 0)


def test_whispera_vad_state_machine_detects_complete_turn(monkeypatch):
    class FakeSileroVAD:
        def __init__(self, _path: str):
            pass

        def reset(self) -> None:
            pass

        def __call__(self, chunk: np.ndarray, _sample_rate: int) -> float:
            return 0.9 if float(np.max(np.abs(chunk))) > 0 else 0.1

    monkeypatch.setattr(realtime_vad, "SileroVAD", FakeSileroVAD)
    vad = RealtimeSession("unused.onnx", VADConfig(min_speech_ms=64, min_silence_ms=64, preroll_ms=64))

    assert vad.push_chunk(np.zeros(1024, dtype=np.float32)) == "listening"
    assert vad.push_chunk(np.full(1024, 0.2, dtype=np.float32)) == "listening"
    assert vad.speaking is True
    assert vad.push_chunk(np.zeros(1024, dtype=np.float32)) == "speech_end"
    assert vad.get_audio().size >= 1024


def test_whispera_vad_accumulates_small_transport_packets(monkeypatch):
    class FakeSileroVAD:
        def __init__(self, _path: str):
            pass

        def reset(self) -> None:
            pass

        def __call__(self, chunk: np.ndarray, _sample_rate: int) -> float:
            return 0.9 if float(np.max(np.abs(chunk))) > 0 else 0.1

    monkeypatch.setattr(realtime_vad, "SileroVAD", FakeSileroVAD)
    vad = RealtimeSession("unused.onnx", VADConfig(min_speech_ms=64, min_silence_ms=64, preroll_ms=64))

    # Browser render quanta are much shorter than Silero's 1024-sample
    # window.  They must be combined, never independently zero-padded.
    for _ in range(4):
        assert vad.push_chunk(np.zeros(256, dtype=np.float32)) == "listening"
    for _ in range(4):
        assert vad.push_chunk(np.full(256, 0.2, dtype=np.float32)) == "listening"
    assert vad.speaking is True
    for index in range(4):
        transition = vad.push_chunk(np.zeros(256, dtype=np.float32))
        assert transition == ("speech_end" if index == 3 else "listening")
    assert vad.get_audio().size >= 1024


def test_llm_endpoint_requires_safe_http_origin():
    assert _normalise_llm_endpoint("http://127.0.0.1:11434/v1/") == "http://127.0.0.1:11434/v1"
    assert _normalise_llm_endpoint("") == ""
    for unsafe in ("file:///tmp/model", "https://user:pass@example.com/v1", "https://example.com/v1?key=x"):
        try:
            _normalise_llm_endpoint(unsafe)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Expected {unsafe!r} to be rejected")


def test_realtime_websocket_exposes_control_protocol_without_starting_models():
    with TestClient(create_app()) as client:
        with client.websocket_connect("/v1/realtime") as socket:
            ready = socket.receive_json()
            assert ready["type"] == "server.ready"
            assert ready["protocol"] == "opentts-realtime-v1"

            socket.send_json({
                "type": "session.configure",
                "llm_base_url": "http://127.0.0.1:11434/v1",
                "llm_model": "qwen3:4b",
                "tts_enabled": False,
            })
            configured = socket.receive_json()
            assert configured["type"] == "session.ready"
            assert configured["api_key_persisted"] is False

            socket.send_json({"type": "ping"})
            assert socket.receive_json()["type"] == "pong"


def test_realtime_synthesizes_the_complete_reply_in_one_whispera_request(monkeypatch):
    """Whole-reply mode must not reset the voice at every LLM full stop."""

    def fake_stream(_options, _messages):
        yield "第一句。第二句。"

    synthesized_texts: list[str] = []

    async def fake_tts_stream(*_args, **kwargs):
        synthesized_texts.append(kwargs["text"])
        # A single response can still be emitted as multiple PCM packets; the
        # server must not add wall-clock pacing between them.
        yield WhisperaPcmChunk(sample_rate=24_000, samples=np.zeros(12_000, dtype=np.float32))

    monkeypatch.setattr(realtime, "_stream_openai_compatible", fake_stream)
    monkeypatch.setattr(realtime, "stream_whispera_tts", fake_tts_stream)
    monkeypatch.setattr(realtime, "get_model_instance", lambda *_args, **_kwargs: SimpleNamespace(enabled=True))
    monkeypatch.setattr(realtime, "check_model_instance", lambda _instance: SimpleNamespace(status="ready", repair_hint=None))
    monkeypatch.setattr(realtime, "_resolve_realtime_voice", lambda *_args, **_kwargs: (None, None))
    monkeypatch.setattr(realtime, "release_conflicting_runtimes", lambda *_args, **_kwargs: [])

    with TestClient(create_app()) as client:
        with client.websocket_connect("/v1/realtime") as socket:
            socket.receive_json()
            socket.send_json({
                "type": "session.configure",
                "llm_base_url": "http://127.0.0.1:11434/v1",
                "llm_model": "qwen3:4b",
                "tts_enabled": True,
                "tts_backend": "streaming",
            })
            assert socket.receive_json()["type"] == "session.ready"
            socket.send_json({"type": "text.input", "text": "test"})

            audio_times: list[float] = []
            while len(audio_times) < 2:
                message = socket.receive()
                if message.get("bytes") is not None:
                    audio_times.append(time.perf_counter())

    assert audio_times[1] - audio_times[0] < 0.2
    assert synthesized_texts == ["第一句。第二句。"]


def test_realtime_interrupt_drops_late_llm_delta_before_next_turn(monkeypatch):
    def fake_stream(_options, messages):
        text = messages[-1]["content"]
        if text == "first":
            yield "first delta"
            # The worker thread cannot be preempted while waiting for the
            # next model delta.  The websocket handler must still discard it
            # once a newer user turn has interrupted this one.
            time.sleep(0.03)
            yield "stale delta"
            return
        yield "fresh delta"

    monkeypatch.setattr(realtime, "_stream_openai_compatible", fake_stream)
    with TestClient(create_app()) as client:
        with client.websocket_connect("/v1/realtime") as socket:
            socket.receive_json()
            socket.send_json({
                "type": "session.configure",
                "llm_base_url": "http://127.0.0.1:11434/v1",
                "llm_model": "qwen3:4b",
                "tts_enabled": False,
            })
            assert socket.receive_json()["type"] == "session.ready"

            socket.send_json({"type": "text.input", "text": "first"})
            assert socket.receive_json()["type"] == "assistant.started"
            assert socket.receive_json()["text"] == "first delta"

            socket.send_json({"type": "text.input", "text": "second"})
            observed_deltas: list[str] = []
            for _ in range(6):
                event = socket.receive_json()
                if event["type"] == "assistant.delta":
                    observed_deltas.append(event["text"])
                if observed_deltas == ["fresh delta"]:
                    break

            assert "stale delta" not in observed_deltas
            assert observed_deltas == ["fresh delta"]
