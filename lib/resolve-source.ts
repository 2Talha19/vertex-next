/**
 * Pick which uploaded file to answer from.
 * - If the user names a file → that one
 * - "previous" / "earlier" / "first" → not the latest when possible
 * - Otherwise → preferred (newest upload)
 */
export function resolveDocSource(
  message: string,
  preferred: string | null,
  available: string[]
): string | null {
  if (!available.length) return preferred;

  const lower = message.toLowerCase();

  // Explicit filename (or stem) mention — longest match wins
  const named = available
    .map((s) => {
      const stem = s.replace(/\.[^.]+$/, "").toLowerCase();
      const full = s.toLowerCase();
      if (lower.includes(full)) return { s, score: full.length + 10 };
      if (stem.length >= 3 && lower.includes(stem)) return { s, score: stem.length };
      return null;
    })
    .filter((x): x is { s: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score);

  if (named.length) return named[0].s;

  const latest = preferred ?? available[available.length - 1];

  if (available.length >= 2) {
    if (/\b(first|oldest)\b/i.test(message)) return available[0];
    if (/\b(previous|earlier|other|before)\b/i.test(message)) {
      const older = available.filter((s) => s !== latest);
      return older[older.length - 1] ?? older[0] ?? latest;
    }
    // "the image" / "that photo" → prefer an image upload if one exists
    if (/\b(image|photo|jfif|picture|screenshot)\b/i.test(message)) {
      const images = available.filter((s) =>
        /\.(jfif|jpe?g|png|webp|gif)$/i.test(s)
      );
      if (images.length) {
        const notLatest = images.filter((s) => s !== latest);
        return notLatest[notLatest.length - 1] ?? images[images.length - 1];
      }
    }
  }

  return latest;
}

export function isWeatherQuestion(message: string): boolean {
  return /\b(weather|temperature|forecast|humid|°c|°f)\b/i.test(message);
}
