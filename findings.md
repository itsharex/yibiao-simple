# Findings

## Research Log
- 当前客户端 `DocumentAnalysisPage` 仍是“导入文件 + AI 解析项目概述/评分要求”的旧交互，导入后没有 Markdown 渲染原始提取内容。
- 当前 `client/electron/services/fileService.cjs` 只用 `mammoth.extractRawText` 和 `pdf-parse` 做纯文本提取，未按配置中的 `file_parser.provider` 分流，也未使用 `tools/doc2markdown-node` 的 Markdown 还原逻辑。
- 配置文件中 `file_parser.provider` 已存在，值为 `local`、`mineru-accurate-api`、`mineru-agent-api`，但文件解析服务没有读取配置。
- `tools/doc2markdown-node/src/convert.js` 是 ESM，实现包括 Markdown 编码识别、DOCX->HTML->GFM Markdown、PDF 文本/表格提取、DOC/WPS 经 LibreOffice 转 DOCX。要“100%还原”本地解析，应复用该模块而不是重写简化版。
- MinerU Agent 轻量 API：`POST https://mineru.net/api/v1/agent/parse/file` 获取 `task_id/file_url`，`PUT` 上传，`GET /parse/{task_id}` 轮询，完成后下载 `markdown_url`。无需 Token。
- MinerU 精准 API：`POST https://mineru.net/api/v4/file-urls/batch` 带 Bearer Token 获取 `batch_id/file_url`，`PUT` 上传，`GET /extract-results/batch/{batch_id}` 轮询，下载 `full_zip_url`，从 zip 中读取 `full.md` 或任意 `.md`。
- 已将 `tools/doc2markdown-node/src/convert.js` 复制到 `client/electron/services/doc2markdown/convert.mjs`，运行时不再依赖 `tools/` 目录。
- 前端 Markdown 渲染使用 `react-markdown`、`remark-gfm`、`rehype-raw`，用于展示 GFM 表格和 DOCX 转换保留下来的 HTML 表格。
