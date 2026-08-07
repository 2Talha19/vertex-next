/**
 * Groq sometimes returns broken tool-call XML instead of proper tool_calls.
 * Parse failed_generation and recover.
 */
export function parseGroqFailedTool(
  failedGeneration: string
): { name: string; args: string } | null {
  const patterns = [
    /<function=([a-zA-Z0-9_]+)\s+(\{[\s\S]*?\})\s*<\/function>/i,
    /<function=([a-zA-Z0-9_]+)>\s*(\{[\s\S]*?\})\s*<\/function>/i,
  ];
  for (const re of patterns) {
    const m = failedGeneration.match(re);
    if (m?.[1] && m[2]) return { name: m[1], args: m[2].trim() };
  }
  return null;
}

export function getFailedGeneration(err: unknown): string | null {
  const e = err as { error?: { failed_generation?: string } };
  return e?.error?.failed_generation ?? null;
}
