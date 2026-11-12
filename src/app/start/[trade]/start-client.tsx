"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEstimate } from "@/lib/estimate/factory";
import { defaultProposalConfig, type ProposalConfig } from "@/lib/proposal/types";
import { saveLocalDraft } from "@/lib/drafts/local";
import type { TradeTemplate } from "@/lib/trades/catalog";

export function StartClient({ trade, blank, template, defaults }: { trade: string; blank: boolean; template?: TradeTemplate; defaults?: ProposalConfig }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const estimate = createEstimate(trade, { blank, template });
    saveLocalDraft({ estimate, proposalConfig: defaults ?? defaultProposalConfig() });
    router.replace(`/builder?draft=${estimate.id}`);
  }, [trade, blank, template, defaults, router]);
  return (
    <main className="grid min-h-screen place-items-center" aria-busy="true">
      <p className="text-ink-soft">Setting up your bid…</p>
    </main>
  );
}
