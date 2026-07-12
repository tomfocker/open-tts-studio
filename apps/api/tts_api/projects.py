from __future__ import annotations

import json
import queue
import threading
from pathlib import Path
from typing import Callable
from uuid import uuid4

from tts_api.config import Settings, get_settings
from tts_api.schemas import (
    BatchProject,
    BatchProjectCreate,
    BatchProjectStatus,
    BatchProjectUpdate,
    BatchSegment,
    BatchSegmentStatus,
    SpeechRequest,
    SpeechResult,
    utc_now,
)


class BatchProjectStore:
    def __init__(self, projects_file: Path):
        self.projects_file = projects_file
        self._lock = threading.RLock()

    def list(self) -> list[BatchProject]:
        with self._lock:
            return sorted(self._load().values(), key=lambda project: project.updated_at, reverse=True)

    def get(self, project_id: str) -> BatchProject | None:
        with self._lock:
            return self._load().get(project_id)

    def create(self, payload: BatchProjectCreate) -> BatchProject:
        with self._lock:
            project = BatchProject(
                id=uuid4().hex,
                title=payload.title.strip(),
                model=payload.model,
                segments=self._build_segments(payload.segments),
                reference_audio=payload.reference_audio,
                reference_text=payload.reference_text,
                emotion=payload.emotion,
                speed=payload.speed,
            )
            projects = self._load()
            projects[project.id] = project
            self._save(projects)
            return project

    def update(self, project_id: str, values: BatchProjectUpdate) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = self._require_editable(projects, project_id)
            payload = values.model_dump(exclude_unset=True)
            if "segments" in payload:
                payload["segments"] = self._build_segments(values.segments or [])
            payload["status"] = BatchProjectStatus.draft
            payload["started_at"] = None
            payload["completed_at"] = None
            payload["updated_at"] = utc_now()
            updated = project.model_copy(update=payload)
            projects[project_id] = updated
            self._save(projects)
            return updated

    def queue(self, project_id: str) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = projects.get(project_id)
            if project is None:
                raise KeyError(project_id)
            if project.status == BatchProjectStatus.running:
                raise RuntimeError("项目正在生成中。")
            if not project.segments:
                raise RuntimeError("项目没有可生成的片段。")
            queued = project.model_copy(update={"status": BatchProjectStatus.queued, "updated_at": utc_now(), "completed_at": None})
            projects[project_id] = queued
            self._save(projects)
            return queued

    def reset_failed(self, project_id: str) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = self._require_editable(projects, project_id)
            segments = [
                segment.model_copy(update={"status": BatchSegmentStatus.pending, "error": None, "result": None})
                if segment.status == BatchSegmentStatus.failed
                else segment
                for segment in project.segments
            ]
            updated = project.model_copy(
                update={"segments": segments, "status": BatchProjectStatus.draft, "completed_at": None, "updated_at": utc_now()}
            )
            projects[project_id] = updated
            self._save(projects)
            return updated

    def mark_running(self, project_id: str) -> BatchProject:
        return self._update_project(
            project_id,
            {"status": BatchProjectStatus.running, "started_at": utc_now(), "completed_at": None},
        )

    def mark_segment_running(self, project_id: str, segment_id: str) -> BatchProject:
        return self._update_segment(
            project_id,
            segment_id,
            {"status": BatchSegmentStatus.running, "attempts": "increment", "error": None},
        )

    def mark_segment_succeeded(self, project_id: str, segment_id: str, result: SpeechResult) -> BatchProject:
        return self._update_segment(
            project_id,
            segment_id,
            {"status": BatchSegmentStatus.succeeded, "result": result, "error": None},
        )

    def mark_segment_failed(self, project_id: str, segment_id: str, error: str) -> BatchProject:
        return self._update_segment(project_id, segment_id, {"status": BatchSegmentStatus.failed, "error": error})

    def mark_finished(self, project_id: str) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = projects[project_id]
            status = BatchProjectStatus.failed if any(segment.status == BatchSegmentStatus.failed for segment in project.segments) else BatchProjectStatus.completed
            finished = project.model_copy(update={"status": status, "completed_at": utc_now(), "updated_at": utc_now()})
            projects[project_id] = finished
            self._save(projects)
            return finished

    def _update_project(self, project_id: str, values: dict) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = projects[project_id]
            updated = project.model_copy(update={**values, "updated_at": utc_now()})
            projects[project_id] = updated
            self._save(projects)
            return updated

    def _update_segment(self, project_id: str, segment_id: str, values: dict) -> BatchProject:
        with self._lock:
            projects = self._load()
            project = projects[project_id]
            segments: list[BatchSegment] = []
            found = False
            for segment in project.segments:
                if segment.id != segment_id:
                    segments.append(segment)
                    continue
                found = True
                payload = dict(values)
                if payload.get("attempts") == "increment":
                    payload["attempts"] = segment.attempts + 1
                segments.append(segment.model_copy(update=payload))
            if not found:
                raise KeyError(segment_id)
            updated = project.model_copy(update={"segments": segments, "updated_at": utc_now()})
            projects[project_id] = updated
            self._save(projects)
            return updated

    def _require_editable(self, projects: dict[str, BatchProject], project_id: str) -> BatchProject:
        project = projects.get(project_id)
        if project is None:
            raise KeyError(project_id)
        if project.status in {BatchProjectStatus.queued, BatchProjectStatus.running}:
            raise RuntimeError("项目已进入队列，暂不能编辑。")
        return project

    def _build_segments(self, drafts) -> list[BatchSegment]:
        return [
            BatchSegment(id=uuid4().hex, position=index, text=draft.text.strip())
            for index, draft in enumerate(drafts, start=1)
            if draft.text.strip()
        ]

    def _load(self) -> dict[str, BatchProject]:
        if not self.projects_file.exists():
            return {}
        try:
            payload = json.loads(self.projects_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        raw_projects = payload.get("projects", []) if isinstance(payload, dict) else []
        projects: dict[str, BatchProject] = {}
        for raw in raw_projects:
            try:
                project = BatchProject.model_validate(raw)
            except Exception:
                continue
            projects[project.id] = project
        return projects

    def _save(self, projects: dict[str, BatchProject]) -> None:
        self.projects_file.parent.mkdir(parents=True, exist_ok=True)
        self.projects_file.write_text(
            json.dumps({"projects": [project.model_dump(mode="json") for project in projects.values()]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class BatchProjectRunner:
    def __init__(self, store: BatchProjectStore, synthesize: Callable[[SpeechRequest], SpeechResult]):
        self.store = store
        self.synthesize = synthesize
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None

    def enqueue(self, project_id: str) -> BatchProject:
        project = self.store.queue(project_id)
        self._queue.put(project_id)
        with self._lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._drain, name="open-tts-batch-runner", daemon=True)
                self._worker.start()
        return project

    def run_project(self, project_id: str) -> BatchProject:
        self.store.mark_running(project_id)
        project = self.store.get(project_id)
        if project is None:
            raise KeyError(project_id)
        for segment in project.segments:
            if segment.status == BatchSegmentStatus.succeeded:
                continue
            self.store.mark_segment_running(project_id, segment.id)
            request = SpeechRequest(
                model=project.model,
                input=segment.text,
                reference_audio=project.reference_audio,
                reference_text=project.reference_text,
                emotion=project.emotion,
                response_format="wav",
                speed=project.speed,
            )
            try:
                result = self.synthesize(request)
            except Exception as exc:
                self.store.mark_segment_failed(project_id, segment.id, str(exc))
            else:
                self.store.mark_segment_succeeded(project_id, segment.id, result)
            project = self.store.get(project_id) or project
        return self.store.mark_finished(project_id)

    def _drain(self) -> None:
        while True:
            try:
                project_id = self._queue.get_nowait()
            except queue.Empty:
                return
            try:
                self.run_project(project_id)
            finally:
                self._queue.task_done()


_project_stores: dict[str, BatchProjectStore] = {}
_project_runners: dict[str, BatchProjectRunner] = {}


def get_project_store(settings: Settings | None = None) -> BatchProjectStore:
    active_settings = settings or get_settings()
    key = str(active_settings.projects_file)
    if key not in _project_stores:
        _project_stores[key] = BatchProjectStore(active_settings.projects_file)
    return _project_stores[key]


def get_project_runner(settings: Settings | None = None) -> BatchProjectRunner:
    active_settings = settings or get_settings()
    key = str(active_settings.projects_file)
    if key not in _project_runners:
        from tts_api.routes.speech import synthesize_with_registered_adapter

        _project_runners[key] = BatchProjectRunner(get_project_store(active_settings), synthesize_with_registered_adapter)
    return _project_runners[key]
