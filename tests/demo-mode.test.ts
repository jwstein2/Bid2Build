/**
 * Demo Mode building blocks that don't need a database: the sample dataset (deterministic, the
 * documented counts, fictional contacts only) and the API blocklist for demo sessions.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEMO_SEED_VERSION, buildDemoDataset, datasetSummary, demoId } from "@/lib/demo/dataset";
import { demoSteps } from "@/lib/demo/apply";
import { DEMO_BLOCKED, isDemoBlocked, parseDemoClaim } from "@/lib/demo/session";

const NS = "11111111-1111-4111-8111-111111111111";
const owner = buildDemoDataset({ kind: "owner_demo", namespace: NS, anchor: "2026-11-18" });

describe("sample company dataset", () => {
  it("has the documented size and mix", () => {
    const s = datasetSummary(owner);
    expect(s).toMatchObject({ customers: 150, estimates: 125, employees: 8, subcontractors: 12 });
    expect(s.projects).toBe(90);
    expect(s.schedules).toBe(45);
    expect(s.invoices).toBe(65);
    expect(s.communications).toBeGreaterThanOrEqual(200);
    const trades = new Set(owner.estimates.flatMap((e) => (e.payload as { trades?: string[] }).trades ?? []));
    for (const t of ["concrete", "decks", "roofing", "siding", "kitchens", "bathrooms", "painting", "drywall", "electrical", "pressure-washing", "soft-washing"]) {
      expect([...trades].some((x) => x.includes(t.split("-")[0])), t).toBe(true);
    }
  });

  it("is deterministic for a workspace and different between workspaces", () => {
    const again = buildDemoDataset({ kind: "owner_demo", namespace: NS, anchor: "2026-11-18" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(owner));
    const other = buildDemoDataset({ kind: "owner_demo", namespace: "22222222-2222-4222-8222-222222222222", anchor: "2026-11-18" });
    expect(other.customers[0].id).not.toBe(owner.customers[0].id);
    expect(demoId(NS, "x")).toMatch(/^[0-9a-f-]{36}$/);
    expect(owner.seedVersion).toBe(DEMO_SEED_VERSION);
  });

  it("uses only reserved example domains and 555-01xx phone numbers", () => {
    const json = JSON.stringify(owner);
    const emails = json.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    expect(emails.length).toBeGreaterThan(100);
    for (const e of emails) expect(e, e).toMatch(/@(example\.(com|net|org)|demo\.built2bid\.org)$/i);
    for (const c of owner.customers) if (c.phone) expect(c.phone).toMatch(/555-01\d\d/);
    expect(json).not.toMatch(/\bstripe\.com|\bgmail\.com|\byahoo\.com/i);
  });

  it("keeps financials consistent: invoices only for won or completed work, payments never above the invoice", () => {
    const byId = new Map(owner.estimates.map((e) => [e.id, e]));
    for (const inv of owner.invoices) {
      const e = byId.get(inv.estimateId)!;
      expect(e, inv.estimateId).toBeDefined();
      const stages = e.stages.map((x) => x.stage);
      expect(stages.some((x) => ["won", "scheduled", "in_progress", "completed"].includes(x)), e.label).toBe(true);
      expect(stages).not.toContain("lost");
      const total = inv.lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice), 0);
      expect(total).toBeGreaterThan(0);
      if (inv.payment) expect(Number(inv.payment.amount)).toBeLessThanOrEqual(total + 0.01);
      expect(inv.dueDate >= inv.issueDate).toBe(true);
    }
  });

  it("splits seeding into small resumable steps", () => {
    const steps = demoSteps(owner);
    expect(steps[0].kind).toBe("base");
    expect(steps[steps.length - 1].kind).toBe("finish");
    for (const s of steps) if (Array.isArray(s.rows)) expect(s.rows.length).toBeLessThanOrEqual(200);
  });

  it("practice data is small and has no team or invoices", () => {
    const p = buildDemoDataset({ kind: "practice", namespace: NS, anchor: "2026-11-18" });
    expect(p.estimates.length).toBeLessThanOrEqual(5);
    expect(p.resources).toEqual([]);
    expect(p.invoices).toEqual([]);
  });
});

describe("demo session blocklist", () => {
  it("blocks money, billing, outbound messages and signature requests", () => {
    for (const [p, m] of [
      ["/api/stripe/checkout", "POST"], ["/api/stripe/portal", "POST"], ["/api/billing/pm-addon", "POST"],
      ["/api/estimates/abc/signing", "POST"], ["/api/comms", "POST"], ["/api/comms/send", "POST"],
      ["/api/financials/email", "POST"], ["/api/company/invitations", "POST"], ["/api/schedules/abc/updates", "POST"],
      ["/api/account/delete", "POST"], ["/api/import-website", "POST"],
    ] as const) expect(isDemoBlocked(p, m), `${m} ${p}`).toBe(true);
  });

  it("leaves the sample company usable", () => {
    for (const [p, m] of [
      ["/api/estimates/abc", "PATCH"], ["/api/estimates/abc/signing", "GET"], ["/api/comms/settings", "POST"], ["/api/comms/preview", "POST"],
      ["/api/schedules/abc", "POST"], ["/api/guide", "POST"], ["/api/demo/exit", "POST"], ["/api/demo/reset", "POST"], ["/api/features", "GET"],
    ] as const) expect(isDemoBlocked(p, m), `${m} ${p}`).toBe(false);
  });

  it("every blocked prefix matches a real API route", () => {
    const api = path.join(__dirname, "..", "src", "app", "api");
    for (const b of DEMO_BLOCKED) {
      const rel = b.prefix.replace(/^\/api\//, "").replace(/\/$/, "");
      expect(fs.existsSync(path.join(api, rel)), b.prefix).toBe(true);
    }
  });

  it("only trusts a well-formed server-written claim", () => {
    const ok = { b2b_demo: { kind: "owner_demo", owner: NS, workspace: NS } };
    expect(parseDemoClaim(ok)).toEqual({ kind: "owner_demo", owner: NS, workspace: NS });
    expect(parseDemoClaim({ b2b_demo: { kind: "admin", owner: NS, workspace: NS } })).toBeNull();
    expect(parseDemoClaim({ b2b_demo: { kind: "practice", owner: "nope", workspace: NS } })).toBeNull();
    expect(parseDemoClaim(null)).toBeNull();
  });
});
