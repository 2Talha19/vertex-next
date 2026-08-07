/** Brand emblem — dragon crest logo on a white app-icon tile. */
export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand-mark${large ? " large" : ""}`} aria-hidden>
      <img src="/logo.png" alt="" width={128} height={128} />
    </span>
  );
}
