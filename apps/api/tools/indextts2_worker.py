import argparse
import json
import os
from pathlib import Path
import sys
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def emit(message: dict) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persistent IndexTTS2 JSONL worker.")
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--max-text-tokens-per-segment", type=int, default=120)
    parser.add_argument("--fp16", action="store_true", default=False)
    parser.add_argument("--deepspeed", action="store_true", default=False)
    parser.add_argument("--cuda-kernel", action="store_true", default=False)
    return parser.parse_args()


def require_file(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} does not exist: {path}")


def load_model(args: argparse.Namespace):
    source_dir = Path(args.source_dir).resolve()
    model_dir = Path(args.model_dir).resolve()
    config_path = Path(args.config).resolve()

    require_file(source_dir / "indextts" / "infer_v2.py", "IndexTTS2 source")
    require_file(config_path, "IndexTTS2 config")
    for filename in ["bpe.model", "gpt.pth", "s2mel.pth", "wav2vec2bert_stats.pt"]:
        require_file(model_dir / filename, f"IndexTTS2 checkpoint {filename}")

    sys.path.insert(0, str(source_dir))
    sys.path.insert(0, str(source_dir / "indextts"))
    os.chdir(source_dir)

    from indextts.infer_v2 import IndexTTS2

    return IndexTTS2(
        model_dir=str(model_dir),
        cfg_path=str(config_path),
        use_fp16=args.fp16,
        use_deepspeed=args.deepspeed,
        use_cuda_kernel=args.cuda_kernel,
    )


def synthesize(tts, request: dict, default_max_tokens: int) -> Path:
    output_path = Path(request["output"]).resolve()
    prompt_audio = Path(request["prompt_audio"]).resolve()
    require_file(prompt_audio, "speaker reference audio")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    tts.infer(
        spk_audio_prompt=str(prompt_audio),
        text=request["text"],
        output_path=str(output_path),
        emo_audio_prompt=request.get("emotion_audio"),
        emo_alpha=float(request.get("emotion_alpha", 1.0)),
        use_emo_text=bool(request.get("emotion_text")),
        emo_text=request.get("emotion_text"),
        use_random=bool(request.get("emotion_random", False)),
        verbose=bool(request.get("verbose", False)),
        max_text_tokens_per_segment=int(request.get("max_text_tokens_per_segment") or default_max_tokens),
    )
    return output_path


def main() -> int:
    args = parse_args()
    try:
        tts = load_model(args)
        emit({"type": "ready"})
        for line in sys.stdin:
            if not line.strip():
                continue
            request = json.loads(line)
            if request.get("type") == "shutdown":
                emit({"type": "shutdown"})
                return 0
            if request.get("type") != "synthesize":
                emit({"type": "error", "message": f"Unsupported worker command: {request.get('type')}"})
                continue
            output_path = synthesize(tts, request, args.max_text_tokens_per_segment)
            emit({"type": "result", "output_path": str(output_path)})
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
