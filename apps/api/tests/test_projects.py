import threading
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.projects import BatchProjectRunner, BatchProjectStore
from tts_api.schemas import BatchProjectCreate, BatchSegmentDraft, SpeechResult


def make_result(request) -> SpeechResult:
    return SpeechResult(
        audio_url=f"/outputs/{request.input}.wav",
        file_path=f"D:/outputs/{request.input}.wav",
        model=request.model,
        sample_rate=24000,
        duration_seconds=0.5,
    )


def test_batch_project_runner_tracks_segment_results_and_retries(tmp_path: Path):
    store = BatchProjectStore(tmp_path / "projects.json")
    project = store.create(
        BatchProjectCreate(
            title="旁白草稿",
            model="mock-tts",
            segments=[BatchSegmentDraft(text="第一段"), BatchSegmentDraft(text="第二段")],
        )
    )
    attempts = {"第二段": 0}

    def synthesize(request):
        if request.input == "第二段" and attempts["第二段"] == 0:
            attempts["第二段"] += 1
            raise RuntimeError("temporary failure")
        return make_result(request)

    runner = BatchProjectRunner(store, synthesize)
    store.queue(project.id)
    first = runner.run_project(project.id)

    assert first.status == "failed"
    assert [segment.status for segment in first.segments] == ["succeeded", "failed"]
    assert first.segments[1].attempts == 1

    store.reset_failed(project.id)
    store.queue(project.id)
    retried = runner.run_project(project.id)

    assert retried.status == "completed"
    assert [segment.status for segment in retried.segments] == ["succeeded", "succeeded"]
    assert retried.segments[1].attempts == 2
    assert retried.segments[1].result is not None


def test_projects_api_persists_project_without_starting_tts(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_PROJECTS_FILE", str(tmp_path / "projects.json"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    create_response = client.post(
        "/v1/projects",
        json={
            "title": "SRT 导入草稿",
            "model": "indextts2",
            "segments": [{"text": "第一句。"}, {"text": "第二句。"}],
        },
    )

    assert create_response.status_code == 200
    project = create_response.json()
    assert project["status"] == "draft"
    assert len(project["segments"]) == 2

    list_response = client.get("/v1/projects")

    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == project["id"]


def test_batch_project_stops_after_current_segment_and_resumes_from_the_boundary(tmp_path: Path):
    store = BatchProjectStore(tmp_path / "projects.json")
    project = store.create(
        BatchProjectCreate(
            title="可安全停止的旁白",
            model="mock-tts",
            segments=[BatchSegmentDraft(text="第一段"), BatchSegmentDraft(text="第二段")],
        )
    )
    first_segment_started = threading.Event()
    allow_first_segment_to_finish = threading.Event()
    generated: list[str] = []

    def synthesize(request):
        generated.append(request.input)
        if request.input == "第一段":
            first_segment_started.set()
            if not allow_first_segment_to_finish.wait(timeout=2):
                raise RuntimeError("test did not release the active segment")
        return make_result(request)

    runner = BatchProjectRunner(store, synthesize)
    store.queue(project.id)
    worker = threading.Thread(target=runner.run_project, args=(project.id,))
    worker.start()
    assert first_segment_started.wait(timeout=1)

    stopping = runner.cancel(project.id)
    assert stopping.status == "cancelling"
    allow_first_segment_to_finish.set()
    worker.join(timeout=2)
    assert not worker.is_alive()

    cancelled = store.get(project.id)
    assert cancelled is not None
    assert cancelled.status == "cancelled"
    assert [segment.status for segment in cancelled.segments] == ["succeeded", "pending"]
    assert generated == ["第一段"]

    store.resume(project.id)
    resumed = runner.run_project(project.id)

    assert resumed.status == "completed"
    assert [segment.status for segment in resumed.segments] == ["succeeded", "succeeded"]
    assert generated == ["第一段", "第二段"]


def test_batch_project_restart_recovery_preserves_queued_work_and_marks_active_work_stopped(tmp_path: Path):
    store = BatchProjectStore(tmp_path / "projects.json")
    queued = store.create(
        BatchProjectCreate(title="等待恢复", model="mock-tts", segments=[BatchSegmentDraft(text="排队段落")])
    )
    interrupted = store.create(
        BatchProjectCreate(title="中断恢复", model="mock-tts", segments=[BatchSegmentDraft(text="运行段落")])
    )
    store.queue(queued.id)
    store.queue(interrupted.id)
    store.mark_running(interrupted.id)
    store.mark_segment_running(interrupted.id, interrupted.segments[0].id)

    queued_project_ids = store.recover_after_restart()

    recovered = store.get(interrupted.id)
    assert queued_project_ids == [queued.id]
    assert recovered is not None
    assert recovered.status == "cancelled"
    assert recovered.segments[0].status == "pending"
