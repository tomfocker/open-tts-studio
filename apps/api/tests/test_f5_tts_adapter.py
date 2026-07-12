from pathlib import Path

from tts_api.adapters.f5_tts import F5TtsAdapter
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_f5_tts_adapter_builds_expected_command(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = F5TtsAdapter(settings=settings, python_executable="D:/runtime/f5/python.exe")
    request = SpeechRequest(
        model="f5-tts",
        input="hello",
        reference_audio="D:/voices/ref.wav",
        reference_text="reference words",
    )

    command, output_path = adapter.build_command(request)

    assert command[0] == "D:/runtime/f5/python.exe"
    assert "-m" in command
    assert "f5_tts.infer.infer_cli" in command
    assert "--gen_text" in command
    assert "hello" in command
    assert "--ref_audio" in command
    assert "D:/voices/ref.wav" in command
    assert "--ref_text" in command
    assert "reference words" in command
    assert output_path.suffix == ".wav"
