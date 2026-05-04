# MinerU 精准解析 API Demo

这是一个完全独立的 MinerU 精准解析 API demo，使用 Token，不依赖 `tools/doc2markdown-node` 或 `tools/Doc2MarkdownService`。

## 能力

- 使用 `tools/mineru-accurate-demo/.env` 中的 `MINERU_API_TOKEN`。
- 调用 `POST https://mineru.net/api/v4/file-urls/batch` 申请上传链接。
- 使用 `PUT` 上传本地文件。
- 轮询 `GET https://mineru.net/api/v4/extract-results/batch/{batch_id}`。
- 下载 `full_zip_url`，解压并保存 `full.md`。

## 安装

```powershell
cd tools\mineru-accurate-demo
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
npm run parse -- "..\测试文件\pdf-1.pdf" --out-dir ".\out" --model-version vlm --timeout 600 --interval 5
```

- `--model-version`：默认 `vlm`，也可传 `pipeline`。
- `--language`：默认 `ch`。
- `--ocr`：开启 OCR，默认关闭。
- `--no-table`：关闭表格识别。
- `--no-formula`：关闭公式识别。
- `--page-ranges`：精准 API 页码范围，例如 `1-10`。

## 输出

```text
out/
  pdf-1.md
  pdf-1.raw.json
  pdf-1.zip
  pdf-1.error.txt
  summary.md
  summary.json
```
