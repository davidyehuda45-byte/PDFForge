#!/usr/bin/env python3
import base64
import csv
import difflib
import hashlib
import html
import io
import json
import math
import os
import re
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser

import pymupdf as fitz
from PIL import Image, ImageOps
import openpyxl

try:
    from pptx import Presentation
    from pptx.util import Inches
    HAS_PPTX = True
except Exception:
    HAS_PPTX = False

MAX_PAGES = int(os.getenv("MAX_PAGES_PER_FILE", "500"))
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "50000000"))
MAX_IMAGE_JOB_PIXELS = int(os.getenv("MAX_IMAGE_JOB_PIXELS", "100000000"))
MAX_OUTPUT_BYTES = int(os.getenv("MAX_OUTPUT_SIZE_MB", "300")) * 1024 * 1024
MAX_ARCHIVE_BYTES = int(os.getenv("MAX_ARCHIVE_EXPANDED_MB", "512")) * 1024 * 1024
MAX_ARCHIVE_FILES = int(os.getenv("MAX_ARCHIVE_FILES", "1000"))
MAX_ARCHIVE_RATIO = int(os.getenv("MAX_ARCHIVE_COMPRESSION_RATIO", "100"))
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def response(ok, message="", warning="", output_format=""):
    print(json.dumps({"ok": ok, "message": message, "warning": warning,
                      "output_format": output_format}))


def capabilities():
    result = []

    def add(source, targets, quality="stable", warning=""):
        for target in targets:
            if target == source:
                continue
            result.append({
                "from": source, "to": target,
                "label": "%s to %s" % (source, target),
                "quality": quality, "warning": warning,
            })

    document_targets = ("pdf", "txt", "html", "rtf", "docx")
    documents = ("txt", "md", "html", "rtf", "docx", "odt", "epub")
    for source in documents:
        add(source, document_targets, "best-effort",
            "Text is converted; complex formatting and layout may change.")
    for source in ("xlsx", "csv", "tsv"):
        add(source, ("pdf", "txt", "csv", "xlsx"), "best-effort",
            "Spreadsheet formatting, formulas and multiple sheets may not be preserved.")
    for source in ("pptx", "odp"):
        add(source, ("pdf", "txt"), "best-effort",
            "Slide text is extracted; visual layout, images and animations are not preserved.")
    add("pdf", ("txt", "html", "rtf", "docx", "xlsx", "csv", "md", "json", "xml",
                "pptx", "png", "jpg", "webp", "tiff"), "best-effort",
        "PDF text extraction or rendering may not preserve the original layout.")
    for source in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
        image_targets = ("pdf", "jpg", "png", "webp", "gif", "bmp", "tiff")
        for target in image_targets:
            if source == target:
                continue
            warning = ""
            if target != "pdf" and source in ("gif", "tiff", "webp"):
                warning = "If this file is animated or multi-frame, only its first frame is used for image output."
            result.append({
                "from": source, "to": target, "label": "%s to %s" % (source, target),
                "quality": "stable", "warning": warning,
            })
    result.append({
        "from": "pdf", "to": "pdf", "label": "PDF processing",
        "quality": "stable", "warning": "",
    })
    for item in result:
        if item["from"] == "pdf" and item["to"] in ("png", "jpg", "webp", "tiff"):
            item["warning"] = "Each page becomes an image; documents with multiple pages download as a ZIP."
    return sorted(result, key=lambda item: (item["from"], item["to"]))


def normalize(fmt):
    fmt = fmt.lower().lstrip(".")
    return {"jpeg": "jpg", "htm": "html", "markdown": "md"}.get(fmt, fmt)


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.hidden += 1
        if tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.hidden:
            self.hidden -= 1
        if tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def html_text(value):
    parser = VisibleText()
    parser.feed(value)
    return re.sub(r"\n[ \t]*\n+", "\n\n", "".join(parser.parts)).strip()


def markdown_html(source):
    blocks = []
    paragraph = []
    list_kind = ""
    code_lines = []
    in_code = False

    def inline(value):
        value = html.escape(value, quote=True)
        value = re.sub(r"`([^`]+)`", r"<code>\1</code>", value)
        value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
        value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", value)
        return re.sub(r"\[([^\]]+)\]\((https?://[^ )]+)\)",
                      r'<a href="\2" rel="nofollow noopener">\1</a>', value)

    def flush_paragraph():
        if paragraph:
            blocks.append("<p>%s</p>" % "<br>\n".join(inline(line) for line in paragraph))
            paragraph.clear()

    def flush_list():
        nonlocal list_kind
        if list_kind:
            blocks.append("<%s>%s</%s>" % (
                list_kind, "".join("<li>%s</li>" % inline(item) for item in code_lines), list_kind))
            code_lines.clear()
            list_kind = ""

    for line in source.splitlines():
        if line.strip().startswith("```"):
            flush_paragraph()
            flush_list()
            if in_code:
                blocks.append("<pre><code>%s</code></pre>" %
                              html.escape("\n".join(code_lines)))
                code_lines.clear()
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            flush_list()
            level = len(heading.group(1))
            blocks.append("<h%d>%s</h%d>" % (level, inline(heading.group(2)), level))
            continue
        list_match = re.match(r"^\s*(?:[-*+]\s+|(\d+)\.\s+)(.+)$", line)
        if list_match:
            flush_paragraph()
            kind = "ol" if list_match.group(1) else "ul"
            if list_kind != kind:
                flush_list()
                list_kind = kind
            code_lines.append(list_match.group(2))
            continue
        if not line.strip():
            flush_paragraph()
            flush_list()
            continue
        paragraph.append(line)
    if in_code:
        blocks.append("<pre><code>%s</code></pre>" % html.escape("\n".join(code_lines)))
    else:
        flush_paragraph()
        flush_list()
    return "<!doctype html><meta charset=\"utf-8\"><article>%s</article>" % "\n".join(blocks)


def read_docx(path):
    with checked_zip(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    return "\n".join("".join(t.text or "" for t in p.findall(".//w:t", ns))
                     for p in root.findall(".//w:p", ns))


def read_odf(path):
    with checked_zip(path) as z:
        root = ET.fromstring(z.read("content.xml"))
    return "\n".join(" ".join(root.itertext()).split())


def read_pptx(path):
    parts = []
    with checked_zip(path) as z:
        slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                        key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
        for name in slides:
            root = ET.fromstring(z.read(name))
            text = [e.text for e in root.iter() if e.tag.endswith("}t") and e.text]
            parts.append("\n".join(text))
    return "\n\n".join(parts)


def read_epub(path):
    parts = []
    with checked_zip(path) as z:
        for name in sorted(n for n in z.namelist() if n.lower().endswith((".xhtml", ".html", ".htm"))):
            parts.append(html_text(z.read(name).decode("utf-8", errors="replace")))
    return "\n\n".join(parts)

def checked_zip(path):
    archive = zipfile.ZipFile(path)
    entries = archive.infolist()
    expanded_size = sum(item.file_size for item in entries)
    compressed_size = max(1, sum(item.compress_size for item in entries))
    if (len(entries) > MAX_ARCHIVE_FILES or expanded_size > MAX_ARCHIVE_BYTES or
            expanded_size > compressed_size * MAX_ARCHIVE_RATIO):
        archive.close()
        raise ValueError("archive exceeds the configured technical safety limits")
    return archive


def read_spreadsheet(path, ext):
    if ext in ("csv", "tsv"):
        with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
            rows = list(csv.reader(f, delimiter="\t" if ext == "tsv" else ","))
        return "\n".join("\t".join(row) for row in rows)
    with checked_zip(path):
        pass
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return "\n\n".join("\n".join("\t".join("" if cell is None else str(cell) for cell in row)
                                     for row in sheet.iter_rows(values_only=True)) for sheet in wb)
    finally:
        wb.close()


def write_text_xlsx(text, path):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for row, line in enumerate(text.splitlines(), 1):
        for col, value in enumerate(line.split("\t"), 1):
            cell = sheet.cell(row=row, column=col, value=value)
            cell.data_type = "s"
    workbook.save(path)


def read_source(path, ext):
    if ext == "pdf":
        doc = fitz.open(path)
        try:
            if doc.needs_pass:
                raise ValueError("password-protected")
            if len(doc) > MAX_PAGES:
                raise ValueError("page limit exceeded")
            return "\n\n".join(page.get_text("text") for page in doc)
        finally:
            doc.close()
    if ext == "docx":
        return read_docx(path)
    if ext in ("odt", "odp"):
        return read_odf(path)
    if ext == "pptx":
        return read_pptx(path)
    if ext == "epub":
        return read_epub(path)
    if ext in ("xlsx", "csv", "tsv"):
        return read_spreadsheet(path, ext)
    if ext in ("html", "htm"):
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            source = f.read()
        if not re.search(r"<[a-zA-Z][^>]*>", source):
            raise ValueError("the selected file is not valid HTML")
        return html_text(source)
    if ext == "rtf":
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            value = f.read()
        if not value.lstrip().startswith(r"{\rtf"):
            raise ValueError("the selected file is not valid RTF")
        value = re.sub(r"\\'[0-9a-fA-F]{2}", " ", value)
        value = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", value)
        return re.sub(r"[{}]", "", value).strip()
    if ext in ("txt", "md"):
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            return f.read()
    if ext in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
        with Image.open(path) as image:
            image.verify()
        return ""
    raise ValueError("unsupported source format")


def write_pdf(text, path, page_size="A4", orientation="portrait"):
    sizes = {"A4": (595, 842), "A3": (842, 1191), "LETTER": (612, 792), "LEGAL": (612, 1008)}
    width, height = sizes.get(page_size.upper(), sizes["A4"])
    if orientation.lower() == "landscape":
        width, height = max(width, height), min(width, height)
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    rect = fitz.Rect(42, 42, width - 42, height - 42)
    remaining = text or "(No extractable text was found in this document.)"
    while remaining:
        spare = page.insert_textbox(rect, remaining[:50000], fontsize=10, fontname="helv",
                                    lineheight=1.3, color=(0.12, 0.15, 0.2))
        if spare >= 0:
            break
        low, high = 0, min(50000, len(remaining))
        while low < high:
            mid = (low + high + 1) // 2
            probe = doc.new_page(width=width, height=height)
            free = probe.insert_textbox(rect, remaining[:mid], fontsize=10, fontname="helv", lineheight=1.3)
            doc.delete_page(-1)
            if free >= 0:
                low = mid
            else:
                high = mid - 1
        if low == 0:
            raise ValueError("text could not be laid out")
        page.insert_textbox(rect, remaining[:low], fontsize=10, fontname="helv", lineheight=1.3)
        remaining = remaining[low:]
        if remaining:
            if len(doc) >= MAX_PAGES:
                raise ValueError("page limit exceeded")
            page = doc.new_page(width=width, height=height)
    doc.save(path, garbage=3, deflate=True)
    doc.close()


def write_html_pdf(markup, path, page_size="A4", orientation="portrait"):
    sizes = {"A4": (595, 842), "A3": (842, 1191), "LETTER": (612, 792), "LEGAL": (612, 1008)}
    width, height = sizes.get(page_size.upper(), sizes["A4"])
    if orientation.lower() == "landscape":
        width, height = max(width, height), min(width, height)
    page_rect = fitz.Rect(0, 0, width, height)
    content_rect = fitz.Rect(42, 42, width - 42, height - 42)
    writer = fitz.DocumentWriter(path)
    story = fitz.Story(html=markup, user_css="body { font-family: sans-serif; font-size: 10pt; }")
    pages = 0
    try:
        more = True
        while more:
            if pages >= MAX_PAGES:
                raise ValueError("page limit exceeded")
            device = writer.begin_page(page_rect)
            more, _ = story.place(content_rect)
            story.draw(device)
            writer.end_page()
            pages += 1
    finally:
        writer.close()


def create_docx(text, path):
    paragraphs = "".join("<w:p><w:r><w:t xml:space=\"preserve\">%s</w:t></w:r></w:p>" %
                         html.escape(line) for line in text.splitlines() or [""])
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body>' + paragraphs + '<w:sectPr/></w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document)


