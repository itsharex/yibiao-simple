from __future__ import annotations

import base64
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import mammoth
import olefile
from bs4 import BeautifulSoup
from charset_normalizer import from_bytes
from markdownify import markdownify as html_to_markdown

from .config import settings
from .errors import ConversionError

MARKDOWN_SUFFIXES = {".md", ".markdown"}
MARKDOWN_IMAGE_PATTERN = re.compile(
    r'!\[(?P<alt>[^\]]*)\]\((?P<target><[^>]+>|[^)\s]+)(?P<title>\s+"[^"]*")?\)',
    re.IGNORECASE,
)
HTML_IMAGE_PATTERN = re.compile(
    r"<img\b(?P<before>[^>]*?)src=[\"'](?P<src>[^\"']+)[\"'](?P<after>[^>]*)>",
    re.IGNORECASE,
)


def convert_path_to_markdown(
    input_path_str: str,
    include_images: bool,
    original_name: str | None = None,
) -> str:
    input_path = Path(input_path_str)
    detected_format = detect_file_format(input_path, original_name)

    if detected_format == "markdown":
        return convert_markdown_file(input_path, include_images)
    if detected_format == "docx":
        return convert_docx_file(input_path, include_images)
    if detected_format == "pdf":
        return convert_pdf_file(input_path, include_images)
    if detected_format == "ole_word_compatible":
        return convert_ole_word_compatible_file(input_path, include_images)

    raise ConversionError(
        code="unsupported_format",
        message="Unsupported input format",
        status_code=400,
        details={
            "filename": original_name or input_path.name,
            "detected_format": detected_format,
        },
    )


def detect_file_format(input_path: Path, original_name: str | None = None) -> str:
    suffix = (
        Path(original_name).suffix if original_name else input_path.suffix
    ).lower()
    with input_path.open("rb") as file_obj:
        header = file_obj.read(8)

    if suffix in MARKDOWN_SUFFIXES:
        return "markdown"

    if header.startswith(b"%PDF-"):
        return "pdf"

    if header.startswith(b"PK\x03\x04") and is_docx_package(input_path):
        return "docx"

    if header == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" and is_word_compatible_ole(
        input_path
    ):
        return "ole_word_compatible"

    if suffix in MARKDOWN_SUFFIXES:
        return "markdown"

    return "unknown"


def is_docx_package(input_path: Path) -> bool:
    try:
        with zipfile.ZipFile(input_path) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile:
        return False
    return "[Content_Types].xml" in names and "word/document.xml" in names


def is_word_compatible_ole(input_path: Path) -> bool:
    try:
        with olefile.OleFileIO(str(input_path)) as ole:
            streams = {"/".join(item) for item in ole.listdir()}
    except OSError:
        return False
    return "WordDocument" in streams


def convert_markdown_file(input_path: Path, include_images: bool) -> str:
    raw = input_path.read_bytes()
    match = from_bytes(raw).best()
    if match is None:
        raise ConversionError(
            code="invalid_markdown",
            message="Unable to detect Markdown encoding",
            status_code=400,
            details={"filename": input_path.name},
        )

    text = str(match)
    text = normalize_newlines_only(text)
    if include_images:
        text = inline_local_markdown_images(text, input_path.parent)
    else:
        text = strip_markdown_images(text)
    return ensure_trailing_newline(text)


def convert_docx_file(input_path: Path, include_images: bool) -> str:
    with input_path.open("rb") as docx_file:
        result = mammoth.convert_to_html(
            docx_file,
            convert_image=build_image_converter(include_images),
        )

    html = clean_html(result.value, include_images)
    html_without_tables, placeholders = preserve_tables(html)
    markdown = html_fragment_to_markdown(html_without_tables)
    markdown = restore_tables(markdown, placeholders)
    markdown = normalize_generated_markdown(markdown)
    if not include_images:
        markdown = strip_markdown_images(markdown)
    return markdown


