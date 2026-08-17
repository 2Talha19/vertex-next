/**
 * Vertex agent for Ask Peham's Docs.
 * - Docs search is done in code (no fragile tool-calls for search)
 * - Weather extracts the city as JSON, then answers (the models available on
 *   this Groq key don't support native function-calling tools)
 * - Chat history supports follow-ups like "and private notes?"
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  expandSearchQuery,
  isBroadDocQuestion,
  isImageSource,
  wantsFullFileRead,
} from "./doc-intent";
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

/**
 * Call the model with automatic retry on transient failures.
 * - 429 (rate limit / TPM exceeded): waits ~2s then retries, up to `attempts`
 *   total, honoring a Retry-After header when the API sends one. Long chats
 *   hit Groq's free-tier TPM cap often; this makes them invisible to the user.
 * - 5xx / network blips: also retried (brief, usually self-healing).
 * - 4xx auth/validation errors are NOT retried — they'd never succeed.
 */
async function chatWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  attempts = 3
) {
  let lastErr: unknown;
  let delayMs = 2000;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      lastErr = err;
      const e = err as { status?: number; headers?: Headers; message?: string };
      const status = e.status ?? 0;
      const retryable =
        status === 429 ||
        status >= 500 ||
        !status ||
        /rate limit|too many requests|temporarily unavailable|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
          e.message || ""
        );
      if (!retryable || attempt === attempts) break;

      // Honor Retry-After if Groq sent one; otherwise exponential backoff.
      const retryAfter = Number(e.headers?.get?.("retry-after") ?? 0);
      const wait = retryAfter > 0 ? retryAfter * 1000 : delayMs * attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
    }
  }
  throw lastErr;
}

async function* streamAnswer(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  citationRows: CitationRow[],
  useWeatherTool: boolean
): AsyncGenerator<AgentEvent> {
  yield { type: "status", text: "Thinking…" };

  // ===== WEATHER AGENT =====
  // The models available on this Groq key don't support native function
  // calls, so weather works in two plain-chat steps: ask the model for the
  // city as JSON, fetch the weather, then ask it to answer.
  if (useWeatherTool) {
    const userMessages = messages.filter((m) => m.role !== "system");
    const extract = await chatWithRetry(client, {
      model,
      messages: [
        {
          role: "system",
          content:
            "Extract the city the user is asking about the weather for. Reply with ONLY a JSON object in this exact form: {\"city\": \"CityName\"}. No other text.",
        },
        ...userMessages,
      ],
      max_tokens: 60,
    });
    const raw = extract.choices[0]?.message?.content?.trim() ?? "";
    let city: string | null = null;
    try {
      const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
      city = (JSON.parse(json) as { city?: string })?.city ?? null;
    } catch {
      city = null;
    }

    if (!city) {
      // The model answered directly instead of returning JSON — stream it.
      for (const w of raw.split(/(\s+)/)) {
        if (w) yield { type: "token", text: w };
      }
      yield { type: "done", citations: [] };
      return;
    }

    yield { type: "tool", name: "get_weather", args: JSON.stringify({ city }) };
    yield { type: "status", text: "Checking weather…" };
    let weather = "";
    try {
      weather = await getWeather(city);
    } catch (e) {
      weather = JSON.stringify({ error: (e as Error).message });
    }

    const final = await chatWithRetry(client, {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Vertex Weather agent. Answer the user's question about the weather in plain, friendly language, in 1-3 short sentences.",
        },
        ...userMessages,
        {
          role: "assistant",
          content: `The current weather in ${city} is: ${weather}`,
        },
        {
          role: "user",
          content: "Now answer my weather question based on that data.",
        },
      ],
      max_tokens: 400,
    });
    const answer = final.choices[0]?.message?.content?.trim() ?? "";
    for (const w of answer.split(/(\s+)/)) {
      if (w) yield { type: "token", text: w };
    }
    yield { type: "done", citations: [] };
    return;
  }

  // ===== DOCS / CHAT AGENT — plain chat, citations are added by the caller =====
  const working = [...messages];
  for (let round = 1; round <= 4; round++) {
    let msg;
    try {
      const res = await chatWithRetry(client, {
        model,
        messages: working,
        // Cap output so answers stay short and cheap.
        // 400 tokens ≈ 280–320 words — enough for a full, cited answer.
        max_tokens: 400,
      });
      msg = res.choices[0]?.message;
    } catch (err) {
      yield {
        type: "error",
        text: (err as Error).message || "Model request failed",
      };
      return;
    }

    if (!msg) {
      yield { type: "error", text: "No response from model" };
      return;
    }

    working.push(msg);
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

  yield { type: "error", text: "Too many rounds" };
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  concise:
    "Be concise: keep answers short and skip filler. Use bullets only when they genuinely save space.",
  friendly:
    "Be warm and friendly: keep a light, approachable tone while staying professional and accurate.",
  technical:
    "Be precise and technical: use exact terminology and include specifics (numbers, units, file names, code) where relevant. Prefer thoroughness over brevity.",
};

