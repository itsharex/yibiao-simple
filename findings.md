# Findings

## Existing Demo
- Python demo 的能力是文档转 Markdown，而不是单纯提取纯文本。
- DOCX 主要可由 Node `mammoth` + `turndown` 复现。
- PDF 使用 Node `pdf-parse` 2.x 作为首选 POC，覆盖文本、表格和图片提取。
- DOC/WPS 不直接解析，沿用 Office 标准化思路，优先调用 LibreOffice CLI 转 DOCX。
- Node 版已改为 DOCX/WPS 表格保留 HTML `<table>`，比强转 GFM 更稳定。
- PDF 基础提取仍依赖 `pdf-parse`；`pdf-parse.getTable()` 对 `pdf-4.pdf` 表格不够稳定。
- `pdf-4.pdf` 存在线框绘制指令，可尝试用 PDF.js `getOperatorList()` + `getTextContent()` 重建表格。

## Constraints
- Windows 优先，命令和路径需要兼容空格与中文路径。
- POC 独立于现有前后端，避免影响当前可运行应用。

## Verification
- Markdown 样本转换成功：`markdown-1.md -> 533 chars`。
- DOCX 样本转换成功：`word-1.docx -> 35001 chars`、`word-2.docx -> 178466 chars`、`word-4.docx -> 18137 chars`。
- PDF 样本转换成功：`pdf-1.pdf -> 1322 chars`、`pdf-3.pdf -> 9235 chars`、`pdf-4.pdf -> 57491 chars`。
- `pdf-2.pdf` 未检测到文字层，当前 POC 按预期拒绝转换。
- `.doc/.wps` 需要 LibreOffice，当前机器未找到，因此相关样本失败。
- 当前机器已确认 LibreOffice 默认路径存在：`C:\Program Files\LibreOffice\program\soffice.exe`，不能依赖 `soffice.exe --version` 判断可用性。
- `pdf-4.pdf` Node 优化后仍出现标题/表头重复和表格断行为普通文本的问题。
- `tools/doc2markdown-node/src/convert.js` 当前只引入了 `pdfjs-dist` 的 `getDocument` 和 `OPS`，尚未把 PDF.js 表格兜底接入 `convertPdfFile()`/`renderPdfMarkdown()`。
- PDF.js 检查 `pdf-4.pdf` 第 1 页显示有重复文本项和 `constructPath`，但首页不是主要表格页；Node 输出中 `标的名称`/`付款方式` 等表格内容仍为断行文本，Python 输出对应位置是 Markdown 表格。
- 已通过 PDF.js 解析 `constructPath`、维护 `save/restore/transform` 图形矩阵，把细矩形线段还原到页面坐标，随后用横竖线交点组成表格组件。
- `pdf-4.pdf` 新输出能重建关键表格：采购包明细、项目标的及采购限价、付款方式/验收要求/其他、技术参数表等，位置示例见 `tools/对比结果/node-pdf4-fallback/pdf-4.md`。
- 普通文本重复清理必须避免处理纯数字/URL；之前全量相邻重复字符折叠会破坏 `440001`、`www`、`000`，已改为仅普通文本折叠含中文的多字片段。
