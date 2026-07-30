# 发布流程

每个面向用户的版本必须同时更新 `apps/desktop/package.json` 与锁文件，并新增 `.github/releases/vX.Y.Z.md` 中文版本说明。说明至少包含：主要功能、重要兼容性或迁移提醒、已完成的验证，以及测试者需要注意的本地模型/数据前提。

推送匹配的 `vX.Y.Z` 标签后，GitHub Actions 会先在干净的 Windows 环境安装 API、运行 API 和桌面测试、构建安装包及便携版，最后发布 GitHub Release。发布工作流读取对应的说明文件；缺失说明会失败，避免出现无更新说明的版本。

发布完成的判定标准是 GitHub Release 已创建且安装包、便携版、`latest.yml` 与校验文件均已上传；仅“标签已推送”或“工作流已启动”都不视为发布成功。
