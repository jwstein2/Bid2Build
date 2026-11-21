import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createAdminClient, createClient, getAuthUser } from "@/lib/supabase/server";
import { applyDemoDataset } from "./apply";
import { DEMO_SEED_VERSION, buildDemoDataset } from "./dataset";
import { DEMO_HINT_COOKIE, DEMO_META_KEY, DEMO_RETURN_COOKIE, DEMO_RETURN_MAX_AGE, parseDemoClaim, type DemoClaim, type DemoSessionKind } from "./session";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Practice Mode is on for every verified user (it creates a sample login per person the first time they turn
 * it on: the same 24-month sample company as the owner demo, with a simulated bank). PRACTICE_MODE=off is an emergency switch that hides it everywhere.
 */
export const isPracticeEnabled = () => process.env.PRACTICE_MODE !== "off";

/** How long one request keeps seeding before it hands back "still preparing" (the browser calls again). */
const SEED_BUDGET_MS = 6_000;

export interface DemoWorkspaceRow {
  id: string; owner_user_id: string; kind: DemoSessionKind; demo_user_id: string | null; company_id: string | null;
  seed_version: string | null; seed_step: number; status: "new" | "seeding" | "ready" | "failed"; last_error: string | null;
  seeded_at: string | null; last_reset_at: string | null; reset_count: number; created_at: string;
}

export function demoClaimOf(user: Pick<User, "app_metadata"> | null | undefined): DemoClaim | null {
  return parseDemoClaim(user?.app_metadata);
}

/** The signed-in session's demo facts (null for a real session). One shared, request-cached Auth lookup. */
export async function currentDemo(): Promise<DemoClaim | null> {
  return demoClaimOf(await getAuthUser());
}

/** Owner check through the existing admin process (public.admin_roles via is_admin), by immutable user id. */
export async function isPlatformOwner(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("is_admin", { p_user_id: userId });
  return !error && data === true;
}

export async function loadWorkspace(admin: Admin, owner: string, kind: DemoSessionKind): Promise<DemoWorkspaceRow | null> {
  const { data } = await admin.from("demo_workspaces").select("*").eq("owner_user_id", owner).eq("kind", kind).maybeSingle();
  return (data as DemoWorkspaceRow | null) ?? null;
}

/** Creates a brand-new demo login (reserved example domain, already confirmed, so no email is ever sent). */
async function createDemoLogin(admin: Admin, owner: string, kind: DemoSessionKind): Promise<{ id: string; email: string }> {
  const tag = randomBytes(5).toString("hex");
  let lastError: unknown = null;
  for (const domain of ["example.com", "demo.built2bid.org"]) {
    const email = `${kind === "practice" ? "practice" : "demo"}-${tag}@${domain}`;
    const { data, error } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { display_name: kind === "practice" ? "Practice" : "Demo Owner" },
      // workspace is filled in after provisioning; until then the login has no demo claim and can't be entered.
      app_metadata: { [DEMO_META_KEY]: null },
    });
    if (!error && data.user) return { id: data.user.id, email };
    lastError = error;
  }
  throw new Error(`demo_login_create_failed: ${(lastError as Error | null)?.message ?? "unknown"}`);
}

/**
 * Provision (first time or after Reset). The old demo login, if any, is retired by demo_provision and then
 * deleted (or banned when deletion isn't possible because it holds sample financial records).
 */
async function provision(admin: Admin, owner: string, kind: DemoSessionKind): Promise<DemoWorkspaceRow> {
  const login = await createDemoLogin(admin, owner, kind);
  const { data, error } = await admin.rpc("demo_provision", { p_owner: owner, p_demo_user: login.id, p_kind: kind, p_company_name: null });
  if (error) { await admin.auth.admin.deleteUser(login.id).catch(() => {}); throw new Error(`demo_provision_failed: ${error.message}`); }
  const r = data as { workspaceId: string; retired: string | null };
  await admin.auth.admin.updateUserById(login.id, { app_metadata: { [DEMO_META_KEY]: { kind, owner, workspace: r.workspaceId } } });
  if (r.retired) await retireLogin(admin, r.retired);
  const ws = await loadWorkspace(admin, owner, kind);
  if (!ws) throw new Error("demo_workspace_missing");
  return ws;
}

async function retireLogin(admin: Admin, userId: string) {
  // Its app_metadata loses the claim first, so a stale session can never act as a demo of anyone.
  await admin.auth.admin.updateUserById(userId, { app_metadata: { [DEMO_META_KEY]: null }, ban_duration: "876000h" }).catch(() => {});
  await admin.auth.admin.deleteUser(userId).catch(() => { /* sample financial records are append-only: the login stays banned instead */ });
}

export type EnterResult =
  | { status: "ready"; workspace: DemoWorkspaceRow }
  | { status: "seeding"; progress: number }
  | { status: "failed"; error: string };

