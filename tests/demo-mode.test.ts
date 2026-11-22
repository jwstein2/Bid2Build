/**
 * Demo Mode building blocks that don't need a database: the sample dataset (deterministic, the
 * documented counts, fictional contacts only) and the API blocklist for demo sessions.
 */
import { describe, expect, it, vi } from "vitest";
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
    expect(s).toMatchObject({ customers: 150, estimates: 169, employees: 8, subcontractors: 18, crews: 2, changeOrders: 4, bankStatements: 25 });
    expect(s.projects).toBe(126 + 8);
    expect(s.schedules).toBe(45);
    expect(s.invoices).toBe(209);
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
    const domains = new Set(emails.map((e) => e.split("@")[1].toLowerCase()));
    for (const real of ["gmail.com", "yahoo.com", "outlook.com", "stripe.com"]) expect(domains.has(real), real).toBe(false);
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
      // Payments never apply more than the invoice (the one overpayment keeps the extra unapplied, then refunds it).
      if (inv.payment) expect(Number(inv.payment.allocate ?? inv.payment.amount)).toBeLessThanOrEqual(total + 0.01);
      expect(inv.dueDate >= inv.issueDate).toBe(true);
    }
  });

  it("splits seeding into small resumable steps", () => {
    const steps = demoSteps(owner);
    expect(steps[0].kind).toBe("base");
    expect(steps[steps.length - 1].kind).toBe("finish");
    for (const s of steps) if (Array.isArray(s.rows)) expect(s.rows.length).toBeLessThanOrEqual(200);
  });

  it("Practice gets the same full company as the owner demo, under its own name", () => {
    const p = buildDemoDataset({ kind: "practice", namespace: NS, anchor: "2026-11-18" });
    const { customers, estimates, schedules, invoices, employees, subcontractors, crews, bankStatements, changeOrders } = datasetSummary(owner);
    expect(datasetSummary(p)).toMatchObject({ customers, estimates, schedules, invoices, employees, subcontractors, crews, bankStatements, changeOrders });
    expect(p.bank.institution).toMatch(/SIMULATED/);
    expect(p.companyName).toMatch(/Practice/);
  });
});

describe("24-month history and the simulated bank (Will meeting 2026-11-21, item C)", () => {
  const b = owner.bank;
  const lines = b.statements.flatMap((s) => s.transactions);

  it("covers 24 months of past activity plus current and future work", () => {
    expect(b.statements).toHaveLength(25);                       // 24 full months + this month to date
    const oldest = owner.estimates.map((e) => e.createdAt).sort()[0];
    expect((Date.parse("2026-11-18") - Date.parse(oldest)) / 86_400_000).toBeGreaterThan(700);
    expect(owner.estimates.some((e) => e.label === "Scheduled")).toBe(true);
    expect(owner.estimates.some((e) => e.label === "Delayed")).toBe(true);
    expect(owner.invoices.some((i) => !i.payment && i.dueDate < "2026-11-18")).toBe(true);   // overdue
    expect(owner.cashPlan.every((c) => c.expectedOn > "2026-11-18")).toBe(true);           // forecasts are future only
    // Seasonal: summer months bring in more than winter months.
    const month = (m: string) => lines.filter((t) => t.date.slice(5, 7) === m && Number(t.amount) > 0).reduce((n, t) => n + Number(t.amount), 0);
    expect(month("07") + month("08")).toBeGreaterThan(month("01") + month("02"));
  });

  it("is conspicuously fake and never a real connection", () => {
    expect(b.institution).toMatch(/SIMULATED/);
    expect(b.accountName).toMatch(/SIMULATED/);
    expect(b.mask).toBe("0000");
    expect(b.itemRef).toMatch(/^demo-sim:/);
    for (const t of lines) expect(t.description).toMatch(/\(SIMULATED\)$/);
    expect(JSON.stringify(b)).not.toMatch(/plaid|stripe|access[-_]?token|routing/i);
  });

  it("balances to the cent: statements chain, the balance stays positive, deposits mirror payments", () => {
    let bal = Number(b.openingBalance), min = Infinity;
    for (const s of b.statements) {
      for (const t of s.transactions) { bal = Math.round((bal + Number(t.amount)) * 100) / 100; min = Math.min(min, bal); expect(t.date >= s.start && t.date <= s.end).toBe(true); }
      expect(s.closingBalance).toBe(bal.toFixed(2));
    }
    expect(b.currentBalance).toBe(bal.toFixed(2));
    expect(min).toBeGreaterThanOrEqual(8000);
    expect(lines.every((t) => t.date < "2026-11-18")).toBe(true);
    const refs = new Set(owner.invoices.filter((i) => i.payment).map((i) => i.payment!.reference));
    for (const t of lines) if (t.post?.type === "payment") expect(refs.has(t.post.reference)).toBe(true);
    // Only the newest lines are left to match, and reconciliations stop before them.
    const open = lines.filter((t) => !t.post);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((t) => t.date > "2026-11-10")).toBe(true);
    expect(b.reconcile.length).toBeGreaterThanOrEqual(22);
    expect(b.reconcile.every((r) => r.periodEnd < "2026-11-01")).toBe(true);
  });

  it("includes the exceptions: a refund, change orders, an owner draw, loss-making jobs", () => {
    expect(lines.filter((t) => t.post?.type === "refund")).toHaveLength(1);
    expect(owner.invoices.filter((i) => i.payment?.allocate)).toHaveLength(1);
    expect(owner.changeOrders.map((c) => c.outcome).sort()).toEqual(["approved", "approved", "declined", "sent"]);
    expect(lines.some((t) => t.post?.type === "excluded" && t.post.reason === "owner")).toBe(true);
    expect(lines.some((t) => t.post?.type === "expense" && /Rework/.test(t.post.description))).toBe(true);
  });

  it("seeds the bank after the books it posts into", () => {
    const kinds = demoSteps(owner).map((s) => s.kind);
    expect(kinds.indexOf("bank")).toBeGreaterThan(kinds.lastIndexOf("invoices"));
    expect(kinds.indexOf("bank_post")).toBeGreaterThan(kinds.indexOf("bank"));
    expect(kinds.indexOf("bank_finish")).toBeGreaterThan(kinds.lastIndexOf("bank_post"));
    expect(kinds.indexOf("changes")).toBeGreaterThan(kinds.lastIndexOf("invoices"));
    // The feed step carries no posting instructions (those are separate, smaller steps).
    expect(JSON.stringify(demoSteps(owner).find((s) => s.kind === "bank"))).not.toContain('"post"');
  });
});

