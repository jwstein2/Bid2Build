/**
 * Smart trigger rules: when a guided tour may be offered on its own.
 *
 * Pure functions (no I/O) shared by the Guide host and tests. The rules, in order:
 *   1. Never interrupt: no offer while a dialog, walkthrough or checkout is open, or while the person
 *      is typing (the host checks those on screen and passes `busy`).
 *   2. Never in Demo Mode (demonstrations are driven from the Guide menu) and never twice in one page load.
 *   3. A finished or skipped tour is never offered again (it stays in the Guide menu to replay). "Maybe
 *      later" snoozes it for 7 days. A tour offered 3 times without an answer stops being offered.
 *   4. A tour's trigger decides where: new-account tours only on their pages and only in the first days
 *      after sign-up; first-visit tours the first time one of their pages is opened.
 *   5. The first-estimate journey waits until the existing welcome popup has been answered, so a new
 *      account never gets two popups.
 *   6. At most one offer per page load, chosen in registry order.
 * A new tour version (version bump) counts as a new tour, so a rewritten walkthrough can be offered once.
 */
import type { GuideContext, PageKey } from "../features/page-guides";
import { TOURS, tourEligible, type TourDef, type Workspace } from "./tours";

export const SNOOZE_DAYS = 7;
export const MAX_OFFERS = 3;
const DAY = 86_400_000;

export type ProgressStatus = "offered" | "in_progress" | "completed" | "dismissed" | "snoozed";
export interface Progress {
  tourId: string;
  version: number;
  status: ProgressStatus;
  lastStep: number | null;
  offeredCount: number;
  snoozedUntil: string | null;
  completedAt: string | null;
}

export interface OfferInput {
  ctx: GuideContext;
  workspace: Workspace;
  page: PageKey | null;
  progress: readonly Progress[];
  /** Account creation time (ISO). */
  createdAt: string | null;
  /** The PR #20 welcome popup has been answered (or can't be shown). */
  welcomeDone: boolean;
  /** Something else is on screen or the person is mid-task. */
  busy: boolean;
  /** Already offered something during this page load. */
  offeredThisLoad: boolean;
  now?: number;
}

export function progressFor(progress: readonly Progress[], t: Pick<TourDef, "id" | "version">): Progress | undefined {
  return progress.find((p) => p.tourId === t.id && p.version === t.version);
}

/** Whether this tour may still be offered automatically to this person (ignoring where they are). */
export function stillOfferable(p: Progress | undefined, now: number): boolean {
  if (!p) return true;
  if (p.status === "completed" || p.status === "dismissed" || p.status === "in_progress") return false;
  if (p.status === "snoozed") return !p.snoozedUntil || Date.parse(p.snoozedUntil) <= now;
  return p.offeredCount < MAX_OFFERS;
}

/** The one tour to offer now, or null. */
export function decideOffer(i: OfferInput): TourDef | null {
  const now = i.now ?? Date.now();
  if (i.busy || i.offeredThisLoad || !i.page || !i.ctx.signedIn) return null;
  if (i.workspace === "demo") return null;
  for (const t of TOURS) {
    if (t.trigger.kind === "manual") continue;
    if (!tourEligible(t, i.ctx, i.workspace)) continue;
    if (!t.trigger.pages.includes(i.page)) continue;
    if (!stillOfferable(progressFor(i.progress, t), now)) continue;
    if (t.trigger.kind === "new_account") {
      if (i.workspace === "real" && !i.welcomeDone) continue;
      const created = i.createdAt ? Date.parse(i.createdAt) : NaN;
      // Practice workspaces are brand new by design; the age window applies to real accounts.
      if (i.workspace === "real" && (!Number.isFinite(created) || now - created > t.trigger.maxAgeDays * DAY)) continue;
    }
    return t;
  }
  return null;
}

/** Where to resume a tour that was started and left (null = from the start). */
export function resumeStep(p: Progress | undefined, steps: number): number {
  if (!p || p.status !== "in_progress" || p.lastStep == null) return 0;
  return Math.max(0, Math.min(p.lastStep, steps - 1));
}

/** Snooze end for "Maybe later". */
export const snoozeUntil = (now = Date.now()) => new Date(now + SNOOZE_DAYS * DAY).toISOString();
