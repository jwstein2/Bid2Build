"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAcademyStaff } from "@/lib/academy/server";
import { getStripe } from "@/lib/billing/stripe";
import { serverEnv } from "@/lib/env";
import { logError } from "@/lib/http/api";
import { provisionAcademyPrices } from "@/lib/academy/advanced/provision";
import { isAdvPlan } from "@/lib/academy/advanced/plans";

/**
 * Academy Advanced admin controls. Academy admins only. Every action re-checks the role on the server, writes with
 * the service role and adds an academy_audit_log entry. Nothing here charges anyone or touches live Stripe data:
 * provisioning refuses a live key unless ACADEMY_ADVANCED_PROVISION_LIVE=true is set in Netlify by the owner.
 */
const PATH = "/academy/manage/advanced";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (q: Record<string, string>): never => redirect(`${PATH}?${new URLSearchParams(q)}`);
const SLUG = /^[a-z0-9-]{3,60}$/;

async function admin() {
  const s = await requireAcademyStaff(["admin"]);
  if (!s) go({ err: "Only Academy admins can change Advanced Learning." });
  return { user: s!.user, db: createAdminClient() };
}
async function audit(actor: string, action: string, type: string, id: string | null, details?: Record<string, unknown>) {
  const { error } = await createAdminClient().from("academy_audit_log").insert({ actor_id: actor, action, target_type: type, target_id: id, details: details ?? null });
  if (error) logError("academy.adv.audit", error);
}
const done = (msg: string): never => { revalidatePath(PATH); revalidatePath("/academy/advanced"); return go({ msg }); };

export async function saveAdvSettings(form: FormData) {
  const { user, db } = await admin();
  const row = {
    enabled: form.get("enabled") === "on", enrollment_open: form.get("enrollment_open") === "on", auto_advance: form.get("auto_advance") === "on",
    count_basis: str(form, "count_basis") === "active" ? "active" : "lifetime",
    reservation_minutes: Math.min(120, Math.max(31, Number(str(form, "reservation_minutes")) || 35)),
    updated_at: new Date().toISOString(), updated_by: user.id,
  };
  const { data: prev } = await db.from("academy_adv_settings").select("*").maybeSingle();
  const { error } = await db.from("academy_adv_settings").update(row).eq("id", true);
  if (error) go({ err: "Couldn't save settings." });
  await audit(user.id, "adv.settings", "academy_adv_settings", null, { before: prev, after: row });
  done("Settings saved.");
}

export async function approveStage(form: FormData) {
  const { user, db } = await admin();
  const stage = Number(str(form, "stage"));
  if (!Number.isInteger(stage) || stage < 1 || stage > 20) go({ err: "Choose a stage." });
  if (form.get("confirm") !== "on") go({ err: "Tick the confirmation box to change the price for new members." });
  const note = str(form, "note").slice(0, 500) || null;
  const { error } = await db.rpc("academy_adv_set_stage", { p_stage: stage, p_actor: user.id, p_note: note });
  if (error) go({ err: error.message.includes("prices_missing") ? "Stripe prices for that stage aren't mapped yet. Create them below first." : "Couldn't change the stage." });
  done(`Stage ${stage} approved. New members now see stage ${stage} prices. Existing members keep their rate.`);
}

export async function saveSubject(form: FormData) {
  const { user, db } = await admin();
  const slug = str(form, "slug");
  if (!SLUG.test(slug)) go({ err: "Subject not found." });
  const status = str(form, "status");
  if (!["draft", "upcoming", "published", "retired"].includes(status)) go({ err: "Choose a status." });
  const next = str(form, "recommended_next") || null;
  if (next && (!SLUG.test(next) || next === slug)) go({ err: "Choose a different subject to pair with." });
  const row = {
    status, recommended_next: next, recommend_reason: str(form, "recommend_reason").slice(0, 240) || null,
    sort_order: Number(str(form, "sort_order")) || 0,
  };
  const { error } = await db.from("academy_adv_subjects").update(row).eq("slug", slug);
  if (error) go({ err: "Couldn't save the subject." });
  await audit(user.id, "adv.subject", "academy_adv_subjects", null, { slug, ...row });
  done(`${slug} saved.`);
}

