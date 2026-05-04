from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from .config import settings
from .errors import ConversionError
from .executor import run_conversion

app = FastAPI(title="Doc2MarkdownService", version="0.1.0")


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    include_images: bool = Form(False),
):
    original_name = sanitize_filename(file.filename or "upload.bin")
    temp_dir = Path(tempfile.mkdtemp(prefix="doc2md-upload-"))
    input_path = temp_dir / original_name
    total_bytes = 0

    try:
        with input_path.open("wb") as output_file:
            while True:
                chunk = await file.read(settings.chunk_size_bytes)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > settings.max_upload_bytes:
                    raise ConversionError(
                        code="file_too_large",
                        message="Uploaded file exceeds size limit",
                        status_code=413,
                        details={
                            "filename": original_name,
                            "max_upload_mb": settings.max_upload_mb,
                        },
                    )
                output_file.write(chunk)

        markdown = await run_conversion(input_path, include_images, original_name)
        response_bytes = len(markdown.encode("utf-8"))
        if response_bytes > settings.max_response_bytes:
            raise ConversionError(
                code="response_too_large",
                message="Converted Markdown exceeds response size limit",
                status_code=413,
                details={
                    "filename": original_name,
                    "max_response_mb": settings.max_response_mb,
                },
            )

        return PlainTextResponse(markdown, media_type="text/markdown")
    except ConversionError as exc:
        return JSONResponse(
            status_code=exc.status_code, content={"error": exc.to_dict()}
        )
    except Exception as exc:  # noqa: BLE001
        error = ConversionError(
            code="internal_error",
            message="Unexpected server error",
            status_code=500,
            details={"filename": original_name, "reason": str(exc)},
        )
        return JSONResponse(
            status_code=error.status_code, content={"error": error.to_dict()}
        )
    finally:
        await file.close()
        shutil.rmtree(temp_dir, ignore_errors=True)


def sanitize_filename(value: str) -> str:
    name = Path(value).name or "upload.bin"
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return sanitized or "upload.bin"


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("DOC2MD_HOST", "0.0.0.0")
    port = int(os.getenv("DOC2MD_PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
