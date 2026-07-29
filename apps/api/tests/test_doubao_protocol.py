import json
from urllib.parse import parse_qs, urlparse

import pytest

from tts_api.doubao_protocol import (
    DoubaoBlockedError,
    DoubaoWebSocketClient,
    build_doubao_ws_url,
    extract_device_fingerprint,
    generate_device_id_from_fingerprint,
)


class FakeSocket:
    def __init__(self, messages):
        self.messages = list(messages)
        self.sent = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def send(self, message):
        self.sent.append(json.loads(message))

    def recv(self, timeout):
        assert timeout == 12
        if not self.messages:
            raise StopIteration
        return self.messages.pop(0)


def test_build_url_matches_doubao_web_protocol():
    cookie = "sessionid=abc; s_v_web_id=verify_test_fingerprint; other=1"
    url = build_doubao_ws_url(
        speaker="voice-id",
        speech_rate=25,
        pitch=-2,
        cookie=cookie,
        web_tab_id="fixed-tab-id",
    )
    query = parse_qs(urlparse(url).query)

    assert extract_device_fingerprint(cookie) == "verify_test_fingerprint"
    assert query["speaker"] == ["voice-id"]
    assert query["format"] == ["aac"]
    assert query["speech_rate"] == ["25"]
    assert query["pitch"] == ["-2"]
    assert query["aid"] == ["497858"]
    assert query["device_id"] == [
        generate_device_id_from_fingerprint("verify_test_fingerprint", 2654435769, "unused")
    ]
    assert query["web_id"] == query["tea_uuid"]
    assert query["web_tab_id"] == ["fixed-tab-id"]


def test_websocket_client_sends_text_and_finish_and_collects_audio():
    socket = FakeSocket([b"\xff\xf1audio-one", b"\xff\xf1audio-two", json.dumps({"event": "finish"})])
    captured = {}

    def connector(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return socket

    client = DoubaoWebSocketClient(connector=connector, timeout_seconds=12)
    audio = client.synthesize(text="你好", speaker="voice-id", cookie="s_v_web_id=verify_1")

    assert audio == b"\xff\xf1audio-one\xff\xf1audio-two"
    assert socket.sent == [{"event": "text", "text": "你好"}, {"event": "finish"}]
    assert captured["origin"] == "https://www.doubao.com"
    assert captured["additional_headers"]["Cookie"] == "s_v_web_id=verify_1"


def test_websocket_client_surfaces_block_response():
    socket = FakeSocket([json.dumps({"event": "error", "code": 710022002, "message": "block"})])
    client = DoubaoWebSocketClient(connector=lambda *_args, **_kwargs: socket, timeout_seconds=12)

    with pytest.raises(DoubaoBlockedError):
        client.synthesize(text="你好", speaker="voice-id", cookie="s_v_web_id=verify_1")


def test_websocket_client_uses_persistent_fallback_device_ids_without_fingerprint():
    socket = FakeSocket([b"\xff\xf1audio", json.dumps({"event": "finish"})])
    captured = {}

    def connector(url, **_kwargs):
        captured["url"] = url
        return socket

    client = DoubaoWebSocketClient(
        connector=connector,
        timeout_seconds=12,
        device_id_provider=lambda: ("1234567890123456789", "9876543210987654321"),
    )
    client.synthesize(text="你好", speaker="voice-id", cookie="sessionid=only")
    query = parse_qs(urlparse(captured["url"]).query)

    assert query["device_id"] == ["1234567890123456789"]
    assert query["web_id"] == ["9876543210987654321"]
