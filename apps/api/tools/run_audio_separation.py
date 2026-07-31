"""Run local UVR-compatible MDX/MDXC models without any network access.

The ``audio-separator`` package provides the well-tested STFT/windowing and
ONNX inference pipeline.  Its stock model loader normally contacts a model
registry, even when the ONNX file already exists locally.  This small worker
instead supplies the UVR metadata alongside the selected local model, so media
never leaves the computer and a model selection cannot cause a surprise weight
download.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path


def _uvr_model_hash(path: Path) -> str:
    """Use the same final-10-MiB fingerprint that UVR uses for MDX models."""

    byte_count = 10_000 * 1024
    with path.open("rb") as handle:
        if path.stat().st_size > byte_count:
            handle.seek(-byte_count, 2)
        return hashlib.md5(handle.read()).hexdigest()


def _read_mdx_model_data(model_file: Path, model_data_file: Path) -> dict:
    try:
        data = json.loads(model_data_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("无法读取本地 MDX-Net 模型参数文件。") from exc
    entry = data.get(_uvr_model_hash(model_file))
    if not isinstance(entry, dict):
        raise RuntimeError("所选 MDX-Net 权重没有匹配的本地 UVR 参数，无法安全推理。")
    return entry


def _select_onnx_provider(requested_device: str) -> list[str]:
    import onnxruntime as ort

    providers = set(ort.get_available_providers())
    if requested_device == "cpu":
        return ["CPUExecutionProvider"]
    if "CUDAExecutionProvider" in providers:
        return ["CUDAExecutionProvider"]
    # DirectML is a useful fully-local fallback on Windows.  It is selected
    # directly instead of relying on audio-separator's optional torch-directml
    # integration, because MDX-Net itself only needs ONNX Runtime.
    if "DmlExecutionProvider" in providers:
        return ["DmlExecutionProvider"]
    return ["CPUExecutionProvider"]


def run_mdx_net(
    source: Path,
    output_dir: Path,
    model_file: Path,
    model_data_file: Path,
    device: str,
) -> dict[str, str]:
    from audio_separator.separator import Separator

    output_dir.mkdir(parents=True, exist_ok=True)
    model_data = _read_mdx_model_data(model_file, model_data_file)
    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=str(model_file.parent),
        output_dir=str(output_dir),
        output_format="WAV",
        use_soundfile=True,
        mdx_params={
            "hop_length": 1024,
            "segment_size": 256,
            "overlap": 0.25,
            "batch_size": 1,
            "enable_denoise": False,
        },
    )
    # ``audio-separator`` normally fetches a model list and metadata from the
    # Internet.  Limit it to the supplied local file and metadata instead.
    separator.list_supported_model_files = lambda: {
        "MDX": {
            "OpenTTS local MDX-Net": {
                "filename": model_file.name,
                "download_files": [model_file.name],
            }
        }
    }
    separator.load_model_data_using_hash = lambda _path: model_data
    separator.onnx_execution_provider = _select_onnx_provider(device)
    separator.load_model(model_file.name)
    generated = separator.separate(
        str(source),
        custom_output_names={"Vocals": "vocals", "Instrumental": "instrumental"},
    )

    stems: dict[str, str] = {}
    for file_name in generated:
        path = output_dir / file_name
        if not path.is_file() or path.stat().st_size <= 0:
            continue
        normalized = path.stem.lower()
        if normalized == "vocals":
            stems["vocals"] = str(path)
        elif normalized == "instrumental":
            stems["instrumental"] = str(path)
    if set(stems) != {"vocals", "instrumental"}:
        raise RuntimeError("MDX-Net 未生成完整的人声与伴奏两条音轨。")
    return stems


def run_mdx23c(
    source: Path,
    output_dir: Path,
    model_file: Path,
    model_config_file: Path,
) -> dict[str, str]:
    """Run the local MDX23C checkpoint with its matching UVR YAML config."""

    from audio_separator.separator import Separator

    output_dir.mkdir(parents=True, exist_ok=True)
    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=str(model_file.parent),
        output_dir=str(output_dir),
        output_format="WAV",
        use_soundfile=True,
        mdxc_params={
            "segment_size": 256,
            "override_model_segment_size": False,
            "batch_size": 1,
            "overlap": 8,
            "pitch_shift": 0,
        },
    )
    # MDXC has a model-specific YAML configuration.  Supplying its absolute
    # local path lets audio-separator use the checkpoint without contacting
    # its model registry or downloading a second config file.
    separator.list_supported_model_files = lambda: {
        "MDXC": {
            "OpenTTS local MDX23C": {
                "filename": model_file.name,
                "download_files": [model_file.name, str(model_config_file)],
            }
        }
    }
    separator.load_model(model_file.name)
    generated = separator.separate(
        str(source),
        custom_output_names={"Vocals": "vocals", "Instrumental": "instrumental"},
    )
    return _collect_two_stems(output_dir, generated, "MDX23C")


def _collect_two_stems(output_dir: Path, generated: list[str], model_name: str) -> dict[str, str]:
    """Verify audio-separator wrote both expected stems inside this job folder."""

    stems: dict[str, str] = {}
    for file_name in generated:
        path = output_dir / file_name
        if not path.is_file() or path.stat().st_size <= 0:
            continue
        normalized = path.stem.lower()
        if normalized == "vocals":
            stems["vocals"] = str(path)
        elif normalized == "instrumental":
            stems["instrumental"] = str(path)
    if set(stems) != {"vocals", "instrumental"}:
        raise RuntimeError(f"{model_name} 未生成完整的人声与伴奏两条音轨。")
    return stems


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenTTS local MDX/MDXC separation worker")
    parser.add_argument("--backend", choices=("mdx", "mdxc"), required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model-file", required=True)
    parser.add_argument("--model-config", required=True)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.input)
    model_file = Path(args.model_file)
    model_config = Path(args.model_config)
    if not source.is_file():
        raise RuntimeError("受控输入音频不存在。")
    if not model_file.is_file() or not model_config.is_file():
        raise RuntimeError("本地分轨模型或参数文件不完整。")
    if args.backend == "mdx":
        stems = run_mdx_net(source, Path(args.output_dir), model_file, model_config, args.device)
    else:
        stems = run_mdx23c(source, Path(args.output_dir), model_file, model_config)
    print(json.dumps({"stems": stems}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Audio separation failed: {exc}", flush=True)
        raise SystemExit(1)
