import io
import json
from pathlib import Path

from tts_api.adapters.indextts2_worker import IndexTts2WorkerClient
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


class FakeProcess:
    def __init__(self):
        self.stdin = io.StringIO()
        self.stdout = io.StringIO('{"type":"ready"}\n{"type":"result","output_path":"D:/out.wav"}\n')
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode


def test_worker_client_builds_persistent_worker_command(tmp_path: Path):
    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        indextts2_root=Path("D:/AI/IndexTTS2"),
    )
    client = IndexTts2WorkerClient(settings=settings, python_executable="python")

    command = client.build_command()

    assert command[0] == "python"
    assert command[1] == "-u"
    assert command[2].endswith("indextts2_worker.py")
    assert "--source-dir" in command
    assert str(Path("D:/AI/IndexTTS2") / "Index-TTS") in command
    assert "--fp16" in command
    assert client.build_environment()["PYTHONUNBUFFERED"] == "1"


def test_worker_client_sends_json_synthesis_request(tmp_path: Path):
    process = FakeProcess()
    popen_calls = []

    def fake_popen(command, **kwargs):
        popen_calls.append(command)
        return process

    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        task_log_dir=tmp_path / "logs" / "tasks",
        indextts2_root=Path("D:/AI/IndexTTS2"),
    )
    client = IndexTts2WorkerClient(settings=settings, python_executable="python", popen=fake_popen)
    request = SpeechRequest(
        model="indextts2",
        input="hello",
        emotion="calm",
        temperature=0.7,
        top_p=0.75,
        top_k=24,
        num_beams=2,
        repetition_penalty=8.5,
        max_mel_tokens=1200,
    )

    output = client.synthesize(request, Path("D:/out.wav"), "D:/prompt.wav")

    sent = json.loads(process.stdin.getvalue().strip())
    assert len(popen_calls) == 1
    assert output == Path("D:/out.wav")
    assert sent["type"] == "synthesize"
    assert sent["text"] == "hello"
    assert sent["prompt_audio"] == "D:/prompt.wav"
    assert sent["emotion_text"] == "calm"
    assert sent["temperature"] == 0.7
    assert sent["top_p"] == 0.75
    assert sent["top_k"] == 24
    assert sent["num_beams"] == 2
    assert sent["repetition_penalty"] == 8.5
    assert sent["max_mel_tokens"] == 1200


def test_worker_client_stops_and_logs_an_unresponsive_inference(tmp_path: Path):
    class SilentProcess(FakeProcess):
        def __init__(self):
            self.stdin = io.StringIO()
            self.stdout = io.StringIO('worker booting\n{"type":"ready"}\n>> starting inference...\n')
            self.returncode = None

    process = SilentProcess()
    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        task_log_dir=tmp_path / "logs" / "tasks",
        indextts2_root=Path("D:/AI/IndexTTS2"),
    )
    client = IndexTts2WorkerClient(
        settings=settings,
        python_executable="python",
        popen=lambda _command, **_kwargs: process,
        request_timeout_seconds=0.01,
    )

    try:
        client.synthesize(SpeechRequest(model="indextts2", input="超时保护测试。"), tmp_path / "out.wav", "D:/prompt.wav")
    except RuntimeError as exc:
        assert "已停止无响应的模型 worker" in str(exc)
        assert str(client.log_path) in str(exc)
    else:
        raise AssertionError("expected a generation timeout")

    assert process.returncode == 0
    assert client.process is None
    assert "starting inference" in client.log_path.read_text(encoding="utf-8")


def test_worker_client_releases_after_idle_timeout(tmp_path: Path):
    process = FakeProcess()
    shutdown_calls = []
    current_time = [100.0]

    class ManualTimer:
        callback = None

        def __init__(self, delay, callback):
            self.delay = delay
            ManualTimer.callback = callback
            self.cancelled = False

        def start(self):
            return None

        def cancel(self):
            self.cancelled = True

    def fake_popen(command, **kwargs):
        return process

    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        indextts2_root=Path("D:/AI/IndexTTS2"),
        indextts2_idle_timeout_seconds=1,
    )
    client = IndexTts2WorkerClient(
        settings=settings,
        python_executable="python",
        popen=fake_popen,
        timer_factory=ManualTimer,
        now_factory=lambda: current_time[0],
    )
    client.shutdown = lambda: shutdown_calls.append("shutdown")

    client.mark_used()
    current_time[0] = 101.1
    ManualTimer.callback()

    assert shutdown_calls == ["shutdown"]
