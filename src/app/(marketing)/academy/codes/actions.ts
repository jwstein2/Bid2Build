"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { LOCATION_COOKIE, locationFrom, locationQuery, serializeLocation } from "@/lib/academy/kb/location";
import { FEEDBACK_REASONS } from "@/lib/academy/kb/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData) => { const r = str(f, "return_to"); return r.startsWith("/academy/codes") ? r : "/academy/codes"; };

/** Saves the visitor's Academy location (ZIP, state, optional verified local authority, trade) in a cookie. */
export async function saveLocation(form: FormData) {
  const loc = locationFrom({ zip: str(form, "zip"), state: str(form, "state"), local: str(form, "local"), trade: str(form, "trade") }, "saved");
  const jar = await cookies();
  if (loc.from === "none") jar.delete(LOCATION_COOKIE);
  else jar.set(LOCATION_COOKIE, serializeLocation(loc), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/academy" });
  const q = str(form, "q");
  const path = back(form).split("?")[0];
  redirect(`${path}${locationQuery(loc, { q: q.slice(0, 300) || null })}`);
}

/** "Report a problem" on a code result or section. Goes into the admin review queue; never changes content. */
export async function reportProblem(form: FormData) {
  const ret = back(form);
  const sep = ret.includes("?") ? "&" : "?";
  const reason = str(form, "reason");
  const type = str(form, "target_type");
  const id = str(form, "target_id").slice(0, 120);
  if (!FEEDBACK_REASONS.some((r) => r.key === reason) || !["section", "search", "answer"].includes(type) || !id || !isSupabaseConfigured()) {
    redirect(`${ret}${sep}reported=0`);
  }
  const db = await createClient();
  const { error } = await db.rpc("academy_kb_report", { p_target_type: type, p_target_id: id, p_reason: reason, p_note: str(form, "note").slice(0, 1000) || null, p_state: str(form, "state").slice(0, 2) || null });
  if (error && !/rate_limited/.test(error.message)) logError("academy.kb.report", error);
  redirect(`${ret}${sep}reported=${error ? (/rate_limited/.test(error.message) ? "limit" : "0") : "1"}`);
}
