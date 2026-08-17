const JINA_URL = "https://api.jina.ai/v1/embeddings";
const MODEL = "jina-embeddings-v3";

// Jina v3 supports retrieval-specific tasks. The document side (passages) and
// the question side (query) use different tasks because the two sides have
// different shapes — a short question vs. a long paragraph. Using the right
// task on each side materially improves match quality.
export type JinaTask = "retrieval.passage" | "retrieval.query";

async function embedMany(
  texts: string[],
  task: JinaTask
): Promise<number[][]> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error("Missing JINA_API_KEY");

  const res = await fetch(JINA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      task,
      input: texts,
    }),
  });

  if (!res.ok) {
    throw new Error(`Jina embeddings failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };

  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Embed in small batches so the UI can show live progress. */
export async function embedTextsBatched(
  texts: string[],
  batchSize = 6,
  onProgress?: (done: number, total: number) => void | Promise<void>
): Promise<number[][]> {
  const out: number[][] = [];
  const total = texts.length;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vecs = await embedMany(batch, "retrieval.passage");
    out.push(...vecs);
    if (onProgress) await onProgress(Math.min(i + batch.length, total), total);
  }
  if (out.length === 0) throw new Error("Jina returned no embeddings");
  return out;
}

// Use at search time — embeds the user's question.
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embedMany([text], "retrieval.query");
  if (!vec) throw new Error("Jina returned no embedding");
  return vec;
}
