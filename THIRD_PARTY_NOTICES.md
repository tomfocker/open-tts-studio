# Third-party notices

## Whispera realtime VAD state machine

`apps/api/tts_api/realtime_vad.py` and
`apps/api/tts_api/realtime_text_segmenter.py` are derived from
[maomao-2001/Whispera](https://github.com/maomao-2001/Whispera), commit
`6a14c7092b0d6ba9aead2c2365d981e01b8f99d3`, under the Apache License 2.0.
The original project license is retained at
`.research/Whispera/LICENSE` in the development research checkout.

## Silero VAD ONNX model

`models/realtime/silero_vad.onnx` is the VAD model artifact distributed by
Whispera from the upstream Silero VAD project. It is bundled for desktop
realtime use; preserve its upstream attribution and license terms when
redistributing the application.

## Whispera VoxCPM streaming module

`apps/api/vendor/whispera_voxcpm/src/voxcpm` is an unmodified vendored copy
of Whispera's minimal VoxCPM streaming module from commit
`6a14c7092b0d6ba9aead2c2365d981e01b8f99d3`. It remains under Apache License
2.0; its original license text is retained alongside the vendored source.

The isolated compatibility runtime also includes an unmodified copy of
`websockets` 16.0, under its BSD license, because the existing VoxCPM2
Python environment has no Uvicorn WebSocket backend. Its license text is
retained in `apps/api/vendor/whispera_voxcpm/support/licenses/`.
