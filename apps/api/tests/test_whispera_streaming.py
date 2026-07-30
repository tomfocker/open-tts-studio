import asyncio
import base64
import json

import numpy as np

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
