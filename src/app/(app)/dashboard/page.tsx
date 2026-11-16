import { WhatsNewNotice } from "@/components/features/whats-new-notice";
import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BidList, type BidRow } from "./bid-list";
import { LocalDraftsBanner } from "./local-drafts";
import { ProfileReminder } from "./profile-reminder";
import { PROFILE_REMINDER_COOKIE } from "./profile-reminder-cookie";
import { cookies } from "next/headers";
import { CreditBalances, UpgradeLink } from "@/components/billing/credits";
import { loadCreditStatus } from "@/lib/credits/server";
import { PremiumTiles } from "./library-tile";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { ROLE_LABELS } from "@/lib/enterprise/permissions";
import { isEsignEnabled, RECENT_SIGNED_DAYS } from "@/lib/esign/config";
import { recentSignatures, signingByEstimate, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { RecentlySigned, type SignedBid } from "./recently-signed";
import { ReviewQueue } from "@/components/operations/review-queue";
import { loadReviewQueue } from "@/lib/operations/queue-server";
import { loadPmAccess } from "@/lib/pm/server";
import { isPmEnabled } from "@/lib/env";
import { RefreshOnFocus } from "@/components/esign/refresh-on-focus";
import { ReferCard } from "./refer-card";
import { TrialBanner } from "@/components/billing/trial-banner";
import { referralLink, type MyReferral } from "@/lib/growth/referral";
import { BidsWorkspace, type BidsView } from "@/components/pipeline/bids-workspace";
import { isFocus, isRange, isStage, type BoardBid, type HistoryRow } from "@/lib/pipeline/board";
import { DEFAULT_PAY, sanitizePay } from "@/lib/pipeline/sales-pay";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKLIST_DISMISSED_KEY, checklistSteps, isMeaningfulItem, MEANINGFUL_ITEMS, showChecklist, type ChecklistStep } from "@/lib/growth/activation";
import { ActivationChecklist } from "@/components/growth/activation-checklist";
import { FirstBidStart } from "@/components/growth/first-bid-start";

const EST_COLS = "id, title, customer_name, trades, status, updated_at, estimate_number, created_at";

/** Personal bids with their pipeline fields. Falls back to the pre-V4 columns until the migration runs. */
async function loadBids(supabase: SupabaseClient, userId: string) {
  const full = await supabase.from("estimates").select(`${EST_COLS}, pipeline_stage, stage_changed_at, won_at, lost_reason`).eq("user_id", userId).order("updated_at", { ascending: false }).limit(500);
  if (!full.error) return { rows: full.data ?? [], migrated: true };
  const basic = await supabase.from("estimates").select(`${EST_COLS}, pipeline_stage, stage_changed_at, lost_reason`).eq("user_id", userId).order("updated_at", { ascending: false }).limit(500);
  if (!basic.error) return { rows: basic.data ?? [], migrated: false };
  const legacy = await supabase.from("estimates").select(EST_COLS).eq("user_id", userId).order("updated_at", { ascending: false }).limit(500);
  return { rows: legacy.data ?? [], migrated: false };
}

async function loadHistory(supabase: SupabaseClient, userId: string): Promise<HistoryRow[]> {
  const sel = (cols: string) => supabase.from("estimate_stage_history").select(`${cols}, estimates!inner(user_id)`).eq("estimates.user_id", userId).order("created_at", { ascending: false }).limit(1000);
  const a = await sel("estimate_id, from_stage, to_stage, created_at, effective_at, note");
  if (!a.error) return (a.data ?? []) as unknown as HistoryRow[];
  const b = await sel("estimate_id, from_stage, to_stage, created_at, note");
  return (b.data ?? []) as unknown as HistoryRow[];
}

/**
 * First-bid checklist facts for this account, from what it actually did. Skips every extra query when
 * the checklist was hidden or the account has already delivered a bid with a company name set.
 */
