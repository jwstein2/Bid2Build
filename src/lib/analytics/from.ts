/** In-site context for ?from= (a short label like "trade-concrete", "tool-roofing" or "fb"). Never personal data. */
export function cleanFrom(raw: string | string[] | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase().slice(0, 40);
  return /^[a-z0-9][a-z0-9_-]*$/.test(s) ? s : undefined;
}
