from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def build_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_COOKIE_FILE", str(tmp_path / "doubao-cookies.json"))
    get_settings.cache_clear()
    return TestClient(create_app())


def test_doubao_cookie_crud_redacts_list_and_supports_legacy_paths(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)

    created = client.post(
        "/api/cookies",
        json={"name": "主账号", "value": "sessionid=secret; s_v_web_id=verify_1"},
    )
    assert created.status_code == 201
    cookie_id = created.json()["data"]["id"]
    assert "value" not in created.json()["data"]

    listing = client.get("/v1/doubao/cookies").json()
    assert listing["total"] == 1
    assert "value" not in listing["data"][0]
    assert listing["stats"]["valid"] == 1

    revealed = client.get(f"/api/cookies/{cookie_id}").json()["data"]
    assert revealed["value"].startswith("sessionid=secret")

    toggled = client.post(f"/api/cookies/{cookie_id}/toggle").json()["data"]
    assert toggled["status"]["isDisabled"] is True
    assert client.get("/v1/doubao/status").json()["data"]["status"] == "needs_cookie"

    assert client.delete(f"/api/cookies/{cookie_id}").status_code == 200
    assert client.get("/api/cookies").json()["total"] == 0


def test_doubao_voice_catalog_has_original_29_voices(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)

    response = client.get("/api/voices")

    assert response.status_code == 200
    assert response.json()["total"] == 29
    assert any(
        voice["style_id"] == "zh_female_wenroutaozi_uranus_bigtts"
        for voice in response.json()["data"]
    )


def test_doubao_cookie_rotation_config_is_persisted(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    client.post("/api/cookies", json={"name": "一", "value": "cookie-one"})
    client.post("/api/cookies", json={"name": "二", "value": "cookie-two"})

    response = client.post(
        "/api/cookies/rotation-config",
        json={"usageLimitEnabled": True, "usageCountPerCookie": 3},
    )

    assert response.status_code == 200
    assert client.get("/api/cookies/stats").json()["data"]["rotation"]["usageCountPerCookie"] == 3


def test_cookie_batch_test_accepts_upstream_indexes_contract(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    client.post("/api/cookies", json={"name": "一", "value": "cookie-one"})
    client.post("/api/cookies", json={"name": "二", "value": "cookie-two"})

    monkeypatch.setattr(
        "tts_api.routes.doubao.DoubaoWebSocketClient.validate_cookie",
        lambda _self, value: (value == "cookie-two", "有效" if value == "cookie-two" else "无效"),
    )
    response = client.post("/api/cookies/batch/test", json={"indexes": [1, 99]})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["successCount"] == 1
    assert data["failCount"] == 0
    assert data["total"] == 2
    assert data["results"][0]["error"] == "Cookie索引 99 不存在"
    assert data["results"][1]["cookieId"]
    assert data["results"][1]["result"]["isValid"] is True

    assert client.post("/api/cookies/batch/test", json={"indexes": []}).status_code == 422
