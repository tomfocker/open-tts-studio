from __future__ import annotations

import threading

from tts_api.adapters.gptsovits import get_gptsovits_service_manager, get_gptsovits_status, release_gptsovits_service
from tts_api.adapters.indextts2_worker import get_indextts2_worker_client, get_indextts2_worker_status, release_indextts2_worker
from tts_api.adapters.sensevoice import get_sensevoice_service_manager, get_sensevoice_status, release_sensevoice_service
from tts_api.adapters.voxcpm2 import get_voxcpm2_service_manager, get_voxcpm2_status, release_voxcpm2_service
from tts_api.adapters.whispera_streaming import get_whispera_streaming_status, release_whispera_streaming_service
from tts_api.config import Settings
from tts_api.model_instances import apply_model_instance_to_settings, list_model_instances


RUNTIME_MODEL_IDS = ("indextts2", "voxcpm2", "voxcpm2_streaming", "gptsovits", "sensevoice", "qwen3-asr", "audio_enhancement", "audio_separation")

# Every local model service ultimately competes for the same GPU.  The regular
# speech API and the realtime websocket intentionally share this lock so a
# microphone turn can never race a batch/single generation for VRAM.
local_gpu_generation_lock = threading.Lock()
_realtime_runtime_reservation_lock = threading.Lock()
_realtime_runtime_reserved = False
_realtime_asr_lock = threading.Lock()
_realtime_asr_settings: Settings | None = None


def is_realtime_runtime_reserved() -> bool:
    with _realtime_runtime_reservation_lock:
        return _realtime_runtime_reserved


def reserve_realtime_runtime(settings: Settings) -> list[str]:
    """Give realtime streaming first claim on VoxCPM2 GPU residency."""
    global _realtime_runtime_reserved
    with _realtime_runtime_reservation_lock:
        _realtime_runtime_reserved = True
    try:
        return release_conflicting_runtimes("voxcpm2_streaming", settings)
    except Exception:
        with _realtime_runtime_reservation_lock:
            _realtime_runtime_reserved = False
        raise


def release_realtime_runtime_reservation() -> None:
    global _realtime_runtime_reserved
    with _realtime_runtime_reservation_lock:
        _realtime_runtime_reserved = False


def get_realtime_asr_settings(default_settings: Settings) -> Settings:
    """Return the SenseVoice settings pinned for the current realtime session.

    The realtime ASR may have fallen back to CPU after the GPU pair could not
    fit in VRAM.  Keeping that choice here prevents a later microphone turn
    from silently recreating the GPU process and evicting Whispera again.
    """
    with _realtime_asr_lock:
        return _realtime_asr_settings or default_settings


def _remember_realtime_asr_settings(settings: Settings) -> None:
    global _realtime_asr_settings
    with _realtime_asr_lock:
        _realtime_asr_settings = settings


def prewarm_realtime_asr(settings: Settings) -> dict:
    """Start a managed SenseVoice worker alongside the reserved Whispera one.

    This function is called while ``local_gpu_generation_lock`` is held.  It
    first tries the configured device, then deliberately falls back to CPU if
    the two GPU models cannot coexist.  The ASR service is pinned until the
    realtime workspace releases it, so its idle timer cannot cause a later
    cold start halfway through a conversation.
    """
    def start(candidate: Settings, *, cpu_fallback: bool) -> dict:
        realtime_settings = candidate.model_copy(update={"sensevoice_idle_timeout_seconds": 0})
        release_conflicting_runtimes(
            "sensevoice",
            realtime_settings,
            preserve_realtime_pair=True,
        )
        manager = get_sensevoice_service_manager(realtime_settings)
        before = manager.status(probe_timeout_seconds=0.25)
        if before.get("loaded") and not before.get("managed"):
            raise RuntimeError("检测到外部启动的 SenseVoice 服务；实时语音需要由 OpenTTS 托管 ASR。")
        manager.ensure_started()
        manager.keep_warm()
        worker = manager.status(probe_timeout_seconds=0.25)
        if not worker.get("managed") or not worker.get("loaded"):
            raise RuntimeError("SenseVoice 未能由 OpenTTS 托管并完成预热。")
        _remember_realtime_asr_settings(realtime_settings)
        return {
            "ready": True,
            "worker": worker,
            "device": realtime_settings.sensevoice_device,
            "cpu_fallback": cpu_fallback,
        }

    try:
        return start(settings, cpu_fallback=False)
    except Exception:
        if settings.sensevoice_device == "cpu":
            raise
        # The failed GPU process may still be winding down after an OOM.  Stop
        # only our managed instance before reusing the same local ASR port for
        # the CPU fallback.
        release_sensevoice_service(settings, force=True)
        return start(settings.model_copy(update={"sensevoice_device": "cpu"}), cpu_fallback=True)


