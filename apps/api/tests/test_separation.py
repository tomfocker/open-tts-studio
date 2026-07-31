import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.audio import write_sine_wav
from tts_api.config import Settings, get_settings
from tts_api.main import create_app
from tts_api.separation import (
    AudioSeparationJobRequest,
    AudioSeparationModel,
    _paths,
    get_audio_separation_runner,
    get_audio_separation_store,
)


def _wait_for_terminal(settings: Settings, job_id: str):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = get_audio_separation_store(settings).get(job_id)
        if job and job.status.value not in {"queued", "running"}:
            return job
        time.sleep(0.02)
    raise AssertionError("audio separation job did not complete")


def _settings(tmp_path: Path) -> Settings:
    return Settings(output_dir=tmp_path / "outputs")


def _prepare_model_root(tmp_path: Path) -> Path:
    root = tmp_path / "MDX_Net_Models"
    (root / "model_data" / "mdx_c_configs").mkdir(parents=True)
    for name in ("UVR-MDX-NET-Voc_FT.onnx", "UVR_MDXNET_KARA_2.onnx", "MDX23C-8KFFT-InstVoc_HQ.ckpt"):
        (root / name).write_bytes(b"onnx")
    (root / "model_data" / "model_data.json").write_text("{}", encoding="utf-8")
    (root / "model_data" / "mdx_c_configs" / "model_2_stem_full_band_8k.yaml").write_text("training: {}\n", encoding="utf-8")
    return root


def test_separation_runner_creates_two_published_stems(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    root = _prepare_model_root(tmp_path)
    monkeypatch.setattr("tts_api.separation._model_root", lambda: root)
    monkeypatch.setattr("tts_api.separation._runtime_python", lambda: Path(sys.executable))
    paths = _paths(settings)
    input_id = "a" * 32
    paths.inputs.mkdir(parents=True)
    source = paths.inputs / f"{input_id}.wav"
    write_sine_wav(source, sample_rate=44100, duration_seconds=0.3)
    runner = get_audio_separation_runner(settings)

    def fake_convert(_source, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        write_sine_wav(destination, sample_rate=44100, duration_seconds=0.3)

    def fake_model(_job_id, _source, output_dir, _backend, _model_file, _model_config):
        output_dir.mkdir(parents=True, exist_ok=True)
        vocals = output_dir / "vocals.wav"
        instrumental = output_dir / "instrumental.wav"
        write_sine_wav(vocals, sample_rate=44100, duration_seconds=0.3)
        write_sine_wav(instrumental, sample_rate=44100, duration_seconds=0.3)
        return {"vocals": vocals, "instrumental": instrumental}

    monkeypatch.setattr(runner, "_convert_to_canonical_wav", fake_convert)
    monkeypatch.setattr(runner, "_run_model", fake_model)
    job = runner.enqueue(AudioSeparationJobRequest(input_id=input_id, source_file_name="sample.wav", model=AudioSeparationModel.mdx_vocals))
    completed = _wait_for_terminal(settings, job.id)

    assert completed.status.value == "completed"
    assert [item.stem for item in completed.outputs] == ["vocals", "instrumental"]
    assert all(Path(item.file_path).is_file() for item in completed.outputs)
    assert all(item.audio_url.startswith("/outputs/") for item in completed.outputs)


def test_separation_job_rejects_unmanaged_input(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    monkeypatch.setattr("tts_api.separation._model_root", lambda: _prepare_model_root(tmp_path))
    runner = get_audio_separation_runner(settings)
    try:
        runner.enqueue(AudioSeparationJobRequest(input_id="b" * 32, source_file_name="missing.wav"))
    except Exception as exc:
        assert "受控" in str(exc)
    else:
        raise AssertionError("expected controlled-input validation error")


def test_separation_upload_uses_opaque_managed_input(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "config" / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_AUDIO_SEPARATION_ROOT", str(tmp_path / "separation"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post("/v1/audio-separations/uploads", files={"file": ("phone.wav", b"placeholder-audio", "audio/wav")})

    assert response.status_code == 200
    body = response.json()
    assert len(body["id"]) == 32
    assert body["file_name"] == "phone.wav"
    assert not Path(body["id"]).is_absolute()
    assert (tmp_path / "separation" / "inputs" / f"{body['id']}.wav").read_bytes() == b"placeholder-audio"