const grantSchema = z.object({
  email: z.string().email(), scope: z.enum(["subjects", "all_access"]), subjects: z.array(z.string().regex(SLUG)).max(20),
  days: z.number().int().min(0).max(3650), reason: z.string().min(3).max(300),
});
export async function grantAccess(form: FormData) {
  const { user, db } = await admin();
  const p = grantSchema.safeParse({
    email: str(form, "email").toLowerCase(), scope: str(form, "scope"), subjects: form.getAll("subjects").map(String),
    days: Number(str(form, "days") || 0), reason: str(form, "reason"),
  });
  if (!p.success) go({ err: "Enter an email, a reason, and at least one subject (or All Access)." });
  const v = p.data!;
  if (v.scope === "subjects" && v.subjects.length === 0) go({ err: "Pick at least one subject." });
  const { data: uid } = await db.rpc("academy_adv_find_user", { p_email: v.email });
  if (!uid) go({ err: "No Built2Bid account uses that email yet. Ask them to sign up first." });
  const row = {
    user_id: uid as string, scope: v.scope, subjects: v.scope === "all_access" ? [] : v.subjects, reason: v.reason, granted_by: user.id,
    expires_at: v.days ? new Date(Date.now() + v.days * 86_400_000).toISOString() : null,
  };
  const { data, error } = await db.from("academy_adv_grants").insert(row).select("id").single();
  if (error || !data) go({ err: "Couldn't create the grant." });
  await audit(user.id, "adv.grant", "academy_adv_grants", data!.id, { email: v.email, ...row });
  done(`Complimentary course access granted to ${v.email}. It doesn't include Individual Unlimited software.`);
}

export async function revokeGrant(form: FormData) {
  const { user, db } = await admin();
  const id = str(form, "id");
  if (!z.string().uuid().safeParse(id).success) go({ err: "Grant not found." });
  const { error } = await db.from("academy_adv_grants").update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq("id", id).is("revoked_at", null);
  if (error) go({ err: "Couldn't revoke the grant." });
  await audit(user.id, "adv.grant_revoke", "academy_adv_grants", id);
  done("Grant revoked.");
}

export async function resolveIssue(form: FormData) {
  const { user, db } = await admin();
  const id = str(form, "id");
  if (!z.string().uuid().safeParse(id).success) go({ err: "Issue not found." });
  const { error } = await db.from("academy_adv_issues").update({ resolved_at: new Date().toISOString(), resolved_by: user.id }).eq("id", id);
  if (error) go({ err: "Couldn't update the issue." });
  await audit(user.id, "adv.issue_resolve", "academy_adv_issues", id, { note: str(form, "note").slice(0, 300) || null });
  done("Issue marked resolved.");
}

export async function setFounding(form: FormData) {
  const { user, db } = await admin();
  const uid = str(form, "user_id"); const mode = str(form, "mode");
  const reason = str(form, "reason");
  if (!z.string().uuid().safeParse(uid).success || !["test", "live"].includes(mode)) go({ err: "Member not found." });
  const restore = reason === "restore";
  if (!restore && !["fraud", "duplicate", "test", "admin"].includes(reason)) go({ err: "Choose a reason." });
  const patch = restore ? { status: "qualifying", disqualified_reason: null, disqualified_at: null } : { status: "disqualified", disqualified_reason: reason, disqualified_at: new Date().toISOString() };
  const { error } = await db.from("academy_adv_founding").update({ ...patch, note: str(form, "note").slice(0, 500) || null }).eq("user_id", uid).eq("mode", mode);
  if (error) go({ err: "Couldn't update the founding member." });
  await audit(user.id, restore ? "adv.founding_restore" : "adv.founding_disqualify", "academy_adv_founding", uid, { mode, reason });
  done(restore ? "Founding member counted again." : "Founding member no longer counts toward the price ladder. Their own rate is unchanged.");
}

