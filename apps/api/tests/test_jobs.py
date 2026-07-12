import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.jobs import JobStore
from tts_api.main import create_app
from tts_api.schemas import SpeechRequest


def make_jobs_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_TASK_LOG_DIR", str(tmp_path / "task-logs"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    get_settings.cache_clear()
    return TestClient(create_app())


def wait_for_terminal_job(client: TestClient, job_id: str) -> dict:
    for _ in range(100):
        response = client.get(f"/v1/tts/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] in {"succeeded", "failed", "cancelled"}:
            return job
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for local job")


def test_create_job_returns_a_trackable_async_job(tmp_path: Path, monkeypatch):
    client = make_jobs_client(tmp_path, monkeypatch)
    response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"]
    assert body["status"] in ["queued", "running", "succeeded"]
    assert body["request"]["model"] == "mock-tts"
    completed = wait_for_terminal_job(client, body["id"])
    assert completed["status"] == "succeeded"
    assert completed["stage"] == "completed"
    assert completed["progress_percent"] == 100
    assert completed["log_file"]
    assert Path(completed["log_file"]).exists()
    assert any(event["stage"] == "starting_adapter" for event in completed["events"])


def test_get_job_returns_existing_job_and_task_center_summary(tmp_path: Path, monkeypatch):
    client = make_jobs_client(tmp_path, monkeypatch)
    create_response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )
    job_id = create_response.json()["id"]

    response = client.get(f"/v1/tts/jobs/{job_id}")

    assert response.status_code == 200
    assert response.json()["id"] == job_id
    tasks_response = client.get("/v1/tasks")
    assert tasks_response.status_code == 200
    task = next(item for item in tasks_response.json()["tasks"] if item["id"] == job_id)
    assert task["source"] == "speech"
    assert task["log_file"]


def test_restart_recovery_marks_running_jobs_retryable_and_keeps_queued_jobs(tmp_path: Path):
    store = JobStore(tmp_path / "tasks.json", tmp_path / "task-logs")
    running = store.create(SpeechRequest(model="mock-tts", input="正在执行"))
    queued = store.create(SpeechRequest(model="mock-tts", input="继续排队"))
    store.mark_running(running.id)

    queued_job_ids = store.recover_after_restart()

    recovered_running = store.get(running.id)
    assert recovered_running is not None
    assert recovered_running.status.value == "failed"
    assert recovered_running.stage == "interrupted"
    assert "重启" in (recovered_running.error or "")
    assert queued_job_ids == [queued.id]
