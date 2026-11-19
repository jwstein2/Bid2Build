import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FOUNDER_ADDRESS } from "@/lib/email/founder-welcome";
import { logError } from "@/lib/http/api";
import { site } from "@/lib/site";

export interface Digest {
  since: string; sales: number;
  successes: { rep: string; kind: string; customer: string }[];
  achievements: { rep: string; kind: string; value: number | null }[];
  awaiting: { congrats: number; rewards: number; boxes: number; not_congratulated: number };
}

const ACH: Record<string, string> = { first_sale: "first sale", month_first_sale: "first sale of the month", record_sales: "personal sales record", record_follow_ups: "personal follow-up record", accelerator_tier: "accelerator tier" };

export function digestText(d: Digest): { subject: string; text: string } {
  const lines = [`This week in the Sales Hub`, "", `New paying customers: ${d.sales}`];
  if (d.successes.length) lines.push("", "Customers through onboarding:", ...d.successes.map((s) => `- ${s.rep}: ${s.customer}`));
  if (d.achievements.length) lines.push("", "Achievements:", ...d.achievements.map((a) => `- ${a.rep}: ${ACH[a.kind] ?? a.kind}`));
  const w = d.awaiting;
  const todo = [w.congrats && `${w.congrats} congratulation email${w.congrats === 1 ? "" : "s"} to review`, w.rewards && `${w.rewards} reward${w.rewards === 1 ? "" : "s"} to authorize`,
    w.boxes && `${w.boxes} milestone box${w.boxes === 1 ? "" : "es"} to approve`, w.not_congratulated && `${w.not_congratulated} onboarding${w.not_congratulated === 1 ? "" : "s"} not congratulated yet`].filter(Boolean);
  if (todo.length) lines.push("", "Waiting on you:", ...todo.map((t) => `- ${t}`));
  lines.push("", `Recognition & incentives: ${new URL("/sales/admin?tab=recognition", site.url)}`);
  return { subject: `Sales Hub weekly recognition: ${d.successes.length + d.achievements.length} win${d.successes.length + d.achievements.length === 1 ? "" : "s"}`, text: lines.join("\n") };
}

/** Sends the owner's weekly digest once per week when the owner has it on. */
export async function sendWeeklyDigest(admin: SupabaseClient, f: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const { data, error } = await admin.rpc("sales_digest_claim", {});
  if (error || !data) return false;
  const { subject, text } = digestText(data as Digest);
  try {
    const r = await f("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Built2Bid Sales Hub <noreply@built2bid.org>", to: [process.env.SALES_DIGEST_TO || FOUNDER_ADDRESS], subject, text }) });
    if (!r.ok) logError("sales.digest", new Error(`resend ${r.status}`));
    return r.ok;
  } catch (e) {
    logError("sales.digest", e);
    return false;
  }
}
