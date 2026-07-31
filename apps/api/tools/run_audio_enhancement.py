"""Run one optional local speech-enhancement model in its own Python runtime.

This script is intentionally dependency-free until a backend is selected.  The
desktop API can therefore keep PyTorch, ClearVoice and DeepFilterNet out of its
core runtime and launch this only after the user has installed an enhancement
environment.  Input and output paths come exclusively from the API's managed
work directories.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _configure_device(device: str) -> None:
    if device == "cpu":
        # Must happen before importing torch so both upstream packages honour
        # an explicit CPU request on a CUDA-capable computer.
        os.environ["CUDA_VISIBLE_DEVICES"] = ""


def run_deepfilternet(source: Path, destination: Path, model_dir: Path, preset: str) -> None:
    # DeepFilterLib, the native extension used by the Python package, does not
    # publish Windows wheels.  The upstream project does publish an equivalent
    # Windows ``deep-filter`` binary, which consumes the ONNX export of the
    # DeepFilterNet3 model.  Prefer that fully local path when the optional
    # files are placed beside the normal config/checkpoint package.
    executable_name = "deep-filter.exe" if os.name == "nt" else "deep-filter"
    executable = model_dir / executable_name
    model_archive = model_dir / "DeepFilterNet3_onnx.tar.gz"
    if executable.is_file() and model_archive.is_file():
        with tempfile.TemporaryDirectory(prefix="open-tts-deepfilter-") as temporary:
            temporary_dir = Path(temporary)
            command = [
                str(executable),
                "--model",
                str(model_archive),
                "--compensate-delay",
                "--output-dir",
                str(temporary_dir),
            ]
            if preset == "strong":
                command.append("--pf")
            if preset == "light":
                command.extend(("--atten-lim-db", "8"))
            command.append(str(source))
            completed = subprocess.run(command, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
            generated = temporary_dir / source.name
            if completed.returncode != 0 or not generated.is_file():
                detail = (completed.stderr or completed.stdout).strip()
                raise RuntimeError(f"DeepFilterNet3 Windows backend failed: {detail or 'no output WAV was written.'}")
            shutil.copyfile(generated, destination)
        return

    from df.enhance import enhance, init_df
    from df.io import load_audio, resample, save_audio

    post_filter = preset == "strong"
    attenuation_limit = {"light": 8, "standard": None, "strong": None}[preset]
    model, df_state, _suffix = init_df(
        str(model_dir),
        post_filter=post_filter,
        log_level="ERROR",
        log_file=None,
        config_allow_defaults=True,
    )
    audio, metadata = load_audio(str(source), df_state.sr, "cpu")
    enhanced = enhance(model, df_state, audio, pad=True, atten_lim_db=attenuation_limit)
    if metadata.sample_rate != df_state.sr:
        enhanced = resample(enhanced, df_state.sr, metadata.sample_rate)
    save_audio(str(destination), enhanced, sr=metadata.sample_rate, log=False)


def run_mossformer2(source: Path, destination: Path, model_dir: Path) -> None:
    # ClearVoice's public wrapper hard-codes a relative checkpoint directory.
    # Constructing its documented network class after setting checkpoint_dir
    # lets OpenTTS use the user-selected model package without modifying vendor
    # files or triggering an automatic network download.
    from clearvoice.network_wrapper import network_wrapper
    from clearvoice.networks import CLS_MossFormer2_SE_48K

    wrapper = network_wrapper()
    wrapper.model_name = "MossFormer2_SE_48K"
    wrapper.load_args_se()
    wrapper.args.checkpoint_dir = str(model_dir)
    # ``load_args_se`` is a lower-level helper in current ClearVoice releases;
    # unlike the public task dispatcher it does not populate these two fields.
    # The MossFormer2 wrapper reads ``task`` while constructing the network.
    wrapper.args.task = "speech_enhancement"
    wrapper.args.network = wrapper.model_name
    model = CLS_MossFormer2_SE_48K(wrapper.args)
    with tempfile.TemporaryDirectory(prefix="open-tts-mossformer-") as temporary:
        temporary_dir = Path(temporary)
        model.process(str(source), online_write=True, output_path=str(temporary_dir))
        generated = temporary_dir / model.name / source.name
        if not generated.is_file():
            raise RuntimeError("MossFormer2_SE_48K did not produce an output WAV file.")
        shutil.copyfile(generated, destination)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenTTS local audio-enhancement worker")
    parser.add_argument("--backend", choices=("deepfilternet3", "mossformer2-se-48k"), required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--preset", choices=("light", "standard", "strong"), default="standard")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.input)
    destination = Path(args.output)
    model_dir = Path(args.model_dir)
    if not source.is_file():
        raise RuntimeError("Managed input WAV is missing.")
    if not model_dir.is_dir():
        raise RuntimeError("Configured model directory is missing.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    _configure_device(args.device)
    if args.backend == "deepfilternet3":
        run_deepfilternet(source, destination, model_dir, args.preset)
    else:
        run_mossformer2(source, destination, model_dir)
    if not destination.is_file() or destination.stat().st_size <= 0:
        raise RuntimeError("Enhancement worker did not write a valid output file.")
    print(json.dumps({"output": str(destination)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Audio enhancement failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
