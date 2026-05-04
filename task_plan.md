# Task Plan

## Goal
- 优化独立 Node.js 文档转 Markdown POC 的 PDF 表格解析，重点提升 `pdf-4.pdf` 这类带线框表格文件的 Markdown 输出质量。

## Scope
- 不接入现有前端和 Python 后端。
- 保持 Markdown、DOCX、PDF、DOC/WPS 既有能力。
- 不实现 OCR；无可选中文字层的 PDF 继续按预期失败。
- PDF 表格优化优先在 Node POC 内实现，当前方向是 PDF.js 文本坐标 + 绘图线框兜底。

## Phases
- [x] 检查历史上下文和工作区状态。
- [x] 创建 Node POC 目录和说明文件。
- [x] 实现转换核心与 CLI。
- [x] 安装依赖并生成 lockfile。
- [x] 运行基础自检，给出测试方法。
- [x] 修复 LibreOffice 路径检测，DOC/WPS 已能转换。
- [x] 将 DOCX/WPS 表格改为保留 HTML `<table>`，降低错位和空行问题。
- [x] 对 PDF `pdf-parse` 文本和表格结果做表格优先去重。
- [x] 实现 PDF.js 线框/坐标表格兜底。
- [x] 用 `pdf-4.pdf` 定点验证新输出。
- [x] 运行 Node 源码语法检查和必要 PDF 回归测试。

## Errors Encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| session-catchup.py 在 `.opencode` 路径不存在 | 1 | 改用实际 `.config/opencode` 路径重试成功 |
| 样本 `.doc/.wps` 转换失败 | 1 | 当前机器未找到 LibreOffice；POC 已明确报错并在 README 说明安装/指定方式 |
| 样本 `pdf-2.pdf` 转换失败 | 1 | 未检测到可选中文字层，符合“不做 OCR”的范围限制 |
| `pdf-4.pdf` Node 输出表格质量弱于 Python | 1 | 已安装 `pdfjs-dist`，准备基于 PDF.js 操作符和文本坐标实现兜底表格重建 |
| 普通 PDF 文本重复折叠误删 `440001`、`www`、`000` | 1 | 收窄为只折叠含中文的多字片段；单字重复仅用于表格去重判定，不改正文 |
