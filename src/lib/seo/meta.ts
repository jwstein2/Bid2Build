/**
 * Search snippet limits. Bing Webmaster Tools' SEO report flags meta descriptions over 160 characters and
 * titles over 70; Google cuts long ones off in results too. Page copy stays as written: only the
 * <meta name="description"> and the <title> are kept short.
 */
export const META_DESCRIPTION_MAX = 160;
export const TITLE_MAX = 70;

/**
 * Keeps whole sentences that fit in `max` characters. If even the first sentence is too long, cuts at the last
 * word that fits and adds an ellipsis. Short text is returned unchanged.
 */
export function metaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // A sentence ends at . ! or ? followed by a space or the end, so "$19.99" is not a break.
  const sentences = (clean.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? [clean]).map((x) => x.trim()).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

/** "<lesson> | <course>" when it fits in the title limit with " | Built2Bid" added, else just the lesson name. */
export function lessonTitle(lesson: string, course: string, suffix = " | Built2Bid"): string {
  const both = `${lesson} | ${course}`;
  return both.length + suffix.length <= TITLE_MAX ? both : lesson;
}
