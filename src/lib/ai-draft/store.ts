/**
 * Browser copy of the "Draft with AI" dialog per bid (Will meeting 2026-11-21, item B): the latest draft,
 * which lines are ticked, the labor burden and ballpark switch, and when it was last added to the bid.
 * Closing, cancelling or clicking outside the dialog no longer loses a draft. The server keeps its own copy
 * of the draft itself (ai_generation_results), used when this browser has none.
 *
 * Every storage access is wrapped: a private window or blocked storage must never break the builder.
 */
import type { DraftResponse } from "./resolve";

export interface StoredDraft {
  v: 1;
  trade: string;
  description: string;
  /** Description the draft was made from (to tell "draft again" from a changed request). */
  draftedFrom?: string;
  draft: DraftResponse | null;
  picked: number[];
  burden: string;
  useBallpark: boolean;
  savedAt: string;
  /** Set when lines from this draft were added to the bid. Adding again adds them a second time. */
  appliedAt?: string | null;
  appliedCount?: number;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export const draftKey = (estimateId: string) => `b2b:ai-draft:${estimateId}`;

function storage(s?: Storage | null): Storage | null {
  if (s) return s;
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadStoredDraft(estimateId: string, s?: Storage | null): StoredDraft | null {
  try {
    const raw = storage(s)?.getItem(draftKey(estimateId));
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    if (d?.v !== 1 || typeof d.trade !== "string" || typeof d.description !== "string") return null;
    if (d.draft && !Array.isArray(d.draft.lines)) return null;
    // Ticked lines must point at lines that exist.
    const n = d.draft?.lines.length ?? 0;
    return { ...d, picked: Array.isArray(d.picked) ? d.picked.filter((i) => Number.isInteger(i) && i >= 0 && i < n) : [] };
  } catch {
    return null;
  }
}

export function saveStoredDraft(estimateId: string, d: Omit<StoredDraft, "v" | "savedAt">, s?: Storage | null, now = () => new Date().toISOString()): boolean {
  try {
    storage(s)?.setItem(draftKey(estimateId), JSON.stringify({ ...d, v: 1, savedAt: now() } satisfies StoredDraft));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDraft(estimateId: string, s?: Storage | null) {
  try { storage(s)?.removeItem(draftKey(estimateId)); } catch { /* ignore */ }
}
