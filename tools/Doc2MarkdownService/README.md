# Doc2MarkdownService

单容器、单接口的文档转 Markdown 服务。

## 支持格式

- Markdown：直接读取内容
- PDF：仅支持带可选中文字层的 PDF，使用多种非模型方式级联读取
- DOCX：转换为 Markdown 文本
- DOC / 金山 WPS 样式 OLE 文档：先标准化为 DOCX，再转换
  - 依赖Microsoft Office或LibreOffice来处理.doc和.wps文件

## 接口

`POST /convert`

请求格式：`multipart/form-data`

- `file`：待转换文件
- `include_images`：是否保留图片，默认 `false`

规则：

- `include_images=false`：过滤全部图片
- `include_images=true`：本地图片会内联为 `data:` URI，远程图片保持原始 URL

成功响应：

- `200 OK`
- `Content-Type: text/markdown; charset=utf-8`
- 响应体直接是 Markdown 文本

## 本地运行

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

PDF 处理策略：

- 只处理可直接选中文字的 PDF。
- 先用 `PyMuPDF4LLM` 提取 Markdown。
- 如果结果不理想，会继续尝试 `PyMuPDF blocks`、`pdfplumber`、`pdfminer.six`、`pypdf`。
- 如果 PDF 没有文字层，接口直接返回 `422`。

调用示例：

```powershell
curl.exe -X POST "http://127.0.0.1:8000/convert" -F "file=@D:\path\file.docx" -F "include_images=false"
```

## Docker

```powershell
docker build -t doc2md-service .
docker rm -f doc2md-service
docker run --rm -p 18000:8000 --name doc2md-service doc2md-service
```

使用 `docker compose`：

```powershell
docker compose up -d --build
docker compose logs -f
docker compose down
```

默认并发策略：

- 同时执行最多 `4` 个转换任务。
- 额外允许最多 `8` 个请求排队等待。
- 超过这个上限后，接口直接返回 `429`。

如果只是代码有更新，想优先复用缓存、加快构建，直接用：

```powershell
docker build -t doc2md-service .
```

只有在依赖或底层环境异常、怀疑缓存脏了时，再用：

```powershell
docker build --no-cache -t doc2md-service .
```

## 调试

查看服务是否启动：

```powershell
curl.exe http://127.0.0.1:18000/openapi.json
```

查看容器日志：

```powershell
docker logs -f doc2md-service
```

停止容器：

```powershell
docker rm -f doc2md-service
```

快速验证 PDF：

```powershell
curl.exe -X POST "http://127.0.0.1:18000/convert" -F "file=@D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件\pdf-1.pdf;type=application/pdf" -F "include_images=false"
```

快速验证 WPS：

```powershell
curl.exe -X POST "http://127.0.0.1:18000/convert" -F "file=@D:\CodeSpace\personal-secretary\Scripts\Word转Markdown\测试文件\wps-1.wps;type=application/octet-stream" -F "include_images=false"
```

## 配置项

服务支持以下环境变量：

| 变量名                           |    默认值 | 说明                                                                |
| -------------------------------- | --------: | ------------------------------------------------------------------- |
| `DOC2MD_HOST`                    | `0.0.0.0` | 本地直接运行 `python -m uvicorn` 时绑定的主机地址。                 |
| `DOC2MD_PORT`                    |    `8000` | 本地直接运行时监听端口。                                            |
| `DOC2MD_MAX_WORKERS`             |       `4` | 同时执行转换任务的最大 worker 数。                                  |
| `DOC2MD_MAX_QUEUE_SIZE`          |       `8` | 当 worker 已满时，额外允许排队等待的请求数量。超出后返回 `429`。    |
| `DOC2MD_MAX_UPLOAD_MB`           |     `100` | 单个上传文件大小上限，超出返回 `413`。                              |
| `DOC2MD_MAX_RESPONSE_MB`         |      `30` | 单次返回 Markdown 文本大小上限，超出返回 `413`。                    |
| `DOC2MD_REQUEST_TIMEOUT_SECONDS` |     `300` | 单次转换任务的总超时时间，超时返回 `504`。                          |
| `DOC2MD_OFFICE_TIMEOUT_SECONDS`  |     `180` | `doc/wps` 标准化为 `docx` 时，Office/LibreOffice 子进程的超时时间。 |
| `DOC2MD_CHUNK_SIZE_BYTES`        | `1048576` | 上传文件时单次读取的块大小。                                        |

示例：

```powershell
docker run --rm -p 18000:8000 --name doc2md-service `
  -e DOC2MD_MAX_WORKERS=6 `
  -e DOC2MD_MAX_QUEUE_SIZE=12 `
  -e DOC2MD_MAX_UPLOAD_MB=200 `
  doc2md-service
```

## 样本冒烟测试

```powershell
python tests/smoke_samples.py
python tests/smoke_samples.py --include-images
```
