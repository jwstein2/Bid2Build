import type { Metadata } from "next";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BidList, type BidRow } from "./bid-list";
import { LocalDraftsBanner } from "./local-drafts";
import { ProfileReminder } from "./profile-reminder";
import { CreditBalances, UpgradeLink } from "@/components/billing/credits";
import { loadCreditStatus } from "@/lib/credits/server";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function Dashboard() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: estimates }, { data: versions }, credits, { data: biz }] = await Promise.all([
    supabase.from("estimates").select("id, title, customer_name, trades, status, updated_at, estimate_number").order("updated_at", { ascending: false }).limit(500),
    supabase.from("estimate_versions").select("id, estimate_id, version_number, total, created_at").order("version_number", { ascending: false }),
    loadCreditStatus(supabase),
    supabase.from("business_profiles").select("company_name, logo_path, phone, email, address").eq("user_id", user.id).maybeSingle(),
  ]);
  const latest = new Map<string, { id: string; version_number: number; total: number }>();
  for (const v of versions ?? []) if (!latest.has(v.estimate_id)) latest.set(v.estimate_id, v);
  const rows: BidRow[] = (estimates ?? []).map((e) => ({
    id: e.id, title: e.title || "Untitled bid", customer: e.customer_name, trades: e.trades, status: e.status, updatedAt: e.updated_at, number: e.estimate_number,
    latestVersion: latest.get(e.id) ? { id: latest.get(e.id)!.id, number: latest.get(e.id)!.version_number, total: Number(latest.get(e.id)!.total) } : null,
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
      <ProfileReminder missing={missing} />
      <div className="grid gap-4 lg:grid-cols-3">
        {credits && <CreditBalances credits={credits} className="lg:col-span-2" showUpgrade={false} />}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <Card className="p-4"><p className="text-sm text-muted">Drafts</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "draft").length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted">Finalized proposals</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "finalized").length}</p></Card>
        </div>
      </div>
      <BidList rows={rows} />
    </div>
  );
}
