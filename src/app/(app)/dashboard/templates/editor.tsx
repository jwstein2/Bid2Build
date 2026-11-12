"use client";
import { useMemo, useState, useTransition } from "react";
import { ProposalStep } from "@/components/builder/proposal-step";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { createEstimate } from "@/lib/estimate/factory";
import type { BusinessProfile, ProposalConfig } from "@/lib/proposal/types";
import { saveProposalDefaults, type SaveDefaultsResult } from "./actions";

export function DefaultsEditor({ business, initial, unlimited }: { business: BusinessProfile; initial: ProposalConfig; unlimited: boolean }) {
  const [config, setConfig] = useState(initial);
  const [result, setResult] = useState<SaveDefaultsResult | null>(null);
  const [pending, start] = useTransition();
  // Preview uses an empty sample project: no invented prices.
  const sample = useMemo(() => ({ ...createEstimate("other", { now: new Date("2026-01-01T12:00:00Z"), number: "SAMPLE" }), title: "Sample project" }), []);
  return (
    <div className="space-y-4">
      {!unlimited && <Notice tone="neutral" title="Saving defaults is part of Unlimited">You can try settings here; upgrade to keep them for every new bid. <ButtonLink href="/settings/billing" variant="link">View plans</ButtonLink></Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!unlimited || pending} onClick={() => start(async () => setResult(await saveProposalDefaults(config)))}>{pending ? "Saving…" : "Save as my defaults"}</Button>
        {result?.ok && <span role="status" className="text-sm text-ok">Saved. New bids will use these settings.</span>}
        {result && !result.ok && <span role="alert" className="text-sm text-danger">{result.message}</span>}
      </div>
      <ProposalStep estimate={sample} business={business} config={config} onConfig={(c) => { setConfig(c); setResult(null); }} />
    </div>
  );
}
