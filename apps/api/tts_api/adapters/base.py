from abc import ABC, abstractmethod

from tts_api.schemas import SpeechRequest, SpeechResult


class TtsAdapter(ABC):
    @abstractmethod
    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        raise NotImplementedError

    def health(self) -> dict[str, object]:
        return {"status": "ok"}
