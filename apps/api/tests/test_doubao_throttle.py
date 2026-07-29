from tts_api.doubao_throttle import DoubaoRequestThrottler


def test_shared_throttler_applies_interval_jitter_and_next_request_round_delay():
    waits = []
    throttler = DoubaoRequestThrottler(sleeper=waits.append, random_value=lambda: 0.0)

    assert throttler.admit(
        lambda: ("cookie-1", True),
        interval_seconds=2,
        round_delay_seconds=5,
    ) == "cookie-1"
    assert waits == []

    assert throttler.admit(
        lambda: ("cookie-2", False),
        interval_seconds=2,
        round_delay_seconds=5,
    ) == "cookie-2"
    assert waits == [1.6, 5.0]


def test_throttler_clamps_delays_and_does_not_delay_first_request():
    waits = []
    throttler = DoubaoRequestThrottler(sleeper=waits.append, random_value=lambda: 1.0)

    throttler.admit(lambda: ("first", False), interval_seconds=999, round_delay_seconds=999)
    throttler.admit(lambda: ("second", False), interval_seconds=999, round_delay_seconds=999)

    assert waits == [78.0]
