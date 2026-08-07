/**
 * Decide how much of a doc to load / whether a message is small talk.
 */

/** User wants the whole file read / quoted / explained. */
export function wantsFullFileRead(message: string): boolean {
  return /\b(read|reading|what (does |did )?it say|what'?s (in|inside|on) (it|this|the|that)|tell (me )?what|show (me )?(the )?(text|content)|translate|mean(ing)?|summar(y|ise|ize)|overview|explain (this|the|that) (file|doc|pdf|image|photo))\b/i.test(
    message
  );
}

export function isBroadDocQuestion(message: string): boolean {
  return (
    wantsFullFileRead(message) ||
    /\b(whole (doc|document|pdf|file)|entire|tell me about|what (is|are) the internship|internship (for|about)|purpose of)\b/i.test(
      message
    )
  );
}

export function isImageSource(source: string): boolean {
  return /\.(jfif|jpe?g|png|webp|gif|bmp)$/i.test(source);
}

export function looksLikeDocsQuestion(message: string): boolean {
  return /\b(internship|peham|office hours|handbook|document|pdf|policy|onboarding|capstone|rag|mentor|upload|api keys?|supabase|week\s*[1-6]|vertex|coolify|embedding|chunk|private notes?|notes)\b/i.test(
    message
  );
}

/** Short thanks / hi — do not search docs or mention tools. */
export function isChitchat(message: string): boolean {
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

/**
 * Turn short follow-ups ("and private notes?") into a fuller search string
 * using recent user messages.
 */
export function expandSearchQuery(
  message: string,
  recentUserMessages: string[]
): string {
  const current = message.trim();
  if (!current) return current;

  const isShortFollowUp =
    current.length < 60 ||
    /^(and|also|what about|how about|more|explain|same|that|those|it)\b/i.test(
      current
    );

  if (!isShortFollowUp || recentUserMessages.length === 0) return current;

  const prior = recentUserMessages
    .slice(-3)
    .map((m) => m.trim())
    .filter((m) => m && m.toLowerCase() !== current.toLowerCase());

  if (!prior.length) return current;
  return `${prior.join(" ")} — ${current}`;
}
