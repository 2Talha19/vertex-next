/**
 * POST /api/chat — Vertex agent (streaming NDJSON).
 * Requires a valid Supabase session token (Authorization: Bearer <token>).
 */
import { runVertexAgent, type ChatTurn } from "@/lib/agent";
import { requireUser } from "@/lib/auth";
import { displaySource, scopedSource } from "@/lib/retrieve";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as {
    message?: string;
    source?: string | null;
    sources?: string[];
    history?: ChatTurn[];
    style?: string;
  };

  if (!body.message?.trim()) {
    return new Response("No message provided", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Re-scope every source to THIS user — covers both new prefixed names
        // and old saved chats that still carry unprefixed names.
        const scope = (s: string) => scopedSource(user.id, displaySource(s));
        const filterSource = body.source ? scope(body.source) : null;
        const availableSources = (body.sources ?? []).map(scope);

        // Does this user have ANY uploaded docs? If so, route substantive
        // questions to the docs agent so their own files get searched.
        const supabase = getSupabase();
        const { count } = await supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .ilike("source", `u_${user.id}__%`)
          .limit(1);
        const hasDocs = (count ?? 0) > 0;

        for await (const event of runVertexAgent({
          message: body.message!.trim(),
          userId: user.id,
          filterSource,
          availableSources,
          history: body.history ?? [],
          style: body.style,
          hasDocs,
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              text: (e as Error).message,
            }) + "\n"
          )
        );
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
