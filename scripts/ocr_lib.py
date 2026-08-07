"""
Shared OCR helpers — used by ocr_image.py and ocr_server.py.

Speed strategy (same idea as QuickSnip):
  1) Tesseract first — light & fast (no big neural net load)
  2) EasyOCR fallback — slower but sometimes better on messy images

QuickSnip itself is a Linux Wayland snipping UI — we reuse its OCR engine idea, not the desktop app.
"""

from __future__ import annotations

import os
from pathlib import Path

_reader = None
_reader_langs: tuple[str, ...] | None = None

# Common Windows install paths for UB Mannheim Tesseract
_TESS_CANDIDATES = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
]


def configure_tesseract() -> None:
    """Point pytesseract at tesseract.exe on Windows if needed."""
    import shutil

    import pytesseract

    if shutil.which("tesseract"):
        return
    for candidate in _TESS_CANDIDATES:
        if Path(candidate).is_file():
            pytesseract.pytesseract.tesseract_cmd = candidate
            return


def preprocess(image_path: Path, fast: bool = True):
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps

    img = Image.open(image_path)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    img = ImageOps.exif_transpose(img)
    w, h = img.size

    # Keep images modest for speed (Tesseract loves this)
    max_w = 1200 if fast else 1600
    if w > max_w:
        scale = max_w / w
        img = img.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.Resampling.BILINEAR,
        )
    elif w < 700:
        scale = 1000 / w
        img = img.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.Resampling.LANCZOS,
        )

    gray = img.convert("L")
    gray = ImageOps.autocontrast(gray, cutoff=0.5)
    gray = ImageEnhance.Contrast(gray).enhance(1.5)
    gray = ImageEnhance.Sharpness(gray).enhance(1.3)
    if not fast:
        gray = gray.filter(ImageFilter.MedianFilter(size=3))
    return gray


def get_reader(languages: list[str]):
    global _reader, _reader_langs
    key = tuple(languages)
    if _reader is None or _reader_langs != key:
        import easyocr

        _reader = easyocr.Reader(list(key), gpu=False, verbose=False)
        _reader_langs = key
    return _reader


def ocr_easyocr(image_path: Path, languages: list[str], fast: bool = True) -> str:
    import numpy as np

    processed = preprocess(image_path, fast=fast)
    arr = np.array(processed)
    reader = get_reader(languages)

    results = reader.readtext(
        arr,
        detail=1,
        paragraph=False,
        batch_size=4 if fast else 1,
        workers=0,
    )

    def sort_key(item):
        box = item[0]
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        return (min(ys), min(xs))

    rows = []
    min_conf = 0.2 if fast else 0.15
    for item in results:
        if len(item) == 3:
            _box, text, conf = item
        else:
            _box, text = item[0], item[1]
            conf = 1.0
        if conf is not None and conf < min_conf:
            continue
        text = (text or "").strip()
        if text:
            rows.append((_box, text, conf))

    rows.sort(key=sort_key)
    return "\n".join(t for _b, t, _c in rows).strip()


def ocr_tesseract(image_path: Path, fast: bool = True) -> str:
    import pytesseract

    configure_tesseract()
    processed = preprocess(image_path, fast=fast)
    # Same spirit as QuickSnip: Tesseract, fast block-of-text mode
    config = "--oem 3 --psm 6"
    text = pytesseract.image_to_string(processed, lang="eng", config=config)
    return (text or "").strip()


def tesseract_available() -> bool:
    try:
        import shutil

        import pytesseract

        configure_tesseract()
        if shutil.which("tesseract"):
            return True
        for candidate in _TESS_CANDIDATES:
            if Path(candidate).is_file():
                return True
        # May still work if pytesseract can find it
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def run_ocr(
    image_path: Path,
    languages: list[str] | None = None,
    fast: bool = True,
    prefer_tesseract: bool | None = None,
) -> str:
    langs = languages or ["en"]
    errors: list[str] = []

    # Default: Tesseract-first (QuickSnip-style speed) when installed
    if prefer_tesseract is None:
        prefer_tesseract = tesseract_available()

    order = (
        ("tesseract", "easyocr")
        if prefer_tesseract
        else ("easyocr", "tesseract")
    )

    for engine in order:
        try:
            if engine == "easyocr":
                text = ocr_easyocr(image_path, langs, fast=fast)
            else:
                text = ocr_tesseract(image_path, fast=fast)
            if text:
                return text
            errors.append(f"{engine} returned empty text")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{engine}: {e}")

    raise RuntimeError(
        "OCR failed.\n"
        "Fast path: install Tesseract (like QuickSnip uses):\n"
        "  winget install --id UB-Mannheim.TesseractOCR\n"
        "  pip install pytesseract\n"
        "Then restart: npm run ocr:server\n"
        "Details:\n- " + "\n- ".join(errors)
    )
