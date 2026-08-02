import pytest

from tts_api import runtime_memory
from tts_api.config import Settings


@pytest.fixture(autouse=True)
def reset_realtime_runtime_reservation():
    runtime_memory.release_realtime_asr()
    runtime_memory.release_realtime_runtime_reservation()
    yield
    runtime_memory.release_realtime_asr()
    runtime_memory.release_realtime_runtime_reservation()


def test_release_conflicting_runtimes_releases_only_other_managed_models(monkeypatch):
    released: list[str] = []
    monkeypatch.setattr(runtime_memory, "resolve_runtime_settings", lambda settings: settings)
    monkeypatch.setattr(
        runtime_memory,
        "runtime_workers",
        lambda settings, detect_external: {
            "indextts2": {"loaded": True, "managed": True, "active_requests": 0},
            "voxcpm2": {"loaded": False, "managed": False, "active_requests": 0},
            "gptsovits": {"loaded": True, "managed": True, "active_requests": 0},
        },
    )
    monkeypatch.setattr(runtime_memory, "get_whispera_streaming_status", lambda _settings: {"loaded": False, "managed": False})
    monkeypatch.setattr(runtime_memory, "release_indextts2_worker", lambda settings: released.append("indextts2") or True)
    monkeypatch.setattr(runtime_memory, "release_gptsovits_service", lambda settings: released.append("gptsovits") or True)

    result = runtime_memory.release_conflicting_runtimes("voxcpm2", Settings())

    assert result == ["indextts2", "gptsovits"]
    assert released == ["indextts2", "gptsovits"]


def test_release_conflicting_runtimes_rejects_external_gpu_service(monkeypatch):
    monkeypatch.setattr(runtime_memory, "resolve_runtime_settings", lambda settings: settings)
    monkeypatch.setattr(
        runtime_memory,
        "runtime_workers",
        lambda settings, detect_external: {
            "indextts2": {"loaded": False, "managed": False, "active_requests": 0},
            "voxcpm2": {"loaded": True, "managed": False, "active_requests": 0},
            "gptsovits": {"loaded": False, "managed": False, "active_requests": 0},
        },
    )
    monkeypatch.setattr(runtime_memory, "get_whispera_streaming_status", lambda _settings: {"loaded": False, "managed": False})

    with pytest.raises(RuntimeError, match="外部启动"):
        runtime_memory.release_conflicting_runtimes("indextts2", Settings())


def test_release_conflicting_runtimes_rejects_an_external_whispera_worker(monkeypatch):
    monkeypatch.setattr(runtime_memory, "resolve_runtime_settings", lambda settings: settings)
    monkeypatch.setattr(
        runtime_memory,
        "runtime_workers",
        lambda settings, detect_external: {
            "indextts2": {"loaded": False, "managed": False, "active_requests": 0},
            "voxcpm2": {"loaded": False, "managed": False, "active_requests": 0},
            "gptsovits": {"loaded": False, "managed": False, "active_requests": 0},
        },
    )
    monkeypatch.setattr(runtime_memory, "get_whispera_streaming_status", lambda _settings: {"loaded": True, "managed": False, "active_requests": 0})

    with pytest.raises(RuntimeError, match="voxcpm2_streaming"):
        runtime_memory.release_conflicting_runtimes("indextts2", Settings())


def test_realtime_reservation_releases_a_managed_voxcpm2_worker_while_it_is_warming(monkeypatch):
    released: list[str] = []
    monkeypatch.setattr(runtime_memory, "resolve_runtime_settings", lambda settings: settings)
    monkeypatch.setattr(
        runtime_memory,
        "runtime_workers",
        lambda settings, detect_external: {
            "indextts2": {"loaded": False, "managed": False, "active_requests": 0},
            "voxcpm2": {"loaded": False, "managed": True, "state": "starting", "active_requests": 0},
            "gptsovits": {"loaded": False, "managed": False, "active_requests": 0},
            "sensevoice": {"loaded": False, "managed": False, "active_requests": 0},
        },
    )
    monkeypatch.setattr(runtime_memory, "get_whispera_streaming_status", lambda _settings: {"loaded": False, "managed": False})
    monkeypatch.setattr(runtime_memory, "release_voxcpm2_service", lambda _settings: released.append("voxcpm2") or True)

    result = runtime_memory.reserve_realtime_runtime(Settings())

    assert result == ["voxcpm2"]
    assert released == ["voxcpm2"]
    assert runtime_memory.is_realtime_runtime_reserved() is True


