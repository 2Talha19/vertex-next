/**
 * POST /api/upload — stream progress as NDJSON while OCR → chunk → embed → save.
 */
import { chunkText } from "@/lib/chunk";
import { embedTextsBatched } from "@/lib/embed";
import { extractTextFromFile } from "@/lib/extract-text";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type ProgressEvent =
  | { type: "status"; text: string }
  | { type: "done"; source: string; chunks: number; preview?: string }
  | { type: "error"; text: string };

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const form = await req.formData();
  const file = form.get("file");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        const missing = [
          "SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "JINA_API_KEY",
        ].filter((k) => !process.env[k]);
        if (missing.length) {
          send({
            type: "error",
            text: `Missing in .env.local: ${missing.join(", ")}`,
          });
          return;
        }

        if (!(file instanceof File)) {
          send({ type: "error", text: "No file uploaded" });
          return;
        }

        const name = (file.name || "").toLowerCase();
        const isImage =
          /\.(png|jpe?g|webp|gif|jfif)$/i.test(name) ||
          (file.type || "").startsWith("image/");

        send({ type: "status", text: "Reading file…" });
        if (isImage) {
          const engine = process.env.GEMINI_API_KEY
            ? "Gemini"
            : process.env.GROQ_API_KEY
              ? "Groq vision"
              : process.env.HF_TOKEN
                ? "Hugging Face Qwen"
                : "local Python";
          send({ type: "status", text: `OCR (${engine})…` });
        } else {
          send({ type: "status", text: "Extracting text…" });
        }

        const text = await extractTextFromFile(file);
        const source = file.name || "upload.txt";
        send({
          type: "status",
          text: `Got ${text.length.toLocaleString()} characters of text`,
        });

        const chunks = chunkText(text, 500, 50);
        if (chunks.length === 0) {
          send({ type: "error", text: "No text chunks produced" });
          return;
        }

        send({
          type: "status",
          text: `Split into ${chunks.length} chunks — embedding…`,
        });

        const embeddings = await embedTextsBatched(
          chunks,
          6,
          async (done, total) => {
            send({
              type: "status",
              text: `Embedding vectors ${done}/${total}…`,
            });
          }
        );

        send({ type: "status", text: "Saving to Supabase…" });

        const rows = chunks.map((content, chunk_index) => ({
          source,
          chunk_index,
          content,
          embedding: embeddings[chunk_index],
        }));

        const supabase = getSupabase();
        await supabase.from("documents").delete().eq("source", source);
        const { error } = await supabase.from("documents").insert(rows);
        if (error) {
          send({
            type: "error",
            text: `Supabase insert failed: ${error.message}`,
          });
          return;
        }

        send({
          type: "done",
          source,
          chunks: rows.length,
          preview: text.slice(0, 280),
        });
      } catch (e) {
        console.error("Upload error:", e);
        send({ type: "error", text: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
