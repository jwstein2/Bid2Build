"use server";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { normalizeTaxId, piiReady, sealPii } from "@/lib/security/pii";
import { importChannel } from "@/lib/affiliates/channels-server";
import { LESSONS } from "@/lib/affiliates/content";
import { payoutProvider, ProviderError, type ProviderName } from "@/lib/payouts/provider";
import { PAYOUT_STATE_COOKIE, signPayoutState } from "@/lib/payouts/state";
import { site } from "@/lib/site";

/**
 * Affiliate self-service onboarding. Self functions run with the affiliate's own session (auth.uid()). Official
 * YouTube numbers and the W-9 go through the service role with the verified session's user id; the TIN is sealed on
 * the server and only the last 4 are stored in app tables. Bank details are entered on the provider's page only.
 */
const go = (step: string, q: Record<string, string> = {}): never => { revalidatePath("/affiliate-hub"); redirect(`/affiliate-hub/onboarding?${new URLSearchParams({ step, ...q })}`); };
const s = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const self = async (fn: string, args: Record<string, unknown> = {}) => (await createClient()).rpc(fn, args);

export async function welcomeSeen() {
  await self("affiliate_my_step", { p_step: "welcome", p: {} });
  go("profile");
}

export async function saveProfile(fd: FormData) {
  const p = Object.fromEntries(["legal_name", "display_name", "business_name", "phone", "address_line1", "address_line2", "city", "state", "postal_code", "contact_pref"].map((k) => [k, s(fd, k)]));
  const { error } = await self("affiliate_my_step", { p_step: "profile", p: { ...p, country: s(fd, "country", 2) || "US", tax_residency: s(fd, "tax_residency", 2) || "US", marketing_opt_in: fd.get("marketing_opt_in") === "on" } });
  go(error ? "profile" : "channel", error ? { err: "required" } : {});
}

export async function importYoutube(fd: FormData) {
  const user = await getUser();
  if (!user) redirect("/affiliate-hub/login?next=/affiliate-hub/onboarding");
  const r = await importChannel(createAdminClient(), user.id, s(fd, "channel", 300));
  go("channel", r.ok ? { ok: "imported" } : { err: r.error });
}

export async function saveChannelSelf(fd: FormData) {
  const { error } = await self("affiliate_my_channel_self", { p: { platform: s(fd, "platform", 20), url: s(fd, "url", 500), handle: s(fd, "handle", 100), title: s(fd, "title"), description: s(fd, "description", 2000), audience: s(fd, "audience", 12).replace(/\D/g, "") } });
  go("channel", error ? { err: /use_correction/.test(error.message) ? "use_correction" : "url" } : { ok: "saved" });
}

export async function requestCorrection(fd: FormData) {
  const field = s(fd, "field", 30);
  if (!["subscriber_count", "title", "handle", "url", "description", "channel_country"].includes(field) || !s(fd, "value")) go("channel", { err: "correction" });
  const { error } = await self("affiliate_my_correction", { p_field: field, p_value: s(fd, "value", 500), p_note: s(fd, "note", 1000) });
  go("channel", error ? { err: "correction" } : { ok: "correction" });
}

export async function channelDone() {
  const { error } = await self("affiliate_my_step", { p_step: "channel_done", p: {} });
  go(error ? "channel" : "learn", error ? { err: "channel_required" } : {});
}

export async function completeLesson(fd: FormData) {
  const key = s(fd, "lesson", 40);
  if (!LESSONS.some((l) => l.key === key)) go("learn");
  await self("affiliate_my_lesson", { p_lesson: key });
  const next = LESSONS[LESSONS.findIndex((l) => l.key === key) + 1];
  go("learn", next ? { lesson: next.key } : {});
}

export async function learnDone() {
  const { error } = await self("affiliate_my_step", { p_step: "learn_done", p: {} });
  go(error ? "learn" : "agreement", error ? { err: "lessons" } : {});
}

export async function acceptAgreement(fd: FormData) {
  const db = await createClient();
  const { data: me } = await db.rpc("affiliate_me");
  const a = (me as { agreement?: { id: string; body: string } } | null)?.agreement;
  if (!a || a.id !== s(fd, "id", 40) || fd.get("agree") !== "on" || s(fd, "typed_name").length < 2) go("agreement", { err: "agree" });
  const h = await headers();
  const { error } = await db.rpc("affiliate_my_agreement_accept", { p_template: a!.id, p_body_sha256: createHash("sha256").update(a!.body, "utf8").digest("hex"),
    p_typed_name: s(fd, "typed_name", 120), p_ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null, p_user_agent: (h.get("user-agent") ?? "").slice(0, 300) });
  go(error ? "agreement" : "payout", error ? { err: "agree" } : {});
}

