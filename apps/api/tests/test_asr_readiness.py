from tts_api.config import Settings, serialize_settings


def test_settings_reports_complete_sensevoice_and_alignment_requirements(tmp_path):
    model_dir = tmp_path / "SenseVoiceSmall"
    model_dir.mkdir()
    runtime = model_dir / "runtime" / "python.exe"
    runtime.parent.mkdir()
    runtime.write_bytes(b"runtime")
    aligner = tmp_path / "Qwen3-ForcedAligner-0.6B"
    aligner.mkdir()
    capswriter = tmp_path / "CapsWriter-Offline"
    capswriter.mkdir()

    settings = Settings(
        sensevoice_model_dir=model_dir,
        sensevoice_python=runtime,
        alignment_aligner_model_dir=aligner,
        alignment_capswriter_root=capswriter,
        alignment_python=runtime,
    )

    payload = serialize_settings(settings)

    assert payload["sensevoice_model_installed"] is True
    assert payload["sensevoice_runtime_installed"] is True
    assert payload["sensevoice_ready"] is True
    assert payload["alignment_ready"] is True


def test_settings_does_not_mark_model_only_sensevoice_as_ready(tmp_path):
    model_dir = tmp_path / "SenseVoiceSmall"
    model_dir.mkdir()

    payload = serialize_settings(Settings(sensevoice_model_dir=model_dir, sensevoice_python=tmp_path / "missing.exe"))

    assert payload["sensevoice_model_installed"] is True
    assert payload["sensevoice_runtime_installed"] is False
    assert payload["sensevoice_ready"] is False
