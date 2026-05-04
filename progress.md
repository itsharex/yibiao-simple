# Progress

## 2026-05-02
- 已确认当前工作区有未跟踪文件 `标书智能体（五）——如何让弱模型也能稳定输出复杂json.md`，本任务不修改它。
- 已创建 `tools/doc2markdown-node/src` 目录。
- 已新增 Node POC：`package.json`、`src/convert.js`、`src/cli.js`、`src/smoke.js`、`README.md`。
- 已执行 `npm install` 并生成依赖锁文件。
- 已通过 `node --check` 检查三个源码文件语法。
- 已用样本目录执行批量 smoke，Markdown/DOCX/带文字层 PDF 成功，扫描 PDF 与缺 LibreOffice 的 DOC/WPS 按预期失败。

## 2026-05-04
- 已按用户要求建立四类对比脚本：Node、Python Docker、MinerU 精准解析、MinerU Agent 轻量解析。
- 已修复 PowerShell 5.1 `Start-Transcript -Encoding UTF8` 不兼容问题。
- 已修复 LibreOffice 绝对路径检测误判，并验证 `.doc` 可转换。
- 已将 Node DOCX/WPS 表格输出策略改为保留 HTML `<table>`。
- 已对 Node PDF 纯文本和 `pdf-parse.getTable()` 表格结果做去重，表格优先。
- 已安装 `pdfjs-dist@5.4.296`，并开始在 `tools/doc2markdown-node/src/convert.js` 接入 PDF.js。
- 已完成 PDF.js 线框/坐标表格兜底并接入 `convertPdfFile()`。
- 已生成定点输出：`tools/对比结果/node-pdf4-fallback/pdf-4.md`，关键 PDF 表格已转成 Markdown 表格。
- 已执行 `node --check src\convert.js` 通过。
- 已回归转换 `pdf-1.pdf`、`pdf-3.pdf` 成功；`pdf-2.pdf` 继续按预期返回 `pdf_text_layer_missing`。
