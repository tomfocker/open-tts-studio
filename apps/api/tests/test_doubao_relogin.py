from __future__ import annotations

import json

from fastapi.testclient import TestClient

from tts_api.doubao_cookies import CookieSecretCodec, DoubaoCookiePool
from tts_api.config import get_settings
from tts_api.main import create_app


class BrokenCodec(CookieSecretCodec):
    prefix = "broken:"

    def unprotect(self, value: str) -> str:
        if value.startswith(self.prefix):
            raise OSError("DPAPI unavailable")
        return value


def test_unreadable_legacy_cookie_no_longer_breaks_status(tmp_path):
    path = tmp_path / "cookies.json"
    payload = DoubaoCookiePool._default_data()
    payload["cookies"].append(
        {
            "id": "legacy",
            "name": "旧账号",
            "value": "broken:encrypted",
            "status": {"isActive": True, "isValid": True, "isDisabled": False},
            "usage": {"usageCount": 0, "successCount": 0, "failureCount": 0},
            "metadata": {},
            "limits": {},
        }
    )
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    pool = DoubaoCookiePool(path, codec=BrokenCodec())

    stats = pool.stats()
    assert stats["enabled"] == 1
    assert stats["disabled"] == 0
    assert stats["valid"] == 0
    assert stats["invalid"] == 1
    record = pool.get("legacy")
    assert record["hasValue"] is False
    assert record["status"]["validationStatus"] == "invalid"
    assert "重新登录" in record["status"]["lastError"]


def test_qr_confirm_replaces_same_name_legacy_cookie(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_COOKIE_FILE", str(tmp_path / "doubao-cookies.json"))
    get_settings.cache_clear()
    client = TestClient(create_app())
    created = client.post("/v1/doubao/cookies", json={"name": "豆包扫码账号", "value": "old-cookie"})
    assert created.status_code == 201

    class FakeQrManager:
        def consume_cookie(self, session_id):
            assert session_id == "session-1"
            return "new-cookie"

    monkeypatch.setattr("tts_api.routes.doubao.get_qr_login_manager", lambda: FakeQrManager())
    confirmed = client.post(
        "/v1/doubao/auth/qr-confirm",
        json={"sessionId": "session-1", "cookieName": "豆包扫码账号"},
    )

    assert confirmed.status_code == 200
    cookie_id = created.json()["data"]["id"]
    revealed = client.get(f"/v1/doubao/cookies/{cookie_id}?reveal=true")
    assert revealed.status_code == 200
    assert revealed.json()["data"]["value"] == "new-cookie"
