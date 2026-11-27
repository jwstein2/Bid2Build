import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { site } from "@/lib/site";
import { checkoutTaxParams, previewTaxParams } from "@/lib/billing/tax";
import { holdsCompanySeat } from "@/lib/billing/company-seat";
import { applySubscription } from "@/lib/billing/apply";
import { academyMetadata, accessFor, advancedErrorMessage } from "./billing";
import { isAutoAdvanceAllowed } from "./flags";
import { isAcademyMeta, pickerOptions, subjectsFor, type AdvPlan } from "./plans";

/**
 * Quote -> accept -> Stripe for Academy Advanced. Every price, subject list and entitlement is decided here and in
 * the database, never taken from the browser. The browser only sends a package name, a subject slug and a quote id.
 */

type Db = SupabaseClient;
export type Quote = {
  id: string; user_id: string; mode: "test" | "live"; kind: "new" | "upgrade" | "convert"; plan: AdvPlan; subjects: string[]; stage: number; amount_cents: number;
  stripe_price_id: string; holds_slot: boolean; status: string; expires_at: string; accepted_at: string | null; membership_id: string | null; convert_subscription_id: string | null;
};
export type QuoteView = {
  id: string; kind: Quote["kind"]; plan: AdvPlan; subjects: { slug: string; title: string }[]; amount_cents: number; stage: number; expires_at: string;
  due_now_cents: number | null; credit_cents: number | null; notes: string[];
};
export class AdvError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

type Membership = { id: string; plan: AdvPlan; subjects: string[]; stripe_subscription_id: string; status: string; current_period_end: string | null; amount_cents: number | null };

const liveStatuses = new Set(["active", "trialing", "past_due"]);
const live = (m: { status: string; current_period_end: string | null }) => liveStatuses.has(m.status) && (!m.current_period_end || new Date(m.current_period_end) > new Date());

export async function liveMembership(db: Db, userId: string, mode: string): Promise<Membership | null> {
  const { data } = await db.from("academy_adv_memberships").select("id, plan, subjects, stripe_subscription_id, status, current_period_end, amount_cents")
    .eq("user_id", userId).eq("mode", mode).order("created_at", { ascending: false });
  return ((data ?? []) as Membership[]).find(live) ?? null;
}

async function ensureCustomer(db: Db, stripe: Stripe, user: { id: string; email?: string | null; phone?: string | null }): Promise<string> {
  let { data: bc } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (!bc) {
    const customer = await stripe.customers.create({ email: user.email ?? undefined, phone: user.phone ?? undefined, metadata: { user_id: user.id } }, { idempotencyKey: `customer-${user.id}` });
    const { error } = await db.from("billing_customers").insert({ user_id: user.id, stripe_customer_id: customer.id });
    if (error) ({ data: bc } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle());
    else bc = { stripe_customer_id: customer.id };
  }
  return bc!.stripe_customer_id as string;
}

/** The person's paid Individual Unlimited subscription, if any (never an Academy or Enterprise one). */
async function paidUnlimited(db: Db, userId: string): Promise<{ stripe_subscription_id: string; plan: string | null } | null> {
  const { data } = await db.from("subscriptions").select("stripe_subscription_id, plan, status, current_period_end").eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due"]).neq("plan", "enterprise");
  return ((data ?? []) as { stripe_subscription_id: string; plan: string | null; status: string; current_period_end: string | null }[]).find(live) ?? null;
}

/** Verified Stripe prices (amount, currency, monthly, active) cached per instance for 10 minutes. */
const verified = new Map<string, number>();
async function verifyPrice(stripe: Stripe, priceId: string, cents: number) {
  const at = verified.get(`${priceId}:${cents}`);
  if (at && Date.now() - at < 10 * 60_000) return;
  const p = await stripe.prices.retrieve(priceId);
  if (!p.active || p.unit_amount !== cents || p.currency !== "usd" || p.recurring?.interval !== "month" || p.recurring?.interval_count !== 1) {
    throw new AdvError(500, "pricing_mismatch", "Checkout is temporarily unavailable while we update pricing. Please try again later.");
  }
  verified.set(`${priceId}:${cents}`, Date.now());
}

async function subjectTitles(db: Db, slugs: string[]) {
  if (!slugs.length) return [];
  const { data } = await db.from("academy_adv_subjects").select("slug, title").in("slug", slugs);
  const t = new Map((data ?? []).map((r) => [r.slug as string, r.title as string]));
  return slugs.map((s) => ({ slug: s, title: t.get(s) ?? s }));
}

