"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEstimate } from "@/lib/estimate/factory";
import type { PricingMode } from "@/lib/estimate/types";
import { defaultProposalConfig, type ProposalConfig } from "@/lib/proposal/types";
import { saveLocalDraft } from "@/lib/drafts/local";
import type { TradeTemplate } from "@/lib/trades/catalog";
import { takeNewBidCustomer } from "@/lib/customers/new-bid";
import { TOOL_HANDOFF_KEY, toolBySlug, type ToolHandoff } from "@/lib/marketing/tools";
import { applyToolPricing, applyToolQuantity } from "@/lib/marketing/tool-handoff";

/** A free-calculator result carried into the new draft (validated on the server). */
export type StartPrefill = { tool: string; quantity: string } | { tool: string; pricing: { mode: PricingMode; percent: string } };

/** The measurements behind a calculator handoff, read once and removed. */
function takeHandoff(): ToolHandoff | null {
  try {
    const raw = sessionStorage.getItem(TOOL_HANDOFF_KEY);
    sessionStorage.removeItem(TOOL_HANDOFF_KEY);
    return raw && raw.length < 50_000 ? (JSON.parse(raw) as ToolHandoff) : null;
  } catch {
    return null;
  }
}

export function StartClient({ trade, blank, template, defaults, prefill }: { trade: string; blank: boolean; template?: TradeTemplate; defaults?: ProposalConfig; prefill?: StartPrefill }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let created = createEstimate(trade, { blank, template });
    // Free calculators (/tools): start with the calculated quantity or the chosen markup/margin.
    const tool = prefill && toolBySlug(prefill.tool);
    if (tool && prefill) {
      if (tool.kind === "quantity" && "quantity" in prefill) created = applyToolQuantity(created, template, tool, prefill.quantity, takeHandoff());
      if (tool.kind === "markup" && "pricing" in prefill) created = applyToolPricing(created, prefill.pricing.mode, prefill.pricing.percent);
    }
    // "New bid for this customer" (Customers): start with that customer filled in and linked.
    const c = takeNewBidCustomer();
    const estimate = c ? { ...created, customerId: c.id, customer: { ...created.customer, name: c.name, email: c.email ?? undefined, phone: c.phone ?? undefined, projectAddress: c.address ?? undefined } } : created;
    saveLocalDraft({ estimate, proposalConfig: defaults ?? defaultProposalConfig() });
    router.replace(`/builder?draft=${estimate.id}`);
  }, [trade, blank, template, defaults, prefill, router]);
  return (
    <main className="app-theme grid min-h-screen place-items-center" aria-busy="true">
      <p className="text-ink-soft">Setting up your bid…</p>
    </main>
  );
}
