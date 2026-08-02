import asyncio
import base64
import json

import numpy as np
import pytest

from tts_api.adapters import whispera_streaming
from tts_api.config import Settings


def test_whispera_streaming_worker_uses_vendored_source_and_websocket_support():
    settings = Settings()
    manager = whispera_streaming.WhisperaStreamingServiceManager(settings=settings)

    environment = manager.build_environment()

    python_paths = environment["PYTHONPATH"].split(";")
    assert str(manager.source_path) in python_paths
    assert str(manager.websocket_support_path) in python_paths
    assert (manager.source_path / "voxcpm" / "streaming_service.py").is_file()
    assert (manager.websocket_support_path / "websockets" / "__init__.py").is_file()
    assert environment["TORCHINDUCTOR_USE_STATIC_CUDA_LAUNCHER"] == "0"


def test_whispera_streaming_status_surfaces_a_healthy_external_worker(monkeypatch):
    manager = whispera_streaming.WhisperaStreamingServiceManager(settings=Settings())
    monkeypatch.setattr(manager, "is_healthy", lambda timeout_seconds=1.0: True)

    status = manager.status()

    assert status["loaded"] is True
    assert status["external"] is True
    assert status["managed"] is False


def test_whispera_streaming_prewarm_uses_the_upstream_warmup_endpoint(monkeypatch):
    requests: list[tuple[str, float]] = []

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"model_loaded": True}

    class FakeHttpClient:
        @staticmethod
        def post(url, timeout):
            requests.append((url, timeout))
            return FakeResponse()

    manager = whispera_streaming.WhisperaStreamingServiceManager(settings=Settings(), http_client=FakeHttpClient)
    monkeypatch.setattr(manager, "ensure_started", lambda: None)

    result = manager.prewarm_model()

    assert requests == [(f"{manager.api_base}/warmup", manager.prewarm_timeout_seconds)]
    assert result == {"model_loaded": True}


async def test_stream_whispera_tts_converts_upstream_protocol_to_pcm_chunks(monkeypatch):
    class FakeManager:
        websocket_url = "ws://upstream.test/ws/tts"

        def __init__(self):
            self.started = 0
            self.finished = 0

        def ensure_started(self):
            self.started += 1

        def begin_request(self):
            pass

        def finish_request(self):
            self.finished += 1

    class FakeWebSocket:
        def __init__(self):
            samples = np.array([0.25, -0.25], dtype=np.float32)
            self.messages = iter([
                {"type": "server.ready"},
                {"type": "session.ready"},
                {"type": "request.state", "state": "started"},
                {"type": "tts.started", "sample_rate": 48_000},
                {"type": "tts.chunk", "data": base64.b64encode(samples.tobytes()).decode("ascii")},
                {"type": "tts.completed"},
            ])
            self.sent: list[dict] = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def recv(self):
            return json.dumps(next(self.messages))

        async def send(self, payload):
            self.sent.append(json.loads(payload))

    manager = FakeManager()
    websocket = FakeWebSocket()
    monkeypatch.setattr(whispera_streaming, "get_whispera_streaming_service_manager", lambda _settings: manager)
    monkeypatch.setattr(whispera_streaming.websockets, "connect", lambda *_args, **_kwargs: websocket)

    chunks = [
        chunk
        async for chunk in whispera_streaming.stream_whispera_tts(
            Settings(),
            text="stream test",
            reference_audio=None,
            reference_text=None,
            cancel_event=asyncio.Event(),
        )
    ]

    assert manager.started == 1
    assert manager.finished == 1
    assert len(chunks) == 1
    assert chunks[0].sample_rate == 48_000
    np.testing.assert_allclose(chunks[0].samples, np.array([0.25, -0.25], dtype=np.float32))
    assert websocket.sent[0]["type"] == "session.start"
    assert websocket.sent[1]["type"] == "tts.start"


async def test_stream_whispera_tts_force_stops_managed_worker_after_interrupt(monkeypatch):
    class FakeManager:
        websocket_url = "ws://upstream.test/ws/tts"

        def __init__(self):
            self.shutdown_calls: list[bool] = []

        def ensure_started(self):
            pass

        def begin_request(self):
            pass

        def finish_request(self):
            pass

        def shutdown(self, force=False):
            self.shutdown_calls.append(force)
            return True

    class FakeWebSocket:
        def __init__(self):
            self.messages = iter([
                {"type": "server.ready"},
                {"type": "session.ready"},
            ])
            self.sent: list[dict] = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def recv(self):
            return json.dumps(next(self.messages))

        async def send(self, payload):
            self.sent.append(json.loads(payload))

    manager = FakeManager()
    websocket = FakeWebSocket()
    cancel_event = asyncio.Event()
    cancel_event.set()
    monkeypatch.setattr(whispera_streaming, "get_whispera_streaming_service_manager", lambda _settings: manager)
    monkeypatch.setattr(whispera_streaming.websockets, "connect", lambda *_args, **_kwargs: websocket)

    chunks = [
        chunk
        async for chunk in whispera_streaming.stream_whispera_tts(
            Settings(),
            text="interrupt test",
            reference_audio=None,
            reference_text=None,
            cancel_event=cancel_event,
        )
    ]

    assert chunks == []
    assert manager.shutdown_calls == [True]
    assert [payload["type"] for payload in websocket.sent] == ["session.start", "tts.start", "tts.interrupt"]


async def test_stream_whispera_tts_releases_a_stalled_worker_before_first_audio(monkeypatch):
    class FakeManager:
        websocket_url = "ws://upstream.test/ws/tts"

        def __init__(self):
            self.shutdown_calls: list[bool] = []
            self.finished = 0

        def ensure_started(self):
            pass

        def begin_request(self):
            pass

        def finish_request(self):
            self.finished += 1

        def shutdown(self, force=False):
            self.shutdown_calls.append(force)
            return True

    class FakeWebSocket:
        def __init__(self):
            self.messages = iter([
                {"type": "server.ready"},
                {"type": "session.ready"},
                {"type": "tts.started", "sample_rate": 48_000},
            ])

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def recv(self):
            try:
                return json.dumps(next(self.messages))
            except StopIteration:
                await asyncio.sleep(60)
                raise AssertionError("unreachable")

        async def send(self, _payload):
            pass

    manager = FakeManager()
    monkeypatch.setattr(whispera_streaming, "FIRST_AUDIO_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(whispera_streaming, "get_whispera_streaming_service_manager", lambda _settings: manager)
    monkeypatch.setattr(whispera_streaming.websockets, "connect", lambda *_args, **_kwargs: FakeWebSocket())

    with pytest.raises(whispera_streaming.WhisperaStreamingUnavailable, match="等待首段音频"):
        async for _chunk in whispera_streaming.stream_whispera_tts(
            Settings(),
            text="stalled stream",
            reference_audio=None,
            reference_text=None,
            cancel_event=asyncio.Event(),
        ):
            pass

    assert manager.shutdown_calls == [True]
    assert manager.finished == 1
