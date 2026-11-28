import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTrade } from "@/lib/trades/catalog";
import { publishedTemplate } from "@/lib/trades/published";
import { createClient, getUser } from "@/lib/supabase/server";
import { proposalConfigFrom } from "@/lib/data/mappers";
import { hasPremiumAccess } from "@/lib/billing/entitlement";
import type { ProposalConfig } from "@/lib/proposal/types";
import { cleanPercent, cleanQuantity, toolBySlug } from "@/lib/marketing/tools";
import { StartClient, type StartPrefill } from "./start-client";

export const metadata: Metadata = { robots: { index: false } };

export default async function StartPage({ params, searchParams }: PageProps<"/start/[trade]">) {
  const { trade } = await params;
  const sp = await searchParams;
  if (!getTrade(trade)) notFound();
  let defaults: ProposalConfig | undefined;
  const user = await getUser();
  if (user) {
    // Saved proposal defaults (Proposal Templates) apply while the account has Unlimited. They stay
    // stored when a subscription lapses and apply again once it is reactivated.
    const supabase = await createClient();
    if (await hasPremiumAccess(supabase)) {
      const { data } = await supabase.from("business_profiles").select("default_proposal_config").eq("user_id", user.id).maybeSingle();
      if (data?.default_proposal_config) defaults = proposalConfigFrom(data.default_proposal_config);
    }
  }
  return <StartClient trade={trade} blank={sp.blank === "1"} template={await publishedTemplate(trade)} defaults={defaults} prefill={toolPrefill(trade, sp)} />;
}

/** "Send this as a bid" from a free calculator: only a known tool, its own trade and a sane value. */
function toolPrefill(trade: string, sp: Record<string, string | string[] | undefined>): StartPrefill | undefined {
  const tool = toolBySlug(typeof sp.tool === "string" ? sp.tool : undefined);
  if (!tool) return undefined;
  if (tool.kind === "quantity") {
    const quantity = cleanQuantity(sp.q);
    return tool.trade === trade && quantity && sp.blank !== "1" ? { tool: tool.slug, quantity } : undefined;
  }
  const mode = sp.pricing === "margin" ? "margin" : sp.pricing === "markup" ? "markup" : null;
  const percent = mode && cleanPercent(sp.pct, mode);
  return mode && percent ? { tool: tool.slug, pricing: { mode, percent } } : undefined;
}
