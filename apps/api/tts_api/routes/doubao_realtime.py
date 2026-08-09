"""Cloud realtime conversation backed by the existing Doubao web adapter.

Doubao's webpage socket completes one AAC response at a time.  A turn is thus
intentionally modelled as: global LLM reply -> one complete Doubao synthesis ->
audio URL.  This keeps cloud dialogue independent of local ASR/Vox GPU runtime
and avoids pretending that the upstream endpoint can stream PCM like Whispera.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from tts_api.adapters.doubao_web import DEFAULT_DOUBAO_VOICE, DoubaoWebAdapter
from tts_api.llm import DEFAULT_SYSTEM_PROMPT, chat_completion
from tts_api.schemas import SpeechRequest


router = APIRouter(prefix="/v1/doubao/realtime", tags=["doubao-realtime"])

MAX_HISTORY_MESSAGES = 16
MAX_MESSAGE_LENGTH = 8_000


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class DoubaoRealtimeTurnRequest(BaseModel):
    base_url: str = Field(min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=512)
    api_key: str = Field(default="", max_length=16384)
    system_prompt: str = Field(default=DEFAULT_SYSTEM_PROMPT, max_length=8192)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=512, ge=1, le=4096)
    messages: list[ConversationMessage] = Field(min_length=1, max_length=MAX_HISTORY_MESSAGES)
    voice_id: str = Field(default=DEFAULT_DOUBAO_VOICE, min_length=1, max_length=200)
    speech_rate: int = Field(default=0, ge=-50, le=100)
    pitch: int = Field(default=0, ge=-12, le=12)
    response_format: Literal["mp3", "wav"] = "mp3"


@router.post("/turn")
def generate_doubao_realtime_turn(request: DoubaoRealtimeTurnRequest) -> dict:
    messages = [
        {"role": "system", "content": request.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT},
        *[
            {"role": message.role, "content": message.text.strip()}
            for message in request.messages[-MAX_HISTORY_MESSAGES:]
            if message.text.strip()
        ],
    ]
    if not any(message["role"] == "user" for message in messages):
        raise HTTPException(status_code=422, detail="请先输入一句想说的话。")
    try:
        reply = chat_completion(
            base_url=request.base_url,
            model=request.model,
            api_key=request.api_key,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            timeout_seconds=90,
        )
        assistant_text = str(reply["content"]).strip()
        audio = DoubaoWebAdapter().synthesize(
            SpeechRequest(
                model="doubao-web",
                input=assistant_text,
                voice=request.voice_id,
                speed=max(0.25, min(4.0, 1 + request.speech_rate / 50)),
                pitch=request.pitch,
                response_format=request.response_format,
            )
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "assistantText": assistant_text,
        "audio": audio.model_dump(),
        "model": reply["model"],
    }
