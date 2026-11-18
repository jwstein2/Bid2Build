/**
 * Navigation by workspace, from effective access (V6.7 §4). The sidebar uses it to hide restricted links and
 * to add a labelled "Other access" entry for a feature granted inside a workspace that is otherwise off; the
 * access editor uses the same function for Preview Employee Experience, so the preview can't drift from the
 * real menu.
 */
import { FEATURE_BY_ID, WORKSPACE_INFO, type FeatureId, type WorkspaceId } from "./capabilities";
import { hasCapability, restrictedFor, type EffectiveAccess } from "./effective";
import type { License } from "./capabilities";

export interface NavEntry { href: string; label: string; feature: FeatureId; needs?: License }
export interface NavGroup { id: WorkspaceId | "other"; label: string; items: NavEntry[] }

/** Sidebar links that belong to a workspace feature (other links, like Account settings, are always shown). */
export const NAV_FEATURES: { href: string; label: string; feature: FeatureId; ws: WorkspaceId }[] = [
  { href: "/dashboard", label: "Bids", feature: "bids", ws: "win" },
  { href: "/dashboard/customers", label: "Customers", feature: "customers", ws: "win" },
  { href: "/dashboard/items", label: "Saved Items & Pricing", feature: "pricing_library", ws: "win" },
  { href: "/dashboard/templates", label: "Proposal Templates", feature: "proposal_templates", ws: "win" },
  { href: "/company/pipeline", label: "Company bids", feature: "bids", ws: "win" },
  { href: "/company/proposal-style", label: "Proposal & Bid Style", feature: "proposal_style", ws: "win" },
  { href: "/projects", label: "Projects", feature: "schedule", ws: "run" },
  { href: "/projects/team", label: "Team, subs & suppliers", feature: "team_directory", ws: "run" },
  { href: "/company", label: "Company overview", feature: "analytics", ws: "grow" },
  { href: "/dashboard/customers/communications", label: "Customer follow-ups", feature: "communications", ws: "grow" },
  { href: "/financials", label: "Financials", feature: "fin_visibility", ws: "financials" },
  { href: "/financials/cash", label: "Cash flow", feature: "fin_visibility", ws: "financials" },
  { href: "/financials/banks", label: "Connected banks", feature: "bank", ws: "financials" },
  { href: "/financials/tax", label: "Tax & regulatory updates", feature: "fin_visibility", ws: "financials" },
  { href: "/company/business-config", label: "Business & trades", feature: "fin_visibility", ws: "financials" },
  { href: "/company/ai-automation", label: "AI & Automation", feature: "fin_visibility", ws: "financials" },
];

/** Where a workspace's exception features open when they have no page of their own. */
const LANDING: Record<WorkspaceId, string> = { win: "/dashboard", run: "/projects", grow: "/company", financials: "/financials" };

export function buildNav(access: EffectiveAccess): NavGroup[] {
  const groups: NavGroup[] = [];
  const other: NavEntry[] = [];
  const seen = new Set<string>();
  for (const ws of ["win", "run", "grow", "financials"] as WorkspaceId[]) {
    const w = access.workspaces[ws];
    // A link stays when the person has the feature, or lacks only a plan/seat (the page explains that).
    const items = NAV_FEATURES.filter((n) => n.ws === ws && !restrictedFor(access, { feature: n.feature }) && (hasCapability(access, { feature: n.feature }) || access.features[n.feature].blocked));
    if (w.exceptions.length) {
      // Workspace switched off with specific features kept: list those under "Other access", labelled with the
      // workspace they come from. Features sharing a page share one entry.
      const byHref = new Map<string, FeatureId[]>();
      for (const fid of w.exceptions) {
        const f = FEATURE_BY_ID[fid];
        const href = items.find((n) => n.feature === fid)?.href ?? f.routes?.[0] ?? LANDING[ws];
        byHref.set(href, [...(byHref.get(href) ?? []), fid]);
      }
      for (const [href, fids] of byHref) {
        if (seen.has(href)) continue;
        seen.add(href);
        other.push({ href, label: `${WORKSPACE_INFO[ws].label}: ${fids.map((x) => FEATURE_BY_ID[x].label).join(", ")}`, feature: fids[0] });
      }
      continue;
    }
    if (items.length) groups.push({ id: ws, label: WORKSPACE_INFO[ws].label, items: items.map(({ href, label, feature }) => {
      const b = access.features[feature].blocked;
      return { href, label, feature, ...(b && b !== "policy" && !hasCapability(access, { feature }) ? { needs: b } : {}) };
    }) });
  }
  if (other.length) groups.push({ id: "other", label: "Other access", items: other });
  return groups;
}

/** For the sidebar: links to hide, plus the "Other access" entries. Solo accounts and owners hide nothing. */
export function sidebarAccess(access: EffectiveAccess | null): { hidden: string[]; other: NavEntry[] } | null {
  if (!access?.company || access.company.isOwner) return null;
  const groups = buildNav(access);
  const shown = new Set(groups.filter((g) => g.id !== "other").flatMap((g) => g.items.map((i) => i.href)));
  return { hidden: NAV_FEATURES.map((n) => n.href).filter((h) => !shown.has(h)), other: groups.find((g) => g.id === "other")?.items ?? [] };
}
