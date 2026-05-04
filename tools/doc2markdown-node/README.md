# doc2markdown-node POC

这是一个独立的 Node.js 文档转 Markdown 验证项目，不接入当前 Python 后端和 React 前端。

## 支持范围

- Markdown：读取 `.md` / `.markdown`，可选择内联本地图片。
- DOCX：使用 `mammoth` 转 HTML，再用 `turndown` 转 GitHub Flavored Markdown。
- PDF：使用 `pdf-parse` 提取文本、表格；开启 `--include-images` 时尝试追加图片 data URI。
- DOC/WPS：调用本机 LibreOffice 转 DOCX 后继续转换。

不支持 OCR。扫描版 PDF 如果没有可选中文字层，会报错。

## 安装

```powershell
cd tools\doc2markdown-node
npm install
```

## 单文件测试

```powershell
npm run convert -- "D:\path\test.docx" --out ".\out\test.md"
npm run convert -- "D:\path\test.pdf" --out ".\out\test-pdf.md"
npm run convert -- "D:\path\test.pdf" --include-images --out ".\out\test-pdf-images.md"
```

不指定 `--out` 时会直接输出到控制台：

```powershell
npm run convert -- "D:\path\test.md"
```

## 批量冒烟测试

```powershell
npm run smoke -- "D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件"
npm run smoke -- "D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件" --out-dir ".\out"
npm run smoke -- "D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件" --include-images --out-dir ".\out-images"
```

输出示例：

```text
OK  test.docx -> 12345 chars
FAIL scan.pdf: PDF 未检测到可选中文字层
```

## DOC/WPS 说明

`.doc` / `.wps` 需要本机安装 LibreOffice，并且能找到 `soffice`。如果没有加入 PATH，会自动尝试以下路径：

- `C:\Program Files\LibreOffice\program\soffice.exe`
- `C:\Program Files (x86)\LibreOffice\program\soffice.exe`

也可以手动指定：

```powershell
$env:LIBREOFFICE_PATH = "C:\Program Files\LibreOffice\program\soffice.exe"
npm run convert -- "D:\path\old.doc" --out ".\out\old.md"
```
