import argparse
import os
from pathlib import Path
import sys
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run IndexTTS2 inference without starting Gradio.")
    parser.add_argument("--source-dir", required=True, help="Path to the Index-TTS source directory")
    parser.add_argument("--model-dir", required=True, help="Path to the IndexTTS2 checkpoints directory")
    parser.add_argument("--config", required=True, help="Path to config.yaml")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--prompt-audio", required=True, help="Speaker reference audio path")
    parser.add_argument("--output", required=True, help="Output wav path")
    parser.add_argument("--emotion-audio", default=None, help="Optional emotion reference audio path")
    parser.add_argument("--emotion-alpha", type=float, default=1.0, help="Emotion reference blend weight")
    parser.add_argument("--emotion-text", default=None, help="Optional emotion description text")
    parser.add_argument("--emotion-random", action="store_true", help="Use random emotion sampling")
    parser.add_argument("--max-text-tokens-per-segment", type=int, default=120)
    parser.add_argument("--fp16", action="store_true", default=False)
    parser.add_argument("--deepspeed", action="store_true", default=False)
    parser.add_argument("--cuda-kernel", action="store_true", default=False)
    parser.add_argument("--verbose", action="store_true", default=False)
    return parser.parse_args()


def require_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} does not exist: {path}")


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source_dir).resolve()
    model_dir = Path(args.model_dir).resolve()
    config_path = Path(args.config).resolve()
    prompt_audio = Path(args.prompt_audio).resolve()
    output_path = Path(args.output).resolve()

    require_file(source_dir / "indextts" / "infer_v2.py", "IndexTTS2 source")
    require_file(config_path, "IndexTTS2 config")
    require_file(prompt_audio, "speaker reference audio")
    for filename in ["bpe.model", "gpt.pth", "s2mel.pth", "wav2vec2bert_stats.pt"]:
        require_file(model_dir / filename, f"IndexTTS2 checkpoint {filename}")

    sys.path.insert(0, str(source_dir))
    sys.path.insert(0, str(source_dir / "indextts"))
    os.chdir(source_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    from indextts.infer_v2 import IndexTTS2

    tts = IndexTTS2(
        model_dir=str(model_dir),
        cfg_path=str(config_path),
        use_fp16=args.fp16,
        use_deepspeed=args.deepspeed,
        use_cuda_kernel=args.cuda_kernel,
    )
    tts.infer(
        spk_audio_prompt=str(prompt_audio),
        text=args.text,
        output_path=str(output_path),
        emo_audio_prompt=args.emotion_audio,
        emo_alpha=args.emotion_alpha,
        use_emo_text=bool(args.emotion_text),
        emo_text=args.emotion_text,
        use_random=args.emotion_random,
        verbose=args.verbose,
        max_text_tokens_per_segment=args.max_text_tokens_per_segment,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
