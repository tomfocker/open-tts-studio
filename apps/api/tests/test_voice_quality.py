import wave
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.audio import write_sine_wav
from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.schemas import VoiceInfo
from tts_api.voice_quality import inspect_voice_quality


def write_silent_wav(path: Path, sample_rate: int = 24000, duration_seconds: float = 4.0) -> None:
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * int(sample_rate * duration_seconds))


def test_voice_quality_accepts_clean_wav_reference(tmp_path: Path):
    audio_path = tmp_path / "clean.wav"
    write_sine_wav(audio_path, sample_rate=24000, duration_seconds=5)

    report = inspect_voice_quality(VoiceInfo(id="clean", name="Clean", reference_audio=str(audio_path), authorization_status="authorized"))

    assert report.status == "ready"
    assert report.duration_seconds == 5
    assert report.sample_rate == 24000
    assert report.silence_ratio is not None


def test_voice_quality_warns_about_silence(tmp_path: Path):
    audio_path = tmp_path / "silent.wav"
    write_silent_wav(audio_path)

    report = inspect_voice_quality(VoiceInfo(id="silent", name="Silent", reference_audio=str(audio_path), authorization_status="authorized"))

    assert report.status == "warning"
    assert report.silence_ratio == 1.0
    assert any("静音" in warning for warning in report.warnings)


def test_voice_quality_api_returns_report_for_saved_voice(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    audio_path = tmp_path / "reference.wav"
    write_sine_wav(audio_path, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(create_app())
    create_response = client.post(
        "/v1/tts/voices",
        json={
            "name": "B站授权音色",
            "reference_audio": str(audio_path),
            "authorization_status": "source_bilibili_authorized",
            "source_type": "bilibili",
            "source_url": "https://www.bilibili.com/video/BV1demo",
        },
    )

    quality_response = client.get(f"/v1/tts/voices/{create_response.json()['id']}/quality")

    assert quality_response.status_code == 200
    assert quality_response.json()["status"] == "ready"
