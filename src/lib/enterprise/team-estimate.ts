import { ENTERPRISE_BASE_CENTS, ENTERPRISE_INCLUDED_USERS, enterpriseQuote, type EnterpriseLine } from "./pricing";
import { PM_EDITOR_CENTS, PM_INCLUDED_ENTERPRISE_EDITORS } from "../pm/billing";

/**
 * The Team pricing preview on /pricing: licensed users (graduated seat tiers from ./pricing) plus
 * Project Command Center schedule editors ($1.99/month for each editor beyond the included one).
 * Pure and display-only. It reuses the same constants the checkout and the editor-seat API bill with,
 * so the preview can't drift from what Stripe charges. Editors are never more than licensed users,
 * because an editor is a permission on an existing licensed user, not another account.
 */
export type TeamEstimate = {
  users: number;
  editors: number;
  baseCents: number;
  /** Seat tier lines for users 4+ (empty for 3 users). */
  userLines: EnterpriseLine[];
  extraUsers: number;
  extraUsersCents: number;
  extraEditors: number;
  extraEditorsCents: number;
  /** What Team checkout charges today: base + licensed users. Editors are added after checkout. */
  checkoutCents: number;
  totalCents: number;
};

export const TEAM_MIN_EDITORS = PM_INCLUDED_ENTERPRISE_EDITORS;

export function clampEditors(editors: number, users: number): number {
  const max = Math.max(TEAM_MIN_EDITORS, users);
  if (!Number.isFinite(editors)) return TEAM_MIN_EDITORS;
  return Math.min(max, Math.max(TEAM_MIN_EDITORS, Math.round(editors)));
}

export function teamEstimate(users: number, editors: number, { includeEditors = true } = {}): TeamEstimate {
  const q = enterpriseQuote(Math.max(ENTERPRISE_INCLUDED_USERS, users));
  const ed = includeEditors ? clampEditors(editors, q.totalUsers) : TEAM_MIN_EDITORS;
  const userLines = q.lines.slice(1);
  const extraUsersCents = userLines.reduce((s, l) => s + l.totalCents, 0);
  const extraEditors = ed - TEAM_MIN_EDITORS;
  const extraEditorsCents = extraEditors * PM_EDITOR_CENTS;
  const checkoutCents = ENTERPRISE_BASE_CENTS + extraUsersCents;
  return {
    users: q.totalUsers, editors: ed, baseCents: ENTERPRISE_BASE_CENTS,
    userLines, extraUsers: q.extraSeats, extraUsersCents,
    extraEditors, extraEditorsCents, checkoutCents, totalCents: checkoutCents + extraEditorsCents,
  };
}
