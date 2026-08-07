# OCR — hosted cascade first (fastest, no server)

**Vertex OCRs images via hosted APIs by default** (~2s, exact text, no PowerShell):

1. **Gemini 2.5 Flash** (`GEMINI_API_KEY`) — verbatim transcription prompt
2. **Groq qwen vision** (`GROQ_API_KEY`, model `qwen/qwen3.6-27b`) — free tier
3. **Hugging Face Qwen2.5-VL** (`HF_TOKEN`) — optional, credit-limited
4. Local Python below — **last resort** only

The local Python OCR below is only a **fallback** when the hosted engines are missing or fail.

## Old local path (fallback only)
[QuickSnip](https://github.com/Ronin-CK/QuickSnip) inspired the local engine idea → **Tesseract first**, EasyOCR only if needed.

## Setup (once)

```powershell
winget install --id UB-Mannheim.TesseractOCR -e
pip install -r scripts\requirements-ocr.txt
```

Close and reopen the terminal after installing Tesseract.

## Run the fallback (only if you skip GEMINI_API_KEY)

```powershell
cd C:\Users\HP\ai-internship\vertex-next
npm run ocr:server
```

You should see: `Tesseract found — fast OCR mode`

**Note:** the local server is only needed if you don't set `GEMINI_API_KEY`. With the key set, image uploads work with zero local processes.
