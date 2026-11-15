import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BidList, type BidRow } from "./bid-list";
import { LocalDraftsBanner } from "./local-drafts";
import { ProfileReminder } from "./profile-reminder";
import { CreditBalances, UpgradeLink } from "@/components/billing/credits";
import { loadCreditStatus } from "@/lib/credits/server";
import { PremiumTiles } from "./library-tile";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import { can, loadMyCompany } from "@/lib/enterprise/server";
import { ROLE_LABELS } from "@/lib/enterprise/permissions";
import { isEsignEnabled, RECENT_SIGNED_DAYS } from "@/lib/esign/config";
import { recentSignatures, signingByEstimate, type RequestRow, type SignatureRow } from "@/lib/esign/status";
import { RecentlySigned, type SignedBid } from "./recently-signed";
import { RefreshOnFocus } from "@/components/esign/refresh-on-focus";
import { ReferCard } from "./refer-card";
import { referralLink, type MyReferral } from "@/lib/growth/referral";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function Dashboard() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: estimates }, { data: versions }, credits, { data: biz }, libraryAccess, company, { data: referralData }] = await Promise.all([
    // "My bids" stays personal: Enterprise owners/managers can also read teammates' company bids (RLS),
    // which belong in the company Command Center, not here.
    supabase.from("estimates").select("id, title, customer_name, trades, status, updated_at, estimate_number").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(500),
    supabase.from("estimate_versions").select("id, estimate_id, version_number, total, created_at").order("version_number", { ascending: false }),
    loadCreditStatus(supabase),
    supabase.from("business_profiles").select("company_name, logo_path, phone, email, address").eq("user_id", user.id).maybeSingle(),
    hasPremiumAccess(supabase),
    loadMyCompany(supabase),
    // Referral code + counts. Missing function (migration not run yet) just hides the card.
    supabase.rpc("my_referral"),
  ]);
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
  const latest = new Map<string, { id: string; version_number: number; total: number }>();
  for (const v of versions ?? []) if (!latest.has(v.estimate_id)) latest.set(v.estimate_id, v);
  const rows: BidRow[] = (estimates ?? []).map((e) => ({
    id: e.id, title: e.title || "Untitled bid", customer: e.customer_name, trades: e.trades, status: e.status, updatedAt: e.updated_at, number: e.estimate_number,
    latestVersion: latest.get(e.id) ? { id: latest.get(e.id)!.id, number: latest.get(e.id)!.version_number, total: Number(latest.get(e.id)!.total) } : null,
    signing: esign ? signing.get(e.id) ?? { state: "none", signed: null, latest: null } : null,
  }));

  // Details that make proposals look complete. None are required to create or export a bid.
  const missing = [!biz?.company_name && "company name", !biz?.logo_path && "logo", !(biz?.phone || biz?.email) && "phone or email", !biz?.address && "business address"]
    .filter((x): x is string => Boolean(x));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-navy">Your bids</h1>
          <p className="text-ink-soft">{biz?.company_name ? biz.company_name : <Link href="/settings/company" className="text-accent-ink underline">Set up your company profile</Link>}</p>
        </div>
        <div className="flex items-center gap-2">
          {credits && !credits.unlimited && <UpgradeLink compact />}
          <ButtonLink href="/bids" variant="accent" className="hidden md:inline-flex">Create New Bid</ButtonLink>
        </div>
      </div>
      <LocalDraftsBanner />
      {esign && <RefreshOnFocus />}
      {esign && recentSigned.length > 0 && <RecentlySigned bids={recentSigned} days={RECENT_SIGNED_DAYS} />}
      <ProfileReminder missing={missing} />
      <div className="grid gap-4 lg:grid-cols-3">
        {credits && <CreditBalances credits={credits} className="lg:col-span-2" showUpgrade={false} enterprise={enterprise} />}
        <div className={`grid gap-4 lg:grid-cols-1 ${esign ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
          {esign && (
            <Card className="col-span-2 border-ok/30 p-4 sm:col-span-1 lg:col-span-1" data-testid="signed-count">
              <p className="flex items-center gap-1 text-sm text-muted"><FileCheck2 className="h-4 w-4 text-ok" aria-hidden />Recently Signed Bids</p>
              <p className="text-2xl font-extrabold text-ok">{recentSigned.length}</p>
              <p className="text-xs text-muted">Last {RECENT_SIGNED_DAYS} days</p>
            </Card>
          )}
          <Card className="p-4"><p className="text-sm text-muted">Drafts</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "draft").length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted">Finalized proposals</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "finalized").length}</p></Card>
        </div>
      </div>
      <PremiumTiles unlocked={libraryAccess} />
      {referral && <ReferCard link={referralLink(referral.code)} signedUp={referral.signed_up} paying={referral.paying} monthsEarned={referral.months_earned} eligible={referral.eligible} />}
      <BidList rows={rows} />
    </div>
  );
}
