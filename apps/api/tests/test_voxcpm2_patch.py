import os
from pathlib import Path

import pytest

from tts_api.voxcpm2_patch import (
    PATCH_MARKER,
    WINDOWS_COMPILE_PATCH_MARKER,
    ensure_voxcpm2_asr_detached,
    ensure_voxcpm2_windows_compile_safe,
)


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


LEGACY_COMPILE_MODEL = '''import os
import torch

class VoxCPMModel:
    def optimize(self, disable: bool = False):
        if disable:
            return self
        self.base_lm.forward_step = torch.compile(self.base_lm.forward_step, mode="reduce-overhead", fullgraph=True)
        self.residual_lm.forward_step = torch.compile(self.residual_lm.forward_step, mode="reduce-overhead", fullgraph=True)
        self.feat_encoder = torch.compile(self.feat_encoder, mode="reduce-overhead", fullgraph=True)
        self.feat_decoder.estimator = torch.compile(self.feat_decoder.estimator, mode="reduce-overhead", fullgraph=True)
        return self
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


def test_patch_repairs_the_invalid_v1_marker_written_by_early_builds(tmp_path: Path):
    api = tmp_path / "api.py"
    api.write_text(
        LEGACY_API.replace(
            "        # 使用本地 ASR 模型路径\n"
            '        local_asr_path = "./models/iic/SenseVoiceSmall"\n'
            "        if os.path.exists(local_asr_path):\n"
            "            self.asr_model_id = local_asr_path\n"
            '            logger.info(f"[VoxCPM2] 使用本地 ASR 模型: {local_asr_path}")\n'
            "        else:\n"
            '            self.asr_model_id = "iic/SenseVoiceSmall"\n'
            '            logger.info(f"[VoxCPM2] 本地 ASR 模型未找到，将从 ModelScope 下载")\n\n'
            "        self.asr_model: Optional[AutoModel] = None",
            "        # OpenTTS-ASR-DETACH-PATCH: v1\n"
            "        SenseVoice belongs to the shared OpenTTS ASR asset, not to the Vox\n"
            "        # package. Keep the standalone /recognize compatibility endpoint\n"
            "        # local-only and never fall back to a network model download.\n"
            "        default_asr_path = os.path.abspath(os.path.join(os.path.dirname(__file__), \"..\", \"SenseVoiceSmall\"))\n"
            '        self.asr_model_id = os.environ.get("OPEN_TTS_SENSEVOICE_MODEL_DIR", default_asr_path)\n\n'
            "        self.asr_model: Optional[AutoModel] = None",
        ),
        encoding="utf-8",
    )

    assert ensure_voxcpm2_asr_detached(tmp_path) is True
    repaired = api.read_text(encoding="utf-8")
    compile(repaired, str(api), "exec")
    assert PATCH_MARKER in repaired
    assert "        # SenseVoice belongs" in repaired
    assert "        SenseVoice belongs" not in repaired


def test_patch_rejects_unknown_vox_api_layout(tmp_path: Path):
    (tmp_path / "api.py").write_text("print('unknown Vox build')\n", encoding="utf-8")

    try:
        ensure_voxcpm2_asr_detached(tmp_path)
    except RuntimeError as exc:
        assert "Unsupported VoxCPM2" in str(exc)
    else:
        raise AssertionError("expected an unsupported-layout error")


@pytest.mark.skipif(os.name != "nt", reason="the TorchInductor workaround applies only to Windows")
def test_patch_switches_both_vox_models_to_the_windows_safe_compile_mode(tmp_path: Path):
    model_root = tmp_path / "src" / "voxcpm" / "model"
    model_root.mkdir(parents=True)
    for name in ("voxcpm.py", "voxcpm2.py"):
        (model_root / name).write_text(LEGACY_COMPILE_MODEL, encoding="utf-8")

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is True
    for name in ("voxcpm.py", "voxcpm2.py"):
        patched = (model_root / name).read_text(encoding="utf-8")
        compile(patched, str(model_root / name), "exec")
        assert WINDOWS_COMPILE_PATCH_MARKER in patched
        assert 'mode="default" if os.name == "nt" else "reduce-overhead"' in patched
        assert patched.count('mode="default" if os.name == "nt" else "reduce-overhead"') == 1
        assert patched.count('mode="reduce-overhead"') == 3

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is False


@pytest.mark.skipif(os.name != "nt", reason="the TorchInductor workaround applies only to Windows")
def test_patch_repairs_the_unsafe_windows_reduce_overhead_mode(tmp_path: Path):
    model_root = tmp_path / "src" / "voxcpm" / "model"
    model_root.mkdir(parents=True)
    windows_safe_mode = 'mode="default" if os.name == "nt" else "reduce-overhead"'
    previously_patched = LEGACY_COMPILE_MODEL.replace(
        "        if disable:\n",
        f"        # {WINDOWS_COMPILE_PATCH_MARKER}\n        if disable:\n",
    )
    for name in ("voxcpm.py", "voxcpm2.py"):
        (model_root / name).write_text(previously_patched, encoding="utf-8")

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is True
    for name in ("voxcpm.py", "voxcpm2.py"):
        repaired = (model_root / name).read_text(encoding="utf-8")
        compile(repaired, str(model_root / name), "exec")
        assert windows_safe_mode in repaired
        assert repaired.count(windows_safe_mode) == 1
        assert repaired.count('mode="reduce-overhead"') == 3

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is False


@pytest.mark.skipif(os.name != "nt", reason="the TorchInductor workaround applies only to Windows")
def test_patch_narrows_an_all_default_draft_to_the_feature_encoder(tmp_path: Path):
    model_root = tmp_path / "src" / "voxcpm" / "model"
    model_root.mkdir(parents=True)
    windows_safe_mode = 'mode="default" if os.name == "nt" else "reduce-overhead"'
    all_default_draft = LEGACY_COMPILE_MODEL.replace(
        "        if disable:\n",
        f"        # {WINDOWS_COMPILE_PATCH_MARKER}\n        if disable:\n",
    ).replace('mode="reduce-overhead"', windows_safe_mode)
    for name in ("voxcpm.py", "voxcpm2.py"):
        (model_root / name).write_text(all_default_draft, encoding="utf-8")

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is True
    for name in ("voxcpm.py", "voxcpm2.py"):
        narrowed = (model_root / name).read_text(encoding="utf-8")
        compile(narrowed, str(model_root / name), "exec")
        assert narrowed.count(windows_safe_mode) == 1
        assert narrowed.count('mode="reduce-overhead"') == 3

    assert ensure_voxcpm2_windows_compile_safe(tmp_path) is False
