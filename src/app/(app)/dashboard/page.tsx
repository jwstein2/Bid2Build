import type { Metadata } from "next";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BidList, type BidRow } from "./bid-list";
import { LocalDraftsBanner } from "./local-drafts";
import { QuotaCard } from "./quota-card";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function Dashboard() {
  const user = (await getUser())!;
  const supabase = await createClient();
  const [{ data: estimates }, { data: versions }, { data: quota }, { data: biz }] = await Promise.all([
    supabase.from("estimates").select("id, title, customer_name, trades, status, updated_at, estimate_number").order("updated_at", { ascending: false }).limit(500),
    supabase.from("estimate_versions").select("id, estimate_id, version_number, total, created_at").order("version_number", { ascending: false }),
    supabase.rpc("quota_status"),
    supabase.from("business_profiles").select("company_name").eq("user_id", user.id).maybeSingle(),
  ]);
  const latest = new Map<string, { id: string; version_number: number; total: number }>();
  for (const v of versions ?? []) if (!latest.has(v.estimate_id)) latest.set(v.estimate_id, v);
  const rows: BidRow[] = (estimates ?? []).map((e) => ({
    id: e.id, title: e.title || "Untitled bid", customer: e.customer_name, trades: e.trades, status: e.status, updatedAt: e.updated_at, number: e.estimate_number,
    latestVersion: latest.get(e.id) ? { id: latest.get(e.id)!.id, number: latest.get(e.id)!.version_number, total: Number(latest.get(e.id)!.total) } : null,
  }));
  const q = (Array.isArray(quota) ? quota[0] : quota) as { exports_used: number; export_limit: number; unlimited: boolean; resets_at: string } | null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-navy">Your bids</h1>
          <p className="text-ink-soft">{biz?.company_name ? biz.company_name : <Link href="/settings/company" className="text-accent-ink underline">Set up your company profile</Link>}</p>
        </div>
        <ButtonLink href="/bids" variant="accent">New bid</ButtonLink>
      </div>
      <LocalDraftsBanner />
      <div className="grid gap-4 sm:grid-cols-3">
        {q && <QuotaCard used={q.exports_used} limit={q.export_limit} unlimited={q.unlimited} resetsAt={q.resets_at} />}
        <Card className="p-4"><p className="text-sm text-muted">Drafts</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "draft").length}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Finalized proposals</p><p className="text-2xl font-extrabold">{rows.filter((r) => r.status === "finalized").length}</p></Card>
      </div>
      <BidList rows={rows} />
    </div>
  );
}
