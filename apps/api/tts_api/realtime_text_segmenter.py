"""Streaming text segmenter reused from Whispera.

Source: maomao-2001/Whispera, commit 6a14c7092b0d6ba9aead2c2365d981e01b8f99d3
License: Apache-2.0 (see THIRD_PARTY_NOTICES.md).
"""

from __future__ import annotations


class StreamingTextSegmenter:
    """Cut incremental LLM text into natural, TTS-friendly sentence chunks.

    ``min_chunk_chars`` is deliberately optional. The upstream Whispera
    behaviour (emit on every sentence punctuation) stays available to callers
    that value latency over cadence, while realtime conversation can merge
    short acknowledgements into a more natural spoken phrase.
    """

    def __init__(
        self,
        hard_limit: int = 160,
        *,
        min_chunk_chars: int = 1,
        preferred_chunk_chars: int = 48,
    ):
        self.hard_limit = max(1, hard_limit)
        self.min_chunk_chars = min(max(1, min_chunk_chars), self.hard_limit)
        self.preferred_chunk_chars = min(max(self.min_chunk_chars, preferred_chunk_chars), self.hard_limit)
        self.buffer = ""
        self.sentence_punct = set(".!?。！？")
        self.soft_punct = set(",，、;；:：")

    def feed(self, text_delta: str) -> list[str]:
        chunks: list[str] = []
        if not text_delta:
            return chunks
        for char in text_delta:
            self.buffer += char
            buffered_length = len(self.buffer.strip())
            if char in self.sentence_punct and buffered_length >= self.min_chunk_chars:
                chunk = self._flush()
                if chunk:
                    chunks.append(chunk)
            elif buffered_length >= self.preferred_chunk_chars:
                # A comma is a good fallback only after we have accumulated a
                # meaningful phrase. This prevents LLMs that omit full stops
                # from holding a reply until the hard limit, without turning
                # every small pause into a separate TTS request.
                chunk = self._flush_soft_boundary()
                if chunk:
                    chunks.append(chunk)
                elif buffered_length >= self.hard_limit:
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

    def _flush_soft_boundary(self) -> str:
        stripped = self.buffer.strip()
        cut = max((stripped.rfind(punctuation) for punctuation in self.soft_punct), default=-1)
        # Do not emit a short prefix just because it happens to end in a
        # comma. Keeping it lets the next short sentence join naturally.
        if cut + 1 < self.min_chunk_chars:
            return ""
        head = stripped[: cut + 1].strip()
        self.buffer = stripped[cut + 1 :]
        return head