export async function* runVertexAgent(opts: {
  message: string;
  userId: string;
  filterSource?: string | null;
  availableSources?: string[];
  history?: ChatTurn[];
  style?: string;
  hasDocs?: boolean;
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
    hasDocs: opts.hasDocs,
  });

  yield {
    type: "status",
    text: `${decision.label}…`,
  };

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
  // groq/compound-mini is fast, cheap and always available on Groq —
  // llama-3.1-8b-instant was removed from Groq and now 404s.
  const MODEL = process.env.GROQ_MODEL || "groq/compound-mini";

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
        matches = await loadSourceChunks(opts.userId, searchSource, 30);
      } else {
        matches = await retrieveChunks(
          opts.userId,
          searchQuery,
          8,
          searchSource
        );
        if (searchSource && matches.length < 2) {
          const fallback = await loadSourceChunks(
            opts.userId,
            searchSource,
            30
          );
          if (fallback.length) matches = fallback;
        }
        if (!searchSource && matches.length < 2) {
          matches = await retrieveChunks(opts.userId, searchQuery, 8, null);
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
- The context below IS the file content (images already OCR'd to text).
- Never say you can't read images/PDFs/files. If garbled, say OCR struggled on a dense diagram and suggest a clearer crop or .txt.
- Quote or explain clearly; translate Roman Urdu/Hindi to simple English when helpful.
- Use ONLY this context; if empty, say so.
- Never mention routing, OCR, embeddings, or tools unless asked.

CITATIONS:
- Context blocks are labeled [Source N | filename].
- Cite as you go: after each sentence using a source, add [N] (Source 1 → [1]) right before the closing period. Never cite unused sources.
- Answer in several short paragraphs and bullet lists, with citations inline so readers can jump to the exact chunk.

KEEP IT SHORT:
- Answer in 1–3 short paragraphs or a few bullets. Do not repeat the question.
- No intro/outro filler like "Based on the documents" or "Let me know if...".

Document context:
${docContext}`;
    } else {
      systemContent = `You are Vertex assistant.
${docsList}
The user's documents were searched but nothing relevant matched.
- If the question is general knowledge (not about their files), answer it helpfully and briefly from what you know.
- If it IS about their documents/policy, say briefly you could not find it in their uploads and suggest uploading a file or naming one from this chat.
Do not invent searchable topic menus. Do not say you cannot read images.`;
    }
  }

  // ========== GENERAL CHAT AGENT — no forced retrieval ==========
  else {
    systemContent = `You are Vertex Chat agent for Ask Peham's Docs.
Answer helpfully in plain language for general questions. Be concise — 1–3 short sentences unless the question needs detail.
Do NOT invent Peham policy. If they need company/doc answers, ask them to upload a file or say which doc.
Do not mention agents, routing, or tools.`;
  }

  // User-chosen response style (from settings) is appended to every agent's
  // system prompt so the whole conversation follows it.
  const style = opts.style?.trim() || "default";
  if (style !== "default") {
    systemContent += `\n\nResponse style:\n${STYLE_INSTRUCTIONS[style as keyof typeof STYLE_INSTRUCTIONS] || ""}`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
  ];

  // Only the last 4 turns, trimmed per turn — enough context for follow-ups
  // ("and private notes?") without paying to re-send entire old answers.
  for (const turn of history.slice(-4)) {
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
      content: text.slice(0, 600),
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