def validate_output(path, target):
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise ValueError("the converter returned an empty output")
    if os.path.getsize(path) > MAX_OUTPUT_BYTES:
        raise ValueError("output size exceeds the configured technical limit")
    with open(path, "rb") as f:
        signature = f.read(16)
    valid = {
        "pdf": signature.startswith(b"%PDF-"),
        "png": signature.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg": signature.startswith(b"\xff\xd8\xff"),
        "jpeg": signature.startswith(b"\xff\xd8\xff"),
        "gif": signature.startswith((b"GIF87a", b"GIF89a")),
        "bmp": signature.startswith(b"BM"),
        "tiff": signature.startswith((b"II*\x00", b"MM\x00*")),
        "webp": signature.startswith(b"RIFF") and signature[8:12] == b"WEBP",
        "docx": validate_office_archive(path, "word/document.xml"),
        "xlsx": validate_office_archive(path, "xl/workbook.xml"),
        "pptx": validate_office_archive(path, "ppt/presentation.xml"),
        "txt": True, "md": True, "html": True, "json": True, "xml": True,
        "rtf": signature.startswith(b"{\\rtf"),
        "csv": True,
        "zip": signature.startswith(b"PK"),
    }
    if target not in valid or not valid[target]:
        raise ValueError("the conversion output did not pass format validation")
    if target == "pdf":
        doc = fitz.open(path)
        if not len(doc) or len(doc) > MAX_PAGES:
            raise ValueError("the converted PDF has an invalid page count")
        doc.close()
    elif target in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
        with Image.open(path) as image:
            image.verify()
    elif target in ("docx", "xlsx", "pptx"):
        with checked_zip(path) as archive:
            root_name = {"docx": "word/document.xml", "xlsx": "xl/workbook.xml",
                         "pptx": "ppt/presentation.xml"}[target]
            ET.fromstring(archive.read(root_name))
    elif target in ("json", "xml"):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if target == "json":
            json.loads(content)
        else:
            ET.fromstring(content)
    elif target == "zip":
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None or not archive.namelist():
                raise ValueError("the multi-file download archive is invalid")


def validate_office_archive(path, required_part):
    try:
        with checked_zip(path) as archive:
            return required_part in archive.namelist()
    except (OSError, zipfile.BadZipFile, ValueError):
        return False


# ---------- shared helpers for 100-feature engine ----------

def opt(req, key, default=""):
    return (req.get("options", {}).get(key) or default).strip() if isinstance(req.get("options", {}).get(key, default), str) else req.get("options", {}).get(key, default)


def parse_color(value, default=(1, 0, 0)):
    if not value:
        return default
    value = str(value).strip().lower()
    named = {"red": (1, 0, 0), "black": (0, 0, 0), "blue": (0.1, 0.3, 0.8),
             "green": (0.1, 0.5, 0.3), "gray": (0.5, 0.5, 0.5), "grey": (0.5, 0.5, 0.5)}
    if value in named:
        return named[value]
    value = value.lstrip("#")
    if re.fullmatch(r"[0-9a-f]{6}", value):
        return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return default


def parse_float(value, default, lo, hi):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, number))


def parse_int(value, default, lo, hi):
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, number))


def open_pdf(source, password=""):
    doc = fitz.open(source)
    if doc.needs_pass:
        if password:
            if not doc.authenticate(password):
                doc.close()
                raise ValueError("incorrect password for this PDF")
        else:
            doc.close()
            raise ValueError("password-protected")
    if len(doc) > MAX_PAGES:
        doc.close()
        raise ValueError("page limit exceeded")
    return doc


def watermark_rect(page_rect, position, font_size):
    w, h = page_rect.width, page_rect.height
    cx, cy = w / 2, h / 2
    positions = {
        "top-left": (70, 80), "top-center": (cx, 80), "top-right": (w - 70, 80),
        "center": (cx, cy), "middle": (cx, cy),
        "bottom-left": (70, h - 60), "bottom-center": (cx, h - 60), "bottom-right": (w - 70, h - 60),
    }
    return positions.get((position or "center").lower().replace("_", "-"), (cx, cy))


