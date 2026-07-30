"""Streaming text segmenter reused from Whispera.

Source: maomao-2001/Whispera, commit 6a14c7092b0d6ba9aead2c2365d981e01b8f99d3
License: Apache-2.0 (see THIRD_PARTY_NOTICES.md).
"""

from __future__ import annotations


class StreamingTextSegmenter:
    """Cut incremental LLM text into TTS-friendly sentence chunks."""

    def __init__(self, hard_limit: int = 160):
        self.hard_limit = hard_limit
        self.buffer = ""
        self.sentence_punct = set(".!?。！？")

    def feed(self, text_delta: str) -> list[str]:
        chunks: list[str] = []
        if not text_delta:
            return chunks
        for char in text_delta:
            self.buffer += char
            if char in self.sentence_punct:
                chunk = self._flush()
                if chunk:
                    chunks.append(chunk)
            elif len(self.buffer.strip()) >= self.hard_limit:
                chunk = self._flush_word_safe()
                if chunk:
                    chunks.append(chunk)
        return chunks

    def flush(self) -> str:
        return self._flush()

    def reset(self) -> None:
        self.buffer = ""

    def _flush(self) -> str:
        value = self.buffer.strip()
        self.buffer = ""
        return value

    def _flush_word_safe(self) -> str:
        stripped = self.buffer.strip()
        cut = stripped.rfind(" ")
        if cut <= 0:
            self.buffer = ""
            return stripped
        head = stripped[:cut].strip()
        self.buffer = stripped[cut + 1 :]
        return head
