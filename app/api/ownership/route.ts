/**
 * GET /api/ownership — returns the authenticated user's uploaded documents
 * (from the documents table) plus a summary of the storage buckets in this
 * project, so the UI can show what belongs to whom. Requires a session token.
 */
import { requireUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { displaySource } from "@/lib/retrieve";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabase();

  // 1) The user's own documents, grouped by source.
  const { data: rows, error } = await supabase
    .from("documents")
    .select("source, chunk_index")
    .ilike("source", `u_${user.id}__%`)
    .limit(1000);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  const bySource = new Map<
    string,
    { source: string; chunks: number; lastChunk: number }
  >();
  for (const r of (rows ?? []) as { source: string; chunk_index: number }[]) {
    const cur = bySource.get(r.source) ?? {
      source: r.source,
      chunks: 0,
      lastChunk: -1,
    };
    cur.chunks += 1;
    cur.lastChunk = Math.max(cur.lastChunk, r.chunk_index);
    bySource.set(r.source, cur);
  }

  const myDocuments = [...bySource.values()]
    .map((d) => ({
      name: displaySource(d.source),
      source: d.source,
      chunks: d.chunks,
      size: Math.max(d.lastChunk + 1, d.chunks),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 2) Bucket ownership — list storage buckets so the UI can show which
  //    user owns which bucket (bucket id is `vertex-<userId>`).
  let buckets: { id: string; owner: string | null; public: boolean }[] = [];
  try {
    const { data } = await supabase.storage.listBuckets();
    buckets = (data ?? [])
      .filter((b) => b.id.startsWith("vertex-"))
      .map((b) => ({
        id: b.id,
        owner: b.id.replace(/^vertex-/, ""),
        public: !!b.public,
      }));
  } catch {
    // buckets listing is best-effort
  }

  return new Response(
    JSON.stringify({
      user: { id: user.id, email: user.email },
      myDocuments,
      buckets,
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}
