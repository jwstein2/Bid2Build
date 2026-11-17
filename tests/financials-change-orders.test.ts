import { describe, expect, it } from "vitest";
import { changeOrderSettlement } from "@/lib/financials/change-orders";

const ch = (id: string, amount: number, kind = "change_order") => ({ change_order_id: id, kind, amount, description: `Change order ${id}` });
const ms = [
  { milestone_id: "m1", description: "Deposit", current_amount: 3000, invoiced: 3000 },
  { milestone_id: "m2", description: "Completion", current_amount: 5000, invoiced: 0 },
  { milestone_id: "m3", description: "CO A", current_amount: 450, invoiced: 0, change_order_id: "a" },
];

describe("change order settlement", () => {
  it("open reduction lists only remaining payments that can absorb it", () => {
    const [r] = changeOrderSettlement([ch("x", -2000)], ms, [], []);
    expect(r).toMatchObject({ settlement: "open", amount: "-2000.00" });
    expect(r.remaining.map((m) => m.milestoneId)).toEqual(["m2"]);
  });
  it("settled by its own payment, credit, pending or approved amendment", () => {
    const rows = changeOrderSettlement([ch("a", 450), ch("b", -100), ch("c", -200), ch("d", -300)], ms,
      [{ id: "am1", change_order_id: "c", milestone_id: "m2", delta: -200, status: "pending" }, { id: "am2", change_order_id: "d", milestone_id: "m2", delta: -300, status: "approved" }],
      [{ change_order_id: "b", number: "CM-0001", status: "issued" }]);
    expect(rows.map((r) => r.settlement)).toEqual(["milestones", "credited", "amendment_pending", "amended"]);
    expect(rows[2].amendmentId).toBe("am1");
  });
  it("a voided credit or rejected amendment leaves it open; a reversed change order disappears", () => {
    const rows = changeOrderSettlement([ch("b", -100), ch("z", -50), ch("z", 50, "correction")], ms,
      [{ id: "am", change_order_id: "b", milestone_id: "m2", delta: -100, status: "rejected" }], [{ change_order_id: "b", number: "CM-1", status: "void" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].settlement).toBe("open");
  });
});
