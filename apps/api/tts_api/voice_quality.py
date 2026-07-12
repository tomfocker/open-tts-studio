from array import array
import sys
import wave
from pathlib import Path

from tts_api.schemas import VoiceInfo, VoiceQualityReport, VoiceQualityStatus


def inspect_voice_quality(voice: VoiceInfo, max_analysis_seconds: int = 30) -> VoiceQualityReport:
    report = VoiceQualityReport(voice_id=voice.id, reference_audio=voice.reference_audio)
    if not voice.reference_audio:
        return report.model_copy(update={"warnings": ["该音色没有参考音频，无法进行克隆质量检查。"]})

    path = Path(voice.reference_audio)
    if not path.is_file():
        return report.model_copy(
            update={
                "format": path.suffix.lstrip(".").lower() or None,
                "status": VoiceQualityStatus.error,
                "warnings": ["参考音频文件不存在或当前不可访问。"],
            }
        )

    suffix = path.suffix.lstrip(".").lower() or None
    base = {"exists": True, "format": suffix, "file_size_bytes": path.stat().st_size}
    if suffix != "wav":
        return report.model_copy(
            update={
                **base,
                "readable": None,
                "status": VoiceQualityStatus.warning,
                "warnings": ["当前只对 WAV 提供完整质量检查；建议转为 16 kHz 以上的单声道 WAV。"],
            }
        )

    try:
        with wave.open(str(path), "rb") as wav_file:
            sample_rate = wav_file.getframerate()
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            total_frames = wav_file.getnframes()
            duration_seconds = total_frames / sample_rate if sample_rate else 0.0
            analysis_frames = min(total_frames, max_analysis_seconds * sample_rate)
            raw = wav_file.readframes(analysis_frames)
    except (OSError, wave.Error) as exc:
        return report.model_copy(
            update={
                **base,
                "readable": False,
                "status": VoiceQualityStatus.error,
                "warnings": [f"无法读取 WAV 文件：{exc}"],
            }
        )

    warnings: list[str] = []
    silence_ratio = _estimate_silence_ratio(raw, sample_width, sample_rate, channels)
    if duration_seconds < 3:
        warnings.append("参考音频少于 3 秒，克隆稳定性可能不足。")
    elif duration_seconds > 90:
        warnings.append("参考音频超过 90 秒，建议裁剪到 6 至 30 秒的干净人声。")
    if sample_rate < 16000:
        warnings.append("采样率低于 16 kHz，建议使用更高质量的参考音频。")
    if channels > 1:
        warnings.append("参考音频为多声道，建议转为单声道以降低声道混入风险。")
    if silence_ratio is not None and silence_ratio > 0.55:
        warnings.append("检测到较多静音，建议裁剪前后空白与停顿。")
    if duration_seconds > max_analysis_seconds:
        warnings.append(f"静音检测仅分析了前 {max_analysis_seconds} 秒音频。")
    return report.model_copy(
        update={
            **base,
            "readable": True,
            "duration_seconds": duration_seconds,
            "sample_rate": sample_rate,
            "channels": channels,
            "analyzed_seconds": analysis_frames / sample_rate if sample_rate else 0.0,
            "silence_ratio": silence_ratio,
            "status": VoiceQualityStatus.warning if warnings else VoiceQualityStatus.ready,
            "warnings": warnings,
        }
    )


def _estimate_silence_ratio(raw: bytes, sample_width: int, sample_rate: int, channels: int) -> float | None:
    if not raw or sample_rate <= 0 or channels <= 0 or sample_width not in {1, 2, 3, 4}:
        return None
    frame_width = sample_width * channels
    window_frames = max(1, sample_rate // 10)
    window_bytes = window_frames * frame_width
    loudness_values = [
        _mean_absolute_amplitude(raw[offset : offset + window_bytes], sample_width)
        for offset in range(0, len(raw), window_bytes)
        if raw[offset : offset + window_bytes]
    ]
    if not loudness_values:
        return None
    threshold = max(80, int(max(loudness_values) * 0.025))
    return sum(value <= threshold for value in loudness_values) / len(loudness_values)


def _mean_absolute_amplitude(raw: bytes, sample_width: int) -> float:
    if sample_width == 1:
        samples = (value - 128 for value in raw)
    elif sample_width in {2, 4}:
        samples_array = array("h" if sample_width == 2 else "i")
        samples_array.frombytes(raw[: len(raw) - (len(raw) % sample_width)])
        if sys.byteorder != "little":
            samples_array.byteswap()
        samples = iter(samples_array)
    else:
        samples = (
            int.from_bytes(raw[index : index + 3], byteorder="little", signed=True)
            for index in range(0, len(raw) - (len(raw) % 3), 3)
        )
    total = 0
    count = 0
    for value in samples:
        total += abs(value)
        count += 1
    return total / count if count else 0.0