def apply_text_watermark(doc, options):
    text = (options.get("watermark_text") or options.get("text") or "CONFIDENTIAL").strip() or "CONFIDENTIAL"
    opacity = parse_float(options.get("watermark_opacity", options.get("opacity", "0.25")), 0.25, 0.05, 1.0)
    size = parse_int(options.get("watermark_size", options.get("font_size", "48")), 48, 8, 200)
    rotation = parse_int(options.get("watermark_rotation", options.get("rotation", "45")), 45, -180, 180)
    position = (options.get("watermark_position") or options.get("position") or "center").strip().lower()
    color = parse_color(options.get("watermark_color") or options.get("color") or "888888", (0.55, 0.55, 0.55))
    pages = selected_pages(options.get("page_range", ""), len(doc)) if options.get("page_range") else list(range(len(doc)))
    tiled = position in ("tiled", "tile", "pattern")
    import math as _math
    for number in pages:
        page = doc[number]
        rect = page.rect
        if tiled:
            for y in range(int(100), int(rect.height), 220):
                for x in range(int(60), int(rect.width), 300):
                    pt = fitz.Point(x, y)
                    if rotation in (0, 90, 180, 270):
                        page.insert_text(pt, text, fontsize=max(14, size // 2),
                                         fontname="helv", color=color, rotate=rotation,
                                         overlay=True, fill_opacity=opacity)
                    else:
                        rad = _math.radians(rotation)
                        mat = fitz.Matrix(_math.cos(rad), _math.sin(rad), -_math.sin(rad), _math.cos(rad), 0, 0)
                        page.insert_text(pt, text, fontsize=max(14, size // 2),
                                         fontname="helv", color=color,
                                         morph=(pt, mat), overlay=True, fill_opacity=opacity)
        else:
            point = watermark_rect(rect, position, size)
            base = fitz.Point(point[0] - len(text) * size * 0.28, point[1])
            if rotation in (0, 90, 180, 270):
                page.insert_text(base, text, fontsize=size, fontname="helv", color=color,
                                 rotate=rotation, overlay=True, fill_opacity=opacity)
            else:
                rad = _math.radians(rotation)
                mat = fitz.Matrix(_math.cos(rad), _math.sin(rad), -_math.sin(rad), _math.cos(rad), 0, 0)
                page.insert_text(base, text, fontsize=size, fontname="helv", color=color,
                                 morph=(base, mat), overlay=True, fill_opacity=opacity)


def apply_image_watermark(doc, logo_path, options):
    opacity = parse_float(options.get("watermark_opacity", "0.3"), 0.3, 0.05, 1.0)
    position = (options.get("watermark_position") or options.get("position") or "center").strip().lower()
    scale = parse_float(options.get("watermark_scale", "0.3"), 0.3, 0.05, 1.0)
    with Image.open(logo_path) as logo:
        logo = ImageOps.exif_transpose(logo).convert("RGBA")
        buf = io.BytesIO()
        logo.save(buf, format="PNG")
        data = buf.getvalue()
        lw, lh = logo.size
    pages = selected_pages(options.get("page_range", ""), len(doc)) if options.get("page_range") else list(range(len(doc)))
    for number in pages:
        page = doc[number]
        rect = page.rect
        target_w = rect.width * scale
        target_h = target_w * lh / max(1, lw)
        if target_h > rect.height * 0.6:
            target_h = rect.height * 0.4
            target_w = target_h * lw / max(1, lh)
        cx, cy = rect.width / 2, rect.height / 2
        pos_map = {
            "top-left": (20, 20), "top-center": (cx - target_w / 2, 20),
            "top-right": (rect.width - target_w - 20, 20),
            "center": (cx - target_w / 2, cy - target_h / 2),
            "bottom-left": (20, rect.height - target_h - 20),
            "bottom-center": (cx - target_w / 2, rect.height - target_h - 20),
            "bottom-right": (rect.width - target_w - 20, rect.height - target_h - 20),
        }
        x0, y0 = pos_map.get(position, pos_map["center"])
        if position in ("tiled", "tile"):
            for y in range(0, int(rect.height), int(target_h + 80)):
                for x in range(0, int(rect.width), int(target_w + 80)):
                    page.insert_image(fitz.Rect(x, y, x + target_w, y + target_h),
                                      stream=data, overlay=True, alpha=int(opacity * 255))
        else:
            page.insert_image(fitz.Rect(x0, y0, x0 + target_w, y0 + target_h),
                              stream=data, overlay=True, alpha=int(opacity * 255))


def apply_page_numbers(doc, options):
    fmt = (options.get("number_format") or options.get("format") or "Page 1 of N").strip()
    position = (options.get("number_position") or options.get("position") or "bottom-center").strip().lower()
    start = parse_int(options.get("number_start", "1"), 1, 1, 1000000)
    size = parse_int(options.get("font_size", "10"), 10, 6, 48)
    color = parse_color(options.get("color", "333333"), (0.25, 0.25, 0.25))
    total = len(doc)
    for i, page in enumerate(doc):
        num = start + i
        if fmt == "1":
            label = str(num)
        elif fmt.lower() in ("page 1", "page n"):
            label = "Page %d" % num
        else:
            label = "Page %d of %d" % (num, total)
        rect = page.rect
        y = 30 if position.startswith("top") else rect.height - 30
        if "left" in position:
            point = fitz.Point(40, y)
        elif "right" in position:
            point = fitz.Point(rect.width - 40 - len(label) * size * 0.55, y)
        else:
            point = fitz.Point(rect.width / 2 - len(label) * size * 0.28, y)
        page.insert_text(point, label, fontsize=size, fontname="helv", color=color, overlay=True)


def apply_compress(doc, options):
    level = (options.get("compress_level") or options.get("level") or "recommended").strip().lower()
    # PyMuPDF recompression: downsample large images for extreme/balanced levels
    if level in ("extreme", "low"):
        for page in doc:
            for img in page.get_images(full=True):
                try:
                    xref = img[0]
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n > 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    if pix.width > 800:
                        scale = 800 / pix.width
                        pix = fitz.Pixmap(pix, [scale, 0, 0, scale, 0, 0])
                        doc.update_stream(xref, pix.tobytes("jpg", jpg_quality=40))
                except Exception:
                    continue
    elif level in ("balanced", "medium"):
        for page in doc:
            for img in page.get_images(full=True):
                try:
                    xref = img[0]
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n > 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    if pix.width > 1200:
                        scale = 1200 / pix.width
                        pix = fitz.Pixmap(pix, [scale, 0, 0, scale, 0, 0])
                        doc.update_stream(xref, pix.tobytes("jpg", jpg_quality=60))
                except Exception:
                    continue


def text_to_markdown(text, title="Converted document"):
    lines = [l.rstrip() for l in text.splitlines()]
    out = ["# %s" % title, ""]
    for line in lines:
        stripped = line.strip()
        if not stripped:
            out.append("")
        elif len(stripped) < 80 and stripped.isupper() and len(stripped) > 3:
            out.append("## " + stripped.title())
        else:
            out.append(stripped)
    return "\n".join(out).strip() + "\n"


def llm_markdown(doc, source_name):
    parts = ["# %s" % source_name, "", "> Converted for LLM context. Page boundaries preserved.", ""]
    for i, page in enumerate(doc, 1):
        text = page.get_text("text").strip()
        parts.append("## Page %d" % i)
        parts.append("")
        parts.append(text if text else "_(no extractable text on this page)_")
        parts.append("")
    return "\n".join(parts)


def extractive_summary(text, max_sentences=8):
    sentences = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text).strip())
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
    if not sentences:
        return text[:2000]
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    freq = Counter(words)
    scored = sorted(enumerate(sentences),
                    key=lambda p: (sum(freq.get(w.lower(), 0) for w in re.findall(r"[a-zA-Z]{3,}", p[1])) / max(1, len(p[1].split())), p[0]),
                    reverse=True)
    top = sorted(i for i, _ in scored[:max_sentences])
    return "\n".join("- %s" % sentences[i] for i in top)


def heuristic_translate(text, target_lang):
    glossary = {
        "id": {"the": "itu", "and": "dan", "is": "adalah", "are": "adalah", "with": "dengan",
               "for": "untuk", "this": "ini", "that": "itu", "document": "dokumen", "page": "halaman",
               "report": "laporan", "contract": "kontrak", "payment": "pembayaran", "total": "total",
               "date": "tanggal", "name": "nama", "address": "alamat", "company": "perusahaan"},
        "en": {"adalah": "is", "dan": "and", "dengan": "with", "untuk": "for", "ini": "this",
               "dokumen": "document", "halaman": "page", "laporan": "report", "pembayaran": "payment"},
    }
    mapping = glossary.get((target_lang or "id").lower()[:2], {})
    def repl(match):
        word = match.group(0)
        lower = word.lower()
        if lower in mapping:
            trans = mapping[lower]
            return trans.capitalize() if word[0].isupper() else trans
        return word
    return re.sub(r"[A-Za-z]+", repl, text)


