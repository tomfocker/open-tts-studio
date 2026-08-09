"""Local ebook import for the Doubao prefetch pipeline.

The reader integration remains useful for people who keep books in Legado, but
it should not be a prerequisite for turning a normal TXT or EPUB into a
chaptered audio book.  This module deliberately returns the same ``bookInfo``
and ``chaptersInfo`` contract consumed by ``DoubaoPrefetchManager``.  The
manager already supports inline chapter content, so no second synthesis queue
or cache format is introduced here.
"""

from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser
from io import BytesIO
from pathlib import PurePosixPath
from urllib.parse import unquote
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, File, HTTPException, UploadFile


router = APIRouter(prefix="/v1/doubao/books", tags=["doubao-books"])

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MAX_EXTRACTED_BYTES = 40 * 1024 * 1024
MAX_IMPORTED_TEXT_BYTES = 8 * 1024 * 1024
MAX_CHAPTERS = 500
MAX_CHAPTER_TEXT_LENGTH = 320_000
_CHAPTER_HEADING = re.compile(
    r"^\s*(?:第\s*[零一二三四五六七八九十百千万两\d]+\s*[章节回卷部篇]|(?:序章|楔子|引子|前言|后记|尾声)|(?:chapter|part|volume)\s+\d+).*",
    re.IGNORECASE,
)


def _success(data: object, message: str) -> dict:
    return {"success": True, "data": data, "message": message}


class _TextExtractor(HTMLParser):
    """Small dependency-free HTML-to-text extractor for EPUB chapter files."""

    _block_tags = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}
    _ignored_tags = {"script", "style", "head", "title", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.casefold()
        if lowered in self._ignored_tags:
            self._ignored_depth += 1
        if not self._ignored_depth and lowered in self._block_tags:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if lowered in self._ignored_tags and self._ignored_depth:
            self._ignored_depth -= 1
        if not self._ignored_depth and lowered in self._block_tags:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)

    def text(self) -> str:
        rows = (re.sub(r"\s+", " ", row).strip() for row in "".join(self.parts).splitlines())
        return "\n".join(row for row in rows if row)


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("无法识别文本编码，请将文件另存为 UTF-8、UTF-16 或 GB18030 后重试。")


