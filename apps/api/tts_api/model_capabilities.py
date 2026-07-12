from pathlib import Path

from tts_api.schemas import ModelInfo, SpeechRequest


def validate_speech_request_capabilities(model: ModelInfo, request: SpeechRequest) -> None:
    """Validate only the request surface exposed by this stable adapter."""
    capabilities = set(model.request_capabilities)

    if request.response_format.lower() != "wav":
        raise ValueError("当前本地后端只支持 WAV 输出。")
    if request.stream:
        raise ValueError("当前本地后端尚未提供流式音频响应。")
    if request.voice:
        raise ValueError("当前稳定适配器不支持 voice 参数，请改用 reference_audio。")
    if model.requires_reference_audio and not request.reference_audio:
        raise ValueError(f"{model.display_name} 必须提供 reference_audio。")

    _require_capability(model, request.reference_audio, "reference_audio", capabilities)
    _require_capability(model, request.reference_text, "reference_text", capabilities)
    _require_capability(model, request.emotion, "control_prompt", capabilities, parameter="emotion")
    _require_capability(model, request.voice_prompt, "voice_prompt", capabilities)
    if request.speed != 1.0:
        _require_capability(model, request.speed, "speed", capabilities)

    if request.reference_audio:
        reference_path = Path(request.reference_audio)
        if not reference_path.is_file():
            raise ValueError("reference_audio 必须是可访问的本地音频文件。")


def _require_capability(
    model: ModelInfo,
    value: object | None,
    capability: str,
    capabilities: set[str],
    parameter: str | None = None,
) -> None:
    if value is None or value == "":
        return
    if capability not in capabilities:
        name = parameter or capability
        raise ValueError(f"{model.display_name} 当前稳定适配器不支持参数：{name}。")
