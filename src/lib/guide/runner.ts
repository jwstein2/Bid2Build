/**
 * Multi-page tour planning (pure; the Guide host renders it). A tour is split into runs of consecutive
 * steps on the same page. The current run is shown with the walkthrough card; between pages the host
 * shows a "Continue on …" card with a link (or a hint, inside the builder) and never navigates on its
 * own. Where the person is in a tour is kept per browser tab, so a page change resumes the tour.
 */
import { PAGE_GUIDES, fill, meets, type GuideContext, type PageKey, type TradeGroup } from "../features/page-guides";
import { messageKey, translate, type TourDef, type TourStepDef } from "./tours";

export const RUN_KEY = "b2b:guide:run";
export interface ActiveRun { tourId: string; version: number; at: number; startedAt: number }
/** A tour left mid-way in this tab is resumed only for this long. */
export const RUN_TTL_MS = 2 * 3600_000;

export interface PlannedStep extends TourStepDef { index: number; title: string; body: string }

/** Steps this person sees, copy filled for their trade and locale. */
export function planTour(t: TourDef, ctx: GuideContext, trade: TradeGroup = "general", pack?: Readonly<Record<string, string>> | null): PlannedStep[] {
  const out: PlannedStep[] = [];
  t.steps.forEach((s, i) => {
    if (!meets(s.requires, ctx)) return;
    out.push({ ...s, index: i, title: fill(translate(pack, messageKey(t.id, i, "title"), s.title), trade), body: fill(translate(pack, messageKey(t.id, i, "body"), s.body), trade) });
  });
  return out;
}

/** The run of consecutive same-page steps starting at `at`. */
export function segmentAt(steps: readonly PlannedStep[], at: number): { page: PageKey; start: number; end: number } | null {
  if (at < 0 || at >= steps.length) return null;
  const page = steps[at].page;
  let end = at;
  while (end + 1 < steps.length && steps[end + 1].page === page) end++;
  return { page, start: at, end: end + 1 };
}

export const pageLabel = (k: PageKey) => PAGE_GUIDES[k].label;

export function parseRun(raw: string | null, now = Date.now()): ActiveRun | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ActiveRun>;
    if (typeof j.tourId !== "string" || typeof j.version !== "number" || typeof j.at !== "number" || typeof j.startedAt !== "number") return null;
    if (now - j.startedAt > RUN_TTL_MS) return null;
    return { tourId: j.tourId, version: j.version, at: j.at, startedAt: j.startedAt };
  } catch {
    return null;
  }
}
