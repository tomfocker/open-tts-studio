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


PATCH_MARKER = "OpenTTS-ASR-DETACH-PATCH: v2"
WINDOWS_COMPILE_PATCH_MARKER = "OpenTTS-WINDOWS-COMPILE-PATCH: v1"


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
_DETACHED_ASR_CONFIG = re.compile(
    r"(?ms)^        # OpenTTS-ASR-DETACH-PATCH: v[12]\r?\n.*?^        self\.asr_model: Optional\[AutoModel\] = None"
)
_UNVERSIONED_DETACHED_ASR_CONFIG = re.compile(
    r"(?ms)^        # SenseVoice belongs to the shared OpenTTS ASR asset, not to the Vox\r?\n.*?^        self\.asr_model: Optional\[AutoModel\] = None"
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


def _detached_config() -> str:
    return f"""        # {PATCH_MARKER}
        # SenseVoice belongs to the shared OpenTTS ASR asset, not to the Vox
        # package. Keep the standalone /recognize compatibility endpoint
        # local-only and never fall back to a network model download.
        default_asr_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "SenseVoiceSmall"))
        self.asr_model_id = os.environ.get("OPEN_TTS_SENSEVOICE_MODEL_DIR", default_asr_path)

        self.asr_model: Optional[AutoModel] = None"""


def _normalise_detached_preload(source: str) -> str:
    """Keep the upstream background preload strictly TTS-only."""
    source, _ = _LEGACY_PRELOAD_ASR.subn("", source, count=1)
    source = source.replace("[1/2]", "[1/1]")
    source = source.replace('"""预加载所有模型：TTS 和 ASR"""', '"""预加载 TTS；独立 ASR 按 /recognize 请求懒加载。"""')
    source = source.replace("[VoxCPM2] 开始预加载所有模型...", "[VoxCPM2] 开始预加载 TTS 模型...")
    source = source.replace("[VoxCPM2] 所有模型加载完成！服务已就绪 🚀", "[VoxCPM2] TTS 模型加载完成！服务已就绪 🚀")
    return source


def _verify_detached_preload(source: str) -> None:
    preload_start = source.find("def preload_models")
    preload_end = source.find("executor.submit(preload_models)", preload_start)
    preload = source[preload_start : preload_end if preload_end >= 0 else None]
    if preload_start < 0 or "service.get_or_load_asr()" in preload:
        raise RuntimeError("Unsupported VoxCPM2 preload layout; refusing to start with embedded ASR enabled.")


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

    detached_config = _detached_config()
    source, config_count = _DETACHED_ASR_CONFIG.subn(detached_config, source, count=1)
    if config_count == 0:
        source, config_count = _UNVERSIONED_DETACHED_ASR_CONFIG.subn(detached_config, source, count=1)
    if config_count == 0:
        source, config_count = _LEGACY_ASR_CONFIG.subn(detached_config, source, count=1)
    if config_count != 1:
        raise RuntimeError("Unsupported VoxCPM2 api.py layout; update the OpenTTS ASR separation patch before starting Vox.")

    source, _ = _LEGACY_ASR_LOAD.subn(_DETACHED_ASR_LOAD, source, count=1)
    source = _normalise_detached_preload(source)
    _verify_detached_preload(source)
    _write_atomically(api_path, source)
    return True


def _patch_windows_compile_mode(path: Path) -> bool:
    """Enable CUDA graphs after disabling PyTorch's broken Windows launcher."""
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"VoxCPM2 model source is not UTF-8: {path}") from exc

    legacy_windows_mode = 'mode="default" if os.name == "nt" else "reduce-overhead"'
    if WINDOWS_COMPILE_PATCH_MARKER in source:
        # Upgrade workspaces patched by the earlier conservative fallback.
        # Their static launcher is already disabled by the service manager, so
        # retaining ``default`` would leave both ordinary and realtime Vox
        # needlessly slower on every single decode step.
        if legacy_windows_mode not in source:
            return False
        _write_atomically(source.replace(legacy_windows_mode, 'mode="reduce-overhead"'), path)
        return True
    if "import os" not in source or 'mode="reduce-overhead"' not in source:
        raise RuntimeError(
            "Unsupported VoxCPM2 torch.compile layout; refusing to start without the Windows safety patch."
        )

    optimize = re.search(r"(?m)^    def optimize\(self, disable: bool = False\).*?:\n", source)
    if optimize is None:
        raise RuntimeError("Unsupported VoxCPM2 torch.compile layout; optimize() was not found.")

    source = (
        source[: optimize.end()]
        + f"        # {WINDOWS_COMPILE_PATCH_MARKER}\n"
        + "        # OpenTTS disables PyTorch's static CUDA launcher on Windows.\n"
        + source[optimize.end() :]
    )
    source = source.replace(
        'mode="reduce-overhead"',
        'mode="reduce-overhead"',
    )
    _write_atomically(path, source)
    return True


def ensure_voxcpm2_windows_compile_safe(voxcpm2_root: Path) -> bool:
    """Patch the local VoxCPM source to keep ``torch.compile`` fast and reliable on Windows.

    The upstream package already opts into TorchInductor and runs one warm-up
    inference while the normal Vox HTTP service starts. Its original
    static CUDA launcher can overflow while resolving 64-bit CUDA handles.
    The worker disables that launcher before Torch imports, allowing the
    upstream ``reduce-overhead`` CUDA-graph mode to stay enabled.
    """
    if os.name != "nt":
        return False
    model_root = voxcpm2_root / "src" / "voxcpm" / "model"
    sources = [model_root / "voxcpm.py", model_root / "voxcpm2.py"]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"VoxCPM2 torch.compile source not found: {', '.join(missing)}")
    changed = False
    for path in sources:
        changed = _patch_windows_compile_mode(path) or changed
    return changed
