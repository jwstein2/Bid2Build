"use client";
import type { DraftDetail, DraftItem, DraftSummaryRow, GenerateRequest, ItemPatch, StackPatch, ApprovalPreview } from "@/lib/library-generator/model";

/** Browser calls for "Generate My Price Library". Every write is re-checked by the API and RLS. */
export type Match = { id: string; name: string; unit: string; unitCost: string; priceSource: string | null; supplierName: string | null; category: string | null };
export type DetailResponse = DraftDetail & { matches: Match[]; stacksAccess: boolean; canShare: boolean };
export type ApproveResult = { created: number; templates: number; matched: number; updated: number; merged: number; awaitingPrice: number; skipped: number; stacks: number; remaining: number; replayed?: boolean };
export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string; draftId?: string };

async function call<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<Result<T>> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, signal, headers: init?.body ? { "content-type": "application/json" } : undefined });
    const d = await r.json().catch(() => null);
    if (r.ok) return { ok: true, data: d as T };
    return { ok: false, code: d?.error?.code ?? "failed", message: d?.error?.message ?? "Something didn't save. Please try again.", draftId: d?.error?.draftId };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, code: "canceled", message: "Canceled." };
    return { ok: false, code: "network", message: "You're offline. Nothing was changed." };
  }
}

export const listDrafts = () => call<{ ready: boolean; aiReady: boolean; drafts: DraftSummaryRow[] }>("/api/library/drafts");
export const generate = (body: Partial<GenerateRequest>, signal?: AbortSignal) =>
  call<DetailResponse & { reused?: boolean; added?: { items: number; stacks: number } }>("/api/library/drafts", { method: "POST", body: JSON.stringify(body) }, signal);
export const getDraft = (id: string) => call<DetailResponse>(`/api/library/drafts/${id}`);
export const patchItems = (id: string, ids: string[], patch: ItemPatch) =>
  call<{ items: DraftItem[] }>(`/api/library/drafts/${id}`, { method: "PATCH", body: JSON.stringify({ op: "items", ids, patch }) });
export const patchStack = (id: string, stackId: string, patch: StackPatch) =>
  call<{ ok: true }>(`/api/library/drafts/${id}`, { method: "PATCH", body: JSON.stringify({ op: "stack", id: stackId, patch }) });
export const patchDraft = (id: string, body: { status?: "draft" | "under_review" | "archived"; title?: string }) =>
  call<{ ok: true }>(`/api/library/drafts/${id}`, { method: "PATCH", body: JSON.stringify({ op: "draft", ...body }) });
type ApproveBody = { requestKey: string; itemIds: string[]; stackIds: string[]; templates: boolean; shareStacks: boolean };
export const previewApproval = (id: string, b: ApproveBody) => call<ApprovalPreview>(`/api/library/drafts/${id}`, { method: "POST", body: JSON.stringify({ op: "preview", ...b }) });
export const approve = (id: string, b: ApproveBody) => call<{ result: ApproveResult }>(`/api/library/drafts/${id}`, { method: "POST", body: JSON.stringify({ op: "approve", ...b }) });