/** Make sure the workspace exists and is seeded; seeds for up to SEED_BUDGET_MS per call. */
export async function prepareWorkspace(admin: Admin, owner: string, kind: DemoSessionKind, opts: { reset?: boolean } = {}): Promise<EnterResult> {
  let ws = await loadWorkspace(admin, owner, kind);
  const stale = ws && ws.status === "ready" && ws.seeded_at && Date.now() - Date.parse(ws.seeded_at) > 600 * 86_400_000;   // grant nears its 730-day limit
  // Practice follows the current sample (e.g. the 2026-11-21 24-month company): an older practice workspace starts fresh.
  // Owner demos keep their data until the owner presses Reset.
  const outdated = kind === "practice" && ws?.status === "ready" && ws.seed_version !== DEMO_SEED_VERSION;
  if (!ws || !ws.demo_user_id || ws.status === "failed" || opts.reset || stale || outdated) ws = await provision(admin, owner, kind);
  if (ws.status === "ready") return { status: "ready", workspace: ws };
  // The anchor day is fixed when the login is provisioned, so a seed resumed tomorrow stays consistent.
  const d = buildDemoDataset({ kind, namespace: ws.id, anchor: anchorOf(ws) });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const r = await applyDemoDataset(rpc, ws.id, d, { fromStep: ws.seed_step, budgetMs: SEED_BUDGET_MS });
  if (r.error) return { status: "failed", error: r.error };
  if (!r.done) return { status: "seeding", progress: Math.round((r.nextStep / r.total) * 100) };
  const fresh = await loadWorkspace(admin, owner, kind);
  return fresh?.status === "ready" ? { status: "ready", workspace: fresh } : { status: "seeding", progress: 99 };
}

/** The day this demo login was provisioned (first time or last Reset). */
function anchorOf(ws: Pick<DemoWorkspaceRow, "last_reset_at" | "created_at">): string {
  return (ws.last_reset_at ?? ws.created_at ?? new Date().toISOString()).slice(0, 10);
}

// ── Session switching ──────────────────────────────────────────────────────────────────────────
interface ReturnStash { rt: string; uid: string }
const encodeStash = (s: ReturnStash) => Buffer.from(JSON.stringify(s)).toString("base64url");
function decodeStash(v: string | undefined): ReturnStash | null {
  if (!v) return null;
  try {
    const s = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as Partial<ReturnStash>;
    return typeof s.rt === "string" && typeof s.uid === "string" ? { rt: s.rt, uid: s.uid } : null;
  } catch { return null; }
}

/**
 * Switch this browser to the demo login. The real session's refresh token is kept in an httpOnly cookie
 * so Exit can restore it; the real session itself is never signed out, changed or merged.
 */
export async function switchToDemo(admin: Admin, ws: DemoWorkspaceRow, real: { id: string } | null): Promise<void> {
  const supabase = await createClient();
  const jar = await cookies();
  if (real) {
    const { data } = await supabase.auth.getSession();
    const rt = data.session?.refresh_token;
    if (!rt || data.session?.user.id !== real.id) throw new Error("no_real_session");
    jar.set(DEMO_RETURN_COOKIE, encodeStash({ rt, uid: real.id }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEMO_RETURN_MAX_AGE });
  } else if (!decodeStash(jar.get(DEMO_RETURN_COOKIE)?.value)) {
    throw new Error("no_return_session");
  }
  const { data: u } = await admin.auth.admin.getUserById(ws.demo_user_id!);
  const email = u.user?.email;
  if (!email || !parseDemoClaim(u.user?.app_metadata)) throw new Error("demo_login_unready");
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });   // creates a token; sends nothing
  if (error || !link.properties?.hashed_token) throw new Error(`demo_link_failed: ${error?.message ?? "no token"}`);
  const { error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (vErr) throw new Error(`demo_session_failed: ${vErr.message}`);
  jar.set(DEMO_HINT_COOKIE, ws.kind, { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: DEMO_RETURN_MAX_AGE });
}

/** Leave Demo / Practice Mode: end the demo session and restore the real one. */
export async function switchToReal(claim: DemoClaim): Promise<{ restored: boolean }> {
  const supabase = await createClient();
  const jar = await cookies();
  const stash = decodeStash(jar.get(DEMO_RETURN_COOKIE)?.value);
  jar.delete(DEMO_RETURN_COOKIE);
  jar.delete(DEMO_HINT_COOKIE);
  await supabase.auth.signOut({ scope: "local" });
  if (!stash || stash.uid !== claim.owner) return { restored: false };
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: stash.rt });
  if (error || data.user?.id !== claim.owner) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return { restored: false };
  }
  return { restored: true };
}

/** First-party demo analytics (never mixed into real activity: workspace is 'demo' or 'practice'). */
export async function recordDemoEvent(admin: Admin, userId: string, event: "demo_entered" | "demo_exited" | "demo_reset" | "practice_started", kind: DemoSessionKind) {
  await admin.from("guide_events").insert({ user_id: userId, event, workspace: kind === "practice" ? "practice" : "demo" }).then(() => {}, () => {});
}