def _normalise_text(value: str) -> str:
    rows = (re.sub(r"[ \t]+", " ", row).strip() for row in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    return "\n".join(row for row in rows if row)


def _split_txt_chapters(text: str, fallback_title: str) -> list[tuple[str, str]]:
    normalized = _normalise_text(text)
    if not normalized:
        raise ValueError("电子书正文为空。")
    chapters: list[tuple[str, list[str]]] = []
    title = fallback_title
    content: list[str] = []
    for row in normalized.splitlines():
        if _CHAPTER_HEADING.match(row) and content:
            chapters.append((title, content))
            title, content = row[:160], []
        elif _CHAPTER_HEADING.match(row) and not content:
            title = row[:160]
        else:
            content.append(row)
    if content:
        chapters.append((title, content))
    if not chapters:
        chapters = [(fallback_title, [normalized])]
    return [(name or fallback_title, "\n".join(rows)) for name, rows in chapters]


def _find_epub_opf(archive: ZipFile) -> str:
    try:
        root = ElementTree.fromstring(archive.read("META-INF/container.xml"))
    except KeyError as exc:
        raise ValueError("该 EPUB 缺少 META-INF/container.xml。") from exc
    except ElementTree.ParseError as exc:
        raise ValueError("该 EPUB 的容器目录无法解析。") from exc
    rootfile = root.find(".//{*}rootfile")
    full_path = rootfile.get("full-path") if rootfile is not None else ""
    if not full_path:
        raise ValueError("该 EPUB 未声明 OPF 书籍目录。")
    return full_path


def _parse_epub(data: bytes, fallback_title: str) -> list[tuple[str, str]]:
    try:
        with ZipFile(BytesIO(data)) as archive:
            infos = archive.infolist()
            extracted = sum(info.file_size for info in infos)
            if extracted > MAX_EXTRACTED_BYTES:
                raise ValueError("EPUB 解压后的正文过大（上限 40 MB）。")
            opf_path = _find_epub_opf(archive)
            try:
                package = ElementTree.fromstring(archive.read(opf_path))
            except (KeyError, ElementTree.ParseError) as exc:
                raise ValueError("该 EPUB 的 OPF 书籍目录无法解析。") from exc
            manifest = {
                item.get("id", ""): item.get("href", "")
                for item in package.findall(".//{*}manifest/{*}item")
                if item.get("id") and item.get("href")
            }
            spine = [item.get("idref", "") for item in package.findall(".//{*}spine/{*}itemref")]
            if not spine:
                raise ValueError("该 EPUB 没有可读取的正文目录。")
            base = PurePosixPath(opf_path).parent
            chapters: list[tuple[str, str]] = []
            for position, item_id in enumerate(spine, start=1):
                href = manifest.get(item_id)
                if not href:
                    continue
                clean_href = unquote(href.split("#", 1)[0].split("?", 1)[0])
                path = str((base / clean_href).as_posix())
                try:
                    raw = archive.read(path)
                except KeyError:
                    continue
                extractor = _TextExtractor()
                extractor.feed(_decode_text(raw))
                text = _normalise_text(extractor.text())
                if not text:
                    continue
                rows = text.splitlines()
                title = rows[0] if rows and (_CHAPTER_HEADING.match(rows[0]) or len(rows[0]) <= 80) else f"第 {position} 章"
                body = "\n".join(rows[1:]) if title == rows[0] and len(rows) > 1 else text
                chapters.append((title[:160] or f"第 {position} 章", body[:MAX_CHAPTER_TEXT_LENGTH]))
                if len(chapters) >= MAX_CHAPTERS:
                    break
    except BadZipFile as exc:
        raise ValueError("EPUB 文件损坏或不是有效的 ZIP 文件。") from exc
    if not chapters:
        raise ValueError("未能从该 EPUB 读取到正文。")
    return chapters


def _import_book(filename: str, data: bytes) -> dict:
    source_name = filename.strip() or "未命名电子书"
    suffix = PurePosixPath(source_name).suffix.casefold()
    title = PurePosixPath(source_name).stem.strip() or "未命名电子书"
    if suffix == ".txt":
        chapters = _split_txt_chapters(_decode_text(data), title)
    elif suffix == ".epub":
        chapters = _parse_epub(data, title)
    else:
        raise ValueError("目前支持 TXT 和 EPUB 文件。")
    content_fingerprint = hashlib.sha256(data).hexdigest()[:16]
    book_id = f"local-{content_fingerprint}"
    book_url = f"local://{book_id}"
    payload_chapters = []
    imported_bytes = 0
    truncated = False
    for index, (chapter_title, content) in enumerate(chapters[:MAX_CHAPTERS]):
        text = content.strip()[:MAX_CHAPTER_TEXT_LENGTH]
        if not text:
            continue
        encoded = text.encode("utf-8")
        available = MAX_IMPORTED_TEXT_BYTES - imported_bytes
        if available <= 0:
            truncated = True
            break
        if len(encoded) > available:
            text = encoded[:available].decode("utf-8", errors="ignore").rstrip()
            encoded = text.encode("utf-8")
            truncated = True
        if not text:
            break
        payload_chapters.append(
            {
                "chapterId": f"chapter-{index + 1:04d}",
                "chapterTitle": chapter_title,
                "chapterUrl": f"{book_url}/chapter-{index + 1:04d}",
                "chapterIndex": index,
                "content": text,
            }
        )
        imported_bytes += len(encoded)
        if truncated:
            break
    if not payload_chapters:
        raise ValueError("电子书没有可用于生成的章节内容。")
    return {
        "bookInfo": {"bookId": book_id, "bookName": title, "bookUrl": book_url, "source": "local"},
        "chaptersInfo": payload_chapters,
        "sourceName": source_name,
        "truncated": truncated or len(chapters) > len(payload_chapters),
    }


@router.post("/import")
async def import_doubao_ebook(file: UploadFile = File(...)) -> dict:
    filename = file.filename or ""
    if PurePosixPath(filename).suffix.casefold() not in {".txt", ".epub"}:
        raise HTTPException(status_code=400, detail="请选择 TXT 或 EPUB 电子书。")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="上传文件为空。")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="电子书文件超过 12 MB 上限，请拆分后导入。")
    try:
        result = _import_book(filename, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _success(result, f"已解析《{result['bookInfo']['bookName']}》，共 {len(result['chaptersInfo'])} 章")
