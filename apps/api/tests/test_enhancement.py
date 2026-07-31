import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.audio import write_sine_wav
from tts_api.config import Settings, get_settings
from tts_api.enhancement import get_audio_enhancement_runner, get_audio_enhancement_store
from tts_api.main import create_app
from tts_api.schemas import AudioEnhancementBackend, AudioEnhancementJobRequest, AudioEnhancementPreset


def _wait_for_terminal(settings: Settings, job_id: str):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = get_audio_enhancement_store(settings).get(job_id)
        if job and job.status.value not in {"queued", "running"}:
            return job
        time.sleep(0.02)
    raise AssertionError("audio enhancement job did not complete")


def _settings(tmp_path: Path) -> Settings:
    deep_root = tmp_path / "DeepFilterNet3"
    (deep_root / "checkpoints").mkdir(parents=True)
    (deep_root / "config.ini").write_text("[train]\n", encoding="utf-8")
    moss_root = tmp_path / "MossFormer2-SE-48K"
    moss_root.mkdir()
    (moss_root / "last_best_checkpoint").write_text("last_best_checkpoint.pt\n", encoding="utf-8")
    (moss_root / "last_best_checkpoint.pt").write_bytes(b"weights")
    return Settings(
        output_dir=tmp_path / "outputs",
        audio_enhancement_jobs_file=tmp_path / "config" / "audio-enhancements.json",
        audio_enhancement_input_dir=tmp_path / "inputs",
        audio_enhancement_work_dir=tmp_path / "work",
        audio_enhancement_python=Path(sys.executable),
        deepfilternet3_root=deep_root,
        mossformer2_se_root=moss_root,
    )


def test_enhancement_runner_creates_ordered_comparison_outputs(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = "a" * 32
    settings.audio_enhancement_input_dir.mkdir(parents=True)
    source = settings.audio_enhancement_input_dir / f"{input_id}.wav"
    write_sine_wav(source, sample_rate=48000, duration_seconds=0.3)
    runner = get_audio_enhancement_runner(settings)

    def fake_convert(_source, destination, _settings):
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_sine_wav(destination, sample_rate=48000, duration_seconds=0.3)

    def fake_backend(_job_id, _backend, _source, destination, _model_dir, _preset):
        write_sine_wav(destination, sample_rate=48000, duration_seconds=0.3)

    monkeypatch.setattr(runner, "_convert_to_canonical_wav", fake_convert)
    monkeypatch.setattr(runner, "_run_backend", fake_backend)
    job = runner.enqueue(AudioEnhancementJobRequest(
        input_id=input_id,
        source_file_name="sample.wav",
        backends=[AudioEnhancementBackend.deepfilternet3, AudioEnhancementBackend.mossformer2_se_48k],
        preset=AudioEnhancementPreset.light,
    ))

    completed = _wait_for_terminal(settings, job.id)

    assert completed.status.value == "completed"
    assert [item.backend.value for item in completed.outputs] == ["deepfilternet3", "mossformer2-se-48k"]
    assert all(Path(item.file_path).is_file() for item in completed.outputs)
    assert all(item.audio_url.startswith("/outputs/") for item in completed.outputs)


def test_enhancement_job_rejects_unmanaged_input(tmp_path: Path):
    settings = _settings(tmp_path)
    runner = get_audio_enhancement_runner(settings)

    try:
        runner.enqueue(AudioEnhancementJobRequest(
            input_id="b" * 32,
            source_file_name="missing.wav",
            backends=[AudioEnhancementBackend.deepfilternet3],
        ))
    except Exception as exc:
        assert "受控" in str(exc)
    else:
        raise AssertionError("expected controlled-input validation error")


def test_enhancement_upload_uses_opaque_managed_input(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "config" / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_AUDIO_ENHANCEMENT_INPUT_DIR", str(tmp_path / "inputs"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post(
        "/v1/audio-enhancements/uploads",
        files={"file": ("phone.wav", b"placeholder-audio", "audio/wav")},
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["id"]) == 32
    assert body["file_name"] == "phone.wav"
    assert not Path(body["id"]).is_absolute()
    assert (tmp_path / "inputs" / f"{body['id']}.wav").read_bytes() == b"placeholder-audio"
