/**
 * Help resources and help search for the Built2Bid Guide.
 *
 * Everything here is verified product copy that already ships: the page walkthrough steps
 * (page-guides.ts), the guided tours (tours.ts) and a short list of help destinations. Search and the
 * optional AI answers only ever draw from this index, so help never describes a feature that doesn't
 * exist or isn't on this person's plan (steps filtered with the same rules the walkthrough uses).
 */
import { PAGE_GUIDES, isPageKey, resolveGuide, type GuideContext, type PageKey, type TradeGroup } from "../features/page-guides";
import { eligibleTours, type Workspace } from "./tours";

export interface HelpResource { id: string; kind: "video" | "article" | "link"; title: string; description: string; href: string }

export const HELP_RESOURCES: readonly HelpResource[] = [
  { id: "video.getting-started", kind: "video", title: "Meet Built2Bid (2 min video)", description: "A short tour of building, sending and tracking a bid.", href: "/media/meet-built2bid-v1.mp4" },
  { id: "article.first-bid", kind: "article", title: "Your first bid, step by step", description: "Pick a trade, price line items, preview and send.", href: "/learn" },
  { id: "article.projects", kind: "article", title: "Project Command Center basics", description: "Turning won bids into scheduled projects.", href: "/projects" },
  { id: "article.enterprise", kind: "article", title: "Company setup", description: "Seats, roles, teams and billing for Team.", href: "/company" },
  { id: "academy", kind: "link", title: "Built2Bid Academy", description: "Courses and a community of contractors.", href: "/academy" },
  { id: "whats-new", kind: "link", title: "What's new", description: "Recent releases and feature tours.", href: "/whats-new" },
];

export const getResource = (id: string) => HELP_RESOURCES.find((r) => r.id === id);

export interface HelpEntry {
  id: string;
  kind: "step" | "tour" | "resource";
  title: string;
  body: string;
  /** Page label, tour title or resource kind, shown beside the result. */
  source: string;
  page?: PageKey;
  tourId?: string;
  href?: string;
}

/**
 * The help index for this person: page walkthrough steps they'd be shown, tours they can open and the
 * help destinations. Locked steps are left out (the walkthrough explains those in place).
 */
export function helpIndex(ctx: GuideContext, ws: Workspace, trade: TradeGroup = "general"): HelpEntry[] {
  const out: HelpEntry[] = [];
  for (const key of Object.keys(PAGE_GUIDES)) {
    if (!isPageKey(key)) continue;
    // Same filter the walkthrough uses: unreleased features and steps for other plans/roles are left out.
    for (const s of resolveGuide(key, ctx, trade)) {
      if (s.locked) continue;
      out.push({ id: s.key, kind: "step", title: s.title, body: s.body, source: PAGE_GUIDES[key].label, page: key });
    }
  }
  for (const t of eligibleTours(ctx, ws)) {
    out.push({ id: `tour:${t.id}`, kind: "tour", title: t.title, body: t.description, source: "Guided tour", tourId: t.id });
  }
  for (const r of HELP_RESOURCES) out.push({ id: `res:${r.id}`, kind: "resource", title: r.title, body: r.description, source: r.kind === "video" ? "Video" : "Help", href: r.href });
  return out;
}

const STOP = new Set(["a", "an", "the", "to", "do", "i", "how", "can", "my", "of", "in", "on", "for", "is", "it", "and", "or", "what", "where", "with", "me", "you", "your"]);
export const terms = (q: string) => q.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/** Simple ranked keyword search (title matches weigh more; a crude stem tolerates plurals). No network. */
export function searchHelp(index: readonly HelpEntry[], q: string, limit = 8, page?: PageKey | null): HelpEntry[] {
  const words = terms(q);
  if (!words.length) return [];
  const stem = (w: string) => w.replace(/(ing|es|s)$/, "");
  const scored = index.map((e) => {
    const title = e.title.toLowerCase(), body = e.body.toLowerCase();
    let s = 0;
    for (const w of words) {
      const st = stem(w);
      if (title.includes(st)) s += 3;
      if (body.includes(st)) s += 1;
    }
    if (s > 0 && page && e.page === page) s += 1;
    if (s > 0 && e.kind === "tour") s += 1;
    return { e, s };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}
