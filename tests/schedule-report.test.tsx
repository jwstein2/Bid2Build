/**
 * Customer schedule updates: what the homeowner sees. Never costs or internal notes, scope only when
 * the contractor turns it on per section, completion only when recorded, slips described accurately.
 */
import { describe, expect, it } from "vitest";
import { buildCustomerReport, buildUpdateEmail, DEFAULT_REPORT_OPTIONS, defaultScopeText, reportOptionsSchema, stateOf } from "@/lib/schedule/report";
import { renderScheduleReportPdf } from "@/lib/pdf/schedule-report";
import type { ScheduleData, Task } from "@/lib/schedule/types";

const CAL = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
const task = (id: string, name: string, s: string, e: string, d: number, extra: Partial<Task> = {}): Task => ({
  id, parentId: null, kind: "section", sourceGroupId: `g-${id}`, sourceItemId: null, splitFrom: null, name, sortOrder: 0, plannedStart: s, plannedEnd: e, durationDays: d,
  actualStart: null, actualFinish: null, percentComplete: 0, status: "not_started", weight: null, assignee: null, notes: null, ...extra,
});
function data(tasks: Task[]): ScheduleData {
  return {
    schedule: { id: "s1", estimateId: "e1", companyId: null, name: "Kitchen", status: "active", provisional: false, calendar: CAL, startDate: "2026-11-13", targetEndDate: null, progressMethod: "duration", revision: 4, updatedAt: "" },
    snapshot: {
      estimate: { id: "e1", title: "Kitchen remodel", number: "1042", customerName: "Pat Lee", projectAddress: "12 Oak St" },
      trades: ["framing"], version: null,
      sections: [
        { id: "g-fr", name: "Framing", trade: "framing", sortOrder: 0, items: [{ id: "i1", name: "Wall framing", quantity: 400, unit: "sq ft", sortOrder: 0 }, { id: "i2", name: "Headers", quantity: 6, unit: "ea", sortOrder: 1 }] },
        { id: "g-dw", name: "Drywall", trade: "drywall", sortOrder: 1, items: [] },
        { id: "g-pt", name: "Paint", trade: "painting", sortOrder: 2, items: [] },
      ],
    },
    tasks, deps: [], revisions: [], canEdit: true, permissions: { edit: true, progress: true, dependencies: true, publish: true, pdf: true },
  };
}
// Framing Nov 13-18 complete; drywall in progress; paint upcoming. Private fields set to catch leaks.
const base = () => [
  task("fr", "Framing", "2026-11-13", "2026-11-18", 4, { sortOrder: 0, status: "complete", percentComplete: 100, actualStart: "2026-11-13", actualFinish: "2026-11-18", assignee: "Bob Crew", notes: "PRIVATE: margin is thin", weight: 7 }),
  task("dw", "Drywall", "2026-11-19", "2026-11-24", 4, { sortOrder: 1, status: "in_progress", percentComplete: 50, actualStart: "2026-11-19", notes: "PRIVATE: sub costs $4,200" }),
  task("pt", "Paint", "2026-11-25", "2026-11-27", 3, { sortOrder: 2 }),
];
const ctx = { company: { name: "Acme Builders", phone: "555-0100", email: "hi@acme.test", color: "#123456", hasLogo: true }, today: "2026-11-20", tradeLabel: (t: string) => t[0].toUpperCase() + t.slice(1) };