@pytest.mark.parametrize(
    ("target_model_id", "workers", "streaming_worker"),
    [
        (
            "sensevoice",
            {
                "indextts2": {"loaded": False, "managed": False, "active_requests": 0},
                "voxcpm2": {"loaded": False, "managed": False, "active_requests": 0},
                "gptsovits": {"loaded": False, "managed": False, "active_requests": 0},
                "sensevoice": {"loaded": True, "managed": True, "active_requests": 0},
            },
            {"loaded": True, "managed": True, "active_requests": 0},
        ),
        (
            "voxcpm2_streaming",
            {
                "indextts2": {"loaded": False, "managed": False, "active_requests": 0},
                "voxcpm2": {"loaded": False, "managed": False, "active_requests": 0},
                "gptsovits": {"loaded": False, "managed": False, "active_requests": 0},
                "sensevoice": {"loaded": True, "managed": True, "active_requests": 0},
            },
            {"loaded": True, "managed": True, "active_requests": 0},
        ),
    ],
)
def test_realtime_pair_keeps_its_managed_peer_resident(monkeypatch, target_model_id, workers, streaming_worker):
    monkeypatch.setattr(runtime_memory, "resolve_runtime_settings", lambda settings: settings)
    monkeypatch.setattr(runtime_memory, "runtime_workers", lambda _settings, detect_external: workers)
    monkeypatch.setattr(runtime_memory, "get_whispera_streaming_status", lambda _settings: streaming_worker)
    monkeypatch.setattr(runtime_memory, "is_realtime_runtime_reserved", lambda: True)

    released = runtime_memory.release_conflicting_runtimes(
        target_model_id,
        Settings(),
        preserve_realtime_pair=True,
    )

    assert released == []


def test_realtime_asr_falls_back_to_cpu_and_remembers_that_choice(monkeypatch):
    calls: list[object] = []

    class FakeManager:
        def __init__(self, device: str):
            self.device = device
            self.started = False

        def status(self, probe_timeout_seconds=None):
            return {"loaded": self.started, "managed": self.started, "device": self.device}

        def ensure_started(self):
            calls.append(f"start:{self.device}")
            if self.device != "cpu":
                raise RuntimeError("CUDA out of memory")
            self.started = True

        def keep_warm(self):
            calls.append(f"pin:{self.device}")

    managers: dict[str, FakeManager] = {}
    monkeypatch.setattr(runtime_memory, "is_realtime_runtime_reserved", lambda: True)
    monkeypatch.setattr(runtime_memory, "release_conflicting_runtimes", lambda model, _settings, **kwargs: calls.append((model, kwargs)) or [])
    monkeypatch.setattr(
        runtime_memory,
        "get_sensevoice_service_manager",
        lambda settings: managers.setdefault(settings.sensevoice_device, FakeManager(settings.sensevoice_device)),
    )
    monkeypatch.setattr(runtime_memory, "release_sensevoice_service", lambda settings, force=False: calls.append((settings.sensevoice_device, force)) or True)

    result = runtime_memory.prewarm_realtime_asr(Settings(sensevoice_device="auto"))

    assert result["device"] == "cpu"
    assert result["cpu_fallback"] is True
    assert runtime_memory.get_realtime_asr_settings(Settings()).sensevoice_device == "cpu"
    assert calls == [
        ("sensevoice", {"preserve_realtime_pair": True}),
        "start:auto",
        ("auto", True),
        ("sensevoice", {"preserve_realtime_pair": True}),
        "start:cpu",
        "pin:cpu",
    ]