def convert_pdf_file(input_path: Path, include_images: bool) -> str:
    if not pdf_has_text_layer(input_path):
        raise ConversionError(
            code="pdf_text_layer_missing",
            message="PDF does not contain a selectable text layer",
            status_code=422,
            details={"filename": input_path.name},
        )

    attempts: list[dict[str, object]] = []
    errors: list[str] = []
    strategies = [
        ("pymupdf4llm", convert_pdf_with_pymupdf4llm),
        ("pymupdf_blocks", convert_pdf_with_pymupdf_blocks),
        ("pdfplumber", convert_pdf_with_pdfplumber),
        ("pdfminer", convert_pdf_with_pdfminer),
        ("pypdf", convert_pdf_with_pypdf),
    ]

    for name, strategy in strategies:
        try:
            markdown = strategy(input_path, include_images)
            if not markdown.strip():
                raise ValueError("empty markdown output")

            score = score_pdf_markdown(markdown)
            attempts.append({"name": name, "score": score, "markdown": markdown})
            if is_pdf_markdown_acceptable(markdown, score):
                return markdown
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}: {exc}")

    if attempts:
        best_attempt = max(attempts, key=lambda item: int(item["score"]))
        return str(best_attempt["markdown"])

    raise ConversionError(
        code="pdf_text_extraction_failed",
        message="All non-OCR PDF extraction strategies failed",
        status_code=422,
        details={"filename": input_path.name, "errors": errors},
    )


def pdf_has_text_layer(input_path: Path, max_pages_to_check: int = 5) -> bool:
    import fitz

    document = fitz.open(input_path)
    try:
        page_limit = min(document.page_count, max_pages_to_check)
        if page_limit == 0:
            return False

        text_pages = 0
        total_chars = 0
        total_words = 0

        for page_index in range(page_limit):
            page = document.load_page(page_index)
            page_text = page.get_text("text").strip()
            word_count = len(page.get_text("words"))
            total_chars += len(page_text)
            total_words += word_count

            if len(page_text) >= 30 or word_count >= 10:
                text_pages += 1

        return (
            text_pages >= max(1, page_limit // 2)
            or total_words >= 50
            or total_chars >= 200
        )
    finally:
        document.close()


def convert_pdf_with_pymupdf4llm(input_path: Path, include_images: bool) -> str:
    import pymupdf4llm

    markdown = pymupdf4llm.to_markdown(
        str(input_path),
        embed_images=include_images,
        ignore_images=not include_images,
        show_progress=False,
        page_separators=False,
        force_text=True,
        table_strategy="lines_strict",
    )

    return finalize_pdf_markdown(
        markdown,
        input_path=input_path,
        include_images=include_images,
        append_images=False,
    )


def convert_pdf_with_pymupdf_blocks(input_path: Path, include_images: bool) -> str:
    import fitz

    document = fitz.open(input_path)
    try:
        page_parts: list[str] = []
        for page_index, page in enumerate(document):
            block_parts: list[str] = []
            page_height = float(page.rect.height or 0)

            for block in page.get_text("blocks", sort=True):
                x0, y0, x1, y1, text, _block_no, block_type = block
                if block_type != 0:
                    continue
                if should_skip_pdf_margin_block(float(y0), float(y1), page_height):
                    continue

                cleaned = normalize_pdf_block_text(str(text))
                if not cleaned:
                    continue
                block_parts.append(cleaned)

            if block_parts:
                page_parts.append("\n\n".join(block_parts))

        markdown = "\n\n".join(page_parts)
        return finalize_pdf_markdown(
            markdown,
            input_path=input_path,
            include_images=include_images,
            append_images=True,
        )
    finally:
        document.close()


def convert_pdf_with_pdfplumber(input_path: Path, include_images: bool) -> str:
    import pdfplumber

    page_parts: list[str] = []
    table_settings = {
        "vertical_strategy": "lines_strict",
        "horizontal_strategy": "lines_strict",
        "intersection_tolerance": 5,
        "snap_tolerance": 3,
    }

    with pdfplumber.open(input_path) as pdf:
        for page in pdf.pages:
            parts: list[str] = []
            text = page.extract_text(layout=True) or page.extract_text() or ""
            normalized_text = normalize_pdf_plain_text(text)
            if normalized_text:
                parts.append(normalized_text)

            for table in page.extract_tables(table_settings) or []:
                rendered_table = render_pdf_table_markdown(table)
                if rendered_table:
                    parts.append(rendered_table)

            if parts:
                page_parts.append("\n\n".join(parts))

    markdown = "\n\n".join(page_parts)
    return finalize_pdf_markdown(
        markdown,
        input_path=input_path,
        include_images=include_images,
        append_images=True,
    )


def convert_pdf_with_pdfminer(input_path: Path, include_images: bool) -> str:
    from pdfminer.high_level import extract_text
    from pdfminer.layout import LAParams

    markdown = extract_text(
        str(input_path),
        laparams=LAParams(line_margin=0.3, char_margin=2.0, word_margin=0.1),
    )
    markdown = normalize_pdf_plain_text(markdown)
    return finalize_pdf_markdown(
        markdown,
        input_path=input_path,
        include_images=include_images,
        append_images=True,
    )


def convert_pdf_with_pypdf(input_path: Path, include_images: bool) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(input_path))
    page_parts: list[str] = []
    for page in reader.pages:
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except TypeError:
            text = page.extract_text() or ""
        if not text:
            text = page.extract_text() or ""

        normalized_text = normalize_pdf_plain_text(text)
        if normalized_text:
            page_parts.append(normalized_text)

    markdown = "\n\n".join(page_parts)
    return finalize_pdf_markdown(
        markdown,
        input_path=input_path,
        include_images=include_images,
        append_images=True,
    )


