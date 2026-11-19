import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";
import { canAdmin, canMy, fallbackCaps, type SalesCap } from "./caps";

export interface SalesRep { id: string; full_name: string; email: string; role: "rep" | "manager" | "admin"; status: string; code: string; sells?: boolean }

type Db = Awaited<ReturnType<typeof createClient>>;
export type SalesAccess =
  | { kind: "staff"; user: SessionUser; rep: SalesRep | null; caps: string[]; db: Db }
  | { kind: "not_staff" | "suspended"; user: SessionUser };

/**
 * The sales portal's own sign-in gate, separate from the contractor app and the owner admin area.
 * Signed-out visitors go to /sales/login. A signed-in person is sales staff if the owner invited their
 * verified email (sales_me links the invite on first sign-in), or if they are a Sales Administrator or
 * the platform owner. Capabilities come from the database; personal data is read with the person's own
 * session through sales_my_* functions, which only return their rows.
 */
export const loadSalesAccess = cache(async function loadSalesAccess(): Promise<SalesAccess> {
  if (!isSupabaseConfigured()) redirect("/sales/login");
  const user = await getUser();
  if (!user) redirect("/sales/login");
  const db = await createClient();
  const [meRes, capRes] = await Promise.all([db.rpc("sales_me"), db.rpc("sales_my_capabilities")]);
  const me = (meRes.error ? null : meRes.data) as SalesRep | { status: string } | null;
  const rep = me && "id" in me ? me : null;
  let caps = (capRes.data as string[] | null) ?? [];
  if (capRes.error) {
    // V8.3 SQL not applied yet: same rules computed here.
    const { data: owner } = await db.rpc("is_admin", { p_user_id: user.id });
    caps = fallbackCaps({ sells: !!rep && rep.sells !== false, salesAdmin: rep?.role === "admin", owner: !!owner && user.emailVerified });
  }
  if (canMy(caps) || canAdmin(caps)) return { kind: "staff", user, rep, caps, db };
  return { kind: me?.status === "suspended" ? "suspended" : "not_staff", user };
});

/** For My Sales Hub pages: only people who sell. A Sales Admin who doesn't sell goes to the Admin Sales Hub. */
export async function requireSalesRep() {
  const a = await loadSalesAccess();
  if (a.kind !== "staff") redirect("/sales");
  if (!canMy(a.caps) || !a.rep) redirect(canAdmin(a.caps) ? "/sales/admin" : "/sales");
  return { ...a, rep: a.rep };
}

/**
 * For Admin Sales Hub pages and actions. Anyone without the admin hub gets a 404. Returns a service-role
 * client: every admin_sales_* function it calls re-checks the caller's capabilities in the database.
 */
export async function requireSalesAdmin(): Promise<{ user: SessionUser; db: ReturnType<typeof createAdminClient>; caps: string[]; has: (c: SalesCap) => boolean }> {
  if (!isSupabaseConfigured()) notFound();
  const user = await getUser();
  if (!user || !user.emailVerified) notFound();
  const a = await loadSalesAccess();
  if (a.kind !== "staff" || !canAdmin(a.caps)) notFound();
  return { user, db: createAdminClient(), caps: a.caps, has: (c) => a.caps.includes(c) };
}
