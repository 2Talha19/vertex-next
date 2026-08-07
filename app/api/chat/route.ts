/**
 * POST /api/chat — Vertex agent (streaming NDJSON).
 */
import { runVertexAgent, type ChatTurn } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    message?: string;
    source?: string | null;
    sources?: string[];
    history?: ChatTurn[];
  };

  if (!body.message?.trim()) {
    return new Response("No message provided", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runVertexAgent({
          message: body.message!.trim(),
          filterSource: body.source ?? null,
          availableSources: body.sources ?? [],
          history: body.history ?? [],
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