def finalize_pdf_markdown(
    markdown: str,
    *,
    input_path: Path,
    include_images: bool,
    append_images: bool,
) -> str:
    if not include_images:
        markdown = strip_markdown_images(markdown)

    markdown = normalize_generated_markdown(markdown)
    if include_images and append_images:
        markdown = append_pdf_images_markdown(markdown, input_path)

    if not markdown.strip():
        raise ValueError("empty markdown output")
    return markdown


def append_pdf_images_markdown(markdown: str, input_path: Path) -> str:
    image_markdown = extract_pdf_images_markdown(input_path)
    if not image_markdown:
        return markdown

    base = markdown.rstrip()
    if not base:
        return ensure_trailing_newline(image_markdown)
    return f"{base}\n\n{image_markdown}\n"


def extract_pdf_images_markdown(input_path: Path) -> str:
    import fitz

    document = fitz.open(input_path)
    try:
        image_lines: list[str] = []
        for page_index, page in enumerate(document):
            seen_xrefs: set[int] = set()
            for image_index, image in enumerate(page.get_images(full=True), start=1):
                xref = int(image[0])
                if xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)

                image_data = document.extract_image(xref)
                if not image_data:
                    continue

                ext = image_data.get("ext", "bin")
                mime_type = mimetypes.guess_type(f"file.{ext}")[0] or f"image/{ext}"
                data_uri = make_data_uri(mime_type, image_data["image"])
                image_lines.append(
                    f"![Page {page_index + 1} Image {image_index}]({data_uri})"
                )
        return "\n\n".join(image_lines)
    finally:
        document.close()


def normalize_pdf_block_text(text: str) -> str:
    lines = [
        collapse_pdf_whitespace(line)
        for line in normalize_newlines_only(text).splitlines()
        if line.strip()
    ]
    if not lines:
        return ""

    merged = lines[0]
    for line in lines[1:]:
        merged = join_pdf_fragments(merged, line)
    return merged.strip()


