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
