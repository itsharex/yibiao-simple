# Progress

## Session Log
- 已初始化文件型计划，用于跟踪导入招标文件页面重做任务。
- 已查看客户端导入页、现有文件解析服务、配置存储和工具目录概览，确认需要重做 UI 并重写解析服务分流。
- 已细读 doc2markdown-node、MinerU Agent、MinerU 精准 API demo 的关键流程，下一步迁入/复用解析逻辑。
- 已完成客户端解析链路改造：Electron 文件服务按配置分流本地解析、MinerU-Agent、MinerU 精准 API；导入页改为配置标题 + Markdown 渲染器。
- 已通过 `node -e "require('./electron/services/fileService.cjs'); console.log('file service ok')"`、`node -e "import('./electron/services/doc2markdown/convert.mjs').then(() => console.log('converter ok'))"`、本地 Markdown 转换 smoke test、`npm run build`、`npm audit`。
