/**
 * Universal search (V6.4), pure parts: query understanding (synonyms, status words, numbers), command actions
 * (permission-aware, never destructive), and where each result opens (deep links to the real record).
 * The database half (relevance, typos, isolation, permissions, sandbox) is tests/db/universal-search.test.ts.
 */
import { describe, expect, it } from "vitest";
import { normalise, parseQuery } from "@/lib/search/query";
import { ACTIONS, defaultActions, findActions, matchAction, type SearchCaps } from "@/lib/search/actions";
import { GROUPS, SEARCH_KINDS, groupOf, hrefFor, kindLabel, statusOf, toResult, type SearchRow } from "@/lib/search/kinds";

const caps = (over: Partial<SearchCaps> = {}): SearchCaps => ({ premium: false, admin: false, company: null, fin: null, flags: { pm: true, financials: true }, ...over });
const owner: SearchCaps = caps({ premium: true, company: { id: "c", role: "owner", perms: ["create_estimates", "view_company_bids", "view_team_bids", "view_schedules", "create_schedules", "manage_users"] },
  fin: { book: "b", sandbox: false, perms: ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "record_expenses", "record_bills", "reconcile", "manage_financial_config"] } });
const crew: SearchCaps = caps({ company: { id: "c", role: "viewer", perms: ["view_own_bids", "view_schedules"] }, fin: null });

describe("query understanding", () => {
  it("normalises numbers, money and phone numbers", () => {
    expect(normalise("#1042")).toBe("1042");
    expect(normalise("$1,250.00 deposit")).toBe("1250.00 deposit");
    expect(normalise("(612) 555-0142")).toBe("6125550142");
    expect(normalise("612.555.0142")).toBe("6125550142");
    expect(normalise("SHG-30-BLK")).toBe("shg-30-blk");
    expect(normalise("  Johnson,   Kitchen! ")).toBe("johnson kitchen");
    expect(normalise("INV-0204")).toBe("inv-0204");
  });

  it("maps contractor words to record types without conflating accounting records", () => {
    expect(parseQuery("Kitchen estimate 1042")).toMatchObject({ text: "kitchen 1042", boost: ["estimate"], types: null });
    expect(parseQuery("johnson quote").boost).toEqual(["estimate"]);
    expect(parseQuery("johnson bid").boost).toEqual(["estimate"]);
    expect(parseQuery("smith job").boost).toEqual(["project"]);
    expect(parseQuery("electric sub").boost).toEqual(["resource"]);
    // A vendor bill is never a customer invoice and the other way round.
    expect(parseQuery("abc vendor invoice").boost).toEqual(["bill"]);
    expect(parseQuery("abc bill").boost).toEqual(["bill"]);
    expect(parseQuery("johnson invoice").boost).toEqual(["invoice"]);
    expect(parseQuery("johnson customer payment").boost).toEqual(["payment"]);
    expect(parseQuery("johnson receipt").boost).toEqual(["payment"]);
    expect(parseQuery("kitchen change order 2")).toMatchObject({ text: "kitchen 2", boost: ["change_order"] });
    expect(parseQuery("co 2").boost).toEqual(["change_order"]);
    expect(parseQuery("co-op kitchen").boost).toEqual([]);   // "co" alone is not a change order
  });

  it("turns status words into real filters ('overdue Johnson' = Johnson's overdue invoices)", () => {
    expect(parseQuery("Overdue Johnson")).toMatchObject({ text: "johnson", types: ["invoice"], status: "overdue", understood: ["Overdue"] });
    expect(parseQuery("past due")).toMatchObject({ text: "", types: ["invoice"], status: "overdue" });
    expect(parseQuery("unpaid invoices smith")).toMatchObject({ text: "smith", types: ["invoice"], status: "open,overdue" });
    expect(parseQuery("draft bids")).toMatchObject({ text: "", types: ["estimate"], status: "draft" });
    expect(parseQuery("bills needs approval")).toMatchObject({ types: ["bill"], status: "pending_approval,pending" });
    expect(parseQuery("projects in progress")).toMatchObject({ types: ["project"], status: "in_progress" });
  });

  it("a bare type word lists that type; plain names search everything", () => {
    expect(parseQuery("invoices")).toMatchObject({ text: "", types: ["invoice"] });
    expect(parseQuery("Johnson")).toMatchObject({ text: "johnson", types: null, boost: [], status: null });
    expect(parseQuery("Jhonson").text).toBe("jhonson");
  });
});

