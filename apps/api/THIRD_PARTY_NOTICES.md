# Third-party notices

## Whispera realtime VAD state machine

`tts_api/realtime_vad.py` and `tts_api/realtime_text_segmenter.py` are derived from
[maomao-2001/Whispera](https://github.com/maomao-2001/Whispera), commit
`6a14c7092b0d6ba9aead2c2365d981e01b8f99d3`, under Apache License 2.0.

## Whispera VoxCPM streaming module

`vendor/whispera_voxcpm/src/voxcpm` is an unmodified vendored copy of
Whispera's minimal VoxCPM streaming module from the same commit. OpenTTS
launches its existing `voxcpm.streaming_service` in the isolated VoxCPM2
runtime; the original Apache License 2.0 text is retained at
`vendor/whispera_voxcpm/LICENSE`.

The small `vendor/whispera_voxcpm/support/websockets` runtime is an
unmodified copy of `websockets` 16.0, used only because the existing VoxCPM2
runtime lacks Uvicorn WebSocket support. Its BSD license is retained at
`vendor/whispera_voxcpm/support/licenses/websockets-LICENSE`.

## Silero VAD ONNX model

`models/realtime/silero_vad.onnx` is the VAD model artifact distributed by
Whispera from the upstream Silero VAD project. It is included to make the
desktop realtime feature self-contained. Preserve the upstream model
attribution and license terms when redistributing this asset.
