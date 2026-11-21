import { z } from "zod";
import { json } from "@/lib/http/api";
import { finFail, finGuard } from "@/lib/financials/api";
import { FinError } from "@/lib/financials/server";
import { isCashV9Enabled, loadJobCostTiming, loadJobProgress } from "@/lib/cash-v9/load";

export const runtime = "nodejs";

/**
 * V9 cash-forecast writes: forecast settings, customer payment habits, milestone progress rules and confirmations,
 * commitment payment terms, forecast overrides and alert status. The book comes from the server; every database
 * function re-checks the financial permission. Nothing here sends an invoice, moves money or contacts anyone:
 * confirming a milestone only records its trigger (the existing invoice dialog then prefills the invoice).
 */
const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const pct = z.number().min(0).max(100);
const int = (lo: number, hi: number) => z.number().int().min(lo).max(hi);
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const COST_TYPES = ["material", "labor", "labor_material", "equipment", "subcontractor", "overhead", "contingency", "permit", "delivery", "labor_burden", "other"] as const;
const ALERT_KINDS = ["low_cash", "payroll_coverage", "milestone_delayed", "milestone_progress_reached", "cost_overrun", "margin_low", "receivable_late", "expense_concentration", "forecast_confidence"] as const;

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings_save"), p: z.object({
    minCash: money.or(z.literal("")).optional(), targetGrossMargin: z.string().regex(/^-?\d{1,3}(\.\d{1,2})?$/).or(z.literal("")).optional(),
    targetNetMargin: z.string().regex(/^-?\d{1,3}(\.\d{1,2})?$/).or(z.literal("")).optional(),
    collectionDays: int(0, 365), collectionBasis: z.enum(["issue", "due"]), useHistory: z.boolean(), historyMinSample: int(1, 50),
    expenseMode: z.enum(["known", "historical", "benchmark"]), benchmark: z.partialRecord(z.enum(COST_TYPES), pct).optional(),
    payrollFromSchedule: z.boolean(), payrollPayLagDays: int(0, 31), payrollBurdenPct: pct, subPayDays: int(0, 180), supplierPayDays: int(0, 180),
    conservativeLateDays: int(0, 180), conservativeCostPct: pct, arGraceDays: int(0, 120), concentrationDays: int(1, 31), concentrationPct: z.number().min(1).max(1000),
    alertEmail: z.boolean(), alertRecipients: z.array(id).max(20), alertKindsOff: z.array(z.enum(ALERT_KINDS)).max(20),
  }) }),
  z.object({ action: z.literal("collection_terms_save"), customerId: id, p: z.object({ days: int(0, 365).optional(), basis: z.enum(["issue", "due"]).optional(), note: text(300).optional(), remove: z.boolean().optional() }) }),
  z.object({ action: z.literal("progress_rule_save"), milestoneId: id, p: z.object({ threshold: z.number().gt(0).max(100).optional(), method: z.enum(["duration", "weight", "financial"]).optional(),
    sectionKey: text(80).optional(), note: text(300).optional(), remove: z.boolean().optional() }) }),
  z.object({ action: z.literal("progress_confirm"), milestoneId: id, p: z.object({ note: text(300).optional() }) }),
  z.object({ action: z.literal("commitment_terms_save"), commitmentId: id, p: z.object({ payBasis: z.enum(["completion", "start", "date"]), payDays: int(0, 180), payDate: day.optional(),
    sectionKey: text(80).optional(), retainagePct: z.number().min(0).max(50).optional(), depositAmount: money.optional(), depositOn: day.optional(), note: text(300).optional() }) }),
  z.object({ action: z.literal("override_save"), jobId: id, p: z.object({ costCodeId: id.optional(), amount: money.nullable(), reason: text(500).min(3) }) }),
  z.object({ action: z.literal("alert_set"), alertId: id, p: z.object({ status: z.enum(["open", "acknowledged", "snoozed", "resolved"]), snoozeUntil: day.optional(), reason: text(500).optional() }) }),
]);

const off = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });

/** GET ?jobId=[&view=costs]: one job's milestones with their progress rule and verified schedule progress (viewer's RLS). */
export async function GET(req: Request) {
  if (!isCashV9Enabled()) return off();
  const g = await finGuard({ write: false, limitKey: "fin-cash-v9-read", limit: 240 });
  if ("error" in g) return g.error;
  const jobId = new URL(req.url).searchParams.get("jobId") ?? "";
  if (!id.safeParse(jobId).success) return Response.json({ error: { code: "invalid", message: "Check the details and try again." } }, { status: 400 });
  const view = new URL(req.url).searchParams.get("view");
  const r = view === "costs" ? await loadJobCostTiming(g.db, g.bookId, jobId) : await loadJobProgress(g.db, g.bookId, jobId);
  if (!r) return off();
  return json(r);
}

export async function POST(req: Request) {
  if (!isCashV9Enabled()) return off();
  const g = await finGuard({ write: true, limitKey: "fin-cash-v9", limit: 120 });
  if ("error" in g) return g.error;
  const { db, bookId } = g;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "invalid", message: "Check the details and try again." } }, { status: 400 });
  const a = parsed.data;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new FinError(error.message, error.message, error.details ?? undefined);
    return data;
  };
  try {
    switch (a.action) {
      case "settings_save": await rpc("fin_cash_settings_save", { p_book_id: bookId, p: a.p }); break;
      case "collection_terms_save": await rpc("fin_collection_terms_save", { p_book_id: bookId, p_customer_id: a.customerId, p: a.p }); break;
      case "progress_rule_save": await rpc("fin_milestone_progress_rule_save", { p_milestone_id: a.milestoneId, p: a.p }); break;
      case "progress_confirm": {
        // The percent recorded is the server's own reading of the schedule, never the browser's.
        const { data: ms } = await db.from("fin_payment_milestones").select("job_id").eq("id", a.milestoneId).maybeSingle();
        const prog = ms ? await loadJobProgress(db, bookId, String((ms as { job_id: string }).job_id)) : null;
        const m = prog?.milestones.find((x) => x.id === a.milestoneId);
        if (!m) throw new FinError("not_found", "not_found");
        if (!m.rule) throw new FinError("no_progress_rule", "no_progress_rule");
        if (m.progress === null || m.progress < m.rule.threshold) throw new FinError("below_threshold", "below_threshold");
        return json({ triggerId: await rpc("fin_milestone_progress_confirm", { p_milestone_id: a.milestoneId, p: { percent: m.progress, method: m.rule.method, note: a.p.note } }) });
      }
      case "commitment_terms_save": await rpc("fin_commitment_terms_save", { p_commitment_id: a.commitmentId, p: a.p }); break;
      case "override_save": return json({ id: await rpc("fin_forecast_override_save", { p_job_id: a.jobId, p: a.p }) });
      case "alert_set": await rpc("fin_cash_alert_set", { p_alert_id: a.alertId, p: a.p }); break;
    }
    return json({ ok: true });
  } catch (e) {
    return finFail(e, "fin.cash_v9");
  }
}
