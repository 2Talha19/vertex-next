#!/usr/bin/env python3
"""
Persistent OCR server.

Prefers Tesseract (fast, like QuickSnip). EasyOCR only as fallback.

  npm run ocr:server
  # http://127.0.0.1:8765
"""

from __future__ import annotations

import json
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_lib import run_ocr, tesseract_available  # noqa: E402

HOST = "127.0.0.1"
PORT = int(__import__("os").environ.get("OCR_PORT", "8765"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "engine": "tesseract" if tesseract_available() else "easyocr",
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/ocr":
            self._json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            self._json(400, {"error": "invalid JSON"})
            return

        b64 = data.get("image_base64")
        if not b64:
            self._json(400, {"error": "missing image_base64"})
            return

        ext = data.get("ext") or ".png"
        if not str(ext).startswith("."):
            ext = "." + ext
        fast = bool(data.get("fast", True))
        langs = data.get("languages") or ["en"]
        # Default: Tesseract-first when available
        prefer_tess = data.get("prefer_tesseract")
        if prefer_tess is None:
            prefer_tess = tesseract_available()

        import base64

        try:
            blob = base64.b64decode(b64)
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(blob)
                tmp_path = Path(tmp.name)
            try:
                text = run_ocr(
                    tmp_path,
                    languages=list(langs),
                    fast=fast,
                    prefer_tesseract=bool(prefer_tess),
                )
            finally:
                tmp_path.unlink(missing_ok=True)
            self._json(200, {"ok": True, "text": text})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(e)})


def main() -> int:
    if tesseract_available():
        print("Tesseract found — fast OCR mode (QuickSnip-style).", flush=True)
    else:
        print(
            "Tesseract NOT found — will use EasyOCR (slower).\n"
            "Install: winget install --id UB-Mannheim.TesseractOCR",
            flush=True,
        )
        # Only warm EasyOCR if we must
        try:
            from ocr_lib import get_reader

            print("Warming EasyOCR (one-time)…", flush=True)
            get_reader(["en"])
        except Exception as e:  # noqa: BLE001
            print(f"EasyOCR warm failed: {e}", flush=True)

    print(f"OCR server ready on http://{HOST}:{PORT}", flush=True)
    print("Keep this window open while using Vertex image upload.", flush=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
