from pathlib import Path

from tts_api.adapters.doubao_web import DoubaoWebAdapter, speed_to_speech_rate
from tts_api.audio import write_sine_wav
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


class FakePool:
    def __init__(self):
        self.record = {"id": "cookie-1", "value": "sessionid=secret"}
        self.usage = []

    def select(self):
        return self.record

    def record_usage(self, cookie_id, *, success, error=None):
        self.usage.append((cookie_id, success, error))

    def mark_validation(self, *_args, **_kwargs):
        raise AssertionError("cookie should remain valid")

    def rotate(self):
        raise AssertionError("cookie should not rotate")


class FakeClient:
    def __init__(self):
        self.request = None

    def synthesize(self, **request):
        self.request = request
        return b"aac-bytes"


class FakeConverter:
    def convert(self, audio, output_path: Path, output_format: str):
        assert audio == b"aac-bytes"
        assert output_format == "wav"
        write_sine_wav(output_path, sample_rate=24000, duration_seconds=0.25)


class RecordingThrottler:
    def __init__(self):
        self.calls = []

    def admit(self, select_request, *, interval_seconds, round_delay_seconds):
        self.calls.append((interval_seconds, round_delay_seconds))
        value, _completed_round = select_request()
        return value


def test_doubao_adapter_uses_voice_speed_pitch_and_records_success(tmp_path):
    settings = Settings(
        output_dir=tmp_path / "outputs",
        settings_file=tmp_path / "settings.json",
        doubao_cookie_file=tmp_path / "cookies.json",
        doubao_data_dir=tmp_path / "doubao",
    )
    pool = FakePool()
    client = FakeClient()
    adapter = DoubaoWebAdapter(
        settings=settings,
        cookie_pool=pool,
        client=client,
        converter=FakeConverter(),
    )

    result = adapter.synthesize(
        SpeechRequest(
            model="doubao-web",
            input="你好，世界",
            voice="zh_female_wenroutaozi_uranus_bigtts",
            speed=1.5,
            pitch=3,
        )
    )

    assert client.request == {
        "text": "你好，世界",
        "speaker": "zh_female_wenroutaozi_uranus_bigtts",
        "cookie": "sessionid=secret",
        "speech_rate": 25,
        "pitch": 3,
    }
    assert pool.usage == [("cookie-1", True, None)]
    assert result.sample_rate == 24000
    assert result.duration_seconds == 0.25
    assert Path(result.file_path).exists()


def test_doubao_adapter_routes_custom_delays_through_shared_throttler(tmp_path):
    settings = Settings(
        output_dir=tmp_path / "outputs",
        settings_file=tmp_path / "settings.json",
        doubao_cookie_file=tmp_path / "cookies.json",
        doubao_data_dir=tmp_path / "doubao",
        doubao_request_interval_delay_seconds=3,
    )
    throttler = RecordingThrottler()
    adapter = DoubaoWebAdapter(
        settings=settings,
        cookie_pool=FakePool(),
        client=FakeClient(),
        converter=FakeConverter(),
        throttler=throttler,
    )

    assert adapter.synthesize_aac(
        text="节流测试",
        request_delay_seconds=7,
        request_interval_seconds=2.5,
    ) == b"aac-bytes"
    assert throttler.calls == [(2.5, 7.0)]


def test_cookie_round_detection_only_fires_when_rotation_wraps():
    assert DoubaoWebAdapter._completed_cookie_round(
        {"totalRotations": 1, "valid": 2, "rotation": {"currentIndex": 1}},
        {"totalRotations": 2, "valid": 2, "rotation": {"currentIndex": 0}},
    )
    assert not DoubaoWebAdapter._completed_cookie_round(
        {"totalRotations": 1, "valid": 3, "rotation": {"currentIndex": 0}},
        {"totalRotations": 2, "valid": 3, "rotation": {"currentIndex": 1}},
    )


def test_speed_mapping_matches_doubao_range():
    assert speed_to_speech_rate(0.25) == -38
    assert speed_to_speech_rate(1.0) == 0
    assert speed_to_speech_rate(2.0) == 50
    assert speed_to_speech_rate(4.0) == 100
