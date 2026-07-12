from fastapi.testclient import TestClient

from tts_api.main import app


def test_create_job_returns_queued_or_completed_job():
    client = TestClient(app)
    response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"]
    assert body["status"] in ["queued", "running", "succeeded"]
    assert body["request"]["model"] == "mock-tts"


def test_get_job_returns_existing_job():
    client = TestClient(app)
    create_response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )
    job_id = create_response.json()["id"]

    response = client.get(f"/v1/tts/jobs/{job_id}")

    assert response.status_code == 200
    assert response.json()["id"] == job_id