describe("command actions", () => {
  it("understands command phrases", () => {
    const ids = (q: string, c = owner) => findActions(q, c).map((a) => a.id);
    expect(ids("new invoice")[0]).toBe("create-invoice");
    expect(ids("create bid")[0]).toBe("new-bid");
    expect(ids("bank reconcile")[0]).toBe("reconcile");
    expect(ids("profit loss")[0]).toBe("open-pl");
    expect(ids("schedule project")[0]).toBe("schedule-project");
    expect(ids("add customer")[0]).toBe("add-customer");
    expect(ids("record payment")[0]).toBe("record-payment");
    expect(ids("import supplier pricing")[0]).toBe("import-pricing");
    expect(ids("company settings")[0]).toBe("company-settings");
    expect(ids("accounts receivable")[0]).toBe("view-ar");
    expect(ids("add subcontractor")[0]).toBe("add-sub");
    expect(matchAction(ACTIONS.find((a) => a.id === "create-invoice")!, "zzz")).toBe(0);
  });

  it("never offers an action the user can't use (plan, company role, Financials permission, feature switch, admin)", () => {
    const ids = (q: string, c: SearchCaps) => findActions(q, c, 50).map((a) => a.id);
    expect(ids("new invoice", crew)).not.toContain("create-invoice");
    expect(ids("profit loss", crew)).not.toContain("open-pl");
    expect(ids("import pricing", crew)).not.toContain("import-pricing");     // Premium only
    expect(ids("create bid", crew)).not.toContain("new-bid");                 // viewer can't create estimates
    expect(ids("users", crew)).not.toContain("company-users");
    expect(ids("admin", owner)).not.toContain("admin");                       // platform admin only
    expect(ids("admin", caps({ admin: true }))).toContain("admin");
    expect(ids("new invoice", { ...owner, flags: { pm: true, financials: false } })).not.toContain("create-invoice");
    expect(ids("schedule project", { ...owner, flags: { pm: false, financials: true } })).not.toContain("schedule-project");
    // A bookkeeper who can view but not record payments sees the report but not "Record Payment".
    const viewer = caps({ fin: { book: "b", sandbox: false, perms: ["view_company_financials"] } });
    expect(ids("record payment", viewer)).not.toContain("record-payment");
    expect(ids("profit loss", viewer)).toContain("open-pl");
  });

  it("only navigates: financial actions open a review form, nothing destructive exists, practice book is labelled", () => {
    for (const a of ACTIONS) {
      expect(a.href.startsWith("/")).toBe(true);
      expect(a.href).not.toMatch(/\/api\//);
      expect(a.label).not.toMatch(/delete|remove|cancel subscription|send email|pay now|charge/i);
    }
    for (const id of ["create-invoice", "record-payment", "add-expense", "add-bill"]) expect(ACTIONS.find((a) => a.id === id)!.reviewForm).toBe(true);
    expect(findActions("bank reconcile", owner)[0]).toMatchObject({ comingSoon: true });
    expect(findActions("new invoice", { ...owner, fin: { ...owner.fin!, sandbox: true } })[0]).toMatchObject({ id: "create-invoice", sandbox: true });
    expect(defaultActions(owner, ["open-pl"]).map((a) => a.id)[0]).toBe("open-pl");
    expect(defaultActions(crew, ["open-pl"]).map((a) => a.id)).not.toContain("open-pl");
  });
});

describe("result kinds and deep links", () => {
  const row = (over: Partial<SearchRow>): SearchRow => ({ kind: "customer", id: "11111111-1111-4111-8111-111111111111", title: "T", subtitle: null, status: null, reason: null, score: 1, estimate_id: null, schedule_id: null,
    customer_id: null, customer_name: null, parent_id: null, owned: true, in_context: false, workspace: "live", amount: null, record_date: null, updated_at: null, total_kind: 1, total_all: 1, ...over });
  const E = "22222222-2222-4222-8222-222222222222", S = "33333333-3333-4333-8333-333333333333", C = "44444444-4444-4444-8444-444444444444", ID = "11111111-1111-4111-8111-111111111111";

  it("every kind belongs to exactly one category", () => {
    for (const k of SEARCH_KINDS) expect(GROUPS.filter((g) => g.kinds.includes(k))).toHaveLength(1);
    expect(groupOf("bill")).toBe("accounting");
    expect(groupOf("invoice")).toBe("invoices");
  });

  it("links open the real record's page (and highlight the row with #r-<id>)", () => {
    expect(hrefFor(row({ kind: "customer" }))).toBe(`/dashboard/customers/${ID}`);
    expect(hrefFor(row({ kind: "estimate", owned: true }))).toBe(`/estimates/${ID}`);
    expect(hrefFor(row({ kind: "estimate", owned: false }))).toBe(`/company/bids/${ID}`);
    expect(hrefFor(row({ kind: "project" }))).toBe(`/projects/${ID}`);
    expect(hrefFor(row({ kind: "task", schedule_id: S, estimate_id: E }))).toBe(`/projects/${S}?tab=schedule#r-${ID}`);
    expect(hrefFor(row({ kind: "scope", schedule_id: S, estimate_id: E }))).toBe(`/projects/${S}?tab=scope#r-${ID}`);
    expect(hrefFor(row({ kind: "change_order", schedule_id: S, estimate_id: E }))).toBe(`/projects/${S}?tab=documents#r-${ID}`);
    expect(hrefFor(row({ kind: "change_order", estimate_id: E }))).toBe(`/estimates/${E}`);
    expect(hrefFor(row({ kind: "signature" }))).toBe(`/signed/${ID}`);
    expect(hrefFor(row({ kind: "invoice", estimate_id: E }))).toBe(`/financials/jobs/${E}#r-${ID}`);
    expect(hrefFor(row({ kind: "payment" }))).toBe(`/financials/records?view=payments#r-${ID}`);
    expect(hrefFor(row({ kind: "bill" }))).toBe(`/financials/records?view=costs#r-${ID}`);
    expect(hrefFor(row({ kind: "resource", status: "subcontractor" }))).toBe(`/projects/team/subs/${ID}`);
    expect(hrefFor(row({ kind: "resource", status: "staff" }))).toBe(`/projects/team/time#r-${ID}`);
    expect(hrefFor(row({ kind: "supplier" }))).toBe(`/projects/team/suppliers#r-${ID}`);
    expect(hrefFor(row({ kind: "saved_item" }))).toBe(`/dashboard/items#r-${ID}`);
    expect(hrefFor(row({ kind: "photo", schedule_id: S }))).toBe(`/projects/${S}?tab=photos#r-${ID}`);
    expect(hrefFor(row({ kind: "message", customer_id: C }))).toBe(`/dashboard/customers/${C}#r-${ID}`);
  });

  it("labels and statuses read the way contractors talk", () => {
    expect(statusOf("project", "won")?.label).toBe("Approved — Needs Review");
    expect(statusOf("project", "in_progress")?.label).toBe("In Progress");
    expect(statusOf("invoice", "overdue")).toMatchObject({ label: "Overdue", tone: "danger" });
    expect(kindLabel("resource", "subcontractor")).toBe("Subcontractor");
    expect(kindLabel("resource", "staff")).toBe("Employee");
    const r = toResult(row({ kind: "invoice", amount: "14400.00", workspace: "sandbox", estimate_id: E }));
    expect(r).toMatchObject({ amount: "$14,400.00", sandbox: true, group: "invoices" });
    // Money is shown only for financial records.
    expect(toResult(row({ kind: "saved_item", amount: "41.75" })).amount).toBeNull();
  });
});
