#!/usr/bin/env python3
"""
One-shot image → text (slower: reloads model each run).
Prefer: npm run ocr:server  (keeps model warm)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_lib import run_ocr  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Image → text OCR")
    parser.add_argument("image", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--stdout", action="store_true")
    parser.add_argument("--lang", default="en")
    parser.add_argument(
        "--fast",
        action="store_true",
        default=True,
        help="Faster (smaller image). Default on.",
    )
    parser.add_argument(
        "--quality",
        action="store_true",
        help="Slower, slightly better OCR",
    )
    parser.add_argument(
        "--tesseract",
        action="store_true",
        help="Try Tesseract first (very fast if installed)",
    )
    args = parser.parse_args()

    if not args.image.exists():
        print(f"File not found: {args.image}", file=sys.stderr)
        return 1

    langs = [x.strip() for x in args.lang.split(",") if x.strip()]
    try:
        text = run_ocr(
            args.image,
            languages=langs or ["en"],
            fast=not args.quality,
            prefer_tesseract=args.tesseract,
        )
    except Exception as e:  # noqa: BLE001
        print(str(e), file=sys.stderr)
        return 1

    if not text:
        print("No text found in image.", file=sys.stderr)
        return 2

    if args.output:
        args.output.write_text(text, encoding="utf-8")
        if not args.stdout:
            print(f"Wrote {len(text)} characters → {args.output}")

    if args.stdout or not args.output:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
