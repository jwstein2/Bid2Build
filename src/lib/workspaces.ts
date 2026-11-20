/**
 * One account, one login, several workspaces (V8.10): the contractor dashboard, My Sales Hub and the
 * Admin Sales Hub. Pure and dependency free so pages, routes, the proxy and tests share the rules.
 *
 * These rules only choose where to send someone. Every destination checks access again on the server
 * (the contractor app's own layout, loadSalesAccess / requireSalesAdmin for the Sales Hub).
 */

export type Landing = "auto" | "contractor" | "sales";
export type Workspace = "contractor" | "sales";
export type SalesView = "my" | "admin";

export interface Workspaces {
  /** Active selling sales rep: My Sales Hub. */
  sales_my: boolean;
  /** Sales Administrator or platform owner: Admin Sales Hub. */
  sales_admin: boolean;
  /** Uses the contractor platform (a bid, a live subscription, an active company seat, or the owner). */
  contractor: boolean;
  landing: Landing;
  last_workspace: Workspace | null;
  sales_view: SalesView | null;
}

export const NO_WORKSPACES: Workspaces = { sales_my: false, sales_admin: false, contractor: false, landing: "auto", last_workspace: null, sales_view: null };

export const hasSales = (w: Workspaces) => w.sales_my || w.sales_admin;

/** The Sales Hub page for this person: their last authorized view, else the one they have. */
export function salesHubPath(w: Workspaces, lastView?: string | null): string | null {
  if (!hasSales(w)) return null;
  const view = lastView ?? w.sales_view;
  if (w.sales_my && w.sales_admin) return view === "admin" ? "/sales/admin" : "/sales";
  return w.sales_admin ? "/sales/admin" : "/sales";
}

/**
 * Where a sign-in with no specific destination lands.
 *  - A pending sales invite always wins (it's accepted at /sales/join first).
 *  - Only one workspace: that one. Sales-only people never land in the contractor dashboard.
 *  - Both: the preference, else the workspace used last, else the contractor dashboard.
 *  - A preference for a workspace the person no longer has falls back to one they do have.
 */
export function landingPath(w: Workspaces, opts: { pendingInvite?: boolean; lastView?: string | null } = {}): string {
  if (opts.pendingInvite) return "/sales/join";
  const sales = salesHubPath(w, opts.lastView);
  if (!sales) return "/dashboard";
  if (!w.contractor) return sales;
  const want = w.landing !== "auto" ? w.landing : w.last_workspace ?? "contractor";
  return want === "sales" ? sales : "/dashboard";
}

export type SwitchTo = "contractor" | "sales" | "sales-my" | "sales-admin";
export const parseSwitchTo = (v: string | null | undefined): SwitchTo | null =>
  v === "contractor" || v === "sales" || v === "sales-my" || v === "sales-admin" ? v : null;

/**
 * The account-menu switch. Returns the page to open and what to remember, or the safest page the person
 * can open when the requested one isn't theirs (permissions changed since the menu was drawn).
 */
export function switchTarget(w: Workspaces, to: SwitchTo, lastView?: string | null): { path: string; remember: { last?: Workspace; view?: SalesView } } {
  if (to === "contractor") {
    // Contractor access: anyone with an account may open their dashboard; the app layout and billing gate the rest.
    return { path: "/dashboard", remember: { last: "contractor" } };
  }
  if (to === "sales-admin" && w.sales_admin) return { path: "/sales/admin", remember: { last: "sales", view: "admin" } };
  if (to === "sales-my" && w.sales_my) return { path: "/sales", remember: { last: "sales", view: "my" } };
  const hub = salesHubPath(w, lastView);
  if (hub) return { path: hub, remember: { last: "sales", view: hub === "/sales/admin" ? "admin" : "my" } };
  return { path: "/dashboard", remember: {} };
}

/** The menu entries to show: "Switch to Sales Hub" in the contractor app, "Switch to Contractor Dashboard" in the Sales Hub. */
export function switchLinks(w: Workspaces, where: Workspace): { href: string; label: string; to: SwitchTo }[] {
  if (where === "contractor") return hasSales(w) ? [{ href: "/switch?to=sales", label: "Switch to Sales Hub", to: "sales" }] : [];
  return w.contractor ? [{ href: "/switch?to=contractor", label: "Switch to Contractor Dashboard", to: "contractor" }] : [];
}

export const LANDING_LABELS: Record<Landing, string> = {
  auto: "Where I was last",
  contractor: "Contractor Dashboard",
  sales: "Sales Hub",
};
