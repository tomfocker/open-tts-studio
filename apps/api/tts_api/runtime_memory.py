from __future__ import annotations

from tts_api.adapters.gptsovits import get_gptsovits_service_manager, get_gptsovits_status, release_gptsovits_service
from tts_api.adapters.indextts2_worker import get_indextts2_worker_client, get_indextts2_worker_status, release_indextts2_worker
from tts_api.adapters.voxcpm2 import get_voxcpm2_service_manager, get_voxcpm2_status, release_voxcpm2_service
from tts_api.config import Settings
from tts_api.model_instances import apply_model_instance_to_settings, list_model_instances


RUNTIME_MODEL_IDS = ("indextts2", "voxcpm2", "gptsovits")


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
    if not detect_external:
        return {
            "indextts2": get_indextts2_worker_status(resolved),
            "voxcpm2": get_voxcpm2_status(resolved),
            "gptsovits": get_gptsovits_status(resolved),
        }
    return {
        "indextts2": get_indextts2_worker_client(resolved).status(),
        "voxcpm2": get_voxcpm2_service_manager(resolved).status(probe_timeout_seconds=0.25),
        "gptsovits": get_gptsovits_service_manager(resolved).status(probe_timeout_seconds=0.25),
    }


def release_conflicting_runtimes(target_model_id: str, settings: Settings) -> list[str]:
    """Release OpenTTS-managed GPU models before loading another one.

    A model selected only in the desktop UI is not touched. This function is called
    immediately before synthesis while the global generation lock is held.
    """
    if target_model_id not in RUNTIME_MODEL_IDS:
        return []

    resolved = resolve_runtime_settings(settings)
    workers = runtime_workers(resolved, detect_external=True)
    conflicts = [
        (model_id, worker)
        for model_id, worker in workers.items()
        if model_id != target_model_id and worker.get("loaded", False)
    ]
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
        elif model_id == "gptsovits":
            did_release = release_gptsovits_service(resolved)
        else:
            did_release = False
        if did_release:
            released.append(model_id)
    return released
