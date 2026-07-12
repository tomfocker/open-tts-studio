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


def test_worker_client_builds_persistent_worker_command(tmp_path: Path):
    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        indextts2_root=Path("D:/AI/IndexTTS2"),
    )
    client = IndexTts2WorkerClient(settings=settings, python_executable="python")

    command = client.build_command()

    assert command[0] == "python"
    assert command[1].endswith("indextts2_worker.py")
    assert "--source-dir" in command
    assert str(Path("D:/AI/IndexTTS2") / "Index-TTS") in command
    assert "--fp16" in command


def test_worker_client_sends_json_synthesis_request(tmp_path: Path):
    process = FakeProcess()
    popen_calls = []

    def fake_popen(command, **kwargs):
        popen_calls.append(command)
        return process

    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        indextts2_root=Path("D:/AI/IndexTTS2"),
    )
    client = IndexTts2WorkerClient(settings=settings, python_executable="python", popen=fake_popen)
    request = SpeechRequest(model="indextts2", input="hello", emotion="calm")

    output = client.synthesize(request, Path("D:/out.wav"), "D:/prompt.wav")

    sent = json.loads(process.stdin.getvalue().strip())
    assert len(popen_calls) == 1
    assert output == Path("D:/out.wav")
    assert sent["type"] == "synthesize"
    assert sent["text"] == "hello"
    assert sent["prompt_audio"] == "D:/prompt.wav"
    assert sent["emotion_text"] == "calm"


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
