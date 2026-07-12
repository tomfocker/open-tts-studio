import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.projects import get_project_store


def make_tasks_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_TASK_LOG_DIR", str(tmp_path / "task-logs"))
    monkeypatch.setenv("OPEN_TTS_PROJECTS_FILE", str(tmp_path / "projects.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    get_settings.cache_clear()
    return TestClient(create_app())


def wait_for_task(client: TestClient, task_id: str) -> dict:
    for _ in range(100):
        tasks = client.get("/v1/tasks").json()["tasks"]
        task = next((item for item in tasks if item["id"] == task_id), None)
        if task and task["status"] in {"succeeded", "failed", "cancelled", "completed"}:
            return task
        time.sleep(0.01)
    raise AssertionError(f"Timed out waiting for task {task_id}")


def test_sync_speech_is_recorded_in_persistent_task_history(tmp_path: Path, monkeypatch):
    client = make_tasks_client(tmp_path, monkeypatch)

    response = client.post("/v1/audio/speech", json={"model": "mock-tts", "input": "同步任务记录"})

    assert response.status_code == 200
    tasks = client.get("/v1/tasks").json()["tasks"]
    speech_task = next(item for item in tasks if item["source"] == "speech")
    assert speech_task["status"] == "succeeded"
    assert speech_task["stage"] == "completed"
    assert speech_task["events"][-1]["stage"] == "completed"
    assert Path(speech_task["log_file"]).exists()


def test_task_center_includes_completed_batch_projects(tmp_path: Path, monkeypatch):
    client = make_tasks_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/v1/projects",
        json={
            "title": "任务中心旁白",
            "model": "mock-tts",
            "segments": [{"text": "第一段"}, {"text": "第二段"}],
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]
    run_response = client.post(f"/v1/projects/{project_id}/run")
    assert run_response.status_code == 200

    task = wait_for_task(client, f"project:{project_id}")

    assert task["source"] == "batch_project"
    assert task["status"] == "completed"
    assert task["progress_percent"] == 100


def test_failed_job_can_be_retried_from_task_api(tmp_path: Path, monkeypatch):
    client = make_tasks_client(tmp_path, monkeypatch)
    create_response = client.post("/v1/tts/jobs", json={"model": "missing-model", "input": "失败后重试"})
    assert create_response.status_code == 200
    original_id = create_response.json()["id"]
    failed = wait_for_task(client, original_id)
    assert failed["status"] == "failed"
    assert failed["retryable"] is True

    retry_response = client.post(f"/v1/tts/jobs/{original_id}/retry")

    assert retry_response.status_code == 200
    assert retry_response.json()["retry_of"] == original_id
    assert retry_response.json()["status"] in {"queued", "running", "failed"}


def test_task_center_reports_a_stopped_batch_project_as_resumable(tmp_path: Path, monkeypatch):
    client = make_tasks_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/v1/projects",
        json={
            "title": "停止后继续",
            "model": "mock-tts",
            "segments": [{"text": "保留的片段"}],
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]
    store = get_project_store()
    store.queue(project_id)
    store.cancel(project_id)

    tasks = client.get("/v1/tasks").json()["tasks"]
    task = next(item for item in tasks if item["id"] == f"project:{project_id}")

    assert task["status"] == "cancelled"
    assert task["stage"] == "cancelled"
    assert task["retryable"] is True
    assert task["cancelable"] is False
