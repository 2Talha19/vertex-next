/**
 * Vertex agent for Ask Peham's Docs.
 * - Docs search is done in code (no fragile tool-calls for search)
 * - Weather still uses a tool when needed
 * - Chat history supports follow-ups like "and private notes?"
 */
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  expandSearchQuery,
  isBroadDocQuestion,
  isImageSource,
  wantsFullFileRead,
} from "./doc-intent";
import { getFailedGeneration, parseGroqFailedTool } from "./groq-tools";
import {
  loadSourceChunks,
  retrieveChunks,
  type Match,
} from "./retrieve";
import { resolveDocSource } from "./resolve-source";
import { routeMessage } from "./router";
import { getWeather } from "./weather";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; args: string }
  | { type: "token"; text: string }
  | {
      type: "done";
      citations: {
        label: string;
        source: string;
        chunk_index: number;
        similarity: number;
        content: string;
      }[];
    }
  | { type: "error"; text: string };

export type ChatTurn = { role: "user" | "bot"; text: string };

const weatherTool: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
    },
  },
];

function toCitations(matches: Match[], limit = 6) {
  return matches.slice(0, limit).map((m, i) => ({
    label: `Source ${i + 1}`,
    source: m.source,
    chunk_index: m.chunk_index,
    similarity: Math.round(m.similarity * 1000) / 10,
    content: m.content.trim(),
  }));
}

function formatContext(matches: Match[]) {
  return matches
    .map((m, i) => `[Source ${i + 1} | ${m.source}]\n${m.content.trim()}`)
    .join("\n\n");
}

type CitationRow = {
  label: string;
  source: string;
  chunk_index: number;
  similarity: number;
  content: string;
};

async function* streamAnswer(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  citationRows: CitationRow[],
  useWeatherTool: boolean
): AsyncGenerator<AgentEvent> {
  yield { type: "status", text: "Thinking…" };

  let recoveryCount = 0;
  const working = [...messages];

  for (let round = 1; round <= 4; round++) {
    let msg;
    try {
      const res = await client.chat.completions.create({
        model,
        messages: working,
        ...(useWeatherTool
          ? {
              tools: weatherTool,
              tool_choice: "auto" as const,
              parallel_tool_calls: false,
            }
          : {}),
      });
      msg = res.choices[0]?.message;
    } catch (err) {
      const failed = getFailedGeneration(err);
      const parsed = failed ? parseGroqFailedTool(failed) : null;
      if (!parsed || parsed.name !== "get_weather") {
        yield {
          type: "error",
          text:
            (err as Error).message?.includes("Failed to call a function")
              ? "I hit a temporary tool error. Try asking again in a full sentence (e.g. “What are private notes in the internship docs?”)."
              : (err as Error).message || "Model request failed",
        };
        return;
      }
      recoveryCount += 1;
      const callId = `call_recovery_${recoveryCount}`;
      yield { type: "tool", name: "get_weather", args: parsed.args };
      working.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name: "get_weather", arguments: parsed.args },
          },
        ],
      });
      try {
        const args = JSON.parse(parsed.args) as { city: string };
        const result = await getWeather(args.city);
        working.push({ role: "tool", tool_call_id: callId, content: result });
      } catch (e) {
        working.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({ error: (e as Error).message }),
        });
      }
      continue;
    }

    if (!msg) {
      yield { type: "error", text: "No response from model" };
      return;
    }

    working.push(msg);
    const toolCalls = msg.tool_calls;

    if (!toolCalls?.length) {
      const text = msg.content?.trim() ?? "";
      for (const w of text.split(/(\s+)/)) {
        if (w) yield { type: "token", text: w };
      }
      // Guarantee clickable citations even if the model skipped inline
      // markers — the UI turns [1] / [2] into buttons.
      const hasMarker = /\[(Source\s*)?\d+[^\]]*\]/i.test(text);
      if (citationRows.length > 0 && !hasMarker) {
        yield { type: "token", text: "\n\n**Sources:** " };
        yield {
          type: "token",
          text: citationRows
            .map((c, i) => `[${i + 1}] ${c.source}`)
            .join(" · "),
        };
      }
      yield { type: "done", citations: citationRows };
      return;
    }

    for (const call of toolCalls) {
      if (call.function.name !== "get_weather") {
        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: "Only get_weather is available. Answer without other tools.",
          }),
        });
        continue;
      }
      yield {
        type: "tool",
        name: "get_weather",
        args: call.function.arguments,
      };
      yield { type: "status", text: "Checking weather…" };
      try {
        const args = JSON.parse(call.function.arguments) as { city: string };
        const result = await getWeather(args.city);
        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      } catch (e) {
        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: (e as Error).message }),
        });
      }
    }
  }

  yield { type: "error", text: "Too many tool rounds" };
}

