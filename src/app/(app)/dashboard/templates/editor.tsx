"use client";
import { useMemo, useState, useTransition } from "react";
import { ProposalStep } from "@/components/builder/proposal-step";
import { ExclusionsEditor } from "@/components/builder/scope-step";
import { Button } from "@/components/ui/button";
import { PremiumUpgrade } from "@/components/billing/premium";
import { createEstimate } from "@/lib/estimate/factory";
import type { BusinessProfile, ProposalConfig } from "@/lib/proposal/types";
import { saveProposalDefaults, type SaveDefaultsResult } from "./actions";

export function DefaultsEditor({ business, initial, unlimited }: { business: BusinessProfile; initial: ProposalConfig; unlimited: boolean }) {
  const [config, setConfig] = useState(initial);
  const [result, setResult] = useState<SaveDefaultsResult | null>(null);
  const [pending, start] = useTransition();
  const onConfig = (c: ProposalConfig) => { setConfig(c); setResult(null); };
  // Preview uses an empty sample project: no invented prices.
  const sample = useMemo(() => ({ ...createEstimate("other", { now: new Date("2026-01-01T12:00:00Z"), number: "SAMPLE" }), title: "Sample project" }), []);
  return (
    <div className="space-y-4">
      {!unlimited && <PremiumUpgrade feature="templates" signedIn note="You can try styles and wording below. Saving them as your defaults for every new bid needs Unlimited." notNowHref="/dashboard" />}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!unlimited || pending} onClick={() => start(async () => setResult(await saveProposalDefaults(config)))}>{pending ? "Saving…" : "Save as my defaults"}</Button>
        {result?.ok && <span role="status" className="text-sm text-ok">Saved. New bids will use these settings.</span>}
        {result && !result.ok && <span role="alert" className="text-sm text-danger">{result.message}</span>}
      </div>
      <ProposalStep
        estimate={sample} business={business} config={config} onConfig={onConfig}
        textExtra={
          <ExclusionsEditor manualOnly estimate={sample} config={config} onConfig={onConfig} signedIn fingerprint="" canGenerate={false}
            value={config.exclusionList} onChange={(exclusionList) => onConfig({ ...config, exclusionList })} />
        }
      />
    </div>
  );
}
