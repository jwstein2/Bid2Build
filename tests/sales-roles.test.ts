import { describe, expect, it } from "vitest";
import { ADMIN_CAPS, canAdmin, canMy, detailSummary, fallbackCaps, landingView, OWNER_CAPS, rangeSince, REP_CAPS, roleLabel, teamTotals, type AnalyticsRep, type RepDetail, type RepMetrics } from "@/lib/sales/caps";
import { csv } from "@/lib/admin/csv";

const zero: RepMetrics = { leads: 0, leads_new: 0, contacted: 0, calls: 0, emails: 0, texts: 0, meetings: 0, follow_ups: 0, tasks_overdue: 0, demos: 0, trials: 0, closed: 0, active_customers: 0, visits: 0, signups: 0, commission_cents: 0, pending_cents: 0, unpaid_cents: 0, milestones: 0 };

describe("V8.3 role combinations", () => {
  const rep = fallbackCaps({ sells: true, salesAdmin: false, owner: false });
  const admin = fallbackCaps({ sells: false, salesAdmin: true, owner: false });
  const both = fallbackCaps({ sells: true, salesAdmin: true, owner: false });
  const ownerRep = fallbackCaps({ sells: true, salesAdmin: false, owner: true });
  const ownerAdmin = fallbackCaps({ sells: false, salesAdmin: false, owner: true });
  const none = fallbackCaps({ sells: false, salesAdmin: false, owner: false });

  it("matches the database's capability sets", () => {
    expect(rep).toEqual([...REP_CAPS]);
    expect(admin).toEqual([...ADMIN_CAPS]);
    expect(both).toEqual([...REP_CAPS, ...ADMIN_CAPS]);
    expect(ownerAdmin).toEqual([...ADMIN_CAPS, ...OWNER_CAPS]);
    expect(none).toEqual([]);
    expect(admin).not.toContain("edit_commission_policies");
    expect(admin).not.toContain("payout_operations");
  });

  it("shows the switcher only to people with both hubs and remembers the last view", () => {
    for (const [caps, my, adm] of [[rep, true, false], [admin, false, true], [both, true, true], [ownerRep, true, true], [ownerAdmin, false, true]] as const) {
      expect([canMy(caps), canAdmin(caps)]).toEqual([my, adm]);
    }
    expect(landingView(both, undefined)).toBe("my");
    expect(landingView(both, "admin")).toBe("admin");
    expect(landingView(rep, "admin")).toBe("my"); // a remembered view never grants a role
    expect(landingView(admin, "my")).toBe("admin");
    expect(landingView(none, "admin")).toBeNull();
  });

  it("labels roles for the header", () => {
    expect(roleLabel(rep)).toBe("Rep");
    expect(roleLabel(admin)).toBe("Sales Admin");
    expect(roleLabel(both)).toBe("Rep + Sales Admin");
    expect(roleLabel(ownerRep)).toBe("Owner + Rep");
    expect(roleLabel(ownerAdmin)).toBe("Owner");
  });
});

describe("team reporting", () => {
  const reps: AnalyticsRep[] = [
    { id: "a", full_name: "Sarah", role: "rep", status: "active", is_admin_rep: false, metrics: { ...zero, contacted: 10, closed: 2, calls: 5, commission_cents: 4000 } },
    { id: "b", full_name: "Dana", role: "admin", status: "active", is_admin_rep: true, metrics: { ...zero, contacted: 10, closed: 3, calls: 1, commission_cents: 6000 } },
  ];
  it("sums each sale once and can exclude reps who are also administrators", () => {
    expect(teamTotals(reps, true)).toMatchObject({ reps: 2, closed: 5, contacted: 20, conversion: 0.25, commission_cents: 10000 });
    expect(teamTotals(reps, false)).toMatchObject({ reps: 1, closed: 2, conversion: 0.2 });
    expect(teamTotals([], true).conversion).toBeNull();
  });
  it("defaults the range to 30 days", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(rangeSince(undefined, now).key).toBe("30d");
    expect(rangeSince("7d", now).since.toISOString()).toBe("2026-11-12T12:00:00.000Z");
    expect(rangeSince("bogus", now).key).toBe("30d");
  });
  it("exports a formula-safe CSV", () => {
    const d = { rep: { full_name: "=HYPERLINK(1)" }, metrics: { ...zero, contacted: 4, closed: 1 } } as unknown as RepDetail;
    const rows = detailSummary(d);
    expect(rows.find(([k]) => k.startsWith("Conversion"))?.[1]).toBe("25%");
    expect(csv(["Rep"], [[d.rep.full_name]])).toContain(`"'=HYPERLINK(1)"`);
  });
});