export async function submitW9(fd: FormData) {
  const user = await getUser();
  if (!user) redirect("/affiliate-hub/login?next=/affiliate-hub/onboarding");
  if (!piiReady()) go("payout", { err: "pii" });
  const tinType = s(fd, "tin_type", 4);
  const tin = normalizeTaxId(fd.get("tin"));
  const cls = s(fd, "tax_class", 20);
  if (!tin || !["ssn", "ein", "itin"].includes(tinType) || !["individual", "c_corp", "s_corp", "partnership", "trust_estate", "llc_c", "llc_s", "llc_p", "other"].includes(cls)
      || fd.get("certify") !== "on" || s(fd, "signed_name").length < 2 || s(fd, "legal_name").length < 2) go("payout", { err: "w9" });
  // Service role on purpose: the TIN secret table has no grants for signed-in users. p_user is this verified session's user.
  const { error } = await createAdminClient().rpc("affiliate_w9_store", { p_user: user.id, p_legal_name: s(fd, "legal_name"), p_business_name: s(fd, "business_name"), p_tax_class: cls,
    p_exempt_code: s(fd, "exempt_code", 4), p_tin_type: tinType, p_tin_last4: tin!.slice(-4), p_tin_ciphertext: sealPii(tin!), p_signed_name: s(fd, "signed_name", 120) });
  go("payout", error ? { err: /us_only/.test(error.message) ? "us_only" : "w9" } : { ok: "w9" });
}

/** "Connect bank account": the payout provider's hosted page (practice page while payouts use the practice provider). */
export async function connectBank(fd: FormData) {
  const back = s(fd, "back", 40) === "profile" ? "/affiliate-hub/profile" : "/affiliate-hub/onboarding?step=payout";
  const user = await getUser();
  if (!user) redirect("/affiliate-hub/login");
  const db = createAdminClient();
  const [{ data: a }, { data: st }] = await Promise.all([
    db.from("affiliates").select("id, email, display_name, legal_name, status, country, tax_residency").eq("user_id", user.id).maybeSingle(),
    db.from("payout_settings").select("mode, provider").eq("id", true).maybeSingle(),
  ]);
  if (!a || ["suspended", "terminated", "rejected"].includes(a.status)) redirect("/affiliate-hub");
  if ((a.country ?? "US") !== "US" || (a.tax_residency ?? "US") !== "US") redirect(`${back}${back.includes("?") ? "&" : "?"}err=us_only`);
  const mode = st?.mode === "live" ? "live" : "test";
  const provider = (st?.provider ?? "mock") as ProviderName;
  const { data: cur } = await db.from("affiliate_payout_destinations").select("recipient_ref").eq("affiliate_id", a.id).eq("mode", mode).eq("is_current", true).maybeSingle();
  let url: string;
  try {
    const p = payoutProvider(provider, mode);
    const base = site.url.replace(/\/$/, "");
    const link = await p.onboardingLink({ recipientRef: cur?.recipient_ref ?? null, email: a.email, name: a.display_name ?? a.legal_name ?? a.email, staffId: `aff_${a.id}`,
      returnUrl: `${base}/api/affiliate-payouts/return?back=${encodeURIComponent(back)}`, refreshUrl: `${base}${back}` });
    (await cookies()).set(PAYOUT_STATE_COOKIE, signPayoutState({ staffId: `aff:${a.id}`, recipientRef: link.recipientRef, mode }), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/affiliate-payouts", maxAge: 1800 });
    url = provider === "mock" ? `/affiliate-hub/practice-bank?back=${encodeURIComponent(back)}` : link.url;
  } catch (e) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}err=${e instanceof ProviderError ? encodeURIComponent(e.code) : "provider"}`);
  }
  redirect(url);
}

export async function submitOnboarding() {
  const { error } = await self("affiliate_my_step", { p_step: "submit", p: {} });
  if (error) go("finish", { err: "incomplete" });
  revalidatePath("/affiliate-hub");
  redirect("/affiliate-hub/onboarding?step=finish&ok=submitted");
}
