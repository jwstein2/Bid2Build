"use client";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { DRAFT_STATUS_LABEL, type DraftSummaryRow } from "@/lib/library-generator/model";
import { ButtonLink } from "../../ui/button";
import { Badge, Card } from "../../ui/misc";
import { listDrafts } from "./api";

/**
 * "Generate My Price Library" on the Saved Items & Pricing Library page, with drafts to continue.
 * Hidden until the generator's SQL has been run; shows "Coming soon" while AI is unavailable.
 */
export function GenerateEntry() {
  const [state, setState] = useState<{ ready: boolean; aiReady: boolean; drafts: DraftSummaryRow[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listDrafts().then((r) => { if (!cancelled && r.ok) setState(r.data); });
    return () => { cancelled = true; };
  }, []);
  if (!state?.ready) return null;
  const open = state.drafts.filter((d) => d.candidateCount > 0 || d.status === "generating").slice(0, 3);
  return (
    <Card className="border-brand/30 bg-brand-tint/40 p-4 sm:p-5" data-testid="generate-entry" data-guide="items.generate">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-display text-lg font-bold text-navy"><Sparkles className="h-5 w-5 text-brand" aria-hidden /> Generate My Price Library</p>
          <p className="text-sm text-ink-soft">Type your trade or a scope, like “Concrete” or “Kitchen remodeling”. You get a draft list of items to review and price. Nothing is saved until you approve it.</p>
        </div>
        {state.aiReady
          ? <ButtonLink href="/dashboard/items/generate" data-testid="generate-start"><Sparkles className="h-4 w-4" aria-hidden /> Generate My Price Library</ButtonLink>
          : <span className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted">Coming soon</span>}
      </div>
      {open.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface" aria-label="Drafts to finish">
          {open.map((d) => (
            <li key={d.id}>
              <a href={`/dashboard/items/generate/${d.id}`} className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm hover:bg-paper">
                <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
                <Badge tone={d.status === "failed" ? "warn" : "neutral"}>{DRAFT_STATUS_LABEL[d.status]}</Badge>
                <span className="text-xs text-muted">{d.candidateCount} to review</span>
                <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
