/**
 * Image OCR.
 * Hosted cascade (no local server needed):
 *   1. Gemini 2.5 Flash  — best quality, ~2s (GEMINI_API_KEY)
 *   2. Groq qwen vision  — free, reuses GROQ_API_KEY
 *   3. Hugging Face Qwen2.5-VL — optional (HF_TOKEN)
 *   4. Local Python (Tesseract/EasyOCR) — last resort
 * First engine that returns text wins.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const OCR_PORT = process.env.OCR_PORT || "8765";
const OCR_URL = `http://127.0.0.1:${OCR_PORT}`;

/** Ask the model to transcribe verbatim — never summarize. */
const OCR_PROMPT =
  "You are an OCR engine. Transcribe EVERY word, number, and symbol in this image " +
  "VERBATIM — exactly as written, including spelling, capitalization, punctuation, " +
  "headings, and lists. Keep table cells as readable lines. Do NOT summarize, " +
  "translate, fix, or rephrase anything. If text is hard to read, still write your " +
  "best verbatim guess. Output only the transcription, no commentary.";

function extFromMime(mime: string): string {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  return ".png";
}

function pythonBin(): string {
  return (
    process.env.PYTHON_PATH ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

let serverStart: Promise<boolean> | null = null;

async function healthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${OCR_URL}/health`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start ocr_server.py in the background if it is not already up. */
async function ensureOcrServer(): Promise<boolean> {
  if (await healthOk()) return true;
  if (serverStart) return serverStart;

  serverStart = (async () => {
    const script = path.join(process.cwd(), "scripts", "ocr_server.py");
    try {
      await fs.access(script);
    } catch {
      return false;
    }

    try {
      const child = spawn(pythonBin(), [script], {
        cwd: process.cwd(),
        windowsHide: true,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, OCR_PORT },
      });
      child.unref();
    } catch {
      return false;
    }

    // First warm-up can take ~30–90s while EasyOCR loads
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await healthOk()) return true;
    }
    return false;
  })();

  try {
    return await serverStart;
  } finally {
    // allow retry later if failed
    const ok = await serverStart;
    if (!ok) serverStart = null;
  }
}

async function ocrViaServer(
  buffer: Buffer,
  ext: string
): Promise<string | null> {
  const ready = (await healthOk()) || (await ensureOcrServer());
  if (!ready) return null;

  const res = await fetch(`${OCR_URL}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: buffer.toString("base64"),
      ext,
      fast: true,
      languages: ["en"],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    text?: string;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.text?.trim()) {
    throw new Error(data.error || "OCR server returned no text");
  }
  return data.text.trim();
}

async function ocrImageWithPythonSpawn(
  buffer: Buffer,
  ext: string
): Promise<string> {
  const script = path.join(process.cwd(), "scripts", "ocr_image.py");
  try {
    await fs.access(script);
  } catch {
    throw new Error(
      "Missing scripts/ocr_image.py. Keep that file in vertex-next/scripts/."
    );
  }

  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  const tmp = path.join(
    os.tmpdir(),
    `vertex-ocr-${randomBytes(8).toString("hex")}${suffix}`
  );
  await fs.writeFile(tmp, buffer);

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(
        pythonBin(),
        [script, tmp, "--stdout", "--fast"],
        {
          windowsHide: true,
          env: { ...process.env },
        }
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.stderr.on("data", (d) => {
        err += String(d);
      });
      child.on("error", (e) => {
        reject(
          new Error(
            `Cannot start Python (${pythonBin()}). Install Python 3 and run: pip install -r scripts/requirements-ocr.txt — ${e.message}`
          )
        );
      });
      child.on("close", (code) => {
        if (code === 0 && out.trim()) {
          resolve(out.trim());
          return;
        }
        reject(
          new Error(
            (err || out || `Python OCR exited with code ${code}`).trim() +
              "\nTip: run `npm run ocr:server` in another terminal for much faster OCR."
          )
        );
      });
    });
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/** OCR a photo / screenshot / page image: hosted models first, then local Python. */
export async function ocrImage(
  buffer: Buffer,
  mime: string
): Promise<string> {
  const ext = extFromMime(mime);
  const errors: string[] = [];
  // Hosted APIs cap image sizes (Groq ≈ 20 MB) — skip them for huge uploads.
  const hostedOk = buffer.length <= 20 * 1024 * 1024;

  // 1) Hosted Gemini — best quality, no local processes.
  if (hostedOk && process.env.GEMINI_API_KEY) {
    try {
      return await ocrImageWithGemini(buffer, mime);
    } catch (e) {
      errors.push(`gemini: ${(e as Error).message}`);
    }
  }

  // 2) Groq vision — reuses the existing GROQ_API_KEY (free tier).
  if (hostedOk && process.env.GROQ_API_KEY) {
    try {
      const text = await ocrImageWithGroq(buffer, mime);
      if (text) return text;
      errors.push("groq: returned no text");
    } catch (e) {
      errors.push(`groq: ${(e as Error).message}`);
    }
  }

  // 3) Hugging Face Inference (Qwen2.5-VL) — optional, needs HF_TOKEN.
  if (hostedOk && process.env.HF_TOKEN) {
    try {
      const text = await ocrImageWithHf(buffer, mime);
      if (text) return text;
      errors.push("hf: returned no text");
    } catch (e) {
      errors.push(`hf: ${(e as Error).message}`);
    }
  }

  // 4) Local Python (Tesseract → EasyOCR).
  try {
    const viaServer = await ocrViaServer(buffer, ext);
    if (viaServer) return viaServer;
  } catch (e) {
    errors.push(`server: ${(e as Error).message}`);
  }

  try {
    return await ocrImageWithPythonSpawn(buffer, ext);
  } catch (e) {
    errors.push(`oneshot: ${(e as Error).message}`);
  }

  throw new Error(
    "Image OCR failed on all engines (Gemini, Groq, local Python). " +
      "Check the image (clear, well-lit, straight) and try again. " +
      `Details: ${errors.join(" | ")}`
  );
}

