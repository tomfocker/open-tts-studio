from pathlib import Path

from tts_api.voxcpm2_patch import PATCH_MARKER, ensure_voxcpm2_asr_detached


LEGACY_API = '''import os
from typing import Optional
from funasr import AutoModel

class VoxCPM2Service:
    def __init__(self) -> None:
        # 使用本地 ASR 模型路径
        local_asr_path = "./models/iic/SenseVoiceSmall"
        if os.path.exists(local_asr_path):
            self.asr_model_id = local_asr_path
            logger.info(f"[VoxCPM2] 使用本地 ASR 模型: {local_asr_path}")
        else:
            self.asr_model_id = "iic/SenseVoiceSmall"
            logger.info(f"[VoxCPM2] 本地 ASR 模型未找到，将从 ModelScope 下载")

        self.asr_model: Optional[AutoModel] = None

    def get_or_load_asr(self) -> AutoModel:
        if self.asr_model is not None:
            return self.asr_model

        print(f"[VoxCPM2] 正在加载 ASR 模型: {self.asr_model_id}", flush=True)

        self.asr_model = AutoModel(model=self.asr_model_id)
        models_loaded["asr"] = True
        return self.asr_model

models_loaded = {"tts": False, "asr": False, "all_ready": False}

def preload_models():
    """预加载所有模型：TTS 和 ASR"""
    try:
        # 1. 加载 VoxCPM2 TTS 模型（主模型）
        print("[VoxCPM2] [1/2] 正在加载 TTS 模型...", flush=True)
        service.get_or_load_voxcpm()
        models_loaded["tts"] = True
        print("[VoxCPM2] [1/2] TTS 模型加载完成 ✓", flush=True)

        # 2. 加载 ASR 模型（SenseVoice）
        print("[VoxCPM2] [2/2] 正在加载 ASR 模型...", flush=True)
        service.get_or_load_asr()
        models_loaded["asr"] = True
        print("[VoxCPM2] [2/2] ASR 模型加载完成 ✓", flush=True)

        models_loaded["all_ready"] = True
    except Exception:
        pass
'''


def test_patch_detaches_legacy_vox_asr_preload_idempotently(tmp_path: Path):
    api = tmp_path / "api.py"
    api.write_text(LEGACY_API, encoding="utf-8")

    assert ensure_voxcpm2_asr_detached(tmp_path) is True
    patched = api.read_text(encoding="utf-8")
    assert PATCH_MARKER in patched
    assert 'models_loaded["all_ready"] = True' in patched
    preload = patched[patched.index("def preload_models"):]
    assert "service.get_or_load_asr()" not in preload
    assert "iic/SenseVoiceSmall" not in patched
    assert "OPEN_TTS_SENSEVOICE_MODEL_DIR" in patched

    assert ensure_voxcpm2_asr_detached(tmp_path) is False


def test_patch_rejects_unknown_vox_api_layout(tmp_path: Path):
    (tmp_path / "api.py").write_text("print('unknown Vox build')\n", encoding="utf-8")

    try:
        ensure_voxcpm2_asr_detached(tmp_path)
    except RuntimeError as exc:
        assert "Unsupported VoxCPM2" in str(exc)
    else:
        raise AssertionError("expected an unsupported-layout error")
