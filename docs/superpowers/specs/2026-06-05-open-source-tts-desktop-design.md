# Open Source TTS Desktop Design

Date: 2026-06-05

## Objective

Build a PC desktop application that aggregates mainstream open-source or open-weight TTS models, lets users generate speech with one-click workflows, and exposes a stable local API for other applications.

The product should feel like a TTS-focused version of Ollama or LM Studio: simple model install, local inference, voice/preset management, generation history, and a predictable localhost API.

## Scope

The first version should focus on local model orchestration, not cloud-provider aggregation.

In scope:

- Desktop UI for model install, model launch, text input, reference audio, voice design, emotion/style controls, batch generation, history, and output export.
- Local API gateway with OpenAI-compatible speech endpoint plus TTS-specific extensions.
- Model adapters for a small number of high-value models.
- Per-model isolated runtime environments to avoid dependency conflicts.
- Model/source metadata, license notes, hardware guidance, and health checks.

Out of scope for v1:

- Paid SaaS proxy or centralized inference service.
- Model training as a first-class workflow, except GPT-SoVITS fine-tuning launcher if it is easy to expose.
- Marketplace payment, team accounts, cloud sync, or hosted voice assets.
- Full support for every open-source TTS model.

## Recommended MVP Models

### P0: Launch Models

1. VoxCPM2
   - Source: https://github.com/OpenBMB/VoxCPM
   - Why: strong current momentum, 2B model, multilingual, voice design, controllable cloning, 48kHz output, streaming, Apache-2.0.
   - Product role: flagship high-quality local model.
   - Notes: repository documents Python API, CLI, streaming, Nano-vLLM, and vLLM-Omni OpenAI-compatible serving.

2. Qwen3-TTS
   - Source: https://github.com/QwenLM/Qwen3-TTS
   - Why: open-source Alibaba/Qwen model series, 0.6B and 1.7B variants, 10 major languages, voice design, custom voice, voice clone, streaming, Apache-2.0.
   - Product role: core Chinese and multilingual model with strong ecosystem support.
   - Notes: fresh isolated Python environment is recommended by upstream.

3. IndexTTS2
   - Source: https://github.com/index-tts/index-tts
   - Why: strong zero-shot TTS, emotion control, duration-control direction, useful for video dubbing and expressive Chinese/English voice generation.
   - Product role: expressive dubbing and emotion-control model.
   - License/commercial note: upstream points commercial usage and cooperation inquiries to indexspeech@bilibili.com. Treat as "research/personal by default" until license is reviewed.

4. CosyVoice 3
   - Source: https://github.com/FunAudioLLM/CosyVoice
   - Why: multilingual, Chinese dialects, zero-shot voice cloning, pronunciation inpainting, streaming, instruction control, Apache-2.0 codebase.
   - Product role: production-friendly Chinese/multilingual model with dialect support.

5. F5-TTS
   - Source: https://github.com/SWivid/F5-TTS
   - Why: mature, popular, easy to install as a package, strong voice-cloning workflow, Docker support, broad community usage.
   - Product role: stable baseline model and lower-complexity adapter.
   - License/commercial note: upstream says code is MIT but pretrained models are CC-BY-NC. Treat pretrained weights as non-commercial unless replaced with commercially licensed weights.

6. GPT-SoVITS
   - Source: https://github.com/RVC-Boss/GPT-SoVITS
   - Why: mature creator ecosystem, Windows-friendly integrated package, zero-shot/few-shot voice cloning, WebUI tools, MIT.
   - Product role: creator workflow, voice dataset prep, and fine-tuning-friendly path.

### P1: Add After MVP

- Fish Speech / Fish Audio S2: strong quality and multilingual cloning, but license and commercial terms should be handled carefully.
- Chatterbox: useful lightweight cloning/emotion model, good for English and multilingual experiments.
- Dia: useful for English dialogue and podcast-like multi-speaker generation.
- VibeVoice: useful for long-form and multi-speaker generation.
- MOSS-TTS: worth watching for long-form spoken-dialogue generation.
- Kokoro: very small and useful as CPU/low-spec fallback, though not a large TTS model.

## Product Architecture

Use four layers:

1. Desktop shell
   - Recommended stack: Tauri or Electron.
   - Responsibilities: UI, settings, file picker, output playback, model library, logs, task list, and API service status.
   - Recommendation: Tauri if the priority is a lighter Windows app; Electron if fastest frontend development and broad plugin ecosystem matter more.

2. Local API gateway
   - Recommended stack: FastAPI.
   - Responsibilities: stable public API, request validation, job queue, model routing, output file management, streaming bridge, and error normalization.
   - Runs on localhost by default.

3. Model worker layer
   - One worker process per active model.
   - Workers expose a small internal protocol: load, unload, synthesize, synthesize_stream, clone/prepare voice, list capabilities, health.
   - Each worker owns its own Python environment or packaged runtime.

4. Model store
   - Stores downloaded model weights, runtime environments, voice assets, presets, history, logs, and generated audio.
   - Supports Hugging Face, ModelScope, direct git, and local model import.

## Runtime Isolation

Runtime isolation is the key technical decision.

Recommended v1 policy:

- Use one isolated environment per model family.
- Prefer uv or micromamba for Python environments.
- Use Docker only as an optional advanced backend, because many Windows users will not want Docker Desktop.
- Keep model weights outside environments so environments can be repaired without redownloading weights.
- Provide a runtime health check before installing or launching a model.

Device support priority:

1. NVIDIA CUDA on Windows.
2. CPU fallback for lightweight models.
3. Apple Silicon and Linux later, unless cross-platform is a launch requirement.
4. AMD/Intel GPU only as experimental unless the target users clearly need it.

