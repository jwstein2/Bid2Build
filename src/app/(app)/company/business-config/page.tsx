import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { pickerTrades } from "@/lib/trades/picker";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BusinessConfigForm } from "@/components/financials/business-config-form";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "Business & Trade Configuration", robots: { index: false } };

/** Company → Business & Trade Configuration (trade-adaptive Financials, V3). Uses the existing trade catalog. */
export default async function BusinessConfigPage() {
  if (!isFinancialsEnabled()) notFound();
  const state = await loadFinState(await createClient());
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Breadcrumbs className="mb-3" items={[{ label: "Company", href: "/settings/company" }, { label: "Business & Trade Configuration" }]} />
      <h1 className="text-3xl font-extrabold">Business &amp; Trade Configuration</h1>
      <p className="max-w-2xl text-ink-soft">Tell Financials what kind of work you do and how you bill. Your Financials home, quick actions, reports and starter cost codes follow it.</p>
      {state.kind !== "ready" ? <FinStateNotice state={state} />
        : <BusinessConfigForm trades={pickerTrades()} initial={state.ctx.config} canEdit={state.ctx.access.permissions.includes("manage_financial_config")} />}
    </div>
  );
}
