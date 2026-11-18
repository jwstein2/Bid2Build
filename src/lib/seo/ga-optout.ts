/** Visitor's own "don't measure me" choice for Google Analytics (V8, owner decision 2026-11-18: GA stays on, disclosed, with an opt-out). */
export const GA_OPTOUT_COOKIE = "b2b_ga_optout";

export function gaOptedOut(cookie: string | null | undefined): boolean {
  return (cookie ?? "").split(/;\s*/).some((c) => c === `${GA_OPTOUT_COOKIE}=1`);
}
