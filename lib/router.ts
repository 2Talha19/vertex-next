/**
 * Lightweight multi-agent router.
 * Classifies the user message, then only the matching specialist runs.
 */
export type AgentRoute = "chitchat" | "docs" | "weather" | "general";

export type RouteDecision = {
  route: AgentRoute;
  reason: string;
  /** Human label for UI status */
  label: string;
};

function hasSessionDocs(available: string[]): boolean {
  return available.length > 0;
}

/**
 * Fast rules-first router (no extra LLM call = lower latency).
 * Prefer docs when a file is active / named / question smells like knowledge.
 */
export function routeMessage(
  message: string,
  opts: {
    availableSources?: string[];
    preferredSource?: string | null;
    /** True when the user has ANY uploaded documents in their account. */
    hasDocs?: boolean;
  } = {}
): RouteDecision {
  const text = message.trim();
  const lower = text.toLowerCase();
  const available = opts.availableSources ?? [];
  const preferred = opts.preferredSource ?? null;
  const hasDocs = opts.hasDocs ?? false;

  // --- Weather specialist ---
  if (/\b(weather|temperature|forecast|humid|°c|°f)\b/i.test(text)) {
    return {
      route: "weather",
      reason: "weather keywords",
      label: "Weather agent",
    };
  }

  // --- Chitchat (skip retrieval entirely) ---
  if (isPureChitchat(text)) {
    return {
      route: "chitchat",
      reason: "short courtesy message",
      label: "Chat agent",
    };
  }

  // Explicit file / previous / read-this → docs
  if (
    /\b(previous|earlier|read (it|this|the)|what (does|did) it say|this (file|pdf|doc|image|photo)|uploaded)\b/i.test(
      text
    )
  ) {
    return {
      route: "docs",
      reason: "asking about an uploaded file",
      label: "Docs agent",
    };
  }

  // Named one of the session files
  if (
    available.some((s) => {
      const stem = s.replace(/\.[^.]+$/, "").toLowerCase();
      return (
        lower.includes(s.toLowerCase()) ||
        (stem.length >= 3 && lower.includes(stem))
      );
    })
  ) {
    return {
      route: "docs",
      reason: "named an uploaded file",
      label: "Docs agent",
    };
  }

  // Peham / internship / RAG vocabulary → docs
  if (
    /\b(internship|peham|office hours|handbook|document|pdf|policy|onboarding|capstone|rag|embedding|chunk|supabase|private notes?|syllabus|mentor|vertex)\b/i.test(
      text
    )
  ) {
    return {
      route: "docs",
      reason: "knowledge / internship question",
      label: "Docs agent",
    };
  }

  // File attached + short follow-up about "it" / "this" → docs
  if (
    (preferred || hasSessionDocs(available)) &&
    /\b(it|this|that|these|those|file|above|summary|summarize|explain)\b/i.test(
      text
    )
  ) {
    return {
      route: "docs",
      reason: "follow-up with an active document",
      label: "Docs agent",
    };
  }

  // Active upload + question mark / substantive ask → prefer docs
  if (
    (preferred || hasSessionDocs(available)) &&
    (text.includes("?") || text.length > 40)
  ) {
    return {
      route: "docs",
      reason: "active document + substantive question",
      label: "Docs agent",
    };
  }

  // The user has uploads → treat any substantive question as a docs question
  // so their OWN files get searched even without doc keywords.
  if (hasDocs && (text.includes("?") || text.length > 25)) {
    return {
      route: "docs",
      reason: "user has documents; any question may be about them",
      label: "Docs agent",
    };
  }

  // Everything else → general chat (no forced retrieval)
  return {
    route: "general",
    reason: "general conversation",
    label: "Chat agent",
  };
}

function isPureChitchat(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t || t.length > 80) return false;
  if (
    /^(ok|okay|k|thanks|thank you|thx|ty|thnks|cool|nice|got it|great|perfect|hi|hello|hey|bye|good (morning|night)|np|no problem)[\s!.]*$/i.test(
      t
    )
  ) {
    return true;
  }
  const leftover = t
    .replace(
      /\b(ok|okay|k|thanks|thank you|thx|ty|thnks|cool|nice|got it|great|perfect|hi|hello|hey|bye|np|no problem)\b/gi,
      ""
    )
    .replace(/[\s!.?,]+/g, "")
    .trim();
  return leftover.length === 0;
}