def release_realtime_asr() -> bool:
    """Release the ASR worker pinned exclusively for realtime conversation."""
    global _realtime_asr_settings
    with _realtime_asr_lock:
        settings = _realtime_asr_settings
        _realtime_asr_settings = None
    # This worker exists only for the realtime workspace.  Leaving that
    # workspace intentionally cancels an in-flight recognition rather than
    # leaving a CPU fallback resident forever after its request completes.
    return release_sensevoice_service(settings, force=True) if settings is not None else False


def resolve_runtime_settings(settings: Settings) -> Settings:
    """Apply every enabled model profile so runtime status uses the selected package paths."""
    resolved = settings
    for instance in list_model_instances(settings):
        if instance.enabled:
            resolved = apply_model_instance_to_settings(resolved, instance)
    return resolved


def runtime_workers(settings: Settings, detect_external: bool = False) -> dict[str, dict]:
    """Return runtime state, probing external API services only for a generation preflight."""
    resolved = resolve_runtime_settings(settings)
    sensevoice_settings = get_realtime_asr_settings(resolved) if is_realtime_runtime_reserved() else resolved
    if not detect_external:
        return {
            "indextts2": get_indextts2_worker_status(resolved),
            # Monitoring must never wait for a model HTTP endpoint. A model
            # can be busy or stuck while the desktop still needs CPU/VRAM data.
            "voxcpm2": get_voxcpm2_status(resolved),
            "gptsovits": get_gptsovits_status(resolved),
            "sensevoice": get_sensevoice_status(sensevoice_settings),
        }
    return {
        "indextts2": get_indextts2_worker_client(resolved).status(),
        "voxcpm2": get_voxcpm2_service_manager(resolved).status(probe_timeout_seconds=0.25),
        "gptsovits": get_gptsovits_service_manager(resolved).status(probe_timeout_seconds=0.25),
        "sensevoice": get_sensevoice_service_manager(sensevoice_settings).status(probe_timeout_seconds=0.25),
    }


