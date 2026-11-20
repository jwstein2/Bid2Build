"use server";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { sendAffiliateEmail } from "@/lib/affiliates/emails";

const s = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const back = (q: Record<string, string>): never => redirect(`/affiliates/apply?${new URLSearchParams(q)}`);

/** Public application. Honeypot field + one open application per email (database). Reviewed by the owner. */
export async function apply(fd: FormData) {
  if (s(fd, "website")) back({ ok: "1" }); // honeypot: bots get the same "received" screen
  if (!isSupabaseConfigured() || !serverEnv().supabaseServiceKey) back({ err: "unavailable" });
  const email = s(fd, "email", 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back({ err: "email" });
  if (s(fd, "legal_name").length < 2) back({ err: "name" });
  if (fd.get("agree") !== "on") back({ err: "agree" });
  if (s(fd, "country", 2).toUpperCase() !== "US") back({ err: "country" });
  const url = s(fd, "channel_url", 500);
  const db = createAdminClient();
  const { data, error } = await db.rpc("affiliate_apply", { p: {
    email, legal_name: s(fd, "legal_name"), display_name: s(fd, "display_name", 120), business_name: s(fd, "business_name"), country: "US",
    platform: s(fd, "platform", 20), channel_url: /^https:\/\//.test(url) ? url : "", channel_name: s(fd, "channel_name"), audience_size: s(fd, "audience_size", 12).replace(/\D/g, ""),
    audience: s(fd, "audience", 1000), note: s(fd, "note", 2000), categories: fd.getAll("categories").map(String).slice(0, 20), marketing_opt_in: fd.get("marketing_opt_in") === "on",
  } });
  if (error) {
    if (/applications_closed/.test(error.message)) back({ err: "closed" });
    logError("affiliate.apply", error);
    back({ err: "save" });
  }
  const r = data as { status: string; id?: string };
  if (r.status === "received" && r.id) {
    await sendAffiliateEmail(db, `applied/${r.id}`, "application_received", email, { name: s(fd, "display_name") || s(fd, "legal_name"), email }, { affiliateId: r.id });
  }
  back({ ok: "1" });
}