def normalize_pdf_plain_text(text: str) -> str:
    text = normalize_newlines_only(text).replace("\x0c", "\n\n")
    lines = [collapse_pdf_whitespace(line) for line in text.splitlines()]
    text = "\n".join(line for line in lines if line or line == "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def collapse_pdf_whitespace(text: str) -> str:
    collapsed = re.sub(r"[ \t]+", " ", text).strip()
    collapsed = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", collapsed)
    collapsed = re.sub(r"\s+([,.;:!?%])", r"\1", collapsed)
    collapsed = re.sub(r"\s+([，。；：！？、％])", r"\1", collapsed)
    return collapsed


def join_pdf_fragments(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left

    if (
        left.endswith("-")
        and re.search(r"[A-Za-z]-$", left)
        and re.match(r"^[A-Za-z]", right)
    ):
        return f"{left[:-1]}{right}"

    if right[0] in ",.;:!?%)]}，。；：！？、％）》】】":
        separator = ""
    elif left[-1] in "([{《【":
        separator = ""
    elif re.search(r"[\u4e00-\u9fff]$", left) and re.match(r"^[\u4e00-\u9fff]", right):
        separator = ""
    else:
        separator = " "

    return f"{left}{separator}{right}".strip()


def should_skip_pdf_margin_block(y0: float, y1: float, page_height: float) -> bool:
    if page_height <= 0:
        return False
    top_margin = page_height * 0.03
    bottom_margin = page_height * 0.03
    return y0 <= top_margin or y1 >= (page_height - bottom_margin)


def render_pdf_table_markdown(table: list[list[object | None]]) -> str:
    cleaned_rows: list[list[str]] = []
    for row in table:
        cleaned_row = [normalize_pdf_table_cell(cell) for cell in row]
        if any(cell for cell in cleaned_row):
            cleaned_rows.append(cleaned_row)

    if not cleaned_rows:
        return ""

    width = max(len(row) for row in cleaned_rows)
    normalized_rows = [row + [""] * (width - len(row)) for row in cleaned_rows]
    header = normalized_rows[0]
    separator = ["---"] * width
    body = normalized_rows[1:]

    lines = [render_markdown_table_row(header), render_markdown_table_row(separator)]
    lines.extend(render_markdown_table_row(row) for row in body)
    return "\n".join(lines)


def normalize_pdf_table_cell(value: object | None) -> str:
    if value is None:
        return ""
    text = normalize_newlines_only(str(value)).strip()
    text = re.sub(r"\n+", "<br>", text)
    text = collapse_pdf_whitespace(text)
    return text.replace("|", r"\|")


def render_markdown_table_row(row: list[str]) -> str:
    return f"|{'|'.join(row)}|"


def score_pdf_markdown(markdown: str) -> int:
    probe = normalize_newlines_only(strip_markdown_images(markdown)).strip()
    if not probe:
        return -10000

    lines = [line.strip() for line in probe.splitlines() if line.strip()]
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", probe))
    latin_count = len(re.findall(r"[A-Za-z]", probe))
    digit_count = len(re.findall(r"\d", probe))
    weird_count = probe.count("�") + len(
        re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", probe)
    )
    long_line_count = sum(len(line) >= 12 for line in lines)
    short_line_count = sum(0 < len(line) <= 2 for line in lines)
    table_count = probe.count("|---")
    heading_count = len(re.findall(r"(?m)^#{1,6}\s", probe))

    return (
        len(probe)
        + cjk_count * 2
        + latin_count
        + digit_count
        + long_line_count * 8
        + table_count * 40
        + heading_count * 20
        - short_line_count * 6
        - weird_count * 120
    )


def is_pdf_markdown_acceptable(markdown: str, score: int) -> bool:
    probe = normalize_newlines_only(strip_markdown_images(markdown)).strip()
    if not probe:
        return False

    informative_count = len(re.findall(r"[A-Za-z0-9\u4e00-\u9fff]", probe))
    return len(probe) >= 120 and informative_count >= 80 and score >= 320


def convert_ole_word_compatible_file(input_path: Path, include_images: bool) -> str:
    with tempfile.TemporaryDirectory(prefix="doc2md-ole-") as temp_dir:
        temp_dir_path = Path(temp_dir)
        legacy_input = temp_dir_path / f"{input_path.stem}.doc"
        normalized_input = temp_dir_path / f"{input_path.stem}.normalized.docx"
        shutil.copy2(input_path, legacy_input)
        normalize_ole_with_office(legacy_input, normalized_input)
        return convert_docx_file(normalized_input, include_images)


def normalize_ole_with_office(input_path: Path, output_path: Path) -> None:
    if os.name == "nt":
        try:
            normalize_with_word(input_path, output_path)
            return
        except Exception:  # noqa: BLE001
            pass

    normalize_with_libreoffice(input_path, output_path)


def normalize_with_word(input_path: Path, output_path: Path) -> None:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    document = None

    try:
        document = word.Documents.Open(
            str(input_path),
            ConfirmConversions=False,
            ReadOnly=True,
            AddToRecentFiles=False,
            Visible=False,
        )
        document.SaveAs2(str(output_path), FileFormat=16)
    finally:
        if document is not None:
            document.Close(False)
        word.Quit()
        pythoncom.CoUninitialize()


def normalize_with_libreoffice(input_path: Path, output_path: Path) -> None:
    soffice = find_libreoffice_command()
    if soffice is None:
        raise ConversionError(
            code="office_backend_missing",
            message="No available Office backend found for legacy document conversion",
            status_code=500,
            details={"filename": input_path.name},
        )

    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="doc2md-lo-profile-") as profile_dir:
        profile_uri = Path(profile_dir).resolve().as_uri()
        command = [
            soffice,
            "--headless",
            "--nologo",
            "--nolockcheck",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "docx",
            "--outdir",
            str(output_dir),
            str(input_path),
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=settings.office_timeout_seconds,
            check=False,
        )

    produced_output = output_dir / f"{input_path.stem}.docx"
    if produced_output.exists():
        if produced_output != output_path:
            shutil.move(str(produced_output), str(output_path))
        return

    raise ConversionError(
        code="office_conversion_failed",
        message="LibreOffice failed to convert legacy document",
        status_code=500,
        details={
            "filename": input_path.name,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        },
    )


def build_image_converter(include_images: bool):
    def convert_image(image):
        attributes: dict[str, str] = {}
        alt_text = getattr(image, "alt_text", None)
        if alt_text:
            attributes["alt"] = alt_text

        if not include_images:
            attributes["src"] = ""
            return attributes

        with image.open() as image_bytes:
            data = image_bytes.read()
        attributes["src"] = make_data_uri(image.content_type, data)
        return attributes

    return mammoth.images.img_element(convert_image)


def make_data_uri(content_type: str | None, data: bytes) -> str:
    mime_type = content_type or "application/octet-stream"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def clean_html(html: str, include_images: bool) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for anchor in soup.find_all("a"):
        href = anchor.get("href", "")
        if not anchor.get_text(strip=True) and not anchor.find("img"):
            anchor.decompose()
            continue
        if href.startswith("#"):
            anchor.unwrap()

    if not include_images:
        for image in soup.find_all("img"):
            image.decompose()

    return str(soup)


def preserve_tables(html: str) -> tuple[str, dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    placeholders: dict[str, str] = {}

    for index, table in enumerate(soup.find_all("table"), start=1):
        placeholder = f"TABLEPLACEHOLDER{index:04d}"
        placeholders[placeholder] = str(table)
        table.replace_with(soup.new_string(placeholder))

    return str(soup), placeholders


def html_fragment_to_markdown(html: str) -> str:
    return html_to_markdown(
        html,
        heading_style="ATX",
        bullets="-",
        strong_em_symbol="*",
    )


def restore_tables(markdown: str, placeholders: dict[str, str]) -> str:
    for placeholder, table_html in placeholders.items():
        markdown = markdown.replace(placeholder, f"\n\n{table_html}\n\n")
    return markdown


def normalize_newlines_only(markdown: str) -> str:
    return markdown.replace("\r\n", "\n").replace("\r", "\n")


def normalize_generated_markdown(markdown: str) -> str:
    markdown = normalize_newlines_only(markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return ensure_trailing_newline(markdown.strip())


def ensure_trailing_newline(text: str) -> str:
    return text if text.endswith("\n") else f"{text}\n"


def strip_markdown_images(text: str) -> str:
    text = MARKDOWN_IMAGE_PATTERN.sub("", text)
    text = HTML_IMAGE_PATTERN.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def inline_local_markdown_images(text: str, base_dir: Path) -> str:
    text = MARKDOWN_IMAGE_PATTERN.sub(
        lambda match: replace_markdown_image(match, base_dir), text
    )
    text = HTML_IMAGE_PATTERN.sub(
        lambda match: replace_html_image(match, base_dir), text
    )
    return text


def replace_markdown_image(match: re.Match[str], base_dir: Path) -> str:
    target = match.group("target")
    clean_target = (
        target[1:-1] if target.startswith("<") and target.endswith(">") else target
    )
    if is_remote_or_data_url(clean_target):
        return match.group(0)

    local_path = resolve_local_path(base_dir, clean_target)
    if local_path is None:
        return match.group(0)

    data_uri = path_to_data_uri(local_path)
    title = match.group("title") or ""
    alt = match.group("alt")
    return f"![{alt}]({data_uri}{title})"


def replace_html_image(match: re.Match[str], base_dir: Path) -> str:
    src = match.group("src")
    if is_remote_or_data_url(src):
        return match.group(0)

    local_path = resolve_local_path(base_dir, src)
    if local_path is None:
        return match.group(0)

    data_uri = path_to_data_uri(local_path)
    before = match.group("before")
    after = match.group("after")
    return f'<img{before}src="{data_uri}"{after}>'


def resolve_local_path(base_dir: Path, target: str) -> Path | None:
    candidate = Path(target)
    if not candidate.is_absolute():
        candidate = (base_dir / candidate).resolve()
    if not candidate.exists() or not candidate.is_file():
        return None
    return candidate


def path_to_data_uri(path: Path) -> str:
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return make_data_uri(mime_type, path.read_bytes())


def is_remote_or_data_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https", "data"}


def find_libreoffice_command() -> str | None:
    candidates = [
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        "/usr/lib/libreoffice/program/soffice",
    ]

    if os.name == "nt":
        candidates.extend(
            [
                r"C:\Program Files\LibreOffice\program\soffice.exe",
                r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            ]
        )

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None
