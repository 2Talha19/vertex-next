export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50
): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  // Prefer paragraph breaks; fall back to sentence ends; finally hard-wrap.
  // This keeps every chunk a complete, readable thought instead of slicing
  // mid-sentence, which is what hurt the embedding match quality.
  const units = cleaned
    .split(/(?<=\n)\s*(?=\S)|(?<=[.!?])\s+(?=[A-Z0-9])/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    // If a single unit is bigger than the target size, hard-wrap it so we
    // never lose content (e.g. a long bullet with no sentence breaks).
    if (unit.length > chunkSize) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < unit.length; i += chunkSize - overlap) {
        chunks.push(unit.slice(i, i + chunkSize).trim());
      }
      continue;
    }

    if ((current + " " + unit).trim().length > chunkSize) {
      chunks.push(current.trim());
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter((c) => c.length > 0);
}
