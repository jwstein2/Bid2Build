"use client";
import type { Estimate } from "../estimate/types";
import type { BusinessProfile, ProposalConfig } from "../proposal/types";

/**
 * Browser-local persistence for visitors who have not signed up yet (and an offline safety net
 * for everyone). Every access is wrapped: private windows or blocked storage must never break the app.
 */
export interface LocalDraft {
  estimate: Estimate;
  proposalConfig: ProposalConfig;
  savedAt: string;
}

const KEY_DRAFT = (id: string) => `byb:draft:${id}`;
const KEY_INDEX = "byb:drafts";
const KEY_BUSINESS = "byb:business";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function remove(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Index entry. `origin: "cloud"` = a safety copy of a bid that already lives in the account, written only
 * while it has edits the server hasn't confirmed (`unsynced`); the builder removes it after a successful save.
 * Entries written before 2026-11-17 carry neither field.
 */
export interface LocalDraftEntry { id: string; title: string; savedAt: string; origin?: "local" | "cloud"; unsynced?: boolean }

export function listLocalDrafts(): LocalDraftEntry[] {
  return read<LocalDraftEntry[]>(KEY_INDEX) ?? [];
}

/**
 * Drafts that really exist only on this device: started signed out (or offline), or account bids with edits
 * the server never confirmed. A plain safety copy of a bid that is already saved in the account is not one,
 * so the dashboard doesn't warn about bids that are safely saved. `accountIds` = bids the account has.
 */
export function unsavedLocalDrafts(accountIds: Iterable<string>): LocalDraftEntry[] {
  const inAccount = new Set(accountIds);
  return listLocalDrafts().filter((d) => (d.origin === "cloud" ? d.unsynced === true : !inAccount.has(d.id)));
}

export function loadLocalDraft(id: string): LocalDraft | null {
  return read<LocalDraft>(KEY_DRAFT(id));
}

export function saveLocalDraft(d: Omit<LocalDraft, "savedAt">, opts: { origin?: "local" | "cloud" } = {}): boolean {
  const savedAt = new Date().toISOString();
  const ok = write(KEY_DRAFT(d.estimate.id), { ...d, savedAt });
  if (ok) {
    const idx = listLocalDrafts().filter((x) => x.id !== d.estimate.id);
    idx.unshift({ id: d.estimate.id, title: d.estimate.title, savedAt, origin: opts.origin ?? "local", ...(opts.origin === "cloud" ? { unsynced: true } : {}) });
    write(KEY_INDEX, idx.slice(0, 50));
  }
  return ok;
}

export function deleteLocalDraft(id: string) {
  remove(KEY_DRAFT(id));
  write(KEY_INDEX, listLocalDrafts().filter((x) => x.id !== id));
}

export function loadLocalBusiness(): BusinessProfile | null {
  return read<BusinessProfile>(KEY_BUSINESS);
}
export function saveLocalBusiness(b: BusinessProfile) {
  write(KEY_BUSINESS, b);
}
export function clearLocalBusiness() {
  remove(KEY_BUSINESS);
}

/**
 * The builder step this device last showed for a bid, so resuming a draft (or coming back after
 * signing in) reopens the same step instead of restarting the workflow.
 */
const KEY_STEP = (id: string) => `b2b:step:${id}`;
export function loadLocalStep(id: string): string | null {
  return read<string>(KEY_STEP(id));
}
export function saveLocalStep(id: string, step: string) {
  write(KEY_STEP(id), step);
}