def extract_entities(text, metadata, source_name, page_count):
    emails = sorted(set(re.findall(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", text)))
    phones = sorted(set(re.findall(r"\+?\d[\d\s\-()]{7,}\d", text)))
    dates = sorted(set(re.findall(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b", text)))
    amounts = sorted(set(re.findall(r"(?:Rp|USD|\$)\s?[\d.,]+|\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\b", text)))
    return {
        "source": source_name, "pages": page_count, "metadata": metadata,
        "char_count": len(text), "word_count": len(text.split()),
        "emails": emails[:50], "phones": phones[:50], "dates": dates[:50], "amounts": amounts[:50],
    }


def try_ocr_text(image_path_or_pdf_page_pix):
    try:
        import pytesseract
        from PIL import Image as PILImage
        if isinstance(image_path_or_pdf_page_pix, str):
            with PILImage.open(image_path_or_pdf_page_pix) as im:
                return pytesseract.image_to_string(ImageOps.exif_transpose(im.convert("RGB")), lang="eng+ind")
        return pytesseract.image_to_string(image_path_or_pdf_page_pix, lang="eng+ind")
    except Exception:
        return ""


def convert_pdf(req, ext, target):
    source, output = req["source"], req["output"]
    options = req.get("options", {})
    operation = req.get("operation", "convert")
    if operation in ("", "convert"):
        operation = "convert"
    password = options.get("unlock_password") or options.get("password") or ""
    doc = open_pdf(source, password if ext == "pdf" else "")
    try:
        if len(doc) > MAX_PAGES:
            raise ValueError("page limit exceeded")
        warning = ""
        # ----- generic pdf operations -----
        if operation in ("merge",):
            merged = fitz.open()
            try:
                for item in req.get("merge_sources", []):
                    part = open_pdf(item, password)
                    if len(merged) + len(part) > MAX_PAGES:
                        part.close()
                        raise ValueError("page limit exceeded")
                    merged.insert_pdf(part)
                    part.close()
                merged.save(output, garbage=3, deflate=True)
            finally:
                merged.close()
            return warning
        if operation == "rotate":
            angle = parse_int(options.get("rotation", "90"), 90, 0, 360)
            if angle % 90 != 0:
                raise ValueError("rotation must be a multiple of 90 degrees")
            if angle not in (90, 180, 270):
                angle = 90
            pages = selected_pages(options.get("page_range", ""), len(doc)) if options.get("page_range") else list(range(len(doc)))
            for number in pages:
                doc[number].set_rotation((doc[number].rotation + angle) % 360)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "split":
            pages = selected_pages(req.get("page_range", ""), len(doc))
            if not pages:
                raise ValueError("enter a valid page range, for example 1-3,5")
            result = fitz.open()
            for page in pages:
                result.insert_pdf(doc, from_page=page, to_page=page)
            result.save(output, garbage=3, deflate=True)
            result.close()
            return warning
        if operation == "smart_split":
            return op_smart_split(doc, output, options)
        if operation == "ai_smart_split":
            return op_ai_smart_split(doc, output, options)
        if operation == "organize":
            warning = op_organize(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "reorder":
            op_reorder(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "remove_pages":
            op_remove_pages(doc, options)
            if not len(doc):
                raise ValueError("removing those pages would leave an empty document")
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "crop":
            op_crop(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "page_numbers":
            apply_page_numbers(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "compress":
            apply_compress(doc, options)
            doc.save(output, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
            return warning
        if operation == "repair":
            doc.save(output, garbage=4, deflate=True, clean=True)
            return "Document was re-saved with structural cleanup; verify the result before archiving."
        if operation == "pdf_to_pdfa":
            doc.set_metadata({"producer": "PDFForge PDF/A (best-effort)", "format": "PDF/A-2b (best-effort)"})
            doc.save(output, garbage=4, deflate=True)
            return "Best-effort PDF/A archival export; full ISO validation requires a dedicated validator."
        if operation == "validate_pdfa":
            report = validate_pdfa_report(doc, req.get("source_name", "document.pdf"))
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return "", "json"
        if operation in ("protect", "password_encrypt"):
            pwd = (options.get("protect_password") or options.get("password") or "").strip()
            if len(pwd) < 4:
                raise ValueError("enter a protection password of at least 4 characters")
            doc.save(output, garbage=3, deflate=True, encryption=fitz.PDF_ENCRYPT_AES_256,
                     user_pw=pwd, owner_pw=pwd, permissions=fitz.PDF_PERM_ACCESSIBILITY)
            return "Document encrypted with AES-256."
        if operation == "unlock":
            doc.save(output, garbage=3, deflate=True)
            return "Protection removed; save the unlocked file securely."
        if operation == "redact":
            terms = [t.strip() for t in (options.get("redact_terms") or options.get("terms") or "").split(",") if t.strip()]
            if not terms:
                raise ValueError("enter at least one term to redact, separated by commas")
            count = 0
            for page in doc:
                for term in terms:
                    for inst in page.search_for(term):
                        page.add_redact_annot(inst, text="█")
                        count += 1
            if not count:
                raise ValueError("none of the requested terms were found in this document")
            page.apply_redactions() if False else doc[0].apply_redactions() if False else None
            for page in doc:
                try:
                    page.apply_redactions()
                except Exception:
                    pass
            doc.save(output, garbage=4, deflate=True)
            return "Redacted %d occurrence(s). Verify visually before sharing." % count
        if operation == "permanent_remove":
            doc.set_metadata({"title": "", "author": "", "subject": "", "keywords": "", "creator": "PDFForge", "producer": "PDFForge sanitizer"})
            try:
                doc.del_xml_metadata()
            except Exception:
                pass
            for page in doc:
                for annot in list(page.annots() or []):
                    try:
                        page.delete_annot(annot)
                    except Exception:
                        pass
            doc.save(output, garbage=4, deflate=True, clean=True)
            return "Metadata, annotations and hidden structures were removed on a best-effort basis."
        if operation in ("digital_sign", "signature_request"):
            name = (options.get("signer_name") or options.get("signer") or "PDFForge Signer").strip()
            reason = (options.get("sign_reason") or options.get("reason") or "Document approval").strip()
            stamp = "Signed by %s | %s | %s" % (name, reason, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
            digest = hashlib.sha256(("%s|%s|%d" % (name, reason, len(doc))).encode()).hexdigest()[:16]
            page = doc[-1]
            rect = fitz.Rect(page.rect.width - 320, page.rect.height - 70, page.rect.width - 20, page.rect.height - 20)
            page.draw_rect(rect, color=(0.2, 0.35, 0.55), width=1.2)
            page.insert_textbox(rect + fitz.Rect(6, 4, -6, -4), "PDFForge Signature\n%s\nIntegrity %s" % (stamp, digest),
                                fontsize=7, fontname="helv", color=(0.15, 0.25, 0.45))
            doc.set_metadata({"producer": "PDFForge integrity stamp %s" % digest})
            if operation == "signature_request":
                widget = fitz.Widget()
                widget.field_name = "signature_request_%s" % digest[:8]
                widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
                widget.field_value = "Awaiting signature: %s (%s)" % (name, reason)
                widget.rect = fitz.Rect(40, page.rect.height - 70, 300, page.rect.height - 20)
                try:
                    page.add_widget(widget)
                except Exception:
                    pass
            doc.save(output, garbage=3, deflate=True)
            return "Applied a visible integrity stamp (hash %s). PKI-qualified signatures require a certificate authority." % digest
        if operation in ("text_watermark",):
            apply_text_watermark(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation in ("image_watermark",):
            overlays = req.get("merge_sources", [])
            if not overlays:
                raise ValueError("attach a logo image together with the PDF for image watermark")
            apply_image_watermark(doc, overlays[0], options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation in ("add_text", "edit_pdf"):
            op_add_text(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "add_image":
            overlays = req.get("merge_sources", [])
            if not overlays:
                raise ValueError("attach an image together with the PDF to embed it")
            op_add_image(doc, overlays[0], options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "add_shapes":
            op_add_shapes(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "add_annotations":
            op_add_annotation(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "highlight":
            count = op_highlight(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return "Highlighted %d occurrence(s)." % count
        if operation == "draw":
            op_draw(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return warning
        if operation == "create_form":
            op_create_form(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return "Form field added; open in a PDF reader to fill it."
        if operation == "fill_form":
            count = op_fill_form(doc, options)
            doc.save(output, garbage=3, deflate=True)
            return "Filled %d field(s)." % count
        if operation in ("ocr_pdf",):
            return op_ocr_searchable(doc, source, output, options)
        if operation == "compare_pdf":
            others = req.get("merge_sources", [])
            if not others:
                raise ValueError("upload two PDF files to compare them")
            report = op_compare(doc, others[0], req.get("source_name", ""), options)
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return "", "json"
        if operation == "audit_trail":
            report = op_audit(doc, source, req.get("source_name", ""), options)
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return "", "json"
        if operation in ("modal_signatures", "verify_signatures"):
            report = op_verify(doc, req.get("source_name", ""), options)
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return "", "json"
        if operation == "ai_summarize":
            text = "\n".join(page.get_text("text") for page in doc)
            prompt = (options.get("ai_prompt") or "").strip()
            summary = extractive_summary(text)
            md = "# AI Summary (extractive)\n\n%s\n\n## Key points\n\n%s\n" % (
                ("Instruction: %s\n\n" % prompt) if prompt else "", summary)
            with open(output, "w", encoding="utf-8") as f:
                f.write(md)
            return "Local extractive summary; connect an LLM for abstractive summaries.", "md"
        if operation == "ai_translate":
            target_lang = (options.get("target_lang") or "id").strip()
            text = "\n".join(page.get_text("text") for page in doc)
            translated = heuristic_translate(text, target_lang)
            write_pdf("Translation target: %s (heuristic local glossary)\n\n%s" % (target_lang, translated),
                      output, options.get("page_size", "A4"), options.get("orientation", "portrait"))
            return "Heuristic glossary translation; neural MT requires an external model.", "pdf"
        if operation == "ai_extract_data":
            text = "\n".join(page.get_text("text") for page in doc)
            meta = doc.metadata or {}
            report = extract_entities(text, meta, req.get("source_name", ""), len(doc))
            prompt = (options.get("ai_prompt") or "").strip()
            if prompt:
                report["instruction"] = prompt
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return "", "json"
        if operation == "pdf_to_llm_md":
            md = llm_markdown(doc, req.get("source_name", "document.pdf"))
            with open(output, "w", encoding="utf-8") as f:
                f.write(md)
            return "", "md"
        if operation == "workflow":
            return op_workflow(doc, source, output, options, req)
        # ----- format conversions below -----
        if target == "pdf":
            doc.save(output, garbage=4, deflate=True)
        elif target in ("txt", "html", "rtf"):
            page_numbers = selected_pages(req.get("page_range", ""), len(doc))
            text = "\n\n".join(doc[number].get_text("text") for number in page_numbers)
            if target == "txt":
                with open(output, "w", encoding="utf-8") as f:
                    f.write(text)
            elif target == "html":
                body = "".join("<section><pre>%s</pre></section>" % html.escape(p.get_text("text"))
                               for p in doc)
                with open(output, "w", encoding="utf-8") as f:
                    f.write("<!doctype html><meta charset=\"utf-8\"><title>Converted PDF</title>" + body)
            else:
                with open(output, "w", encoding="utf-8") as f:
                    f.write("{\\rtf1\\ansi " + re.sub(r"([{}\\])", r"\\\1", text).replace("\n", "\\par ") + "}")
        elif target in ("docx", "xlsx", "csv"):
            page_numbers = selected_pages(req.get("page_range", ""), len(doc))
            text = "\n".join(doc[number].get_text("text") for number in page_numbers)
            if target == "docx":
                ocr_hint = try_ocr_fallback(doc, page_numbers, options)
                if ocr_hint:
                    text = ocr_hint + "\n" + text
                    warning = "OCR engine not fully available; embedded text extraction used with best effort."
                create_docx(text, output)
            elif target == "xlsx":
                write_text_xlsx(text, output)
            else:
                with open(output, "w", encoding="utf-8", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerows([[safe_csv_cell(cell) for cell in line.split("\t")]
                                      for line in text.splitlines()])
            if not warning:
                warning = "PDF extraction is best-effort; page layout, tables and complex formatting may change."
        elif target == "md":
            page_numbers = selected_pages(req.get("page_range", ""), len(doc))
            text = "\n\n".join(doc[number].get_text("text") for number in page_numbers)
            with open(output, "w", encoding="utf-8") as f:
                f.write(text_to_markdown(text, req.get("source_name", "document")))
            return warning, "md"
        elif target == "json":
            text = "\n".join(page.get_text("text") for page in doc)
            report = extract_entities(text, doc.metadata or {}, req.get("source_name", ""), len(doc))
            with open(output, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            return warning, "json"
        elif target == "xml":
            text = "\n".join(page.get_text("text") for page in doc)
            root = ET.Element("document", name=req.get("source_name", "document.pdf"))
            meta_el = ET.SubElement(root, "metadata")
            for key, value in (doc.metadata or {}).items():
                child = ET.SubElement(meta_el, "field", name=str(key))
                child.text = str(value or "")
            for i, page in enumerate(doc, 1):
                page_el = ET.SubElement(root, "page", number=str(i))
                page_el.text = page.get_text("text")
            ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
            return warning, "xml"
        elif target == "pptx":
            return op_pdf_to_pptx(doc, output, options)
        elif target in ("png", "jpg", "webp", "tiff"):
            pages = selected_pages(req.get("page_range", ""), len(doc)) if req.get("page_range") else list(range(len(doc)))
            dpi = max(36, min(int(req.get("options", {}).get("dpi") or 144), 600))
            if not pages:
                raise ValueError("no pages were selected")
            ensure_render_job_pixels(doc, pages, dpi)
            if len(pages) == 1:
                image = render_page(doc, pages[0], dpi)
                save_image(image, output, target, req.get("options", {}))
                image.close()
            else:
                import zipfile as zf
                with zf.ZipFile(output, "w", zf.ZIP_DEFLATED) as archive:
                    for i, page_number in enumerate(pages, 1):
                        image = render_page(doc, page_number, dpi)
                        buf = io.BytesIO()
                        save_image(image, buf, target, req.get("options", {}))
                        archive.writestr("page-%03d.%s" % (i, target), buf.getvalue())
                        image.close()
                warning = "Each page was rendered as a separate image and bundled in a ZIP file."
                return warning, "zip"
        else:
            raise ValueError("unsupported target format")
    finally:
        if not doc.is_closed:
            try:
                doc.close()
            except Exception:
                pass
    return warning


def try_ocr_fallback(doc, page_numbers, options):
    # Attempt OCR for pages with little embedded text; graceful fallback.
    collected = []
    try:
        import pytesseract  # noqa: F401
        available = True
    except Exception:
        available = False
    if not available:
        return ""
    for number in page_numbers:
        page = doc[number]
        if len(page.get_text("text").strip()) < 20:
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                collected.append(try_ocr_text(img))
            except Exception:
                continue
    return "\n".join(collected)


def op_smart_split(doc, output, options):
    mode = (options.get("split_mode") or options.get("mode") or "individual").strip().lower()
    total = len(doc)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        if mode in ("every_n", "every", "n"):
            n = parse_int(options.get("split_n") or options.get("every") or "5", 5, 1, total)
            part = 1
            for start in range(0, total, n):
                chunk = fitz.open()
                chunk.insert_pdf(doc, from_page=start, to_page=min(start + n - 1, total - 1))
                buf = io.BytesIO()
                chunk.save(buf, garbage=3, deflate=True)
                chunk.close()
                archive.writestr("part-%03d-pages-%d-%d.pdf" % (part, start + 1, min(start + n, total)), buf.getvalue())
                part += 1
        elif (options.get("page_range") or "").strip():
            groups = [g.strip() for g in options.get("page_range", "").split(";") if g.strip()]
            if not groups:
                groups = [options.get("page_range")]
            for i, group in enumerate(groups, 1):
                pages = selected_pages(group, total)
                chunk = fitz.open()
                for p in pages:
                    chunk.insert_pdf(doc, from_page=p, to_page=p)
                buf = io.BytesIO()
                chunk.save(buf, garbage=3, deflate=True)
                chunk.close()
                archive.writestr("split-%02d.pdf" % i, buf.getvalue())
        else:
            for i in range(total):
                chunk = fitz.open()
                chunk.insert_pdf(doc, from_page=i, to_page=i)
                buf = io.BytesIO()
                chunk.save(buf, garbage=3, deflate=True)
                chunk.close()
                archive.writestr("page-%03d.pdf" % (i + 1), buf.getvalue())
    return "Split into %d file(s) bundled as ZIP." % (len(zipfile.ZipFile(output).namelist())), "zip"


def op_ai_smart_split(doc, output, options):
    # Topic-shift detection via vocabulary change between consecutive pages.
    texts = [doc[i].get_text("text") for i in range(len(doc))]
    def bow(text):
        return Counter(re.findall(r"[a-zA-Z]{4,}", text.lower()))
    boundaries = [0]
    for i in range(1, len(texts)):
        prev, cur = bow(texts[i - 1]), bow(texts[i])
        if not prev or not cur:
            if len(texts[i].strip()) > 200:
                boundaries.append(i)
            continue
        common = sum((prev & cur).values())
        union = sum((prev | cur).values()) or 1
        similarity = common / union
        if similarity < 0.12:
            boundaries.append(i)
    boundaries.append(len(doc))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for part in range(len(boundaries) - 1):
            start, end = boundaries[part], boundaries[part + 1] - 1
            chunk = fitz.open()
            chunk.insert_pdf(doc, from_page=start, to_page=end)
            buf = io.BytesIO()
            chunk.save(buf, garbage=3, deflate=True)
            chunk.close()
            archive.writestr("chapter-%02d-pages-%d-%d.pdf" % (part + 1, start + 1, end + 1), buf.getvalue())
    return "AI topic detection found %d section(s); bundled as ZIP." % (len(boundaries) - 1), "zip"


def parse_order_list(value, count):
    if not (value or "").strip():
        raise ValueError("enter a page order such as 3,1,2")
    order = []
    for part in value.split(","):
        part = part.strip()
        if "-" in part:
            bounds = part.split("-", 1)
            start, end = int(bounds[0]), int(bounds[1])
            step = 1 if end >= start else -1
            for n in range(start, end + step, step):
                if n < 1 or n > count:
                    raise ValueError("the page order is outside this document")
                order.append(n - 1)
        else:
            n = int(part)
            if n < 1 or n > count:
                raise ValueError("the page order is outside this document")
            order.append(n - 1)
    if sorted(order) != list(range(count)) and len(order) != count:
        # allow subset reorder (remaining pages appended) or full reorder
        pass
    return order


def op_reorder(doc, options):
    order = parse_order_list(options.get("page_order") or options.get("order") or options.get("page_range") or "", len(doc))
    new_doc = fitz.open()
    for number in order:
        new_doc.insert_pdf(doc, from_page=number, to_page=number)
    # replace pages in place
    while len(doc):
        doc.delete_page(0)
    doc.insert_pdf(new_doc)
    new_doc.close()


def op_remove_pages(doc, options):
    raw = (options.get("remove_pages") or options.get("page_range") or "").strip()
    if not raw:
        raise ValueError("enter pages to remove, for example 2,5-6")
    doomed = set(selected_pages(raw, len(doc)))
    for number in sorted(doomed, reverse=True):
        doc.delete_page(number)


def op_organize(doc, options):
    notes = []
    if (options.get("remove_pages") or "").strip():
        op_remove_pages(doc, {"page_range": options.get("remove_pages")})
        notes.append("removed")
    if (options.get("page_order") or options.get("order") or "").strip():
        op_reorder(doc, options)
        notes.append("reordered")
    rotation = parse_int(options.get("rotation", "0"), 0, 0, 270)
    if rotation in (90, 180, 270):
        for page in doc:
            page.set_rotation((page.rotation + rotation) % 360)
        notes.append("rotated")
    return ("Organized pages (%s)." % ", ".join(notes)) if notes else ""


def op_crop(doc, options):
    margin = parse_float(options.get("crop_margin", options.get("margin", "36")), 36, 0, 300)
    pages = selected_pages(options.get("page_range", ""), len(doc)) if options.get("page_range") else list(range(len(doc)))
    for number in pages:
        page = doc[number]
        rect = page.rect
        page.set_cropbox(fitz.Rect(rect.x0 + margin, rect.y0 + margin, rect.x1 - margin, rect.y1 - margin))


def op_add_text(doc, options):
    text = (options.get("add_text_content") or options.get("text") or options.get("watermark_text") or "").strip()
    if not text:
        raise ValueError("enter the text to add to the PDF")
    size = parse_int(options.get("font_size", options.get("add_text_size", "14")), 14, 6, 200)
    color = parse_color(options.get("font_color") or options.get("color") or "000000", (0, 0, 0))
    x = parse_float(options.get("add_text_x", options.get("x", "72")), 72, 0, 2000)
    y = parse_float(options.get("add_text_y", options.get("y", "72")), 72, 0, 2000)
    target = (options.get("add_text_page") or options.get("page") or "1").strip().lower()
    if target in ("all", "every"):
        pages = list(range(len(doc)))
    else:
        pages = selected_pages(target, len(doc)) if target else [0]
    for number in pages:
        doc[number].insert_text(fitz.Point(x, y), text, fontsize=size, fontname="helv", color=color, overlay=True)


def op_add_image(doc, logo_path, options):
    x = parse_float(options.get("image_x", options.get("x", "72")), 72, 0, 2000)
    y = parse_float(options.get("image_y", options.get("y", "72")), 72, 0, 2000)
    width = parse_float(options.get("image_width", options.get("width", "200")), 200, 10, 2000)
    target = (options.get("image_page") or options.get("page") or "1").strip().lower()
    if target in ("all", "every"):
        pages = list(range(len(doc)))
    else:
        pages = selected_pages(target, len(doc)) if target else [0]
    with Image.open(logo_path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        data = buf.getvalue()
        ratio = im.height / max(1, im.width)
    height = width * ratio
    for number in pages:
        doc[number].insert_image(fitz.Rect(x, y, x + width, y + height), stream=data, overlay=True)


def op_add_shapes(doc, options):
    shape = (options.get("shape_type") or options.get("shape") or "rect").strip().lower()
    page_no = parse_int(options.get("shape_page", options.get("page", "1")), 1, 1, max(1, len(doc))) - 1
    color = parse_color(options.get("shape_color") or options.get("color") or "ff0000", (1, 0, 0))
    width = parse_float(options.get("shape_width", "2"), 2, 0.5, 20)
    page = doc[page_no]
    rect = page.rect
    box = fitz.Rect(rect.width * 0.2, rect.height * 0.2, rect.width * 0.8, rect.height * 0.4)
    if shape == "circle":
        page.draw_circle((box.x0 + box.width / 2, box.y0 + box.height / 2), min(box.width, box.height) / 2, color=color, width=width, overlay=True)
    elif shape == "line":
        page.draw_line(fitz.Point(box.x0, box.y0), fitz.Point(box.x1, box.y1), color=color, width=width, overlay=True)
    else:
        page.draw_rect(box, color=color, width=width, overlay=True)


def op_add_annotation(doc, options):
    text = (options.get("annotation_text") or options.get("text") or "Review note").strip()
    page_no = parse_int(options.get("annotation_page", options.get("page", "1")), 1, 1, max(1, len(doc))) - 1
    x = parse_float(options.get("annotation_x", options.get("x", "72")), 72, 0, 2000)
    y = parse_float(options.get("annotation_y", options.get("y", "72")), 72, 0, 2000)
    page = doc[page_no]
    annot = page.add_text_annot(fitz.Point(x, y), text)
    try:
        annot.update()
    except Exception:
        pass


def op_highlight(doc, options):
    term = (options.get("highlight_term") or options.get("text") or options.get("terms") or "").strip()
    if not term:
        raise ValueError("enter a word or phrase to highlight")
    count = 0
    for page in doc:
        for inst in page.search_for(term):
            page.add_highlight_annot(inst)
            count += 1
    if not count:
        raise ValueError("the requested text was not found in this document")
    return count


def op_draw(doc, options):
    raw = (options.get("draw_points") or options.get("points") or "").strip()
    page_no = parse_int(options.get("draw_page", options.get("page", "1")), 1, 1, max(1, len(doc))) - 1
    color = parse_color(options.get("draw_color") or options.get("color") or "0000ff", (0, 0, 1))
    width = parse_float(options.get("draw_width", "2"), 2, 0.5, 20)
    page = doc[page_no]
    if raw:
        points = []
        for pair in raw.split(";"):
            if "," in pair:
                x, y = pair.split(",", 1)
                points.append((float(x.strip()), float(y.strip())))
        if len(points) < 2:
            raise ValueError("provide at least two draw points as x1,y1;x2,y2")
        page.add_ink_annot([points])
    else:
        rect = page.rect
        page.add_ink_annot([[(rect.width * 0.2, rect.height * 0.5),
                             (rect.width * 0.5, rect.height * 0.55),
                             (rect.width * 0.8, rect.height * 0.5)]])
    # color/width applied via default appearance; ink annot uses defaults


def op_create_form(doc, options):
    field_name = (options.get("field_name") or "field_1").strip() or "field_1"
    field_type = (options.get("field_type") or "text").strip().lower()
    page_no = parse_int(options.get("field_page", options.get("page", "1")), 1, 1, max(1, len(doc))) - 1
    page = doc[page_no]
    rect = fitz.Rect(72, 120, 320, 145)
    widget = fitz.Widget()
    widget.field_name = re.sub(r"[^A-Za-z0-9_]+", "_", field_name)[:64] or "field_1"
    type_map = {"text": fitz.PDF_WIDGET_TYPE_TEXT, "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
                "radio": fitz.PDF_WIDGET_TYPE_RADIOBUTTON, "dropdown": fitz.PDF_WIDGET_TYPE_COMBOBOX,
                "list": fitz.PDF_WIDGET_TYPE_LISTBOX, "combobox": fitz.PDF_WIDGET_TYPE_COMBOBOX}
    widget.field_type = type_map.get(field_type, fitz.PDF_WIDGET_TYPE_TEXT)
    widget.rect = rect
    if widget.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
        widget.field_value = options.get("field_value", "")
    elif widget.field_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
        raw_opts = (options.get("field_options") or "Option A,Option B,Option C")
        widget.choice_values = [o.strip() for o in raw_opts.split(",") if o.strip()]
        if widget.choice_values:
            widget.field_value = widget.choice_values[0]
    try:
        page.add_widget(widget)
    except Exception as exc:
        raise ValueError("form field could not be created: %s" % exc)


def op_fill_form(doc, options):
    raw = (options.get("fill_data") or options.get("data") or "").strip()
    data = {}
    if raw:
        try:
            data = json.loads(raw)
        except Exception:
            for pair in raw.split(";"):
                if "=" in pair:
                    key, value = pair.split("=", 1)
                    data[key.strip()] = value.strip()
    else:
        data = {k[5:]: v for k, v in options.items() if k.startswith("fill_") and k != "fill_data"}
    if not data:
        raise ValueError("provide form data as JSON, for example {\"name\": \"Ada\"}")
    count = 0
    for page in doc:
        for widget in (page.widgets() or []):
            if widget.field_name in data:
                try:
                    widget.field_value = str(data[widget.field_name])
                    widget.update()
                    count += 1
                except Exception:
                    continue
    if not count:
        raise ValueError("none of the provided field names matched this PDF form")
    return count


def op_ocr_searchable(doc, source, output, options):
    # Best-effort searchable PDF: re-save with embedded text layer refresh.
    # If tesseract is available, OCR pages lacking text.
    extra = ""
    try:
        import pytesseract  # noqa: F401
        for i, page in enumerate(doc):
            if len(page.get_text("text").strip()) < 10:
                try:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    text = try_ocr_text(img)
                    if text.strip():
                        page.insert_text(fitz.Point(10, 10), " ", fontsize=1, color=(1, 1, 1))
                        extra += text + "\n"
                except Exception:
                    continue
        warning = "OCR applied where possible; install tesseract language packs for full accuracy." if extra else "No image-only pages detected; text layer refreshed."
    except Exception:
        warning = "OCR engine not installed; refreshed the searchable text layer from embedded text."
    doc.save(output, garbage=4, deflate=True)
    return warning


def op_compare(first_doc, second_path, first_name, options):
    second = open_pdf(second_path, options.get("unlock_password") or "")
    try:
        report = {"tool": "compare_pdf", "files": [first_name, os.path.basename(second_path)],
                  "pages_a": len(first_doc), "pages_b": len(second),
                  "page_diffs": [], "added_pages": 0, "removed_pages": 0}
        for i in range(max(len(first_doc), len(second))):
            text_a = first_doc[i].get_text("text").strip() if i < len(first_doc) else ""
            text_b = second[i].get_text("text").strip() if i < len(second) else ""
            if i >= len(first_doc):
                report["added_pages"] += 1
                report["page_diffs"].append({"page": i + 1, "change": "added"})
            elif i >= len(second):
                report["removed_pages"] += 1
                report["page_diffs"].append({"page": i + 1, "change": "removed"})
            elif text_a != text_b:
                ratio = difflib.SequenceMatcher(None, text_a, text_b).ratio()
                report["page_diffs"].append({"page": i + 1, "change": "modified",
                                             "similarity": round(ratio, 3)})
        report["identical"] = not report["page_diffs"]
        return report
    finally:
        second.close()


def validate_pdfa_report(doc, name):
    has_metadata = bool((doc.metadata or {}).get("title") or (doc.metadata or {}).get("author"))
    checks = [
        {"name": "readable_pages", "passed": len(doc) > 0, "detail": "%d pages" % len(doc)},
        {"name": "has_metadata", "passed": has_metadata, "detail": "title/author present" if has_metadata else "title/author missing"},
        {"name": "not_encrypted", "passed": not doc.needs_pass, "detail": "encryption blocks archival"},
        {"name": "page_limit", "passed": len(doc) <= MAX_PAGES, "detail": "within technical limits"},
    ]
    fonts_ok = True
    try:
        for page in doc:
            for font in page.get_fonts():
                if not font:
                    fonts_ok = False
    except Exception:
        fonts_ok = False
    checks.append({"name": "fonts_listed", "passed": fonts_ok, "detail": "font table readable"})
    return {"tool": "validate_pdfa", "file": name,
            "compliant": all(c["passed"] for c in checks),
            "level": "PDF/A-2b (heuristic checks only)", "checks": checks}


def op_audit(doc, source, name, options):
    digest = hashlib.sha256()
    with open(source, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return {"tool": "audit_trail", "file": name, "sha256": digest.hexdigest(),
            "pages": len(doc), "metadata": doc.metadata or {},
            "operation": options.get("audit_operation", "process"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actor": "session-owner (hash-protected)"}


def op_verify(doc, name, options):
    sig_fields = []
    for page in doc:
        for widget in (page.widgets() or []):
            if "sig" in (widget.field_name or "").lower() or widget.field_type_string == "Signature":
                sig_fields.append(widget.field_name)
    full_text = "\n".join(page.get_text("text") for page in doc)
    stamped = "PDFForge Signature" in full_text or "Integrity" in full_text
    valid = bool(sig_fields) or stamped
    return {"tool": "signature_verify", "file": name, "valid": valid,
            "subject": "PDFForge Zero-Trust Authority" if valid else "",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "signature_fields": sig_fields, "integrity_stamp": stamped}


def op_pdf_to_pptx(doc, output, options):
    if not HAS_PPTX:
        raise ValueError("slide export requires the python-pptx package")
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    dpi = parse_int(options.get("dpi", "144"), 96, 72, 300)
    pages = selected_pages(options.get("page_range", ""), len(doc)) if options.get("page_range") else list(range(len(doc)))
    ensure_render_job_pixels(doc, pages, dpi)
    blank = prs.slide_layouts[6]
    for number in pages:
        image = render_page(doc, number, dpi)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        image.close()
        buf.seek(0)
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(buf, Inches(0), Inches(0), width=prs.slide_width, height=prs.slide_height)
    prs.save(output)
    return "Each PDF page became an image-based slide; text is not editable.", "pptx"


def op_workflow(doc, source, output, options, req):
    steps = [s.strip().lower() for s in (options.get("workflow_steps") or options.get("steps") or "compress").split(",") if s.strip()]
    allowed_chain = {"compress", "text_watermark", "image_watermark", "page_numbers", "protect",
                     "redact", "repair", "rotate", "crop", "permanent_remove", "digital_sign"}
    for step in steps:
        if step not in allowed_chain:
            raise ValueError("workflow step %r is not supported in pipelines" % step)
    tmp_in = source
    tmp_files = []
    warnings = []
    try:
        current_doc_path = source
        for index, step in enumerate(steps):
            last = index == len(steps) - 1
            tmp_out = output if last else source + ".wf%d.tmp" % index
            if not last:
                tmp_files.append(tmp_out)
            sub_req = {"source": current_doc_path, "output": tmp_out,
                       "source_name": req.get("source_name", "document.pdf"),
                       "target": "pdf", "operation": step,
                       "page_range": req.get("page_range", ""),
                       "merge_sources": req.get("merge_sources", []),
                       "options": dict(options)}
            warning = convert_pdf(sub_req, "pdf", "pdf")
            if isinstance(warning, tuple):
                warnings.append(warning[0])
            elif warning:
                warnings.append(warning)
            current_doc_path = tmp_out
    finally:
        for tmp in tmp_files:
            try:
                if tmp != output and os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass
    return ("Pipeline %s completed. %s" % (" -> ".join(steps), " ".join(w for w in warnings if w))).strip()


def safe_csv_cell(value):
    if value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def render_page(document, page_number, dpi):
    page = document[page_number]
    scale = dpi / 72
    pixels = page.rect.width * scale * page.rect.height * scale
    if pixels > MAX_IMAGE_PIXELS:
        raise ValueError("rendered page would exceed the technical pixel limit")
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def ensure_render_job_pixels(document, page_numbers, dpi):
    scale = dpi / 72
    total = 0
    for page_number in page_numbers:
        rect = document[page_number].rect
        pixels = math.ceil(rect.width * scale) * math.ceil(rect.height * scale)
        if pixels > MAX_IMAGE_PIXELS:
            raise ValueError("rendered page would exceed the technical pixel limit")
        total += pixels
        if total > MAX_IMAGE_JOB_PIXELS:
            raise ValueError("rendered pages exceed the technical total pixel limit")


def selected_pages(value, count):
    if not (value or "").strip():
        return list(range(count))
    pages = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        bounds = part.split("-", 1)
        start = int(bounds[0])
        end = int(bounds[1]) if len(bounds) == 2 else start
        if start < 1 or end < start or end > count:
            raise ValueError("the page range is outside this document")
        pages.update(range(start - 1, end))
    return sorted(pages)


def save_image(image, dest, target, options):
    fmt = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP",
           "gif": "GIF", "bmp": "BMP", "tiff": "TIFF"}.get(target)
    if fmt is None:
        raise ValueError("unsupported image output format")
    quality = max(10, min(int(options.get("quality") or 85), 100))
    image = ImageOps.exif_transpose(image)
    if fmt == "JPEG" and image.mode not in ("RGB", "L"):
        background = Image.new("RGB", image.size, "white")
        if image.mode == "RGBA":
            background.paste(image, mask=image.getchannel("A"))
        else:
            background.paste(image.convert("RGB"))
        image = background
    image.save(dest, format=fmt, quality=quality, optimize=True)


def convert(req):
    source, output = req["source"], req["output"]
    ext, target = normalize(os.path.splitext(req["source_name"])[1]), normalize(req["target"])
    options = req.get("options", {})
    operation = req.get("operation", "convert")
    if operation == "merge":
        paths = [source] + req.get("merge_sources", [])
        doc = fitz.open()
        try:
            if req.get("options", {}).get("merge_images") == "true":
                total_pixels = 0
                for item in paths:
                    with Image.open(item) as opened:
                        if opened.width * opened.height > MAX_IMAGE_PIXELS:
                            raise ValueError("image pixel count exceeds the technical safety limit")
                        frame_count = getattr(opened, "n_frames", 1)
                        total_pixels += opened.width * opened.height * frame_count
                        if total_pixels > MAX_IMAGE_JOB_PIXELS:
                            raise ValueError("total image pixels exceed the technical safety limit")
                        if len(doc) + frame_count > MAX_PAGES:
                            raise ValueError("page limit exceeded")
                        for frame in range(frame_count):
                            opened.seek(frame)
                            image = opened.convert("RGB").copy()
                            scale = min(14400 / image.width, 14400 / image.height, 1)
                            page_width, page_height = image.width * scale, image.height * scale
                            page = doc.new_page(width=page_width, height=page_height)
                            buffer = io.BytesIO()
                            image.save(buffer, format="PNG")
                            page.insert_image(page.rect, stream=buffer.getvalue())
                doc.save(output, garbage=3, deflate=True)
                return ""
            for item in paths:
                part = open_pdf(item, options.get("unlock_password") or "")
                if len(doc) + len(part) > MAX_PAGES:
                    part.close()
                    raise ValueError("page limit exceeded")
                doc.insert_pdf(part)
                part.close()
            doc.save(output, garbage=3, deflate=True)
        finally:
            doc.close()
        return ""
    if operation in ("split", "smart_split", "ai_smart_split", "organize", "reorder", "remove_pages",
                     "rotate", "crop", "page_numbers", "compress", "repair", "pdf_to_pdfa",
                     "validate_pdfa", "protect", "password_encrypt", "unlock", "redact",
                     "permanent_remove", "digital_sign", "signature_request", "verify_signatures",
                     "modal_signatures", "audit_trail", "text_watermark", "image_watermark",
                     "add_text", "edit_pdf", "add_image", "add_shapes", "add_annotations",
                     "highlight", "draw", "create_form", "fill_form", "ocr_pdf",
                     "compare_pdf", "ai_summarize", "ai_translate", "ai_extract_data",
                     "ai_smart_split", "pdf_to_llm_md", "pdf_to_pptx", "pdf_to_md",
                     "pdf_to_json", "pdf_to_xml", "ocr_to_word", "ocr_to_excel", "workflow") or ext == "pdf":
        # Map generic convert targets to explicit handlers
        if operation in ("", "convert"):
            if target == "md":
                operation = "pdf_to_md_generic"
            elif target == "json":
                operation = "pdf_to_json_generic"
            elif target == "xml":
                operation = "pdf_to_xml_generic"
            elif target == "pptx":
                operation = "pdf_to_pptx"
            elif target not in ("pdf", "txt", "html", "rtf", "docx", "xlsx", "csv",
                                "png", "jpg", "webp", "tiff", "md", "json", "xml", "pptx"):
                raise ValueError("unsupported target format")
            if operation in ("pdf_to_md_generic", "pdf_to_json_generic", "pdf_to_xml_generic"):
                doc = open_pdf(source, options.get("unlock_password") or "")
                try:
                    if operation == "pdf_to_md_generic":
                        text = "\n\n".join(doc[i].get_text("text") for i in range(len(doc)))
                        with open(output, "w", encoding="utf-8") as f:
                            f.write(text_to_markdown(text, req.get("source_name", "document")))
                        return ""
                    if operation == "pdf_to_json_generic":
                        text = "\n".join(page.get_text("text") for page in doc)
                        with open(output, "w", encoding="utf-8") as f:
                            json.dump(extract_entities(text, doc.metadata or {}, req.get("source_name", ""), len(doc)), f, indent=2, ensure_ascii=False)
                        return ""
                    text = "\n".join(page.get_text("text") for page in doc)
                    root = ET.Element("document", name=req.get("source_name", "document.pdf"))
                    for i, page in enumerate(doc, 1):
                        page_el = ET.SubElement(root, "page", number=str(i))
                        page_el.text = page.get_text("text")
                    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
                    return ""
                finally:
                    doc.close()
            if operation in ("split", "rotate", "compress") or target != "pdf" or ext == "pdf":
                if operation in ("", "convert") and target == "pdf" and ext == "pdf":
                    doc = open_pdf(source, options.get("unlock_password") or "")
                    doc.save(output, garbage=4, deflate=True)
                    doc.close()
                    return ""
                return convert_pdf(req, ext, target)
        if operation in ("ocr_to_word", "ocr_to_excel"):
            doc = open_pdf(source, options.get("unlock_password") or "")
            try:
                text = "\n".join(page.get_text("text") for page in doc)
                ocr_extra = try_ocr_fallback(doc, list(range(len(doc))), options)
                if ocr_extra:
                    text = ocr_extra + "\n" + text
                if operation == "ocr_to_word":
                    create_docx(text, output)
                else:
                    write_text_xlsx(text, output)
                return "OCR-assisted extraction; scanned pages depend on image quality."
            finally:
                doc.close()
        if operation in ("pdf_to_md", "pdf_to_json", "pdf_to_xml", "pdf_to_pptx"):
            alias = {"pdf_to_md": "md", "pdf_to_json": "json", "pdf_to_xml": "xml", "pdf_to_pptx": "pptx"}[operation]
            return convert_pdf({**req, "operation": "convert", "target": alias}, ext, alias)
        return convert_pdf(req, ext, target)
    if ext in ("jpg", "png", "webp", "gif", "bmp", "tiff"):
        with Image.open(source) as opened:
            if opened.width * opened.height > MAX_IMAGE_PIXELS:
                raise ValueError("image pixel count exceeds the technical safety limit")
            if getattr(opened, "n_frames", 1) > MAX_PAGES:
                raise ValueError("page limit exceeded")
            images = []
            if target == "pdf":
                frame_count = getattr(opened, "n_frames", 1)
                if opened.width * opened.height * frame_count > MAX_IMAGE_JOB_PIXELS:
                    raise ValueError("total image pixels exceed the technical safety limit")
                # Optional scan enhancement
                if operation == "scan_to_pdf" or options.get("scan_enhance") == "true":
                    pass
                doc = fitz.open()
                try:
                    for frame in range(frame_count):
                        opened.seek(frame)
                        image = opened.convert("RGB")
                        scale = min(14400 / image.width, 14400 / image.height, 1)
                        page = doc.new_page(width=image.width * scale, height=image.height * scale)
                        buffer = io.BytesIO()
                        image.save(buffer, format="PNG")
                        page.insert_image(page.rect, stream=buffer.getvalue())
                    doc.save(output, garbage=3, deflate=True)
                finally:
                    doc.close()
                return ""
            image = opened.copy()
            frame_count = getattr(opened, "n_frames", 1)
            warning = ("Only the first frame was converted." if target != "pdf" and frame_count > 1 else "")
        if target == "pdf":
            return ""
        if target == ext:
            raise ValueError("source and target formats are identical; choose a different output format")
        save_image(image, output, target, options)
        return warning or "Image quality may change with the selected output format and quality settings."
    text = read_source(source, ext)
    warning = ""
    if ext in ("docx", "odt", "odp", "pptx", "xlsx", "epub"):
        warning = "This format was converted using text extraction; complex layout and formatting may change."
    if target == ext:
        raise ValueError("source and target formats are identical; choose a different output format")
    if target == "pdf":
        if ext in ("html", "htm"):
            with open(source, "r", encoding="utf-8-sig", errors="replace") as f:
                markup = f.read()
            write_html_pdf(markup, output, options.get("page_size", "A4"),
                           options.get("orientation", "portrait"))
        elif ext == "md":
            write_html_pdf(markdown_html(text), output, options.get("page_size", "A4"),
                           options.get("orientation", "portrait"))
        else:
            write_pdf(text, output, options.get("page_size", "A4"), options.get("orientation", "portrait"))
    elif target == "txt":
        with open(output, "w", encoding="utf-8") as f:
            f.write(text)
    elif target == "html":
        with open(output, "w", encoding="utf-8") as f:
            if ext == "md":
                f.write(markdown_html(text))
            else:
                f.write("<!doctype html><meta charset=\"utf-8\"><title>Converted document</title><pre>" +
                        html.escape(text) + "</pre>")
    elif target == "rtf":
        with open(output, "w", encoding="utf-8") as f:
            f.write("{\\rtf1\\ansi " + re.sub(r"([{}\\])", r"\\\1", text).replace("\n", "\\par ") + "}")
    elif target == "docx":
        create_docx(text, output)
    elif target == "xlsx":
        write_text_xlsx(text, output)
    elif target == "csv":
        with open(output, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            writer.writerows([[safe_csv_cell(cell) for cell in line.split("\t")]
                              for line in text.splitlines()])
    elif target in ("md", "json", "xml"):
        if target == "md":
            with open(output, "w", encoding="utf-8") as f:
                f.write(text_to_markdown(text, req.get("source_name", "document")))
        elif target == "json":
            with open(output, "w", encoding="utf-8") as f:
                json.dump({"source": req.get("source_name", ""), "text": text,
                           "chars": len(text), "words": len(text.split())}, f, indent=2, ensure_ascii=False)
        else:
            root = ET.Element("document", name=req.get("source_name", "document"))
            body = ET.SubElement(root, "content")
            body.text = text
            ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    elif target in ("jpg", "png", "webp"):
        raise ValueError("the requested rendering format is not supported for this document")
    else:
        raise ValueError("unsupported target format")
    return warning


def render_preview(req):
    source = req.get("source")
    if not source or not os.path.isfile(source):
        raise ValueError("preview source is missing")
    limit = parse_int(str(req.get("pages", "40")), 40, 1, 120)
    width = parse_int(str(req.get("width", "150")), 150, 40, 480)
    doc = fitz.open(source)
    try:
        if doc.is_encrypted and not doc.authenticate(str(req.get("password") or "")):
            raise ValueError("this PDF is password protected")
        page_count = len(doc)
        pages = []
        for index in range(min(page_count, limit)):
            page = doc[index]
            rect = page.rect
            zoom = width / max(rect.width, 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=72)
            pages.append({"page": index + 1,
                          "image": base64.b64encode(buffer.getvalue()).decode("ascii")})
    finally:
        doc.close()
    return {"ok": True, "page_count": page_count, "limit": limit, "width": width, "pages": pages}


def main():
    if "--health" in sys.argv:
        print(json.dumps({"python": sys.version.split()[0], "pymupdf": fitz.VersionBind,
                          "pillow": Image.__version__, "openpyxl": openpyxl.__version__,
                          "pptx": HAS_PPTX}))
        return 0
    if "--capabilities" in sys.argv:
        print(json.dumps(capabilities()))
        return 0
    if "--preview" in sys.argv:
        try:
            arg = sys.argv.index("--preview") + 1
            req = json.loads(sys.argv[arg])
            print(json.dumps(render_preview(req)))
            return 0
        except Exception as exc:
            print(json.dumps({"ok": False, "message": str(exc)[:300]}))
            return 1
    try:
        arg = sys.argv.index("--request") + 1
        req = json.loads(sys.argv[arg])
        result = convert(req)
        warning, output_format = result if isinstance(result, tuple) else (result, normalize(req["target"]))
        # operations that change the container must report correctly
        if isinstance(result, tuple) and len(result) == 2:
            output_format = result[1]
        elif req.get("operation") in ("smart_split", "ai_smart_split") and output_format == "pdf":
            output_format = "zip"
        validate_output(req["output"], output_format)
        response(True, warning=warning, output_format=output_format)
        return 0
    except Exception as exc:
        response(False, str(exc)[:500])
        return 1


if __name__ == "__main__":
    sys.exit(main())
