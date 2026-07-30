# Vendored Whispera VoxCPM streaming module

This directory contains the `src/voxcpm` runtime module copied from
`maomao-2001/Whispera` at commit
`6a14c7092b0d6ba9aead2c2365d981e01b8f99d3`.

It is kept as an isolated upstream copy so OpenTTS can launch Whispera's
existing `voxcpm.streaming_service` in the VoxCPM2 model runtime. OpenTTS
does not modify the model inference implementation. The surrounding adapter
only supplies paths, lifecycle management, and protocol conversion.

License: Apache License 2.0. The upstream license text is retained in
[`LICENSE`](./LICENSE).

## WebSocket runtime support

`support/websockets` is an unmodified copy of the pure-Python `websockets`
16.0 runtime. The existing VoxCPM2 Python environment does not include a
WebSocket implementation for Uvicorn; this isolated support directory lets
the upstream service run without mutating a user-managed model package. Its
BSD license is retained at `support/licenses/websockets-LICENSE`.
