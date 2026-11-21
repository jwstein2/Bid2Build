import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { loadClockProjects } from "@/lib/team/server";
import { isQuickBooksEnabled, qbConfigured } from "@/lib/quickbooks/config";
import { scopeFor } from "@/lib/quickbooks/server";
import { QuickBooksSync } from "@/components/workforce/quickbooks/quickbooks-sync";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "QuickBooks hours sync", robots: { index: false } };

const RESULT: Record<string, { tone: "ok" | "warn" | "danger"; text: string }> = {
  connected: { tone: "ok", text: "QuickBooks is connected. Match your workers below, then send approved hours." },
  declined: { tone: "warn", text: "QuickBooks wasn't connected because the sign-in was cancelled." },
  failed: { tone: "danger", text: "We couldn't finish connecting QuickBooks. Please try again." },
  forbidden: { tone: "danger", text: "Only people who manage your team can connect QuickBooks." },
  unavailable: { tone: "warn", text: "QuickBooks connections are coming soon." },
  busy: { tone: "warn", text: "Too many tries in a row. Wait a few minutes and try again." },
};

/**
 * Projects → Contractors & Workforce → QuickBooks (V8.4): send approved crew hours to QuickBooks Online as time
 * entries, so QuickBooks Payroll can pay them. Built2Bid doesn't run payroll here.
 */
export default async function QuickBooksPage({ searchParams }: { searchParams: Promise<{ qb?: string }> }) {
  if (!isPmEnabled() || !isQuickBooksEnabled()) notFound();
  const supabase = await createClient();
  const [scope, sp] = await Promise.all([scopeFor(supabase), searchParams]);
  const header = (
    <div>
      <Link href="/projects/workforce/time-tracking?tab=payroll" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden /> Time tracking</Link>
      <h1 className="mt-1 text-3xl font-extrabold text-navy">QuickBooks hours sync</h1>
      <p className="mt-1 text-ink-soft">Send approved crew hours to QuickBooks Online as time entries, ready to run in QuickBooks Payroll. No double entry.</p>
    </div>
  );
  if (!scope) return <div className="mx-auto max-w-4xl space-y-5">{header}<Notice tone="warn" title="QuickBooks sync is being set up">The database update for this page hasn&apos;t been applied yet.</Notice></div>;
  if (!scope.canManage) return <div className="mx-auto max-w-4xl space-y-5">{header}<Notice title="Only people who manage your team can open this page" /></div>;
  const [{ data: people }, projects] = await Promise.all([
    supabase.from("pm_resources").select("id, name, kind").in("kind", ["staff", "crew"]).eq("status", "active").order("name").limit(500),
    loadClockProjects(supabase),
  ]);
  const result = sp.qb ? RESULT[sp.qb] : undefined;
  return (
    <div className="mx-auto max-w-4xl space-y-5" data-testid="quickbooks-page">
      {header}
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <QuickBooksSync configured={qbConfigured()} workers={((people ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }))} projects={projects} />
    </div>
  );
}
