"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContractSummary } from "@/lib/operations/contract";
import type { StylePolicy } from "@/lib/operations/proposal-style";
import type { SubQuoteBundle } from "@/lib/operations/sub-quotes";

export interface TeamResource { id: string; name: string; kind: "staff" | "subcontractor" | "crew"; trades: string[] }
export interface OwnerBrand {
  companyName: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; logoLayout: string; headerStyle: string;
  phone?: string; email?: string; address?: string; website?: string; licenseNumber?: string; tagline?: string;
}
export interface BuilderOps {
  available: boolean;
  stage?: string | null;
  subQuotes: SubQuoteBundle | null;
  resources: TeamResource[];
  stylePolicy: StylePolicy | null;
  ownerBrand: OwnerBrand | null;
  contract: null | {
    accepted: boolean; canCreate: boolean; canSend: boolean; changeOrderCount: number;
    approval: { versionId: string; source: string; total: number; versionNumber: number | null } | null;
    summary: ContractSummary | null;
  };
}

interface Ctx { estimateId: string | null; ops: BuilderOps | null; refresh: () => void; saved: boolean }
const OpsContext = createContext<Ctx>({ estimateId: null, ops: null, refresh: () => {}, saved: false });

/** Loads project-operations data for a saved (cloud) bid. Nothing loads for local drafts. */
export function useOpsLoader(estimateId: string | null) {
  const [ops, setOps] = useState<BuilderOps | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!estimateId) return;
    let live = true;
    fetch(`/api/estimates/${estimateId}/ops`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BuilderOps | null) => { if (live) setOps(d && d.available ? d : null); })
      .catch(() => {});
    return () => { live = false; };
  }, [estimateId, tick]);
  return { ops: estimateId ? ops : null, refresh };
}

export function BuilderOpsProvider({ estimateId, saved, ops, refresh, children }: { estimateId: string | null; saved: boolean; ops: BuilderOps | null; refresh: () => void; children: ReactNode }) {
  return <OpsContext.Provider value={{ estimateId, ops, refresh, saved }}>{children}</OpsContext.Provider>;
}

export const useBuilderOps = () => useContext(OpsContext);
