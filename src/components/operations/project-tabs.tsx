"use client";
import { useState, type ReactNode } from "react";
import { CalendarDays, Camera, ClipboardList, FileText, Landmark, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChangeOrderDraft } from "./documents-panel";
import { DocumentsPanel } from "./documents-panel";
import { ScopePanel } from "./scope-panel";
import { PhotosPanel } from "./photos-panel";
import { CostsPanel } from "./costs-panel";
import { JobFinancials } from "../financials/job-financials";

export type ProjectTab = "schedule" | "scope" | "documents" | "photos" | "costs" | "financials";
const TABS: { id: ProjectTab; label: string; icon: typeof CalendarDays }[] = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "scope", label: "Trade scope", icon: ClipboardList },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "photos", label: "Photos", icon: Camera },
  { id: "costs", label: "Internal costs", icon: Wallet },
];
/** Financials (Phase 1): only when NEXT_PUBLIC_FINANCIALS=on (the page passes `financials`). */
const FIN_TAB = { id: "financials" as const, label: "Financials", icon: Landmark };

/**
 * Project Detail tabs (V4.3). The schedule editor stays mounted (hidden) so switching tabs never loses
 * unsaved Gantt state. Internal costs only shows for people allowed to see subcontractor costs (the
 * server decides; the tab says so when it can't show anything).
 */
export function ProjectTabs({ estimateId, initialTab, children, customerId, financials = false }: { estimateId: string; initialTab?: string; children: ReactNode; customerId?: string | null; financials?: boolean }) {
  const tabs = financials ? [...TABS, FIN_TAB] : TABS;
  const [tab, setTab] = useState<ProjectTab>(tabs.some((t) => t.id === initialTab) ? (initialTab as ProjectTab) : "schedule");
  const [coDraft, setCoDraft] = useState<{ key: number; draft: ChangeOrderDraft } | null>(null);
  const go = (t: ProjectTab) => {
    setTab(t);
    try { const u = new URL(window.location.href); if (t === "schedule") u.searchParams.delete("tab"); else u.searchParams.set("tab", t); window.history.replaceState(null, "", u); } catch { /* ignore */ }
  };
  return (
    <div>
      <div role="tablist" aria-label="Project sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-line" data-testid="project-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" id={`ptab-${id}`} aria-selected={tab === id} aria-controls={`ppanel-${id}`} onClick={() => go(id)}
            className={cn("-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold", tab === id ? "border-brand text-navy" : "border-transparent text-muted hover:text-ink")}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ppanel-schedule" aria-labelledby="ptab-schedule" hidden={tab !== "schedule"}>{children}</div>
      {tab === "scope" && <div role="tabpanel" id="ppanel-scope" aria-labelledby="ptab-scope"><ScopePanel estimateId={estimateId} /></div>}
      {tab === "documents" && (
        <div role="tabpanel" id="ppanel-documents" aria-labelledby="ptab-documents" className="rounded-xl border border-line bg-surface p-4">
          <DocumentsPanel key={coDraft?.key ?? 0} estimateId={estimateId} startNew={coDraft?.draft} />
        </div>
      )}
      {tab === "photos" && <div role="tabpanel" id="ppanel-photos" aria-labelledby="ptab-photos"><PhotosPanel estimateId={estimateId} customerId={customerId ?? null} /></div>}
      {financials && tab === "financials" && <div role="tabpanel" id="ppanel-financials" aria-labelledby="ptab-financials"><JobFinancials estimateId={estimateId} /></div>}
      {tab === "costs" && (
        <div role="tabpanel" id="ppanel-costs" aria-labelledby="ptab-costs">
          <CostsPanel estimateId={estimateId} onPrepareChangeOrder={(draft) => { setCoDraft({ key: Date.now(), draft }); go("documents"); }} />
        </div>
      )}
    </div>
  );
}
