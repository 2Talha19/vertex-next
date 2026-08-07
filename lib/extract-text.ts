/**
 * Extract plain text from .txt, .pdf, or images (.png/.jpg/.webp/.jfif).
 * Images → local Python EasyOCR (no vision API).
 * Text-poor PDFs → ask for screenshots (Python) or optional Gemini.
 */
import { ocrImage, ocrPdfWithGemini } from "./ocr";

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".jfif", ".jpe"];
const WEAK_PDF_CHARS = 80;

function mimeForImage(name: string, type: string): string {
  if (type.startsWith("image/")) {
    if (type === "image/jpg") return "image/jpeg";
    return type;
  }
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function extractTextFromFile(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const type = file.type || "";

  const isPdf = name.endsWith(".pdf") || type === "application/pdf";
  const isImage =
    IMAGE_EXT.some((ext) => name.endsWith(ext)) || type.startsWith("image/");
  const isTxt =
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    type.startsWith("text/") ||
    type === "application/octet-stream";

  if (isImage) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = (await ocrImage(buffer, mimeForImage(name, type))).trim();
    if (!text) throw new Error("No text found in this image");
    return text;
  }

  if (isPdf) {
    const buffer = Buffer.from(await file.arrayBuffer());
    // unpdf wraps the maintained Mozilla pdf.js — pdf-parse bundles a 2018-era
    // pdf.js that breaks under the Next.js bundler ("bad XRef entry" on valid
    // PDFs) and fails on modern xref-stream PDFs. unpdf handles both.
    const { extractText } = await import("unpdf");
    const parsed = await extractText(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      { mergePages: true }
    );
    let text = (parsed.text || "").trim();

    if (text.length < WEAK_PDF_CHARS) {
      if (
        process.env.ALLOW_GEMINI_PDF_OCR === "1" &&
        process.env.GEMINI_API_KEY
      ) {
        text = (await ocrPdfWithGemini(buffer)).trim();
      } else {
        throw new Error(
          "This PDF looks scanned (no text layer). Save pages as .png/.jpg and upload those — local Python OCR will read them (no API)."
        );
      }
    }

    if (!text) {
      throw new Error(
        "No text found in this PDF. Upload page images for local OCR."
      );
    }
    return text;
  }

  if (isTxt || !name.includes(".")) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("File is empty");
    return text;
  }

  throw new Error(
    "Unsupported file type. Upload .txt, .md, .pdf, or an image (.png/.jpg/.webp/.jfif)."
  );
}
