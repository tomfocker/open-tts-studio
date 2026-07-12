from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from enum import StrEnum
import json
import os
from pathlib import Path
import threading
from uuid import uuid4

from pydantic import BaseModel, Field

from tts_api.config import Settings, get_settings
from tts_api.model_health import check_model_instance
from tts_api.model_instances import ModelInstanceProfile, RuntimeType, get_model_instance, list_model_instances, update_model_instance


ARCHIVE_SUFFIXES = {".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"}
DIRECTORY_SCAN_LIMIT = 2048


class ModelPackageSourceKind(StrEnum):
    directory = "directory"
    archive = "archive"


class ModelPackageState(StrEnum):
    candidate = "candidate"
    stable = "stable"
    archived = "archived"


class ModelPackageAdapterStatus(StrEnum):
    ready = "ready"
    incomplete = "incomplete"
    reserved = "reserved"
    archive = "archive"


class ModelPackageCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str | None = None


class ModelPackageInspection(BaseModel):
    exists: bool
    path_type: str
    size_bytes: int | None = None
    file_count: int | None = None
    scan_complete: bool = True
    checks: list[ModelPackageCheck] = Field(default_factory=list)
    adapter_status: ModelPackageAdapterStatus
    ready_for_activation: bool = False
    summary: str
    inspected_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ModelPackageRecord(BaseModel):
    id: str
    model_id: str
    path: Path
    source_kind: ModelPackageSourceKind
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)
    state: ModelPackageState = ModelPackageState.candidate
    inspection: ModelPackageInspection
    registered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def serializable(self) -> dict:
        return self.model_dump(mode="json")


class ModelPackageCreate(BaseModel):
    model_id: str = Field(min_length=1, max_length=80)
    path: Path
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)


class ModelPackageUpdate(BaseModel):
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)
    state: ModelPackageState | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_path(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def _detect_source_kind(path: Path) -> ModelPackageSourceKind:
    if path.is_dir():
        return ModelPackageSourceKind.directory
    if path.is_file() and path.suffix.lower() in ARCHIVE_SUFFIXES:
        return ModelPackageSourceKind.archive
    if path.exists():
        raise ValueError("仅支持登记模型目录或 zip、7z、rar、tar 等压缩包。")
    raise ValueError("所选模型包路径不存在。")


def _scan_directory(path: Path, limit: int = DIRECTORY_SCAN_LIMIT) -> tuple[int, int, bool]:
    """Return a bounded lower-bound scan without opening or hashing model files."""

    pending: deque[Path] = deque([path])
    scanned_entries = 0
    file_count = 0
    total_bytes = 0
    complete = True

    while pending and complete:
        current = pending.popleft()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    scanned_entries += 1
                    if scanned_entries > limit:
                        complete = False
                        break
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False):
                            file_count += 1
                            total_bytes += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue

    return total_bytes, file_count, complete


def inspect_model_package(
    model_id: str,
    path: Path,
    source_kind: ModelPackageSourceKind,
    settings: Settings,
) -> ModelPackageInspection:
    normalized_path = _normalize_path(path)
    if not normalized_path.exists():
        return ModelPackageInspection(
            exists=False,
            path_type="missing",
            adapter_status=ModelPackageAdapterStatus.incomplete,
            summary="路径不存在，保留档案以便之后重新挂载。",
        )

    if source_kind == ModelPackageSourceKind.archive:
        if not normalized_path.is_file():
            return ModelPackageInspection(
                exists=True,
                path_type="unexpected",
                adapter_status=ModelPackageAdapterStatus.incomplete,
                summary="登记路径不再是压缩包文件。",
            )
        try:
            size_bytes = normalized_path.stat().st_size
        except OSError:
            size_bytes = None
        return ModelPackageInspection(
            exists=True,
            path_type="archive",
            size_bytes=size_bytes,
            file_count=None,
            scan_complete=True,
            checks=[ModelPackageCheck(id="archive", label="压缩包文件", passed=True, detail=str(normalized_path))],
            adapter_status=ModelPackageAdapterStatus.archive,
            summary="压缩包已登记；第一阶段不会自动解压，请在解压后登记实际模型目录。",
        )

    if not normalized_path.is_dir():
        return ModelPackageInspection(
            exists=True,
            path_type="unexpected",
            adapter_status=ModelPackageAdapterStatus.incomplete,
            summary="登记路径不再是模型目录。",
        )

    size_bytes, file_count, scan_complete = _scan_directory(normalized_path)
    profile = get_model_instance(model_id, settings=settings).model_copy(
        update={"root_path": normalized_path, "enabled": True}
    )
    health = check_model_instance(profile)
    checks = [
        ModelPackageCheck(id=check.id, label=check.label, passed=check.passed, detail=check.detail)
        for check in health.checks
    ]
    if profile.runtime_type == RuntimeType.reserved:
        adapter_status = ModelPackageAdapterStatus.reserved
        ready_for_activation = False
        summary = "模型包可以登记，但该适配器尚未接入，暂不能启用。"
    elif health.status.value == "ready":
        adapter_status = ModelPackageAdapterStatus.ready
        ready_for_activation = True
        summary = "目录结构与本软件适配器匹配；可以设为当前稳定包。"
    else:
        adapter_status = ModelPackageAdapterStatus.incomplete
        ready_for_activation = False
        summary = health.repair_hint or "目录结构检查未通过。"
    return ModelPackageInspection(
        exists=True,
        path_type="directory",
        size_bytes=size_bytes,
        file_count=file_count,
        scan_complete=scan_complete,
        checks=checks,
        adapter_status=adapter_status,
        ready_for_activation=ready_for_activation,
        summary=summary,
    )


