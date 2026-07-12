# Stable TTS Model Management Design

## Goal

OpenTTS Studio should manage TTS models as stable local assets, not as a loose set of directory fields. The first release of model management focuses on one reliable instance per model. A model is considered useful when it can be checked, started, and used for a short successful generation without the user understanding the underlying lazy pack, API server, worker, or Python environment.

The product priority is stability over freshness. We do not automatically replace a working model with a newer version. New versions can be discovered later, but only a tested local instance should become the active default.

## Current State

The backend has a static model registry at `model-registry/models.json`. Runtime settings store fixed root paths for IndexTTS2, VoxCPM2, and GPT-SoVITS. The desktop settings dialog exposes those paths directly, and `/v1/model-directories` reports whether each configured directory exists.

This is enough to call models, but it is not enough to manage them. It does not record whether the path is a lazy pack, official source checkout, local API service, or worker runtime. It also cannot tell the user whether a model is stable, untested, broken, or last successfully used.

## First-Release Scope

The first implementation adds a model management layer with exactly one active local instance per model.

It includes:

- A persistent model instance profile for each real model.
- A health check that inspects required files and reports clear repair hints.
- A stable status value: `ready`, `untested`, `missing`, `broken`, or `disabled`.
- A default instance used by generation and system status.
- A desktop Model Center view that replaces the current flat model path section.

It does not include:

- Automatic model downloads.
- Automatic upgrades.
- Multiple active versions per model.
- Deleting model files from disk.
- Migrating every adapter to a shared runtime abstraction in one step.

## Model Instance Profile

Each model gets one profile stored in user configuration. The profile represents the current stable local instance.

Suggested fields:

```json
{
  "model_id": "gptsovits",
  "display_name": "GPT-SoVITS",
  "enabled": true,
  "runtime_type": "lazy_pack_api",
  "root_path": "D:\\newworld\\Shinsekai\\data\\tts_bundles\\installed\\GPT-SoVITS-v2pro-20250604",
  "api_host": "127.0.0.1",
  "api_port": 9880,
  "status": "untested",
  "last_health_check_at": null,
  "last_success_at": null,
  "last_error": null
}
```

Runtime types for the first release:

- `worker_lazy_pack`: used by IndexTTS2.
- `lazy_pack_api`: used by VoxCPM2 and GPT-SoVITS.
- `reserved`: used by F5-TTS until it is truly connected.

## Health Checks

Health checks should be model-specific but return a shared shape.

For each model, the check reports:

- Whether the root path exists.
- Whether the expected Python runtime exists.
- Whether the expected API or worker entry script exists.
- Whether required config or checkpoint directories exist.
- Whether a local service is already running, when applicable.
- A short user-facing repair message.

Health checks should not automatically load a model into GPU memory. Deep generation tests are separate and run only when the user asks for a stability test or when they generate normally.

Example shared result:

```json
{
  "model_id": "gptsovits",
  "status": "ready",
  "checks": [
    { "id": "root", "label": "模型目录", "passed": true },
    { "id": "python", "label": "Python 运行时", "passed": true },
    { "id": "entrypoint", "label": "API 启动脚本", "passed": true },
    { "id": "config", "label": "推理配置", "passed": true }
  ],
  "repair_hint": null
}
```

## Backend API

Add model management endpoints while keeping existing generation endpoints compatible.

Endpoints:

- `GET /v1/model-instances`
  Returns all configured model instance profiles with health summaries.

- `GET /v1/model-instances/{model_id}`
  Returns one model instance profile and the latest check result.

- `PATCH /v1/model-instances/{model_id}`
  Updates root path, API host, API port, enabled state, or runtime type for supported models.

- `POST /v1/model-instances/{model_id}/check`
  Runs a non-loading health check and records the result.

- `POST /v1/model-instances/{model_id}/stability-test`
  Optional first-release endpoint. Runs a short generation test only after user confirmation, then records `last_success_at` or `last_error`.

Existing endpoints remain:

- `/v1/tts/models` still returns public model capabilities.
- `/v1/system/status` includes runtime state, but should also include the model instance health status.
- `/v1/audio/speech` should use the active instance profile instead of reading only raw path fields.

## Desktop UI

Replace the current "本地模型" settings group with a Model Center section.

Each model card shows:

- Model name and current state.
- Runtime type label.
- Current path.
- Health check result.
- Last successful generation time.
- Buttons: `检查`, `选择目录`, `打开目录`, `启用/禁用`.

The generation screen should keep its current simple model selector. The user should not need to manage paths there. If a selected model is not ready, the generate button stays disabled and the app points them to the model card repair action.

The right rail should show both runtime state and model health:

- Runtime state: not started, service running, model loaded, released.
- Health state: ready, untested, missing, broken, disabled.

## Data Flow

1. The desktop loads `/v1/model-instances`.
2. The user opens Model Center and sees each model's stable profile.
3. The user changes a path or runs a health check.
4. The backend records the profile and check summary in user settings.
5. The generation UI reads the active profile for the selected model.
6. The adapter uses the profile path and service settings when generating.
7. Successful generation updates `last_success_at`.

## Error Handling

Errors should be specific and repairable.

Examples:

- GPT-SoVITS root exists, but `runtime/python.exe` is missing: show "当前目录不像 GPT-SoVITS 懒人包，请重新选择包含 runtime 的目录。"
- VoxCPM2 API port is already occupied: show "端口已被占用，可以换一个端口或关闭占用服务。"
- IndexTTS2 checkpoint directory is missing: show "未找到 checkpoints，请选择完整的 IndexTTS2 目录。"

Do not silently fall back to another model or another path. Stability means predictable behavior.

## Testing

Backend tests:

- Default profiles are created for IndexTTS2, VoxCPM2, GPT-SoVITS, and F5-TTS.
- Profile updates persist and refresh runtime settings.
- Health checks pass with fake complete directories.
- Health checks fail with clear repair hints for missing files.
- Generation uses the selected model profile path.

Desktop tests:

- Model Center renders all models.
- Changing a path calls the profile update endpoint.
- Health state updates after a check.
- Generate button disables when the selected model is missing or disabled.

## Migration

Existing settings should become initial model instance profiles:

- `indextts2_root` maps to the IndexTTS2 profile.
- `voxcpm2_root`, `voxcpm2_api_host`, and `voxcpm2_api_port` map to the VoxCPM2 profile.
- `gptsovits_root`, `gptsovits_api_host`, and `gptsovits_api_port` map to the GPT-SoVITS profile.

The old fields can remain for compatibility during the first release, but new UI should use model instance profiles.

## Open Questions Resolved

- Version freshness is not a first-release goal.
- One active stable instance per model is enough.
- Health checks should not automatically occupy GPU memory.
- Automatic download and upgrade are deferred.
