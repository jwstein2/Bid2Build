import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled, isSupabaseConfigured } from "@/lib/env";
import { loadMyCompany } from "@/lib/enterprise/server";
import { loadPmAccess } from "@/lib/pm/server";
import { fail, json, logError, sameOrigin } from "@/lib/http/api";
import { META_KEY, applyAction, initialState, parseState, type FeatureState } from "@/lib/features/state";

export const dynamic = "force-dynamic";

/**
 * The signed-in account's feature discovery state plus its entitlement (library_access(), checked
 * here on the server). The first read stores the account's starting state. known=false when the
 * state can't be read or saved: the client then shows nothing automatically.
 */
export async function GET(req?: Request) {
  if (!isSupabaseConfigured()) return json({ signedIn: false });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ signedIn: false });
  const u = data.user;
  const { data: access, error: aErr } = await supabase.rpc("library_access");
  if (aErr) logError("features.access", aErr);
  const unlimited = access === true;
  let state = parseState((u.user_metadata as Record<string, unknown> | null)?.[META_KEY]);
  let known = true;
  if (!state) {
    state = initialState({ unlimited }, u.created_at ?? null);
    const { error: wErr } = await supabase.auth.updateUser({ data: { [META_KEY]: state } });
    if (wErr) { logError("features.init", wErr); known = false; }
  }
  // ?guide=1: what the page walkthrough may explain to this person (role, add-ons, trades on recent bids).
  // Read only when a walkthrough starts, so ordinary page loads don't pay for it.
  if (!req || new URL(req.url).searchParams.get("guide") !== "1") return json({ signedIn: true, known, access: { unlimited }, state });
  const [admin, company, pm, recent] = await Promise.all([
    supabase.rpc("is_admin", { p_user_id: u.id }).then((r) => r.data === true, () => false),
    loadMyCompany(supabase).catch(() => null),
    isPmEnabled() ? loadPmAccess(supabase).catch(() => null) : Promise.resolve(null),
    supabase.from("estimates").select("trades, template_trade").eq("user_id", u.id).order("updated_at", { ascending: false }).limit(25)
      .then((r) => (r.error ? [] : ((r.data ?? []) as { trades: string[] | null; template_trade: string | null }[])), () => []),
  ]);
  const trades = recent.flatMap((e) => (Array.isArray(e.trades) && e.trades.length ? e.trades : e.template_trade ? [e.template_trade] : [])).filter((t): t is string => typeof t === "string").slice(0, 60);
  const guide = {
    admin,
    pm: { view: Boolean(pm && (pm.scope !== "none" || pm.canEdit)), edit: Boolean(pm?.canEdit) },
    company: company ? { role: company.role, owner: Boolean(company.isOwner), permissions: company.permissions ?? [] } : null,
    trades,
  };
  return json({ signedIn: true, known, access: { unlimited }, state, guide });
}

const Body = z.union([
  z.object({ ack: z.array(z.string().max(64)).max(50) }),
  z.object({ notice: z.string().max(20) }),
  z.object({ tour: z.enum(["completed", "dismissed"]) }),
  z.object({ guide: z.string().max(64) }),
]);

/** Records an acknowledgement, a seen notice or the walkthrough outcome. Never changes access. */
export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "bad_origin", "Cross-site request refused.");
  if (!isSupabaseConfigured()) return fail(503, "not_configured", "Accounts aren't configured.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail(401, "not_authenticated", "Sign in required.");
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return fail(400, "invalid", "Invalid request.");
  const current: FeatureState = parseState((data.user.user_metadata as Record<string, unknown> | null)?.[META_KEY]) ?? { v: 1, acked: [], notice: null, tour: null };
  const next = applyAction(current, p.data);
  const { error } = await supabase.auth.updateUser({ data: { [META_KEY]: next } });
  if (error) {
    logError("features.write", error);
    return fail(500, "write_failed", "Couldn't save.");
  }
  return json({ ok: true, state: next });
}