/** Gemini only accepts these image MIME types for inline_data. */
const GEMINI_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];

/** One shared call to Gemini: image or PDF bytes in, extracted plain text out. */
async function geminiExtractText(
  buffer: Buffer,
  mime: string,
  prompt: string
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY in .env.local");
  }

  const model = process.env.GEMINI_OCR_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mime,
                data: buffer.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini OCR failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("\n")
      .trim() ?? "";

  if (!text) throw new Error("Gemini returned no text");
  return text;
}

export async function ocrImageWithGemini(
  buffer: Buffer,
  mime: string
): Promise<string> {
  // .gif / odd types aren't accepted by Gemini — fail fast so the next
  // engine (Groq / local) runs instead of wasting a round-trip on a 400.
  if (!GEMINI_IMAGE_MIMES.includes(mime)) {
    throw new Error(`Gemini does not accept ${mime}; trying next engine`);
  }
  return geminiExtractText(buffer, mime, OCR_PROMPT);
}

export async function ocrPdfWithGemini(buffer: Buffer): Promise<string> {
  return geminiExtractText(
    buffer,
    "application/pdf",
    "You are an OCR engine. Transcribe EVERY word, number, and symbol in this PDF VERBATIM. Keep headings, lists, and table rows as readable lines. Do NOT summarize or rephrase. Output only the transcription, no commentary."
  );
}

/**
 * Shared OpenAI-compatible image→text call (Groq, Hugging Face router).
 * Sends the image as a base64 data URI, asks for verbatim transcription,
 * and strips any <think> reasoning block the model may emit.
 */
async function ocrViaOpenAiCompatible(opts: {
  url: string;
  token: string;
  model: string;
  buffer: Buffer;
  mime: string;
  label: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:${opts.mime};base64,${opts.buffer.toString("base64")}`,
              },
            },
          ],
        },
      ],
      ...(opts.temperature !== undefined
        ? { temperature: opts.temperature }
        : {}),
      max_tokens: 4096, // long/dense pages need headroom — 2000 truncates
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      `${opts.label} OCR failed (${res.status}): ${
        data.error?.message ?? JSON.stringify(data).slice(0, 200)
      }`
    );
  }

  let text = data.choices?.[0]?.message?.content?.trim() ?? "";
  // qwen emits a <think> reasoning block before the answer — drop it.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const openThink = text.indexOf("<think");
  if (openThink !== -1) text = text.slice(0, openThink).trim();
  if (!text) throw new Error(`${opts.label} OCR returned no text`);
  return text;
}

/** OpenAI-compatible image → text via Groq's multimodal model (qwen). */
export async function ocrImageWithGroq(
  buffer: Buffer,
  mime: string
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Missing GROQ_API_KEY in .env.local");

  return ocrViaOpenAiCompatible({
    url: "https://api.groq.com/openai/v1/chat/completions",
    token: key,
    model: process.env.GROQ_OCR_MODEL || "qwen/qwen3.6-27b",
    buffer,
    mime,
    label: "Groq",
    temperature: 0,
  });
}

/**
 * Hugging Face Inference (OpenAI-compatible router) — optional, needs HF_TOKEN.
 * Qwen2.5-VL is a top open OCR model. Free tier is credit-limited, so this is
 * a fallback, not the default. If the plain model id 404s on your token,
 * try the ":fastest" suffix, e.g. Qwen/Qwen2.5-VL-7B-Instruct:fastest.
 */
export async function ocrImageWithHf(
  buffer: Buffer,
  mime: string
): Promise<string> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("Missing HF_TOKEN in .env.local");

  return ocrViaOpenAiCompatible({
    url: "https://router.huggingface.co/v1/chat/completions",
    token,
    model: process.env.HF_OCR_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct",
    buffer,
    mime,
    label: "Hugging Face",
  });
}