export async function provisionPrices(form: FormData) {
  const { user, db } = await admin();
  const key = serverEnv().stripeSecretKey;
  if (!key) go({ err: "No Stripe key is set for this deploy." });
  const live = /^(sk|rk)_live_/.test(key);
  if (live && process.env.ACADEMY_ADVANCED_PROVISION_LIVE !== "true") go({ err: "This deploy uses the live Stripe key. Live Academy products and prices need the owner's approval and ACADEMY_ADVANCED_PROVISION_LIVE=true. Use a preview deploy (test key) instead." });
  const dryRun = form.get("dry_run") === "on";
  try {
    const r = await provisionAcademyPrices({ stripe: getStripe(), db, secretKey: key, dryRun, allowLive: live, actor: user.id });
    await audit(user.id, dryRun ? "adv.provision_dry_run" : "adv.provision", "academy_adv_prices", null, { mode: r.mode, products: r.products, created: r.prices.filter((x) => x.status === "created").length, mapped: r.mapped, problems: r.problems });
    const created = r.prices.filter((x) => x.status === (dryRun ? "planned" : "created")).length;
    const msg = dryRun
      ? `Dry run (${r.mode} mode): ${created} prices would be created, ${r.prices.length - created} already exist.`
      : `${r.mode === "test" ? "Test" : "Live"} mode: ${created} prices created, ${r.mapped} mapped.`;
    done(r.problems.length ? `${msg} Check: ${r.problems.slice(0, 3).join(" ")}` : msg);
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    logError("academy.adv.provision", e);
    go({ err: `Stripe provisioning failed: ${(e as Error).message.slice(0, 200)}` });
  }
}

export async function addPrice(form: FormData) {
  const { user, db } = await admin();
  const plan = str(form, "plan"); const stage = Number(str(form, "stage")); const priceId = str(form, "price_id");
  if (!isAdvPlan(plan) || !Number.isInteger(stage) || !/^price_[A-Za-z0-9]+$/.test(priceId)) go({ err: "Enter a plan, a stage and a Stripe price id (price_…)." });
  const key = serverEnv().stripeSecretKey;
  const mode = /^(sk|rk)_live_/.test(key) ? "live" : "test";
  let p;
  try { p = await getStripe().prices.retrieve(priceId); } catch { go({ err: `Stripe doesn't have ${priceId} in ${mode} mode.` }); }
  const { data: st } = await db.from("academy_adv_price_stages").select("*").eq("stage", stage).maybeSingle();
  const want = st ? (plan === "one_subject" ? st.one_subject_cents : plan === "two_subjects" ? st.two_subjects_cents : st.all_access_cents) : null;
  if (!p!.active || p!.currency !== "usd" || p!.recurring?.interval !== "month" || p!.recurring?.interval_count !== 1 || p!.unit_amount !== want) {
    go({ err: `That price is ${p!.unit_amount} ${p!.currency}/${p!.recurring?.interval ?? "one-time"}; stage ${stage} ${plan} needs ${want} usd/month and active.` });
  }
  const product = typeof p!.product === "string" ? p!.product : p!.product.id;
  const { error } = await db.from("academy_adv_prices").insert({ mode, plan, stage, billing_interval: "month", amount_cents: want, stripe_product_id: product, stripe_price_id: priceId, created_by: user.id });
  if (error) go({ err: error.code === "23505" ? "That stage and plan already has an active price. Deactivate it first." : "Couldn't save the price." });
  await audit(user.id, "adv.price_add", "academy_adv_prices", null, { mode, plan, stage, priceId });
  done(`Mapped ${priceId}.`);
}

export async function deactivatePrice(form: FormData) {
  const { user, db } = await admin();
  const id = str(form, "id");
  if (!z.string().uuid().safeParse(id).success) go({ err: "Price not found." });
  const { data } = await db.from("academy_adv_prices").update({ active: false }).eq("id", id).select("stripe_price_id, plan, stage, mode").maybeSingle();
  await audit(user.id, "adv.price_deactivate", "academy_adv_prices", id, data ?? {});
  done("Price mapping deactivated. Existing subscribers on it are unaffected.");
}

