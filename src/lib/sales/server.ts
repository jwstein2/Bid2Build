import "server-only";
import { redirect } from "next/navigation";
import { createClient, getUser, type SessionUser } from "../supabase/server";
import { isSupabaseConfigured } from "../env";

export interface SalesRep { id: string; full_name: string; email: string; role: "rep" | "manager"; status: string; code: string }

export type SalesAccess =
  | { kind: "rep"; user: SessionUser; rep: SalesRep; db: Awaited<ReturnType<typeof createClient>> }
  | { kind: "not_staff" | "suspended"; user: SessionUser };

/**
 * The sales portal's own sign-in gate, separate from the contractor app and the owner admin area.
 * Signed-out visitors go to /sales/login. A signed-in person is sales staff only if the owner invited
 * their verified email (sales_me links the invite on first sign-in). Data is then read with the
 * person's own session through sales_my_* functions, which only return their rows.
 */
export async function loadSalesAccess(): Promise<SalesAccess> {
  if (!isSupabaseConfigured()) redirect("/sales/login");
  const user = await getUser();
  if (!user) redirect("/sales/login");
  const db = await createClient();
  const { data, error } = await db.rpc("sales_me");
  if (error || !data) return { kind: "not_staff", user };
  const rep = data as SalesRep;
  if (rep.status !== "active") return { kind: rep.status === "suspended" ? "suspended" : "not_staff", user };
  return { kind: "rep", user, rep, db };
}

/** For pages inside the portal: anyone who isn't active sales staff is sent to the portal home. */
export async function requireSalesRep() {
  const a = await loadSalesAccess();
  if (a.kind !== "rep") redirect("/sales");
  return a;
}
