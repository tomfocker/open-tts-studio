from pathlib import Path

from tts_api.model_instances import (
    ModelHealthCheck,
    ModelHealthResult,
    ModelInstanceProfile,
    ModelInstanceStatus,
)


def _path_check(identifier: str, label: str, path: Path | None, must_be_dir: bool = False) -> ModelHealthCheck:
    if path is None:
        return ModelHealthCheck(id=identifier, label=label, passed=False, detail="未配置路径")
    exists = path.is_dir() if must_be_dir else path.exists()
    return ModelHealthCheck(id=identifier, label=label, passed=exists, detail=str(path))


def _status_from_checks(profile: ModelInstanceProfile, checks: list[ModelHealthCheck]) -> ModelInstanceStatus:
    if not profile.enabled:
        return ModelInstanceStatus.disabled
    root_check = next((check for check in checks if check.id == "root"), None)
    if root_check is not None and not root_check.passed:
        return ModelInstanceStatus.missing
    return ModelInstanceStatus.ready if all(check.passed for check in checks) else ModelInstanceStatus.broken


def _repair_hint(profile: ModelInstanceProfile, status: ModelInstanceStatus, checks: list[ModelHealthCheck]) -> str | None:
    if status == ModelInstanceStatus.ready:
        return None
    if status == ModelInstanceStatus.disabled:
        return "模型已禁用。"
    failed = next((check for check in checks if not check.passed), None)
    if failed is None:
        return "模型配置需要重新检查。"
    if profile.model_id == "gptsovits" and failed.id == "python":
        return "当前目录不像 GPT-SoVITS 懒人包，请重新选择包含 runtime 的目录。"
    if profile.model_id == "gptsovits" and failed.id == "entrypoint":
        return "未找到 api_v2.py，请选择完整的 GPT-SoVITS 目录。"
    if profile.model_id == "gptsovits" and failed.id == "config":
        return "未找到 GPT_SoVITS/configs/tts_infer.yaml，请选择完整的 GPT-SoVITS 目录。"
    if profile.model_id == "voxcpm2" and failed.id == "python":
        return "当前目录不像 VoxCPM2 懒人包，请重新选择包含 MWAI/python.exe 的目录。"
    if profile.model_id == "indextts2" and failed.id == "checkpoints":
        return "未找到 checkpoints，请选择完整的 IndexTTS2 目录。"
    return f"{failed.label}检查未通过，请重新选择模型目录。"


def _check_indextts2(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    source = root / "Index-TTS" if root else None
    python_path = root / "WPy64-310110" / "python-3.10.11.amd64" / "python.exe" if root else None
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", python_path),
        _path_check("source", "源码目录", source, must_be_dir=True),
        _path_check("checkpoints", "权重目录", source / "checkpoints" if source else None, must_be_dir=True),
    ]


def _check_voxcpm2(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", root / "MWAI" / "python.exe" if root else None),
        _path_check("entrypoint", "API 启动脚本", root / "api.py" if root else None),
        _path_check("models", "模型文件目录", root / "models" if root else None, must_be_dir=True),
    ]


def _check_gptsovits(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", root / "runtime" / "python.exe" if root else None),
        _path_check("entrypoint", "API 启动脚本", root / "api_v2.py" if root else None),
        _path_check("config", "推理配置", root / "GPT_SoVITS" / "configs" / "tts_infer.yaml" if root else None),
    ]


def check_model_instance(profile: ModelInstanceProfile) -> ModelHealthResult:
    if not profile.enabled:
        return ModelHealthResult(
            model_id=profile.model_id,
            status=ModelInstanceStatus.disabled,
            checks=[],
            repair_hint="模型已禁用。",
        )
    if profile.model_id == "indextts2":
        checks = _check_indextts2(profile)
    elif profile.model_id == "voxcpm2":
        checks = _check_voxcpm2(profile)
    elif profile.model_id == "gptsovits":
        checks = _check_gptsovits(profile)
    else:
        checks = []
        return ModelHealthResult(
            model_id=profile.model_id,
            status=ModelInstanceStatus.disabled,
            checks=checks,
            repair_hint="模型尚未接入。",
        )
    status = _status_from_checks(profile, checks)
    return ModelHealthResult(
        model_id=profile.model_id,
        status=status,
        checks=checks,
        repair_hint=_repair_hint(profile, status, checks),
    )