export async function* runVertexAgent(opts: {
  message: string;
  filterSource?: string | null;
  availableSources?: string[];
  history?: ChatTurn[];
}): AsyncGenerator<AgentEvent> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    yield { type: "error", text: "Missing GROQ_API_KEY in .env.local" };
    return;
  }

  const available = opts.availableSources?.length
    ? opts.availableSources
    : opts.filterSource
      ? [opts.filterSource]
      : [];

  const history = opts.history ?? [];
  const recentUser = history
    .filter((h) => h.role === "user" && h.text.trim())
    .map((h) => h.text);

  // --- Router: pick which specialist runs ---
  const decision = routeMessage(opts.message, {
    availableSources: available,
    preferredSource: opts.filterSource ?? null,
  });

  yield {
    type: "status",
    text: `${decision.label}…`,
  };

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  let citationRows: ReturnType<typeof toCitations> = [];
  let systemContent = "";
  let useWeatherTool = false;

  // ========== CHAT AGENT (thanks / hi) — no retrieval ==========
  if (decision.route === "chitchat") {
    systemContent = `You are Vertex Chat agent.
Reply in one short warm sentence. Do not mention tools, documents, or routing.`;
  }

  // ========== WEATHER AGENT ==========
  else if (decision.route === "weather") {
    useWeatherTool = true;
    systemContent = `You are Vertex Weather agent.
Use get_weather for the city the user asks about, then answer briefly in plain language.`;
  }

  // ========== DOCS AGENT — retrieve then answer ==========
  else if (decision.route === "docs") {
    const resolved = resolveDocSource(
      opts.message,
      opts.filterSource ?? null,
      available
    );
    const searchSource =
      resolved ??
      (available.length ? available[available.length - 1] : null);
    const searchQuery = expandSearchQuery(opts.message, recentUser);

    const forceFull =
      !!searchSource &&
      (wantsFullFileRead(opts.message) ||
        isBroadDocQuestion(opts.message) ||
        isImageSource(searchSource));

    yield {
      type: "status",
      text: searchSource
        ? forceFull
          ? `Docs agent · reading ${searchSource}…`
          : `Docs agent · searching ${searchSource}…`
        : "Docs agent · searching knowledge base…",
    };
    yield {
      type: "tool",
      name: "search_documents",
      args: JSON.stringify({
        query: searchQuery,
        source: searchSource,
        mode: forceFull ? "full" : "search",
      }),
    };

    let docContext = "";
    let usedDocs = false;
    try {
      let matches: Match[] = [];
      if (forceFull && searchSource) {
        matches = await loadSourceChunks(searchSource, 50);
      } else {
        matches = await retrieveChunks(searchQuery, 8, searchSource);
        if (searchSource && matches.length < 2) {
          const fallback = await loadSourceChunks(searchSource, 30);
          if (fallback.length) matches = fallback;
        }
        if (!searchSource && matches.length < 2) {
          matches = await retrieveChunks(searchQuery, 8, null);
        }
      }

      if (matches.length) {
        usedDocs = true;
        citationRows = toCitations(matches);
        docContext = formatContext(matches);
      }
    } catch (e) {
      docContext = `(Document search failed: ${(e as Error).message})`;
    }

    const docsList =
      available.length > 0
        ? `Files in this chat: ${available.join(", ")}. Active: ${searchSource ?? "none"}.`
        : "No file in this chat; use shared Peham knowledge base if present.";

    if (usedDocs) {
      systemContent = `You are Vertex Docs agent — ChatGPT-style answers grounded in documents.
${docsList}

CRITICAL:
- Document context below IS the file content (images already OCR'd to text).
- NEVER say you cannot read images/PDFs/files.
- Quote or explain clearly. Translate Roman Urdu/Hindi to simple English if helpful.
- Use ONLY the document context. If empty, say so.
- Do not mention routing, OCR, embeddings, or tools unless asked.
- If context looks garbled, say OCR struggled on a dense diagram and suggest a clearer crop or .txt.

CITATIONS:
- Each context block is labeled [Source N | filename] in the Document context below.
- Cite as you go: after every sentence that uses a source, add a marker [N] where N is that source's number (Source 1 → [1]).
- Put the marker right after the sentence, before the closing period. Never cite sources you did not use.
- Answer with several short paragraphs and bullet lists; keep citations inline so the reader can jump to the exact chunk.

Document context:
${docContext}`;
    } else {
      systemContent = `You are Vertex Docs agent.
${docsList}
No matching document text was found. Say briefly you could not find it and suggest uploading a file or naming one from this chat.
Do not invent searchable topic menus. Do not say you cannot read images.`;
    }
  }

  // ========== GENERAL CHAT AGENT — no forced retrieval ==========
  else {
    systemContent = `You are Vertex Chat agent for Ask Peham's Docs.
Answer helpfully in plain language for general questions.
Do NOT invent Peham policy. If they need company/doc answers, ask them to upload a file or say which doc.
Do not mention agents, routing, or tools.`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];

  for (const turn of history.slice(-6)) {
    const text = turn.text.trim();
    if (!text) continue;
    if (
      turn.role === "bot" &&
      /don'?t have the capability to (directly )?read|cannot read (or understand )?images|can'?t read images/i.test(
        text
      )
    ) {
      continue;
    }
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: text.slice(0, 1500),
    });
  }
  messages.push({ role: "user", content: opts.message });

  yield* streamAnswer(
    client,
    MODEL,
    messages,
    citationRows,
    useWeatherTool
  );
}
