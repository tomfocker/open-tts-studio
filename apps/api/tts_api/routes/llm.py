from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from tts_api.llm import DEFAULT_SYSTEM_PROMPT, chat_completion, parse_json_content


router = APIRouter(prefix="/v1/llm", tags=["llm"])


VOICE_PROMPT_POLISH_INSTRUCTION = (
    "你是 OpenTTS Studio 的专业语音设计提示词编辑。用户只会给出几个关键词，"
    "请把它们整理成适用于指定语音模型的中文控制提示词。保留用户明确表达的性别、年龄、"
    "音色、情绪、语速和角色设定，不编造具体人物、经历或品牌。根据目标模型和生成模式"
    "选择模型能理解的自然描述，避免 Markdown、标签和解释性前缀。"
    "只输出 JSON，不要 Markdown 代码围栏，字段必须为：prompt（单段可直接用于模型的提示词）、"
    "summary（不超过 30 字的概括）、suggestions（最多 3 条简短可选建议）。"
)


TEXT_TRANSFORM_INSTRUCTIONS = {
    "rewrite_script": (
        "把文本改写成自然、顺口、适合 TTS 直接朗读的中文配音稿。保持事实、数字和核心意思，"
        "不添加没有依据的信息；修复明显病句，合理处理口语停顿；只输出改写后的正文。"
    ),
    "proofread": (
        "校对 ASR 转写文本，修正明显的错字、漏字、重复、标点和断句问题。尽量保持原意、"
        "专有名词、时间数字和说话人的语气；无法确定的内容不要凭空补写，只输出校对后的正文。"
    ),
    "summarize": (
        "总结文本的核心内容，保留关键人物、事件、结论和时间。用简洁清晰的中文输出，"
        "不要输出分析过程、标题、Markdown 或文本之外的推断。"
    ),
    "translate": (
        "保留专有名词、数字、时间和原文事实，表达自然。"
        "不要附加解释、译者说明或 Markdown，只输出译文正文。"
    )
}


class LlmRequest(BaseModel):
    base_url: str = Field(min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=512)
    api_key: str = Field(default="", max_length=16384)
    system_prompt: str = Field(default=DEFAULT_SYSTEM_PROMPT, max_length=16384)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=512, ge=1, le=8192)


class LlmTestRequest(LlmRequest):
    pass


class PolishPromptRequest(LlmRequest):
    keywords: str = Field(min_length=1, max_length=4000)
    model_name: str = Field(default="VoxCPM2", max_length=120)
    mode: str = Field(default="音色设计", max_length=80)


class TextTransformRequest(LlmRequest):
    operation: str = Field(pattern="^(rewrite_script|proofread|summarize|translate)$")
    text: str = Field(min_length=1, max_length=50000)
    target_language: str = Field(default="中文", max_length=40)
    style: str = Field(default="自然、适合直接朗读", max_length=240)


@router.get("/status")
def llm_status() -> dict[str, str]:
    return {"protocol": "openai-compatible", "status": "ready"}


@router.post("/test")
def test_llm(request: LlmTestRequest) -> dict:
    try:
        result = chat_completion(
            base_url=request.base_url,
            model=request.model,
            api_key=request.api_key,
            messages=[
                {"role": "system", "content": request.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT},
                {"role": "user", "content": "只回复：连接成功"},
            ],
            temperature=0,
            max_tokens=16,
            timeout_seconds=30,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True, "model": result["model"], "reply": result["content"]}


@router.post("/polish-prompt")
def polish_prompt(request: PolishPromptRequest) -> dict:
    user_content = f"目标模型：{request.model_name}\n生成模式：{request.mode}\n用户关键词：{request.keywords.strip()}"
    try:
        result = chat_completion(
            base_url=request.base_url,
            model=request.model,
            api_key=request.api_key,
            messages=[
                {"role": "system", "content": VOICE_PROMPT_POLISH_INSTRUCTION},
                {"role": "user", "content": user_content},
            ],
            temperature=request.temperature,
            max_tokens=max(request.max_tokens, 256),
            timeout_seconds=90,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    parsed = parse_json_content(result["content"])
    if not parsed:
        parsed = {"prompt": result["content"], "summary": "已根据关键词整理", "suggestions": []}
    prompt = str(parsed.get("prompt") or result["content"]).strip()
    summary = str(parsed.get("summary") or "已根据关键词整理").strip()
    raw_suggestions = parsed.get("suggestions")
    suggestions = [str(item).strip() for item in raw_suggestions if str(item).strip()][:3] if isinstance(raw_suggestions, list) else []
    return {"prompt": prompt, "summary": summary, "suggestions": suggestions, "model": result["model"]}


@router.post("/transform-text")
def transform_text(request: TextTransformRequest) -> dict:
    instruction = TEXT_TRANSFORM_INSTRUCTIONS[request.operation]
    if request.operation == "translate":
        instruction = f"把文本翻译成{request.target_language}。{instruction}"
    system = f"你是 OpenTTS Studio 的文本处理助手。{instruction}"
    if request.style.strip() and request.operation == "rewrite_script":
        system += f"\n额外风格要求：{request.style.strip()}。"
    try:
        result = chat_completion(
            base_url=request.base_url,
            model=request.model,
            api_key=request.api_key,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": request.text.strip()},
            ],
            temperature=request.temperature,
            max_tokens=max(request.max_tokens, 1024 if request.operation in {"translate", "rewrite_script"} else 512),
            timeout_seconds=120,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"text": result["content"], "operation": request.operation, "target_language": request.target_language, "model": result["model"]}
