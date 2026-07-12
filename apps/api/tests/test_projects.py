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