describe("customer report", () => {
  it("defaults protect internal information: no line items, scope, notes, costs, assignees or private notes", () => {
    const r = buildCustomerReport(data(base()), {}, ctx);
    expect(DEFAULT_REPORT_OPTIONS).toMatchObject({ showTaskDetails: false, showScope: false, notes: "", showProgress: true });
    const text = JSON.stringify(r);
    for (const leak of ["PRIVATE", "Bob Crew", "4,200", "margin", "400", "sq ft", "weight"]) expect(text).not.toContain(leak);
    expect(r.sections.every((s) => s.scope === null && s.tasks === null)).toBe(true);
    expect(r.notes).toBeNull();
    expect(r).toMatchObject({ customerName: "Pat Lee", projectTitle: "Kitchen remodel", company: { name: "Acme Builders" }, brand: { logo: true, color: "#123456" } });
  });

  it("groups completed, current and upcoming work; progress is work-based, not elapsed time", () => {
    const r = buildCustomerReport(data(base()), {}, ctx);
    expect(r.sections.map((s) => [s.name, s.state, s.statusLabel])).toEqual([["Framing", "completed", "Complete"], ["Drywall", "current", "In progress"], ["Paint", "upcoming", "Scheduled"]]);
    // (4*100 + 4*50 + 3*0) / 11 = 55%
    expect(r.progress).toBe(55);
    expect(r.forecastFinish).toBe("2026-11-27");
    expect(r.sections[0].actualFinish).toBe("2026-11-18");
    expect(r.counts).toEqual({ completed: 1, current: 1, upcoming: 1 });
  });

  it("never claims completion until it is recorded", () => {
    const t = base(); t[1] = { ...t[1], percentComplete: 100, status: "in_progress", actualFinish: null };
    const r = buildCustomerReport(data(t), {}, ctx);
    expect(r.sections[1]).toMatchObject({ state: "current", statusLabel: "In progress", actualFinish: null });
    // Past its planned finish without being marked complete: still current work.
    expect(stateOf({ status: "not_started", plannedStart: "2026-11-01", actualStart: null }, "2026-11-20")).toBe("current");
  });

  it("a slip is shown as a revised forecast with the change identified", () => {
    const before = buildCustomerReport(data(base()), {}, { ...ctx, today: "2026-11-16" });
    const t = base(); t[0] = { ...t[0], status: "in_progress", percentComplete: 70, actualFinish: null, plannedEnd: "2026-11-21" };
    const t2 = t.map((x) => (x.id === "pt" ? { ...x, plannedEnd: "2026-12-01" } : x));
    const prev = buildCustomerReport(data(base().map((x) => ({ ...x, status: "not_started" as const, actualFinish: null, percentComplete: 0 }))), {}, { ...ctx, today: "2026-11-13" });
    const after = buildCustomerReport(data(t2), {}, { ...ctx, previous: prev });
    expect(before.previousForecast).toBeNull();
    expect(after.sections[0].change).toBe("Finish moved later: was Nov 18, now Nov 21.");
    expect(after.sections[0].statusLabel).toBe("In progress");
    expect(after.forecastFinish).toBe("2026-12-01");
    expect(after.previousForecast).toBe("2026-11-27");
    const done = buildCustomerReport(data(base()), {}, { ...ctx, previous: prev });
    expect(done.sections[0].change).toBe("Completed since the last update.");
  });

  it("scope visibility is configurable per section; hidden groups are left out", () => {
    const d = data(base());
    const scope = { fr: defaultScopeText(d, d.tasks[0]) };
    expect(scope.fr).toBe("Wall framing, Headers");
    const off = buildCustomerReport(d, { scope }, ctx);
    expect(off.sections[0].scope).toBeNull();
    const on = buildCustomerReport(d, { showScope: true, scope, showCompleted: false }, ctx);
    expect(on.sections.map((s) => s.name)).toEqual(["Drywall", "Paint"]);
    const all = buildCustomerReport(d, { showScope: true, scope }, ctx);
    expect(all.sections.map((s) => s.scope)).toEqual(["Wall framing, Headers", null, null]);
    expect(all.counts.completed).toBe(1);
    expect(() => reportOptionsSchema.parse({ prices: true })).toThrow();
  });

  it("line items and branding are optional; progress can be hidden", () => {
    const t = [...base(), task("it1", "Wall framing", "2026-11-13", "2026-11-14", 2, { kind: "item", parentId: "fr", sourceGroupId: "g-fr", sourceItemId: "i1", status: "complete", actualFinish: "2026-11-14", percentComplete: 100, notes: "PRIVATE item" })];
    const r = buildCustomerReport(data(t), { showTaskDetails: true, branding: false, showProgress: false }, ctx);
    expect(r.sections[0].tasks).toEqual([{ name: "Wall framing", plannedStart: "2026-11-13", plannedEnd: "2026-11-14", actualFinish: "2026-11-14", status: "complete", statusLabel: "Complete" }]);
    expect(r.brand).toEqual({ logo: false, color: null });
    expect(r.progress).toBeNull();
    expect(r.sections.every((s) => s.progress === null)).toBe(true);
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
  });

  it("email: link or attachment wording, no claim of delivery", () => {
    const r = buildCustomerReport(data(base()), {}, ctx);
    const withLink = buildUpdateEmail(r, { link: "https://built2bid.org/updates/abc", contactName: "Sam" });
    expect(withLink.subject).toBe("Project update: Kitchen remodel — Acme Builders");
    expect(withLink.body).toContain("Hi Pat,");
    expect(withLink.body).toContain("55% complete");
    expect(withLink.body).toContain("https://built2bid.org/updates/abc");
    expect(buildUpdateEmail(r).body).toContain("attached as a PDF");
  });

  it("PDF renders the customer content and nothing private", async () => {
    const t = base();
    const r = buildCustomerReport(data(t), { notes: "Cabinets arrive Tuesday." }, ctx);
    const pdf = await renderScheduleReportPdf(r, 2);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(text).toContain("Project Update");
    expect(text).toContain("Acme Builders");
    expect(text).toContain("Cabinets arrive Tuesday.");
    expect(text).toContain("55% complete");
    expect(text).not.toContain("PRIVATE");
    expect(text).not.toMatch(/\$\d/);
  });
});
