/** Bid pipeline stages, filters and CSV for the Enterprise Command Center. Server rules live in SQL (set_estimate_stage). */
export const STAGES = ["draft", "ready_for_review", "approved", "sent", "pending", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  draft: "Draft", ready_for_review: "Ready for Review", approved: "Approved", sent: "Sent", pending: "Pending", won: "Won", lost: "Lost",
};
export const STAGE_TONES: Record<Stage, "neutral" | "warn" | "brand" | "accent" | "ok" | "danger"> = {
  draft: "neutral", ready_for_review: "warn", approved: "brand", sent: "accent", pending: "accent", won: "ok", lost: "danger",
};
export const isStage = (s: unknown): s is Stage => typeof s === "string" && (STAGES as readonly string[]).includes(s);

export const RANGES = { "30d": "Last 30 days", "90d": "Last 90 days", "365d": "Last 12 months", all: "All time" } as const;
export type RangeKey = keyof typeof RANGES;
export const isRange = (s: unknown): s is RangeKey => typeof s === "string" && s in RANGES;

/** Start of a date range (bids created on/after), or null for all time. */
export function rangeStart(range: RangeKey, now = new Date()): string | null {
  if (range === "all") return null;
  const days = Number(range.replace("d", ""));
  return new Date(now.getTime() - days * 864e5).toISOString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PipelineFilters = { stage: Stage | null; user: string | null; team: string | null; q: string | null; range: RangeKey };

/** Reads filters from URL search params, dropping anything invalid. */
export function parseFilters(sp: Record<string, string | string[] | undefined> | URLSearchParams): PipelineFilters {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v : null;
  };
  const q = get("q")?.trim().slice(0, 100) || null;
  const user = get("user"), team = get("team"), stage = get("stage"), range = get("range");
  return {
    stage: isStage(stage) ? stage : null,
    user: user && UUID.test(user) ? user : null,
    team: team && UUID.test(team) ? team : null,
    q,
    range: isRange(range) ? range : "90d",
  };
}

export function rpcArgs(f: PipelineFilters, limit: number, offset = 0) {
  return { p_stage: f.stage, p_user: f.user, p_team: f.team, p_q: f.q, p_from: rangeStart(f.range), p_to: null, p_limit: limit, p_offset: offset };
}

export type PipelineRow = {
  id: string; title: string; estimate_number: string; customer_name: string; trades: string[]; pipeline_stage: Stage; status: string;
  user_id: string; owner_name: string; total: number | string | null; margin_pct: number | string | null;
  created_at: string; updated_at: string; stage_changed_at: string | null; total_count: number | string;
};

/** RFC 4180 CSV; cells that start with = + - @ are prefixed so spreadsheets don't run them as formulas. */
export function toCsv(rows: PipelineRow[], includeMargin: boolean): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Bid #", "Title", "Customer", "Trades", "Stage", "Estimator", "Total", ...(includeMargin ? ["Margin %"] : []), "Created", "Last updated", "Stage changed"];
  const lines = rows.map((r) => [
    r.estimate_number, r.title, r.customer_name, (r.trades ?? []).join("; "), STAGE_LABELS[r.pipeline_stage] ?? r.pipeline_stage, r.owner_name,
    r.total ?? "", ...(includeMargin ? [r.margin_pct ?? ""] : []), r.created_at?.slice(0, 10), r.updated_at?.slice(0, 10), r.stage_changed_at?.slice(0, 10) ?? "",
  ].map(cell).join(","));
  return [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

export const money = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