def release_conflicting_runtimes(
    target_model_id: str,
    settings: Settings,
    *,
    preserve_realtime_pair: bool = False,
) -> list[str]:
    """Release OpenTTS-managed GPU models before loading another one.

    A model selected only in the desktop UI is not touched. This function is called
    immediately before synthesis while the global generation lock is held.
    """
    if target_model_id not in RUNTIME_MODEL_IDS:
        return []

    resolved = resolve_runtime_settings(settings)
    workers = runtime_workers(resolved, detect_external=True)
    streaming_worker = get_whispera_streaming_status(resolved)
    # A managed process can already be loading weights while its health probe is
    # still false.  It is nevertheless a real GPU occupant, particularly for
    # VoxCPM2 whose upstream HTTP service starts responding before warm-up has
    # completed.  Treat that in-flight process as a conflict as well; otherwise
    # a realtime worker can start loading the same weights alongside it.
    preserve_pair = (
        preserve_realtime_pair
        and is_realtime_runtime_reserved()
        and target_model_id in {"sensevoice", "voxcpm2_streaming"}
    )

    def is_managed_realtime_peer(model_id: str, worker: dict) -> bool:
        return (
            preserve_pair
            and worker.get("managed", False)
            and {target_model_id, model_id} == {"sensevoice", "voxcpm2_streaming"}
        )

    conflicts = [
        (model_id, worker)
        for model_id, worker in workers.items()
        if model_id != target_model_id
        and not is_managed_realtime_peer(model_id, worker)
        and (worker.get("loaded", False) or worker.get("managed", False))
    ]
    if target_model_id != "voxcpm2_streaming" and (
        streaming_worker.get("loaded", False) or streaming_worker.get("managed", False)
    ) and not is_managed_realtime_peer("voxcpm2_streaming", streaming_worker):
        conflicts.append(("voxcpm2_streaming", streaming_worker))
    for model_id, worker in conflicts:
        if worker.get("active_requests", 0) > 0:
            raise RuntimeError(f"{model_id} 正在生成，暂不能切换模型。")
        if not worker.get("managed", False):
            raise RuntimeError(
                f"检测到外部启动的 {model_id} 服务占用显存；请先在外部关闭它，再生成 {target_model_id}。"
            )

    released: list[str] = []
    for model_id, _worker in conflicts:
        if model_id == "indextts2":
            did_release = release_indextts2_worker(resolved)
        elif model_id == "voxcpm2":
            did_release = release_voxcpm2_service(resolved)
        elif model_id == "voxcpm2_streaming":
            did_release = release_whispera_streaming_service(resolved)
        elif model_id == "gptsovits":
            did_release = release_gptsovits_service(resolved)
        elif model_id == "sensevoice":
            did_release = release_sensevoice_service(get_realtime_asr_settings(resolved))
        else:
            did_release = False
        if did_release:
            released.append(model_id)
    return released


def release_idle_runtimes_for_alignment(settings: Settings) -> list[str]:
    """Release managed TTS workers before local post-processing uses the GPU.

    Alignment runs only after final audio is safely written.  Retaining a TTS
    model at that point trades a small warm-start benefit for a likely OOM when
    Qwen ForcedAligner is loaded. External/active runtimes are
    treated exactly like generation preflight: do not kill or silently compete
    with a process OpenTTS does not own.
    """

    resolved = resolve_runtime_settings(settings)
    workers = runtime_workers(resolved, detect_external=True)
    streaming_worker = get_whispera_streaming_status(resolved)
    loaded = [(model_id, worker) for model_id, worker in workers.items() if worker.get("loaded", False)]
    if streaming_worker.get("loaded", False):
        loaded.append(("voxcpm2_streaming", streaming_worker))
    for model_id, worker in loaded:
        if worker.get("active_requests", 0) > 0:
            raise RuntimeError(f"{model_id} 正在生成，暂不能开始本地强制对齐。")
        if not worker.get("managed", False):
            raise RuntimeError(f"检测到外部启动的 {model_id} 服务占用显存；请先关闭后再执行本地强制对齐。")

    released: list[str] = []
    for model_id, _worker in loaded:
        if model_id == "indextts2":
            did_release = release_indextts2_worker(resolved)
        elif model_id == "voxcpm2":
            did_release = release_voxcpm2_service(resolved)
        elif model_id == "voxcpm2_streaming":
            did_release = release_whispera_streaming_service(resolved)
        elif model_id == "gptsovits":
            did_release = release_gptsovits_service(resolved)
        elif model_id == "sensevoice":
            did_release = release_sensevoice_service(resolved)
        else:
            did_release = False
        if did_release:
            released.append(model_id)
    return released


def force_release_runtime(model_id: str, settings: Settings) -> bool:
    """Terminate a managed model only when the user explicitly aborts a stuck task."""
    resolved = resolve_runtime_settings(settings)
    if model_id == "indextts2":
        return release_indextts2_worker(resolved, force=True)
    if model_id == "voxcpm2":
        return release_voxcpm2_service(resolved, force=True)
    if model_id == "voxcpm2_streaming":
        return release_whispera_streaming_service(resolved, force=True)
    if model_id == "gptsovits":
        return release_gptsovits_service(resolved, force=True)
    if model_id == "sensevoice":
        return release_sensevoice_service(resolved, force=True)
    return False
