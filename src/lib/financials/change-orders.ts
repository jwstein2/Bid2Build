/**
 * How each approved change order on a job is reflected in billing (V6 P1-B, Scenario D).
 * An added-scope change order gets its own payment(s); a scope-removal change order is taken off a remaining
 * payment (amendment) or settled with a credit memo. Each is settled one way only (the database enforces it).
 */
type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const cents = (n: number) => Math.round(n * 100);

export type CoSettlement = "open" | "milestones" | "amendment_pending" | "amended" | "credited";
export interface CoRow {
  changeOrderId: string; label: string; amount: string; settlement: CoSettlement;
  detail: string | null; amendmentId: string | null; creditNumber: string | null;
  /** Remaining (not fully invoiced) payments that can absorb a reduction of this size. */
  remaining: { milestoneId: string; description: string; current: string }[];
}

export function changeOrderSettlement(changes: Row[], milestones: Row[], amendments: Row[], credits: Row[]): CoRow[] {
  const byCo = new Map<string, { label: string; amount: number }>();
  for (const c of changes) {
    const id = str(c.change_order_id);
    if (!id || !["change_order", "correction"].includes(str(c.kind))) continue;
    const cur = byCo.get(id) ?? { label: "", amount: 0 };
    if (str(c.kind) === "change_order") cur.label = str(c.description);
    cur.amount += num(c.amount);
    byCo.set(id, cur);
  }
  const remainingFor = (amt: number) => milestones
    .filter((m) => num(m.invoiced) < num(m.current_amount) && num(m.current_amount) + amt >= 0)
    .map((m) => ({ milestoneId: str(m.milestone_id), description: str(m.description), current: num(m.current_amount).toFixed(2) }));
  const out: CoRow[] = [];
  for (const [id, c] of byCo) {
    if (cents(c.amount) === 0) continue;   // reversed by a correction
    const ownMs = milestones.filter((m) => str(m.change_order_id) === id);
    const ams = amendments.filter((a) => str(a.change_order_id) === id && str(a.status) !== "rejected");
    const credit = credits.find((x) => str(x.change_order_id) === id && str(x.status) === "issued");
    const base = { changeOrderId: id, label: c.label || "Change order", amount: c.amount.toFixed(2), amendmentId: null, creditNumber: null, remaining: [] as CoRow["remaining"] };
    if (credit) out.push({ ...base, settlement: "credited", detail: `Credit ${str(credit.number)}`, creditNumber: str(credit.number) });
    else if (ownMs.length) out.push({ ...base, settlement: "milestones", detail: ownMs.map((m) => str(m.description)).join(", ") });
    else if (ams.some((a) => str(a.status) === "pending")) {
      const a = ams.find((x) => str(x.status) === "pending")!;
      const m = milestones.find((x) => str(x.milestone_id) === str(a.milestone_id));
      out.push({ ...base, settlement: "amendment_pending", detail: `Take ${Math.abs(num(a.delta)).toFixed(2)} off "${str(m?.description)}"`, amendmentId: str(a.id) });
    } else if (ams.length) {
      const m = milestones.find((x) => str(x.milestone_id) === str(ams[0].milestone_id));
      out.push({ ...base, settlement: "amended", detail: `"${str(m?.description)}"` });
    } else out.push({ ...base, settlement: "open", detail: null, remaining: c.amount < 0 ? remainingFor(c.amount) : [] });
  }
  return out;
}