/** Build a quote (and reserve a founding slot) for `plan` starting from `subject`. */
export async function createQuote(db: Db, stripe: Stripe, user: { id: string; email?: string | null; phone?: string | null }, mode: "test" | "live", plan: AdvPlan, subject: string): Promise<QuoteView> {
  const { data: subj } = await db.from("academy_adv_subjects").select("slug, recommended_next").eq("slug", subject).maybeSingle();
  if (!subj) throw new AdvError(404, "not_found", "That subject isn't available.");
  const partnerOk = subj.recommended_next ? (await db.rpc("academy_adv_purchasable", { p_subject: subj.recommended_next })).data === true : false;
  const partner = partnerOk ? (subj.recommended_next as string) : null;
  const access = await accessFor(db, user.id);
  const member = await liveMembership(db, user.id, mode);
  // Paid access decides the options; complimentary or staff access alone never blocks buying.
  const opts = pickerOptions({ ...access, plan: member?.plan ?? null, subjects: member ? (member.plan === "all_access" ? [] : member.subjects) : access.subjects, all_access: member?.plan === "all_access" || access.all_access }, subject, partner);
  if (opts.enter) throw new AdvError(409, "already_included", "You already have this subject. Open it from Advanced Learning.");
  if (!opts.plans.includes(plan)) throw new AdvError(409, "not_offered", "That package isn't available for your account. Please choose one of the options shown.");

  const notes: string[] = [];
  let kind: Quote["kind"] = "new";
  let convert: string | null = null;
  if (member) {
    kind = "upgrade";
  } else if (plan === "all_access") {
    const iu = await paidUnlimited(db, user.id);
    if (iu) {
      if (iu.plan !== "monthly") throw new AdvError(409, "annual_unlimited", "You pay for Individual Unlimited yearly, so switching needs a person to make sure you aren't charged twice. Email support@built2bid.org and we'll set it up.");
      kind = "convert";
      convert = iu.stripe_subscription_id;
    }
    if (await holdsCompanySeat(db, user.id)) notes.push("Your company's Team license already gives you the software. All Access would add the advanced courses; it doesn't change your company plan, seats or billing.");
  }
  const subjects = subjectsFor(plan, subject, partner, member?.plan === "one_subject" ? member.subjects : []);
  if (!subjects) throw new AdvError(409, "not_offered", "That package isn't available for this subject yet.");

  const { data, error } = await db.rpc("academy_adv_quote", {
    p_user_id: user.id, p_mode: mode, p_plan: plan, p_subjects: subjects, p_kind: kind, p_membership_id: member?.id ?? null, p_convert_subscription_id: convert, p_auto_allowed: isAutoAdvanceAllowed(),
  });
  if (error) { const e = advancedErrorMessage(error.message); throw new AdvError(409, e.code, e.message); }
  const q = data as Quote;

  let dueNow: number | null = null;
  let credit: number | null = null;
  try {
    if (kind === "upgrade" && member) {
      const sub = await stripe.subscriptions.retrieve(member.stripe_subscription_id);
      const preview = await stripe.invoices.createPreview({
        customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id, subscription: sub.id,
        subscription_details: { items: [{ id: sub.items.data[0].id, price: q.stripe_price_id }], proration_behavior: "always_invoice" }, ...previewTaxParams(sub),
      });
      dueNow = Math.max(0, preview.amount_due);
      notes.push("You keep your progress. The new monthly rate is today's founding price for this package; your current package's rate doesn't carry over to a different package.");
    } else if (kind === "convert" && convert) {
      const sub = await stripe.subscriptions.retrieve(convert);
      const preview = await stripe.invoices.createPreview({
        customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id, subscription: sub.id,
        subscription_details: { cancel_now: true, proration_behavior: "create_prorations" }, ...previewTaxParams(sub),
      });
      credit = Math.max(0, -preview.total);
      notes.push("Right after this payment we cancel your Individual Unlimited plan ($19.99/month) and credit its unused days to your account. The credit comes off your next Academy invoice, so you never pay for the same seat twice. Your bids, customers and saved items stay exactly as they are.");
    }
  } catch {
    if (kind === "upgrade") notes.push("Stripe will charge the prorated difference for the rest of this month when you confirm.");
    if (kind === "convert") notes.push("Right after this payment we cancel your Individual Unlimited plan and credit its unused days to your account, applied to your next Academy invoice.");
  }
  return { id: q.id, kind, plan, subjects: await subjectTitles(db, q.subjects), amount_cents: q.amount_cents, stage: q.stage, expires_at: q.expires_at, due_now_cents: dueNow, credit_cents: credit, notes };
}

