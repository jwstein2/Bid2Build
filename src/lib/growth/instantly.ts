import "server-only";

/**
 * Instantly API v2 client (server only).
 *
 * STATUS: INCOMPLETE / UNTESTED. Written against the public docs (developer.instantly.ai, checked
 * 2026-11-12) but never called against a real workspace: no Instantly account or API key was
 * available. Everything here is a no-op unless BOTH are set:
 *   INSTANTLY_API_KEY        API v2 key with scopes leads:create and block_list_entries:create
 *   INSTANTLY_SYNC_ENABLED   "true"
 *
 * The key is read only on the server and never sent to the browser.
 * Docs: POST /api/v2/leads (create lead), POST /api/v2/block-lists-entries (block list entry),
 * Authorization: Bearer <key>.
 */
const BASE = "https://api.instantly.ai/api/v2";

export function instantlyEnabled(): boolean {
  return Boolean(process.env.INSTANTLY_API_KEY) && process.env.INSTANTLY_SYNC_ENABLED === "true";
}

async function call(path: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) return { ok: false, status: 0 };
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { ok: res.ok, status: res.status };
}

/**
 * Add an email to the workspace block list so no campaign ever emails it again.
 * Used when someone becomes a paying customer, unsubscribes, or deletes their account.
 */
export async function blockEmail(email: string): Promise<{ ok: boolean; status: number; skipped?: boolean }> {
  if (!instantlyEnabled()) return { ok: false, status: 0, skipped: true };
  return call("/block-lists-entries", { bl_value: email });
}

/**
 * Add a prospect to a campaign. Never used automatically by the app: importing prospects is an
 * operator action. skip_if_in_workspace prevents duplicates across campaigns.
 */
export async function addLeadToCampaign(input: { email: string; campaignId: string; firstName?: string; companyName?: string; website?: string }) {
  if (!instantlyEnabled()) return { ok: false, status: 0, skipped: true };
  return call("/leads", {
    campaign: input.campaignId,
    email: input.email,
    first_name: input.firstName,
    company_name: input.companyName,
    website: input.website,
    skip_if_in_workspace: true,
  });
}
