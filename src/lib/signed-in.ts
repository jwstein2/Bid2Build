/**
 * "Logged in as" name shown at the top of the app sidebar (2026-11-24).
 * An Enterprise company the person belongs to wins; otherwise the Company profile name.
 * Null when neither is set: the sidebar then shows the sign-in email instead.
 */
export function signedInLabel(enterpriseName?: string | null, profileName?: string | null): string | null {
  const pick = (v?: string | null) => (v ?? "").replace(/\s+/g, " ").trim() || null;
  return pick(enterpriseName) ?? pick(profileName);
}
