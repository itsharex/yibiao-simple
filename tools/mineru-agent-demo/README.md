# MinerU Agent 轻量解析 API Demo

这是一个完全独立的 MinerU Agent 轻量解析 API demo，不使用 Token，不读取 `.env`，不发送 `Authorization` 请求头。

## 能力

- 调用 `POST https://mineru.net/api/v1/agent/parse/file` 获取上传链接。
- 使用 `PUT` 上传本地文件。
- 轮询 `GET https://mineru.net/api/v1/agent/parse/{task_id}`。
- 下载 `markdown_url` 并保存 Markdown。

## 限制

- 无需 Token。
- 文件大小上限 10MB。
- PDF 页数上限 20 页。
- 可能触发 IP 限频。
- 轻量 API 只返回 Markdown 链接，不返回精准 API 的 zip 包。

## 安装

```powershell
cd tools\mineru-agent-demo
npm install
```

## 单文件测试

```powershell
npm run parse -- "..\测试文件\pdf-1.pdf" --out-dir ".\out"
npm run parse -- "..\测试文件\word-1.docx" --out-dir ".\out"
```

## 批量测试

```powershell
npm run smoke -- "..\测试文件" --out-dir ".\out"
```

## 常用参数

```powershell
npm run parse -- "..\测试文件\pdf-1.pdf" --out-dir ".\out" --timeout 300 --interval 3
```

- `--language`：默认 `ch`。
- `--ocr`：开启 OCR，默认关闭。
- `--no-table`：关闭表格识别。
- `--no-formula`：关闭公式识别。
- `--page-range`：Agent API 页码范围，例如 `1-10`，不支持逗号分隔。

## 输出

```text
out/
  pdf-1.md
  pdf-1.raw.json
  pdf-1.error.txt
  summary.md
  summary.json
```
