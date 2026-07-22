# OpenTTS Studio

OpenTTS Studio 是一个 Windows 桌面端本地 TTS 工作台：统一管理可用的开源模型包，提供桌面生成界面和本地 HTTP API，并让音色、模型目录、运行时状态和生成结果可追踪。

## 当前能力

- 当前对外提供的稳定本地模型：IndexTTS2、VoxCPM2、GPT-SoVITS。
- 模型包统一放在项目根目录的 [`models`](models/README.md)；运行时、权重与懒人包文件均留在本机，不进入 Git。
- 模型中心：目录选择、健康检查、启用/禁用、稳定包标记、维护备注和检查历史。
- 运行时管理：按需启动、显示运行状态、空闲自动释放显存、手动停止；不会终止外部懒人包自行启动的服务。
- 桌面端音色库：可将本地参考音频或生成结果一键加入音色库。
- B 站取样：桌面端扫码登录、视频/番剧解析、分 P/剧集选择、音频下载、FFmpeg 转 WAV/裁剪、取消任务，并直接入库。
- 本地 API：`/v1/audio/speech` 与 `/v1/tts/speech`；根据当前稳定适配器拒绝未实现参数，防止桌面端与外部调用不一致。

## B 站取样边界

取样仅应使用已获得授权、拥有权利或可合法使用的内容。入库时需由用户确认授权状态；下载音频、登录会话和生成结果均为本机数据，不会提交到版本库。

## 开发运行

后端：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m uvicorn tts_api.main:app --host 127.0.0.1 --port 8765
```

桌面端：

```powershell
cd apps/desktop
npm run desktop
```

## 验证

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q

cd ..\desktop
npm run build
npm run test:electron
```
