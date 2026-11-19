import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { GeneratorStart } from "@/components/library/generator/generator-start";
import { createClient, getUser } from "@/lib/supabase/server";
import { getTrade } from "@/lib/trades/catalog";

export const metadata: Metadata = { title: "Generate My Price Library", robots: { index: false } };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Step 1 of "Generate My Price Library". Trade suggestions come from the company profile and recent bids. */
export default async function GeneratePage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard/items/generate");
  const supabase = await createClient();
  const [{ data: profile }, { data: recent }] = await Promise.all([
    supabase.from("business_profiles").select("primary_trade").eq("user_id", user.id).maybeSingle(),
    supabase.from("estimates").select("id, title, trades, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(25),
  ]);
  const tally = new Map<string, number>();
  for (const e of recent ?? []) for (const t of (e as any).trades ?? []) tally.set(t, (tally.get(t) ?? 0) + 1);
  const defaults = [(profile as any)?.primary_trade, ...[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)]
    .filter((t, k, a): t is string => typeof t === "string" && Boolean(getTrade(t)) && a.indexOf(t) === k && t !== "other")
    .slice(0, 1);
  const bids = (recent ?? []).filter((e: any) => (e.title ?? "").trim()).slice(0, 15).map((e: any) => ({ id: e.id as string, label: String(e.title).slice(0, 80) }));
  return (
    <div className="mx-auto max-w-4xl space-y-6" data-guide-page="library.generate">
      <div>
        <Link href="/dashboard/items" className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><ChevronLeft className="h-4 w-4" aria-hidden /> Saved Items &amp; Pricing</Link>
        <h1 className="mt-1 text-3xl font-extrabold text-navy">Generate My Price Library</h1>
        <p className="text-ink-soft">Get a draft list of the items you estimate with, organized by category. Review it, enter your own costs and approve what you want. Nothing is saved until you approve it.</p>
      </div>
      <GeneratorStart bids={bids} defaultTrades={defaults} />
    </div>
  );
}
