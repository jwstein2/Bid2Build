import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFinancialsEnabled } from "@/lib/env";
import { loadFinState } from "@/lib/financials/loaders";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AiAutomationForm } from "@/components/financials/ai-automation-form";
import { FinStateNotice } from "@/components/financials/fin-state-notice";

export const metadata: Metadata = { title: "AI & Automation", robots: { index: false } };

/** Company → AI & Automation (V3.1): independent, opt-in toggles with a plain-language disclosure each. */
export default async function AiAutomationPage() {
  if (!isFinancialsEnabled()) notFound();
  const state = await loadFinState(await createClient());
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Breadcrumbs className="mb-3" items={[{ label: "Company", href: "/settings/company" }, { label: "AI & Automation" }]} />
      <h1 className="text-3xl font-extrabold">AI &amp; Automation</h1>
      {state.kind !== "ready" ? <FinStateNotice state={state} />
        : <AiAutomationForm initial={state.ctx.ai} canEdit={state.ctx.access.permissions.includes("manage_financial_config")} />}
    </div>
  );
}