## API Design

Expose an OpenAI-compatible endpoint:

```http
POST /v1/audio/speech
```

Recommended request shape:

```json
{
  "model": "voxcpm2",
  "input": "需要生成的文本",
  "voice": "default",
  "response_format": "wav",
  "speed": 1.0,
  "stream": false
}
```

Add TTS-specific endpoints:

```http
GET  /v1/tts/models
GET  /v1/tts/voices
POST /v1/tts/speech
POST /v1/tts/jobs
GET  /v1/tts/jobs/{job_id}
POST /v1/tts/voices
DELETE /v1/tts/voices/{voice_id}
GET  /v1/health
```

Extended request fields:

- provider/model adapter: `model`
- text: `input`
- fixed speaker: `voice`
- natural-language voice design: `voice_prompt`
- reference audio: `reference_audio`
- reference transcript: `reference_text`
- style or emotion reference audio: `style_audio`
- emotion vector or label: `emotion`
- language: `language`
- speed/pitch/volume: `speed`, `pitch`, `volume`
- output: `response_format`, `sample_rate`
- streaming: `stream`

The API gateway should expose capabilities per model instead of pretending every model supports every field.

## Desktop UX

Main views:

1. Generate
   - Model selector, text editor, voice selector, reference audio picker, style controls, generate button, player, export button.

2. Models
   - Model cards with install status, size, license/commercial note, hardware requirement, source, update button, and repair button.

3. Voices
   - Saved voice presets, reference clips, transcripts, tags, authorization status, and test generation.

4. Jobs
   - Batch generation queue, progress, failed tasks, retry, output folder.

5. API
   - Local API status, port, token option, examples, request logs, enable/disable switch.

6. Settings
   - Model directory, output directory, download mirror, GPU selection, max concurrent jobs, auto-unload timeout, FFmpeg path.

## Model Adapter Contract

Each adapter should define:

- Model id and display name.
- Source URLs and model download method.
- License metadata for code and weights.
- Required runtime packages and Python version.
- Hardware requirements.
- Supported features: plain TTS, streaming, voice design, voice clone, emotion control, duration control, batch, fine-tune.
- Input schema mapping.
- Output formats and native sample rate.
- Health-check command.
- Install, launch, unload, and repair commands.

Feature flags are more important than a universal parameter set. For example, IndexTTS2 emotion vectors should not be forced into the same UI as VoxCPM2 natural-language voice design; both can map to a common "style control" concept while keeping model-specific advanced panels.

## Long Text Strategy

Long text should be a first-class workflow:

- Split text by paragraph and punctuation.
- Keep per-segment metadata and generated audio.
- Allow retrying failed segments.
- Normalize silence and loudness across segments.
- Concatenate with FFmpeg.
- Save both final audio and segment-level files.
- Preserve seed and parameter history for reproducibility where supported.

## Security And Compliance

Voice cloning must be treated carefully:

- Require user confirmation that reference audio is authorized.
- Mark cloned voices with an authorization status.
- Keep voice assets local by default.
- Add an optional generated-audio watermark or metadata marker if practical.
- Provide a visible disclosure option for AI-generated voice.
- Avoid shipping pre-cloned celebrity or public-figure voices.

License handling:

- Separate code license from model-weight license.
- Show commercial status in the model list.
- Block or warn on commercial use for non-commercial weights.
- Keep a manually editable license metadata file so the product can react when upstream terms change.

## Implementation Phases

### Phase 1: MVP Core

- Desktop shell.
- FastAPI local gateway.
- Model registry.
- Job queue.
- File output and playback.
- One working adapter, preferably VoxCPM2 or F5-TTS.

### Phase 2: P0 Model Coverage

- Add Qwen3-TTS, CosyVoice 3, IndexTTS2, GPT-SoVITS.
- Add model install/repair UI.
- Add voice library and reference audio workflows.
- Add long-text generation.

### Phase 3: API And Stability

- OpenAI-compatible endpoint.
- Streaming support where available.
- API token option.
- Request logs.
- Hardware diagnostics.
- Better error messages.

### Phase 4: Expansion

- Add P1 models.
- Add Docker backend option.
- Add one-click benchmarking.
- Add model comparison workflow.
- Add optional cloud/offload support only if users request it.

## Main Risks

1. Dependency conflicts
   - Mitigation: isolated model environments, adapter health checks, repair button.

2. Model download friction
   - Mitigation: support Hugging Face and ModelScope, resumable downloads, mirror settings.

3. GPU memory failures
   - Mitigation: hardware diagnostics, expected VRAM labels, auto-unload, queue concurrency limits.

4. License ambiguity
   - Mitigation: explicit model metadata, commercial-use warnings, source links.

5. Voice cloning misuse
   - Mitigation: authorization confirmations, local-only voice store, disclosure controls.

6. UI complexity
   - Mitigation: simple mode by default, advanced model-specific controls behind an expandable panel.

## Recommended First Build Decision

Start with Windows + NVIDIA CUDA as the primary target.

Use:

- Tauri or Electron for the desktop app.
- FastAPI for the local API gateway.
- Python worker processes for model adapters.
- uv or micromamba for isolated environments.
- Hugging Face and ModelScope as model download sources.
- FFmpeg for audio conversion, concatenation, and normalization.

Start with two adapters:

1. VoxCPM2 as the flagship modern open model.
2. F5-TTS as the stable baseline adapter.

Then add Qwen3-TTS, CosyVoice 3, IndexTTS2, and GPT-SoVITS.

This sequence lowers integration risk while still proving the core product value: one desktop app, multiple local open TTS models, unified generation workflow, and a stable local API.
