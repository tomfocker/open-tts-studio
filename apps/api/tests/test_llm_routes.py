from fastapi.testclient import TestClient

from tts_api.main import app
from tts_api.routes import llm


def test_transform_text_builds_a_speech_friendly_request(monkeypatch):
    captured = {}

    def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return {"content": "今天下雨，请大家注意安全。", "model": "gpt-5.6-luna", "usage": None}

    monkeypatch.setattr(llm, "chat_completion", fake_chat_completion)
    response = TestClient(app).post(
        "/v1/llm/transform-text",
        json={
            "base_url": "https://example.test/v1",
            "model": "gpt-5.6-luna",
            "api_key": "secret",
            "operation": "rewrite_script",
            "text": "今天下雨了，大家注意安全",
        },
    )

    assert response.status_code == 200
    assert response.json()["text"] == "今天下雨，请大家注意安全。"
    assert captured["messages"][0]["role"] == "system"
    assert "适合 TTS 直接朗读" in captured["messages"][0]["content"]
    assert captured["messages"][1]["content"] == "今天下雨了，大家注意安全"


def test_polish_prompt_accepts_structured_json_from_the_model(monkeypatch):
    monkeypatch.setattr(
        llm,
        "chat_completion",
        lambda **_: {"content": '{"prompt":"年轻女性，音色温柔清亮。","summary":"温柔年轻女声","suggestions":["语速稍慢"]}', "model": "gpt-5.6-luna", "usage": None},
    )
    response = TestClient(app).post(
        "/v1/llm/polish-prompt",
        json={
            "base_url": "https://example.test/v1",
            "model": "gpt-5.6-luna",
            "keywords": "温柔 少女",
        },
    )

    assert response.status_code == 200
    assert response.json()["prompt"].startswith("年轻女性")
    assert response.json()["suggestions"] == ["语速稍慢"]
