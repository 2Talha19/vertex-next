/**
 * POST /api/upload — stream progress as NDJSON while OCR → chunk → embed → save.
 * Requires a valid Supabase session token (Authorization: Bearer <token>).
 * Every file is stored in the authenticated user's own storage bucket and its
 * chunks are scoped in the documents table with a `u_<userId>__` source prefix,
 * so no user ever sees another user's uploads.
 */
import { chunkText } from "@/lib/chunk";
import { embedTextsBatched } from "@/lib/embed";
import { extractTextFromFile } from "@/lib/extract-text";
import { requireUser } from "@/lib/auth";
import { scopedSource } from "@/lib/retrieve";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — keep server memory bounded

type ProgressEvent =
  | { type: "status"; text: string }
  | { type: "done"; source: string; chunks: number; preview?: string }
  | { type: "error"; text: string };

export async function POST(req: Request) {
  const encoder = new TextEncoder();

  const user = await requireUser(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    file = null; // malformed/empty body — handled as "no file" below
  }

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

        // Server-side size + type enforcement (the UI also checks, but the API
        // must never trust the client).
        if (file.size > MAX_BYTES) {
          send({
            type: "error",
            text: `File is too large — max 25 MB (this one is ${Math.round(
              file.size / 1024 / 1024
            )} MB).`,
          });
          return;
        }

        const name = (file.name || "").toLowerCase();
        const isImage =
          /\.(png|jpe?g|webp|gif|jfif)$/i.test(name) ||
          (file.type || "").startsWith("image/");
        const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
        const isText =
          /\.(txt|md)$/i.test(name) || (file.type || "").startsWith("text/");
        if (!isImage && !isPdf && !isText) {
          send({
            type: "error",
            text: "Unsupported file type — upload images, PDFs, or .txt/.md files.",
          });
          return;
        }

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
        const source = scopedSource(user.id, file.name || "upload.txt");
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

        const supabase = getSupabase();

        // 1) Store the raw file in THIS user's own storage bucket (created on
        //    demand, never shared with other users).
        const bucket = `vertex-${user.id}`;
        try {
          const { data: buckets } = await supabase.storage.listBuckets();
          if (!buckets?.some((b) => b.id === bucket)) {
            await supabase.storage.createBucket(bucket, { public: false });
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { error: upErr } = await supabase.storage
            .from(bucket)
            .upload(source, bytes, {
              contentType: file.type || "application/octet-stream",
              upsert: true,
            });
          if (!upErr) {
            send({
              type: "status",
              text: "Saved original to your private bucket",
            });
          }
        } catch (e) {
          console.error("Bucket upload failed (continuing):", e);
          send({
            type: "status",
            text: "Note: original file archive skipped — chunks saved anyway",
          });
        }

        // 2) Index the chunks, scoped to this user (delete only their old rows
        //    for the same source).
        const rows = chunks.map((content, chunk_index) => ({
          source,
          chunk_index,
          content,
          embedding: embeddings[chunk_index],
        }));

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
