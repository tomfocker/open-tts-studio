from tts_api.doubao_qr_login import DoubaoQrLoginManager, _cookie_header_from_set_cookie


class FakeHeaders:
    def __init__(self, values=None):
        self.values = values or []

    def get_list(self, name):
        assert name == "set-cookie"
        return self.values


class FakeResponse:
    def __init__(self, payload, *, headers=None):
        self.payload = payload
        self.headers = FakeHeaders(headers)

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeHttpClient:
    def __init__(self):
        self.responses = []
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.responses.pop(0)


def test_qr_login_flow_captures_cookie_without_returning_it_to_status():
    http = FakeHttpClient()
    http.responses = [
        FakeResponse({"data": {"token": "qr-token", "scan_url": "doubao://scan"}}),
        FakeResponse(
            {"data": {"status": "confirmed", "redirect_url": "https://www.doubao.com"}},
            headers=[
                "sessionid=secret-session; Path=/; HttpOnly",
                "s_v_web_id=verify_cookie; Path=/; Secure",
            ],
        ),
    ]
    manager = DoubaoQrLoginManager(
        http_client=http,
        qr_encoder=lambda value: f"data:image/png;base64,{value}",
        now=lambda: 100,
    )

    started = manager.start()
    checked = manager.check(started["sessionId"])

    assert checked == {"status": "confirmed", "message": "登录已确认"}
    assert "cookie" not in checked
    assert manager.consume_cookie(started["sessionId"]) == "sessionid=secret-session; s_v_web_id=verify_cookie"
    assert manager.count() == 0


def test_qr_login_expires_sessions():
    clock = {"now": 100.0}
    http = FakeHttpClient()
    http.responses = [FakeResponse({"data": {"token": "qr-token", "scan_url": "scan-url"}})]
    manager = DoubaoQrLoginManager(
        http_client=http,
        qr_encoder=lambda _value: "data:image/png;base64,qr",
        now=lambda: clock["now"],
    )
    session_id = manager.start()["sessionId"]
    clock["now"] = 161

    assert manager.check(session_id)["status"] == "expired"
    assert manager.count() == 0


def test_set_cookie_headers_are_normalized_for_cookie_request_header():
    assert _cookie_header_from_set_cookie(
        ["a=1; Path=/; HttpOnly", "b=two; Expires=Wed, 21 Oct 2026 07:28:00 GMT"]
    ) == "a=1; b=two"