/** The customer accepted a quote: open Stripe Checkout (new / convert) or change the existing subscription (upgrade). */
export async function acceptQuote(db: Db, stripe: Stripe, user: { id: string; email?: string | null; phone?: string | null }, quoteId: string, returnSubject: string | null): Promise<{ url: string }> {
  const { data, error } = await db.rpc("academy_adv_quote_accept", { p_quote_id: quoteId, p_user_id: user.id });
  if (error) { const e = advancedErrorMessage(error.message); throw new AdvError(409, e.code, e.message); }
  const q = data as Quote;
  await verifyPrice(stripe, q.stripe_price_id, q.amount_cents);
  const back = returnSubject && /^[a-z0-9-]{3,60}$/.test(returnSubject) ? `/academy/advanced/${returnSubject}` : "/academy/advanced";

  if (q.kind === "upgrade") {
    const { data: m } = await db.from("academy_adv_memberships").select("id, stripe_subscription_id, status, current_period_end, user_id").eq("id", q.membership_id ?? "").maybeSingle();
    if (!m || m.user_id !== user.id || !live(m)) throw new AdvError(409, "membership_changed", "Your membership changed. Please start again.");
    const sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id);
    // pending_if_incomplete: the new package applies only once Stripe collects the prorated amount. No unpaid upgrades.
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: q.stripe_price_id }], proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete",
    }, { idempotencyKey: `academy-upgrade-${q.id}` });
    if (updated.pending_update) {
      await db.rpc("academy_adv_quote_mark", { p_quote_id: q.id, p_status: "failed", p_session_id: null, p_subscription_id: sub.id });
      const inv = typeof updated.latest_invoice === "string" ? await stripe.invoices.retrieve(updated.latest_invoice) : updated.latest_invoice;
      if (inv?.hosted_invoice_url) return { url: inv.hosted_invoice_url };
      throw new AdvError(402, "payment_needed", "Your card needs attention before the upgrade can finish. Update your payment method and try again.");
    }
    const withMeta = await stripe.subscriptions.update(sub.id, { metadata: academyMetadata({ ...q, convert_subscription_id: null }, user.id) });
    await applySubscription(db, withMeta, Math.floor(Date.now() / 1000));
    await db.rpc("academy_adv_quote_mark", { p_quote_id: q.id, p_status: "paid", p_session_id: null, p_subscription_id: sub.id });
    return { url: `${site.url}/academy/advanced/membership?upgraded=1` };
  }

  // New member or Individual Unlimited conversion: Stripe Checkout at exactly the quoted price.
  if (await liveMembership(db, user.id, q.mode)) throw new AdvError(409, "already_member", "You already have an Academy membership. Upgrade it from Membership instead.");
  const customer = await ensureCustomer(db, stripe, user);
  const open = (await stripe.checkout.sessions.list({ customer, status: "open", limit: 20 })).data.filter((s) => isAcademyMeta(s.metadata));
  const reuse = open.find((s) => s.metadata?.quote_id === q.id && s.url);
  if (reuse?.url) return { url: reuse.url };
  await Promise.all(open.map((s) => stripe.checkout.sessions.expire(s.id).catch(() => null)));
  // Stripe needs at least 30 minutes; accepting a quote holds it at least 31 minutes (academy_adv_quote_accept).
  const expires = Math.max(Math.floor(new Date(q.expires_at).getTime() / 1000) - 20, Math.floor(Date.now() / 1000) + 30 * 60 + 5);
  const metadata = academyMetadata(q, user.id);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription", customer, client_reference_id: user.id,
    line_items: [{ price: q.stripe_price_id, quantity: 1 }],
    subscription_data: { metadata, description: "Built2Bid Academy membership" },
    metadata,
    // Founding prices are the offer; promotion codes would undercut the published ladder.
    allow_promotion_codes: false,
    ...checkoutTaxParams(),
    expires_at: expires,
    success_url: `${site.url}/academy/advanced/membership?checkout=success`,
    cancel_url: `${site.url}${back}?checkout=cancelled`,
  }, { idempotencyKey: `academy-checkout-${q.id}` });
  if (!session.url) throw new AdvError(409, "checkout_retry", "That checkout link expired. Please try again.");
  await db.rpc("academy_adv_quote_mark", { p_quote_id: q.id, p_status: "checkout_open", p_session_id: session.id, p_subscription_id: null });
  return { url: session.url };
}