describe("demo session blocklist", () => {
  it("blocks money, billing, outbound messages and signature requests", () => {
    for (const [p, m] of [
      ["/api/stripe/checkout", "POST"], ["/api/stripe/portal", "POST"], ["/api/billing/pm-addon", "POST"],
      ["/api/estimates/abc/signing", "POST"], ["/api/comms", "POST"], ["/api/comms/send", "POST"],
      ["/api/company/invitations", "POST"], ["/api/schedules/abc/updates", "POST"],
      ["/api/account/delete", "POST"], ["/api/import-website", "POST"],
      // Practice Mode for everyone (Nov 20): sub document request emails, change order links, Sales Hub.
      ["/api/team/subs/abc/request", "POST"], ["/api/change-orders/abc", "POST"], ["/api/sales/leads/import", "POST"], ["/api/sales/google/connect", "GET"],
    ] as const) expect(isDemoBlocked(p, m), `${m} ${p}`).toBe(true);
  });

  it("leaves the sample company usable", () => {
    for (const [p, m] of [
      ["/api/estimates/abc", "PATCH"], ["/api/estimates/abc/signing", "GET"], ["/api/comms/settings", "POST"], ["/api/comms/preview", "POST"],
      ["/api/schedules/abc", "POST"], ["/api/guide", "POST"],
      // Invoice email drafts only render text (nothing can be sent), so demos can show them (Nov 18 demo failure).
      ["/api/financials/email", "POST"], ["/api/demo/exit", "POST"], ["/api/demo/reset", "POST"], ["/api/features", "GET"],
      ["/api/team/subs/abc", "PATCH"], ["/api/team/subs/abc/documents", "POST"], ["/api/change-orders/abc", "GET"],
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

describe("Practice Mode for everyone", () => {
  it("is on unless PRACTICE_MODE=off", async () => {
    const { isPracticeEnabled } = await import("@/lib/demo/server");
    const prev = process.env.PRACTICE_MODE;
    try {
      delete process.env.PRACTICE_MODE; expect(isPracticeEnabled()).toBe(true);
      process.env.PRACTICE_MODE = "on"; expect(isPracticeEnabled()).toBe(true);
      process.env.PRACTICE_MODE = "off"; expect(isPracticeEnabled()).toBe(false);
    } finally { if (prev === undefined) delete process.env.PRACTICE_MODE; else process.env.PRACTICE_MODE = prev; }
  });

  it("says plainly that practice data is fake when an action is blocked", async () => {
    const { demoBlockedMessage } = await import("@/lib/demo/session");
    expect(demoBlockedMessage("practice")).toMatch(/fake/i);
    expect(demoBlockedMessage("practice")).toMatch(/turn off practice mode/i);
    expect(demoBlockedMessage("owner_demo")).toMatch(/Demo Mode/);
  });

  it("recognises demo and practice logins, current or retired", async () => {
    const { isDemoLogin } = await import("@/lib/demo/session");
    expect(isDemoLogin({ email: "someone@gmail.com", app_metadata: { b2b_demo: { kind: "practice", owner: NS, workspace: NS } } })).toBe(true);
    expect(isDemoLogin({ email: "practice-a1b2c3d4e5@example.com", app_metadata: { b2b_demo: null } })).toBe(true);
    expect(isDemoLogin({ email: "demo-a1b2c3d4e5@demo.built2bid.org", app_metadata: {} })).toBe(true);
    expect(isDemoLogin({ email: "practice@gmail.com", app_metadata: {} })).toBe(false);
    expect(isDemoLogin({ email: "james@example.com", app_metadata: {} })).toBe(false);
  });

  it("the email sender refuses to send from a demo or practice session", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ getAuthUser: async () => ({ id: NS, app_metadata: { b2b_demo: { kind: "practice", owner: NS, workspace: NS } } }) }));
    const { sendCommEmail } = await import("@/lib/comms/send");
    const fetchImpl = vi.fn();
    const r = await sendCommEmail("key", { idempotencyKey: "k", from: "a@b.c", to: "real@person.com", replyTo: null, subject: "s", text: "t", messageId: "<m>" }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, retry: false, error: "demo_mode_no_send" });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/supabase/server");
    vi.resetModules();
  });

  it("affiliate and payout emails refuse to send from a practice session", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase/server", () => ({ getAuthUser: async () => ({ id: NS, app_metadata: { b2b_demo: { kind: "practice", owner: NS, workspace: NS } } }) }));
    const prev = { a: process.env.AFFILIATE_EMAILS, k: process.env.RESEND_API_KEY, o: process.env.OWNER_ALERT_EMAIL };
    process.env.AFFILIATE_EMAILS = "on"; process.env.RESEND_API_KEY = "re_test_placeholder"; process.env.OWNER_ALERT_EMAIL = "owner@example.com";
    try {
      const recorded: Record<string, unknown>[] = [];
      const db = {
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
        rpc: async (_fn: string, args: Record<string, unknown>) => { recorded.push(args); return { data: true }; },
      };
      const fetchImpl = vi.fn();
      const { sendAffiliateEmail } = await import("@/lib/affiliates/emails");
      const r = await sendAffiliateEmail(db as never, "k1", "approved", "real@person.com", { email: "real@person.com" }, {}, fetchImpl as unknown as typeof fetch);
      expect(r).toBe("skipped");
      expect(recorded[0]).toMatchObject({ p_status: "logged_off", p_error: "demo_mode_no_send" });
      const { emailOwnerAlert, emailBankChanged } = await import("@/lib/payouts/notify");
      await emailOwnerAlert("s", "b", "k2", fetchImpl as unknown as typeof fetch);
      await emailBankChanged("real@person.com", "Pat", "6789", "Bank", null, "id1", fetchImpl as unknown as typeof fetch);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      for (const [k, v] of [["AFFILIATE_EMAILS", prev.a], ["RESEND_API_KEY", prev.k], ["OWNER_ALERT_EMAIL", prev.o]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      vi.doUnmock("@/lib/supabase/server"); vi.doUnmock("server-only");
      vi.resetModules();
    }
  });

  it("blocks the payout and affiliate payout routes for sample logins", async () => {
    const { isDemoBlocked } = await import("@/lib/demo/session");
    expect(isDemoBlocked("/api/payouts/return", "GET")).toBe(true);
    expect(isDemoBlocked("/api/affiliate-payouts/return", "GET")).toBe(true);
    expect(isDemoBlocked("/api/payouts/export", "GET")).toBe(true);
  });

  it("every outbound email sender is reviewed for Demo / Practice Mode", () => {
    // Adding a new place that calls Resend? Make sure a demo or practice session can't reach it, then add it here.
    const reviewed = new Set([
      "src/lib/comms/send.ts",            // refuses demo sessions itself (customer comms, sub requests, compliance, signer copy)
      "src/lib/email/outbox.ts",          // founder welcome: paid subscriptions only, demo tenants blocked in SQL
      "src/lib/email/lifecycle-run.ts",   // demo logins filtered out; email_outbox SQL guard
      "src/lib/creator/outreach/send.ts", // staff creator outreach cron
      "src/lib/trial/delivery.ts",        // Facebook trial invites (public funnel, not a signed-in session)
      "src/lib/sales/invite-email.ts", "src/lib/sales/booking-email.ts", "src/lib/sales/congrats-email.ts", "src/lib/sales/digest.ts", // staff Sales Hub (/api/sales blocked)
      "src/lib/sales/nurture/runner.ts", // Sales Hub follow-up emails: refuses demo sessions itself (inDemoSession); off until an admin enables it
      "src/lib/sales/nurture/inbound.ts", // webhook-only: forwards a lead's reply to the rep
      "src/app/api/webhooks/resend/route.ts", // inbound mail webhook (reads only)
      "src/lib/payouts/notify.ts",        // staff payouts: staff_members only, payment emails for live payouts only; refuses demo sessions itself
      "src/lib/affiliates/emails.ts",     // Affiliate Hub: off until AFFILIATE_EMAILS=on / recruitment switch; refuses demo sessions itself
    ]);
    const root = path.join(__dirname, "..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && /api\.resend\.com|api\.twilio\.com|inviteUserByEmail/.test(fs.readFileSync(full, "utf8"))) found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    };
    walk(path.join(root, "src"));
    const unreviewed = found.filter((f) => !reviewed.has(f) && f !== "src/lib/comp/server.ts" /* owner-only complimentary invites */ && f !== "src/lib/admin/costs.ts" /* text only */);
    expect(unreviewed).toEqual([]);
  });
});
