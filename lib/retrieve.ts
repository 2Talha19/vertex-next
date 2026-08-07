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

export async function retrieveChunks(
  question: string,
  matchCount = 6,
  filterSource?: string | null
): Promise<Match[]> {
  const embedding = await embedOne(question);
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_source: filterSource ?? null,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);
  const matches = (data ?? []) as Match[];
  return matches.filter((m) => m.similarity >= MIN_SIMILARITY);
}

/** Load chunks in order for summary / “what’s this about?” questions. */
export async function loadSourceChunks(
  source: string,
  limit = 40
): Promise<Match[]> {
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
