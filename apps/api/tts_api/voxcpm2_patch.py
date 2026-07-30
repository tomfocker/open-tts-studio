"""Versioned, idempotent compatibility patch for the local VoxCPM2 package.

The VoxCPM2 package is a locally installed model asset and is intentionally
ignored by Git. Its upstream ``api.py`` eagerly loads SenseVoice together with
TTS, which conflicts with OpenTTS's independently managed ASR service. This
module applies the small startup-only patch immediately before OpenTTS starts
that local API. No model files or user audio are read or copied.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path


PATCH_MARKER = "OpenTTS-ASR-DETACH-PATCH: v1"


_LEGACY_ASR_CONFIG = re.compile(
    r"(?ms)^        # 使用本地 ASR 模型路径\r?\n.*?^        self\.asr_model: Optional\[AutoModel\] = None"
)
_LEGACY_ASR_LOAD = re.compile(
    r'(?m)^        print\(f"\[VoxCPM2\] 正在加载 ASR 模型: \{self\.asr_model_id\}", flush=True\)\r?\n[ \t]*\r?\n        self\.asr_model = AutoModel\('
)
_DETACHED_ASR_LOAD = """        if not os.path.isdir(self.asr_model_id):
            raise RuntimeError(
                \"独立 SenseVoice 模型不存在。请安装 models/SenseVoiceSmall，\"
                \"或设置 OPEN_TTS_SENSEVOICE_MODEL_DIR。\"
            )
        print(f\"[VoxCPM2] 正在加载独立 ASR 模型: {self.asr_model_id}\", flush=True)

        self.asr_model = AutoModel("""
_LEGACY_PRELOAD_ASR = re.compile(
    r'(?ms)^        # 2\. 加载 ASR 模型（SenseVoice）\r?\n.*?(?=^        models_loaded\["all_ready"\] = True)'
)


def _write_atomically(path: Path, content: str) -> None:
    temporary = path.with_name(f".{path.name}.opentts-patch.tmp")
    try:
        temporary.write_text(content, encoding="utf-8", newline="")
        # Windows Defender or an editor can briefly keep the model asset open.
        # Keep the replacement atomic, but tolerate that short share-violation
        # window instead of leaving Vox unable to start after an update.
        for attempt in range(5):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))
    finally:
        temporary.unlink(missing_ok=True)


def _mark_existing_detached_source(source: str) -> str | None:
    """Recognise the pre-versioned local patch used by existing installations."""
    legacy_local_patch = "# SenseVoice belongs to the shared OpenTTS ASR asset, not to the Vox"
    if legacy_local_patch not in source:
        return None
    return source.replace(legacy_local_patch, f"# {PATCH_MARKER}\n        {legacy_local_patch[2:]}", 1)


def ensure_voxcpm2_asr_detached(voxcpm2_root: Path) -> bool:
    """Patch ``api.py`` so Vox starts TTS without eagerly loading SenseVoice.

    Returns ``True`` when the local asset was changed, ``False`` when it was
    already patched. An unexpected upstream API layout fails closed with a
    clear error instead of silently launching a Vox process that consumes ASR
    VRAM or attempts a model download.
    """

    api_path = voxcpm2_root / "api.py"
    if not api_path.is_file():
        raise FileNotFoundError(f"VoxCPM2 API script not found: {api_path}")
    try:
        source = api_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("VoxCPM2 API script is not UTF-8; cannot apply the ASR separation patch.") from exc

    if PATCH_MARKER in source:
        return False

    existing = _mark_existing_detached_source(source)
    if existing is not None:
        _write_atomically(api_path, existing)
        return True

    detached_config = """        # OpenTTS-ASR-DETACH-PATCH: v1
        # SenseVoice belongs to the shared OpenTTS ASR asset, not to the Vox
        # package. Keep the standalone /recognize compatibility endpoint
        # local-only and never fall back to a network model download.
        default_asr_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "SenseVoiceSmall"))
        self.asr_model_id = os.environ.get("OPEN_TTS_SENSEVOICE_MODEL_DIR", default_asr_path)

        self.asr_model: Optional[AutoModel] = None"""
    source, config_count = _LEGACY_ASR_CONFIG.subn(detached_config, source, count=1)
    if config_count != 1 or _LEGACY_ASR_LOAD.search(source) is None:
        raise RuntimeError("Unsupported VoxCPM2 api.py layout; update the OpenTTS ASR separation patch before starting Vox.")
    source, load_count = _LEGACY_ASR_LOAD.subn(_DETACHED_ASR_LOAD, source, count=1)
    if load_count != 1:
        raise RuntimeError("Unsupported VoxCPM2 ASR loader layout; refusing to start with embedded ASR enabled.")
    source, preload_count = _LEGACY_PRELOAD_ASR.subn("", source, count=1)
    if preload_count != 1:
        raise RuntimeError("Unsupported VoxCPM2 preload layout; refusing to start with embedded ASR enabled.")
    source = source.replace("[1/2]", "[1/1]")
    source = source.replace('"""预加载所有模型：TTS 和 ASR"""', '"""预加载 TTS；独立 ASR 按 /recognize 请求懒加载。"""')
    _write_atomically(api_path, source)
    return True