class ModelPackageStore:
    def __init__(self, packages_file: Path):
        self.packages_file = packages_file
        self._lock = threading.RLock()

    def list(self) -> list[ModelPackageRecord]:
        with self._lock:
            packages = list(self._load().values())
            state_rank = {
                ModelPackageState.stable: 0,
                ModelPackageState.candidate: 1,
                ModelPackageState.archived: 2,
            }
            packages.sort(key=lambda package: package.updated_at, reverse=True)
            packages.sort(key=lambda package: state_rank[package.state])
            return packages

    def get(self, package_id: str) -> ModelPackageRecord | None:
        with self._lock:
            return self._load().get(package_id)

    def register(self, payload: ModelPackageCreate, settings: Settings) -> ModelPackageRecord:
        with self._lock:
            get_model_instance(payload.model_id, settings=settings)
            path = _normalize_path(payload.path)
            source_kind = _detect_source_kind(path)
            packages = self._load()
            existing = next(
                (
                    package
                    for package in packages.values()
                    if package.model_id == payload.model_id and _normalize_path(package.path) == path
                ),
                None,
            )
            inspection = inspect_model_package(payload.model_id, path, source_kind, settings)
            now = _utc_now()
            if existing is not None:
                updates = {"inspection": inspection, "updated_at": now}
                if "package_label" in payload.model_fields_set:
                    updates["package_label"] = payload.package_label.strip() if payload.package_label else None
                if "user_note" in payload.model_fields_set:
                    updates["user_note"] = payload.user_note.strip() if payload.user_note else None
                updated = existing.model_copy(update=updates)
            else:
                updated = ModelPackageRecord(
                    id=uuid4().hex,
                    model_id=payload.model_id,
                    path=path,
                    source_kind=source_kind,
                    package_label=payload.package_label.strip() if payload.package_label else None,
                    user_note=payload.user_note.strip() if payload.user_note else None,
                    inspection=inspection,
                    registered_at=now,
                    updated_at=now,
                )
            packages[updated.id] = updated
            self._save(packages)
            return updated

    def update(self, package_id: str, update: ModelPackageUpdate) -> ModelPackageRecord:
        with self._lock:
            packages = self._load()
            package = packages.get(package_id)
            if package is None:
                raise KeyError(package_id)
            values = update.model_dump(exclude_unset=True)
            if values.get("state") == ModelPackageState.stable:
                raise ValueError("请通过“启用此稳定包”切换当前稳定包。")
            if "package_label" in values:
                values["package_label"] = values["package_label"].strip() if values["package_label"] else None
            if "user_note" in values:
                values["user_note"] = values["user_note"].strip() if values["user_note"] else None
            updated = package.model_copy(update={**values, "updated_at": _utc_now()})
            packages[package_id] = updated
            self._save(packages)
            return updated

    def inspect(self, package_id: str, settings: Settings) -> ModelPackageRecord:
        with self._lock:
            packages = self._load()
            package = packages.get(package_id)
            if package is None:
                raise KeyError(package_id)
            inspection = inspect_model_package(package.model_id, package.path, package.source_kind, settings)
            updated = package.model_copy(update={"inspection": inspection, "updated_at": _utc_now()})
            packages[package_id] = updated
            self._save(packages)
            return updated

    def activate(self, package_id: str, settings: Settings) -> tuple[ModelPackageRecord, ModelInstanceProfile]:
        with self._lock:
            packages = self._load()
            package = packages.get(package_id)
            if package is None:
                raise KeyError(package_id)
            inspection = inspect_model_package(package.model_id, package.path, package.source_kind, settings)
            package = package.model_copy(update={"inspection": inspection, "updated_at": _utc_now()})
            if package.source_kind != ModelPackageSourceKind.directory:
                raise RuntimeError("压缩包需先解压并登记实际模型目录，不能直接启用。")
            if not inspection.ready_for_activation:
                raise RuntimeError(inspection.summary)
            _ensure_runtime_released(package.model_id, settings)

            updates: dict[str, object] = {"root_path": package.path, "enabled": True}
            if package.package_label:
                updates["package_label"] = package.package_label
            active_instance = update_model_instance(package.model_id, updates, settings=settings)
            now = _utc_now()
            for existing_id, existing in list(packages.items()):
                if existing.model_id == package.model_id and existing_id != package.id and existing.state == ModelPackageState.stable:
                    packages[existing_id] = existing.model_copy(update={"state": ModelPackageState.archived, "updated_at": now})
            activated = package.model_copy(update={"state": ModelPackageState.stable, "updated_at": now})
            packages[activated.id] = activated
            self._save(packages)
            return activated, active_instance

    def ensure_active_profiles(self, settings: Settings) -> None:
        """Seed current model roots once so existing stable packs become manageable assets."""

        with self._lock:
            packages = self._load()
            changed = False
            now = _utc_now()
            for instance in list_model_instances(settings):
                if instance.root_path is None or instance.runtime_type == RuntimeType.reserved:
                    continue
                path = _normalize_path(instance.root_path)
                existing = next(
                    (
                        package
                        for package in packages.values()
                        if package.model_id == instance.model_id and _normalize_path(package.path) == path
                    ),
                    None,
                )
                inspection = inspect_model_package(instance.model_id, path, ModelPackageSourceKind.directory, settings)
                if existing is None:
                    existing = ModelPackageRecord(
                        id=uuid4().hex,
                        model_id=instance.model_id,
                        path=path,
                        source_kind=ModelPackageSourceKind.directory,
                        package_label=instance.package_label,
                        user_note=instance.user_note,
                        state=ModelPackageState.stable,
                        inspection=inspection,
                        registered_at=now,
                        updated_at=now,
                    )
                    packages[existing.id] = existing
                    changed = True
                else:
                    updates: dict[str, object] = {}
                    if existing.inspection != inspection:
                        updates["inspection"] = inspection
                    if existing.state != ModelPackageState.stable:
                        updates["state"] = ModelPackageState.stable
                    if not existing.package_label and instance.package_label:
                        updates["package_label"] = instance.package_label
                    if not existing.user_note and instance.user_note:
                        updates["user_note"] = instance.user_note
                    if updates:
                        updates["updated_at"] = now
                        packages[existing.id] = existing.model_copy(update=updates)
                        changed = True
                for other_id, other in list(packages.items()):
                    if other.model_id == instance.model_id and other_id != existing.id and other.state == ModelPackageState.stable:
                        packages[other_id] = other.model_copy(update={"state": ModelPackageState.archived, "updated_at": now})
                        changed = True
            if changed:
                self._save(packages)

    def replace(self, records: list[ModelPackageRecord], settings: Settings) -> None:
        """Replace the portable catalog during a settings migration and recheck local paths."""

        with self._lock:
            packages: dict[str, ModelPackageRecord] = {}
            now = _utc_now()
            for record in records:
                path = _normalize_path(record.path)
                inspection = inspect_model_package(record.model_id, path, record.source_kind, settings)
                packages[record.id] = record.model_copy(
                    update={"path": path, "inspection": inspection, "updated_at": now}
                )
            self._save(packages)

    def _load(self) -> dict[str, ModelPackageRecord]:
        if not self.packages_file.exists():
            return {}
        try:
            payload = json.loads(self.packages_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        raw_packages = payload.get("packages", []) if isinstance(payload, dict) else []
        packages: dict[str, ModelPackageRecord] = {}
        for raw in raw_packages:
            try:
                package = ModelPackageRecord.model_validate(raw)
            except Exception:
                continue
            packages[package.id] = package
        return packages

    def _save(self, packages: dict[str, ModelPackageRecord]) -> None:
        self.packages_file.parent.mkdir(parents=True, exist_ok=True)
        self.packages_file.write_text(
            json.dumps({"packages": [package.serializable() for package in packages.values()]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


_model_package_stores: dict[str, ModelPackageStore] = {}


def get_model_package_store(settings: Settings | None = None) -> ModelPackageStore:
    active_settings = settings or get_settings()
    key = str(active_settings.model_packages_file)
    if key not in _model_package_stores:
        _model_package_stores[key] = ModelPackageStore(active_settings.model_packages_file)
    return _model_package_stores[key]


def list_model_packages(settings: Settings | None = None) -> list[ModelPackageRecord]:
    active_settings = settings or get_settings()
    store = get_model_package_store(active_settings)
    store.ensure_active_profiles(active_settings)
    return store.list()


def replace_model_packages(records: list[ModelPackageRecord], settings: Settings) -> None:
    store = get_model_package_store(settings)
    store.replace(records, settings)
    store.ensure_active_profiles(settings)


def _ensure_runtime_released(model_id: str, settings: Settings) -> None:
    """Do not change a package path underneath a loaded local or external runtime."""

    if model_id == "indextts2":
        from tts_api.adapters.indextts2_worker import get_indextts2_worker_status

        status = get_indextts2_worker_status(settings)
    elif model_id == "voxcpm2":
        from tts_api.adapters.voxcpm2 import get_voxcpm2_status

        status = get_voxcpm2_status(settings)
    elif model_id == "gptsovits":
        from tts_api.adapters.gptsovits import get_gptsovits_status

        status = get_gptsovits_status(settings)
    else:
        return
    if status.get("loaded", False):
        raise RuntimeError("模型运行时仍在加载或服务中，请先停止服务/释放显存后再切换稳定包。")
