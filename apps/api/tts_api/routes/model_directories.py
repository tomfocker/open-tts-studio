from pathlib import Path

from fastapi import APIRouter

from tts_api.config import get_settings
from tts_api.model_instances import list_model_instances

router = APIRouter()


def directory_info(identifier: str, display_name: str, path: Path, kind: str) -> dict:
    return {
        "id": identifier,
        "display_name": display_name,
        "path": str(path),
        "exists": path.exists() and path.is_dir(),
        "kind": kind,
    }


def runtime_directory(executable: Path) -> Path:
    """Return the managed runtime folder instead of the Python executable."""

    if executable.parent.name.lower() == "scripts":
        return executable.parent.parent
    return executable.parent


@router.get("/v1/model-directories")
def list_model_directories() -> dict:
    settings = get_settings()
    instances = {instance.model_id: instance for instance in list_model_instances(settings)}
    directories = [
        directory_info("storage-root", "统一资源库", settings.storage_root, "storage_root"),
        directory_info("model-store", "模型与专用运行时", settings.storage_root / "models", "model_store"),
        directory_info("outputs", "成品输出", settings.output_dir, "output"),
        directory_info("indextts2", "IndexTTS2", instances["indextts2"].root_path or settings.indextts2_root, "model_root"),
        directory_info("voxcpm2", "VoxCPM2", instances["voxcpm2"].root_path or settings.voxcpm2_root, "model_root"),
        directory_info("gptsovits", "GPT-SoVITS", instances["gptsovits"].root_path or settings.gptsovits_root, "model_root"),
        directory_info("sensevoice", "SenseVoice", settings.sensevoice_model_dir, "model_root"),
        directory_info("sensevoice-runtime", "SenseVoice 运行时", runtime_directory(settings.sensevoice_python), "runtime"),
        directory_info("qwen-asr", "Qwen3 ASR", settings.qwen_asr_model_dir, "model_root"),
        directory_info("qwen-runtime", "Qwen3 运行时", runtime_directory(settings.qwen_asr_python), "runtime"),
        directory_info("qwen-cuda-runtime", "Qwen3 CUDA 运行时", runtime_directory(settings.qwen_cuda_python), "runtime"),
        directory_info("alignment-model", "Qwen3 强制对齐", settings.alignment_aligner_model_dir or settings.storage_root / "models" / "Qwen3-ForcedAligner-0.6B", "model_root"),
        directory_info("capswriter", "CapsWriter", settings.alignment_capswriter_root or settings.storage_root / "models" / "CapsWriter-Offline", "model_root"),
        directory_info("enhancement-runtime", "语音增强运行时", runtime_directory(settings.audio_enhancement_python), "runtime"),
        directory_info("deepfilternet3", "DeepFilterNet3", settings.deepfilternet3_root, "model_root"),
        directory_info("mossformer2", "MossFormer2", settings.mossformer2_se_root, "model_root"),
        directory_info("separation-runtime", "音频分轨运行时", runtime_directory(settings.audio_separation_python), "runtime"),
        directory_info("mdx-models", "MDX-Net 分轨模型", settings.audio_separation_root, "model_root"),
    ]
    return {
        "directories": directories
    }
