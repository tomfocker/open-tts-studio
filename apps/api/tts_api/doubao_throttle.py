from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar


T = TypeVar("T")


class DoubaoRequestThrottler:
    """Serialize request admission and reproduce the upstream delay policy.

    Only request starts are serialized. The WebSocket request itself runs after
    the admission lock is released, so slow synthesis does not block unrelated
    result processing while still keeping every entry point on one delay clock.
    """

    def __init__(
        self,
        *,
        sleeper: Callable[[float], None] = time.sleep,
        random_value: Callable[[], float] = random.random,
    ) -> None:
        self._sleep = sleeper
        self._random = random_value
        self._lock = threading.Lock()
        self._has_started_request = False
        self._round_delay_pending = False

    @staticmethod
    def _seconds(value: float | int | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(float(value), 60.0))

    def admit(
        self,
        select_request: Callable[[], tuple[T, bool]],
        *,
        interval_seconds: float,
        round_delay_seconds: float,
    ) -> T:
        """Wait, select a request identity, and atomically schedule round delay.

        ``select_request`` returns ``(value, completed_cookie_round)``. A round
        completed by this selection is deliberately delayed on the *next*
        request, matching the original service.
        """

        interval = self._seconds(interval_seconds)
        round_delay = self._seconds(round_delay_seconds)
        with self._lock:
            if self._has_started_request and interval:
                self._sleep(interval * (0.8 + self._random() * 0.5))
            if self._round_delay_pending and round_delay:
                self._round_delay_pending = False
                self._sleep(round_delay * (1.0 + self._random() * 0.3))
            else:
                self._round_delay_pending = False

            value, completed_round = select_request()
            if value is not None:
                self._has_started_request = True
            if completed_round:
                self._round_delay_pending = True
            return value


_registry_lock = threading.Lock()
_throttlers: dict[str, DoubaoRequestThrottler] = {}


def get_doubao_request_throttler(cookie_file: Path) -> DoubaoRequestThrottler:
    key = str(Path(cookie_file).resolve())
    with _registry_lock:
        throttler = _throttlers.get(key)
        if throttler is None:
            throttler = DoubaoRequestThrottler()
            _throttlers[key] = throttler
        return throttler


def reset_doubao_request_throttlers() -> None:
    with _registry_lock:
        _throttlers.clear()