async function loadChecklist(supabase: SupabaseClient, userId: string, f: { companyName: boolean; estimateIds: string[]; latestEstimateId: string | null; delivered: boolean }): Promise<ChecklistStep[] | null> {
  if (f.delivered && f.companyName) return null;
  const { data: auth } = await supabase.auth.getUser();
  if ((auth.user?.user_metadata as Record<string, unknown> | undefined)?.[CHECKLIST_DISMISSED_KEY]) return null;
  let meaningfulEstimates = 0, previewed = false;
  if (f.estimateIds.length && !f.delivered) {
    const [{ data: items }, prev] = await Promise.all([
      supabase.from("estimate_items").select("estimate_id, name, quantity, unit_cost").in("estimate_id", f.estimateIds.slice(0, 200)).limit(5000),
      // analytics_events is service-role only; read just this account's own preview flag.
      createAdminClient().from("analytics_events").select("id").eq("user_id", userId).eq("event", "preview_opened").limit(1).then((r) => r, () => ({ data: null })),
    ]);
    const per = new Map<string, number>();
    for (const i of items ?? []) if (isMeaningfulItem({ name: i.name ?? "", quantity: String(i.quantity), unitCost: String(i.unit_cost) })) per.set(i.estimate_id, (per.get(i.estimate_id) ?? 0) + 1);
    meaningfulEstimates = [...per.values()].filter((n) => n >= MEANINGFUL_ITEMS).length;
    previewed = Boolean(prev.data?.length);
  }
  const steps = checklistSteps({ companyName: f.companyName, estimates: f.estimateIds.length, meaningfulEstimates, previewed, delivered: f.delivered, latestEstimateId: f.latestEstimateId });
  return showChecklist(steps, false) ? steps : null;
}

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const initialView = (["pipeline", "table", "analytics"] as const).find((v) => v === sp.view) as BidsView | undefined;
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ rows: estimates, migrated }, { data: versions }, credits, { data: biz }, libraryAccess, company, { data: referralData }] = await Promise.all([
    // "My bids" stays personal: Enterprise owners/managers can also read teammates' company bids (RLS),
    // which belong in the company Command Center, not here.
    loadBids(supabase, user.id),
    supabase.from("estimate_versions").select("id, estimate_id, version_number, total, subtotal, total_cost, created_at").order("version_number", { ascending: false }),
    loadCreditStatus(supabase),
    supabase.from("business_profiles").select("company_name, logo_path, phone, email, address").eq("user_id", user.id).maybeSingle(),
    hasPremiumAccess(supabase),
    loadMyCompany(supabase),
    // Referral code + counts. Missing function (migration not run yet) just hides the card.
    supabase.rpc("my_referral"),
  ]);
  // Creator Partner Program: gifted members get a welcome line with their mentor and end date.
  // Missing function (migration not applied) or no gift: nothing is shown.
  const { data: gifts } = await supabase.rpc("my_mentorship");
  const gift = ((gifts ?? []) as { state: string; program_state: string; channel_name: string | null; workspace_name: string; expires_at: string | null }[])
    .find((g) => g.state === "active" && g.program_state === "active") ?? null;
  // Facebook BID trial (exact expiry + optional upgrade). Missing function = no banner.
  const { data: trialRows } = await supabase.rpc("my_campaign_trial");
  const trial = (Array.isArray(trialRows) ? trialRows[0] : null) as { state: string; expires_at: string; has_paid_subscription: boolean } | null;
  const [history, { data: payRow }] = await Promise.all([
    loadHistory(supabase, user.id),
    supabase.from("sales_pay_settings").select("method, rate, flat_fee, base_salary, base_exclusions").eq("user_id", user.id).maybeSingle(),
  ]);
  const pay = payRow ? sanitizePay({ method: payRow.method, rate: Number(payRow.rate), flatFee: Number(payRow.flat_fee), baseSalary: Number(payRow.base_salary), baseExclusions: Number(payRow.base_exclusions) }) : DEFAULT_PAY;
  const referral = (referralData as MyReferral | null)?.code ? referralData as MyReferral : null;
  // Signing status (personal bids, like the list below). A missing table (migration not run yet)
  // just means no signing data: the dashboard never fails because of it.
  const esign = isEsignEnabled();
  const [{ data: reqRows }, { data: sigRows }] = esign ? await Promise.all([
    supabase.from("signing_requests").select("id, estimate_id, version_id, status, expires_at, created_at, revoke_reason, signed_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1000),
    supabase.from("signatures").select("id, estimate_id, version_id, version_number, total, signed_at, signer_name, pdf_status, customer_name, project_title, proposal_number").eq("user_id", user.id).order("signed_at", { ascending: false }).limit(1000),
  ]) : [{ data: null }, { data: null }];
  const signing = signingByEstimate((reqRows ?? []) as RequestRow[], (sigRows ?? []) as SignatureRow[]);
  const recentSigned: SignedBid[] = recentSignatures((sigRows ?? []) as SignatureRow[], RECENT_SIGNED_DAYS)
    .map((x) => ({ id: x.id, estimateId: x.estimate_id, customer: x.customer_name || x.signer_name, project: x.project_title || "Untitled bid", total: Number(x.total), signedAt: x.signed_at, versionNumber: x.version_number, pdfStatus: x.pdf_status }));
  const enterprise = company?.entitlement.active ? {
    companyName: company.name, role: ROLE_LABELS[company.role], complimentary: company.entitlement.source === "complimentary",
    expiresAt: company.entitlement.expiresAt, manageHref: can(company, "manage_billing") ? "/company/billing" as const : "/company/users" as const,
  } : null;
  const latest = new Map<string, { id: string; version_number: number; total: number; subtotal?: number | string | null; total_cost?: number | string | null }>();
  for (const v of versions ?? []) if (!latest.has(v.estimate_id)) latest.set(v.estimate_id, v);
  type Est = { id: string; title: string; customer_name: string; trades: string[]; status: BidRow["status"]; updated_at: string; estimate_number: string; created_at: string; pipeline_stage?: string; stage_changed_at?: string | null; won_at?: string | null; lost_reason?: string | null };
  const ests = (estimates ?? []) as Est[];
  const board: BoardBid[] = ests.map((e) => {
    const v = latest.get(e.id);
    return {
      id: e.id, title: e.title || "Untitled bid", customer: e.customer_name, number: e.estimate_number, trades: e.trades, status: e.status,
      stage: isStage(e.pipeline_stage) ? e.pipeline_stage : "draft", createdAt: e.created_at ?? e.updated_at, updatedAt: e.updated_at,
      stageChangedAt: e.stage_changed_at ?? null, wonAt: e.won_at ?? null, lostReason: e.lost_reason ?? null,
      latestVersion: v ? { id: v.id, number: v.version_number, total: Number(v.total), subtotal: v.subtotal == null ? null : Number(v.subtotal), cost: v.total_cost == null ? null : Number(v.total_cost) } : null,
      signing: esign ? signing.get(e.id) ?? { state: "none", signed: null, latest: null } : null,
    };
  });
  const rows: BidRow[] = ests.map((e) => ({
    id: e.id, title: e.title || "Untitled bid", customer: e.customer_name, trades: e.trades, status: e.status, updatedAt: e.updated_at, number: e.estimate_number,
    latestVersion: latest.get(e.id) ? { id: latest.get(e.id)!.id, number: latest.get(e.id)!.version_number, total: Number(latest.get(e.id)!.total) } : null,
    signing: esign ? signing.get(e.id) ?? { state: "none", signed: null, latest: null } : null,
  }));

  const ownIds = new Set(ests.map((e) => e.id));
  const delivered = ests.some((e) => latest.has(e.id)) || (reqRows ?? []).some((r: { estimate_id: string }) => ownIds.has(r.estimate_id));
  const checklist = ests.length === 0 ? null : await loadChecklist(supabase, user.id, { companyName: Boolean(biz?.company_name?.trim()), estimateIds: ests.map((e) => e.id), latestEstimateId: ests[0]?.id ?? null, delivered });

  // Details that make proposals look complete. None are required to create or export a bid.
  const missing = [!biz?.company_name && "company name", !biz?.logo_path && "logo", !(biz?.phone || biz?.email) && "phone or email", !biz?.address && "business address"]
    .filter((x): x is string => Boolean(x));

  const rawDismissed = (await cookies()).get(PROFILE_REMINDER_COOKIE)?.value;
  const reminderDismissed = rawDismissed ? decodeURIComponent(rawDismissed) : null;

  // V4.3 "Newly approved — needs review" (same queue as Projects; null before the SQL runs).
  const [reviewQueue, pmAccess] = isPmEnabled() ? await Promise.all([loadReviewQueue(supabase), loadPmAccess(supabase)]) : [null, null];
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {gift && <p className="text-sm font-semibold text-accent-ink">{biz?.company_name ? `Welcome back, ${biz.company_name}` : "Let's build your next professional bid"}</p>}
          <h1 className="text-3xl font-extrabold text-navy">Your bids</h1>
          <p className="text-ink-soft">{biz?.company_name ? biz.company_name : <Link href="/settings/company" className="text-accent-ink underline">Set up your company profile</Link>}</p>
        </div>
        <div className="flex items-center gap-2">
          {credits && !credits.unlimited && <UpgradeLink compact />}
          <ButtonLink href="/bids" variant="accent" className="hidden md:inline-flex">Create New Bid</ButtonLink>
        </div>
      </div>
      {gift && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="gift-banner">
          <p className="text-sm">Complimentary Unlimited from <span className="font-semibold">{gift.channel_name ?? gift.workspace_name}</span>{gift.expires_at ? ` through ${new Date(gift.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : ""}. No payment needed.</p>
          <div className="flex gap-3 text-sm font-semibold"><Link href="/welcome" className="underline">Branding setup</Link><Link href="/mentorship" className="underline">Mentorship</Link></div>
        </Card>
      )}
      {trial && !trial.has_paid_subscription && (trial.state === "active" || trial.state === "expired") && <TrialBanner state={trial.state} expiresAt={trial.expires_at} />}
      <WhatsNewNotice />
      <LocalDraftsBanner />
      {esign && <RefreshOnFocus />}
      {esign && recentSigned.length > 0 && <RecentlySigned bids={recentSigned} days={RECENT_SIGNED_DAYS} />}
      {reviewQueue && reviewQueue.length > 0 && <ReviewQueue items={reviewQueue} canSchedule={Boolean(pmAccess?.canEdit)} compact max={5} />}
      {ests.length === 0 && <FirstBidStart companyName={biz?.company_name?.trim() || null} />}
      {checklist && <ActivationChecklist steps={checklist} />}
      {!checklist && ests.length > 0 && <ProfileReminder missing={missing} dismissedSignature={reminderDismissed} />}
      <BidsWorkspace bids={board} history={history} esign={esign} pay={pay} paySaved={Boolean(payRow)} migrated={migrated} initialView={initialView} initialFocus={isFocus(sp.focus) ? sp.focus : null} initialRange={isRange(sp.range) ? sp.range : undefined} table={<BidList rows={rows} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        {credits && <CreditBalances credits={credits} className="lg:col-span-2" showUpgrade={false} enterprise={enterprise} />}
        <div className="grid gap-4">
          {esign && (
            <Card className="border-ok/30 p-4" data-testid="signed-count">
              <p className="flex items-center gap-1 text-sm text-muted"><FileCheck2 className="h-4 w-4 text-ok" aria-hidden />Recently Signed Bids</p>
              <p className="text-2xl font-extrabold text-ok">{recentSigned.length}</p>
              <p className="text-xs text-muted">Last {RECENT_SIGNED_DAYS} days</p>
            </Card>
          )}
        </div>
      </div>
      <PremiumTiles unlocked={libraryAccess} />
      {referral && <ReferCard link={referralLink(referral.code)} signedUp={referral.signed_up} paying={referral.paying} monthsEarned={referral.months_earned} eligible={referral.eligible} />}
    </div>
  );
}
