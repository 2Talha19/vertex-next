import { embedOne } from "./embed";
import { getSupabase } from "./supabase";

export type Match = {
  id: number;
  source: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

const MIN_SIMILARITY = 0.28;

/**
 * Prefix an uploaded file name with the user id so every user's chunks are
 * isolated: `u_<userId>__<name>`. This scoping lives entirely in the source
 * column — no schema change or shared RPC needed.
 */
export function scopedSource(userId: string, name: string): string {
  return `u_${userId}__${name}`;
}

/** Strip the user prefix for display in the UI. */
export function displaySource(source: string): string {
  const i = source.indexOf("__");
  return i > 0 && source.startsWith("u_") ? source.slice(i + 2) : source;
}

/** True if a source string belongs to this user. */
export function isOwnSource(userId: string, source: string): boolean {
  return source.startsWith(`u_${userId}__`);
}

function parseEmbedding(raw: string | number[]): number[] {
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Search ONLY the authenticated user's chunks. The shared match_documents RPC
 * searches everyone's data, so we fetch this user's rows via PostgREST (source
 * is prefixed with their id) and rank with cosine similarity in JS.
 */
export async function retrieveChunks(
  userId: string,
  question: string,
  matchCount = 6,
  filterSource?: string | null
): Promise<Match[]> {
  const embedding = await embedOne(question);
  const supabase = getSupabase();

  let query = supabase
    .from("documents")
    .select("id, source, chunk_index, content, embedding")
    .ilike("source", `u_${userId}__%`)
    .limit(500);

  // If a specific file is selected, only search that one — but never let a
  // source from another user's prefix through.
  if (filterSource && isOwnSource(userId, filterSource)) {
    query = query.eq("source", filterSource);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Search failed: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: number;
    source: string;
    chunk_index: number;
    content: string;
    embedding: string | number[];
  }>;

  return rows
    .map((r) => ({
      id: r.id,
      source: r.source,
      chunk_index: r.chunk_index,
      content: r.content,
      similarity: cosine(parseEmbedding(r.embedding), embedding),
    }))
    .filter((m) => m.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
}

/** Load chunks in order for summary / “what’s this about?” questions. */
export async function loadSourceChunks(
  userId: string,
  source: string,
  limit = 40
): Promise<Match[]> {
  if (!isOwnSource(userId, source)) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("id, source, chunk_index, content")
    .eq("source", source)
    .order("chunk_index", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Load source failed: ${error.message}`);
  return ((data ?? []) as Omit<Match, "similarity">[]).map((row) => ({
    ...row,
    similarity: 1,
  }));
}
