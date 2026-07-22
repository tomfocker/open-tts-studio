import pytest

from tts_api import runtime_memory
from tts_api.config import Settings


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

    with pytest.raises(RuntimeError, match="外部启动"):
        runtime_memory.release_conflicting_runtimes("indextts2", Settings())
