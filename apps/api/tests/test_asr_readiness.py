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


def test_settings_reports_audio_enhancement_prerequisites_independently(tmp_path):
    deepfilter_root = tmp_path / "DeepFilterNet3"
    (deepfilter_root / "checkpoints").mkdir(parents=True)
    (deepfilter_root / "config.ini").write_text("[df]\n", encoding="utf-8")
    mossformer_root = tmp_path / "MossFormer2-SE-48K"
    mossformer_root.mkdir()
    (mossformer_root / "last_best_checkpoint").write_text("last_best_checkpoint.pt\n", encoding="utf-8")
    (mossformer_root / "last_best_checkpoint.pt").write_bytes(b"weights")

    payload = serialize_settings(Settings(
        audio_enhancement_python=tmp_path / "missing-python.exe",
        deepfilternet3_root=deepfilter_root,
        mossformer2_se_root=mossformer_root,
    ))

    assert payload["audio_enhancement_runtime_installed"] is False
    assert payload["deepfilternet3_model_installed"] is True
    assert payload["mossformer2_se_model_installed"] is True
    assert payload["audio_enhancement_ready"] is False
