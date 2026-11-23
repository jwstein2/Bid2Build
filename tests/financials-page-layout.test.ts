/**
 * Financials page built with the dashboard builder: Financials sections in the registry, which page/mode offers
 * which widget, the starting layout (same sections and order as before), and always-shown sections.
 */
import { describe, expect, it } from "vitest";
import { WIDGET_TYPES, FIN_CARD_KEYS, instanceTitle, onPage, sanitizeSettings, widgetDef } from "@/lib/dashboard/registry";
import { parseLayout, remove } from "@/lib/dashboard/schema";
import { financialsStartLayout, withRequiredSections, REQUIRED_SECTIONS } from "@/lib/dashboard/financials-page";
import { buildTemplate, TEMPLATE_KEYS } from "@/lib/dashboard/templates";
import { accessFromFacts } from "@/lib/dashboard/access";

const start = (mode: "contractor" | "accountant" = "contractor") =>
  financialsStartLayout({ mode, kpis: ["contract_value", "collected"], quickActions: ["create_invoice", "record_payment"], cards: ["ar_aging", "job_profitability"] });

describe("registry pages and modes", () => {
  it("Financials sections are offered only on the Financials page", () => {
    for (const t of WIDGET_TYPES.filter((t) => t.startsWith("fin_page_"))) {
      expect(onPage(widgetDef(t)!, "home", "contractor"), t).toBe(false);
    }
    expect(onPage(widgetDef("fin_page_kpis")!, "financials", "contractor")).toBe(true);
  });
  it("money widgets from Home can also go on the Financials page; sales and projects can't", () => {
    for (const t of ["chart", "fin_ar", "fin_pl_summary", "fin_project_profitability", "tax_updates"]) {
      expect(onPage(widgetDef(t)!, "financials", "contractor"), t).toBe(true);
      expect(onPage(widgetDef(t)!, "home", "contractor"), t).toBe(true);
    }
    for (const t of ["sales_pipeline", "pm_calendar", "quick_actions", "industry_briefing"]) expect(onPage(widgetDef(t)!, "financials", "contractor"), t).toBe(false);
  });
  it("the accountant overview is Accountant Mode only, the shortcuts Contractor Mode only", () => {
    expect(onPage(widgetDef("fin_page_accountant")!, "financials", "accountant")).toBe(true);
    expect(onPage(widgetDef("fin_page_accountant")!, "financials", "contractor")).toBe(false);
    expect(onPage(widgetDef("fin_page_nav")!, "financials", "accountant")).toBe(false);
  });
  it("Home templates never pick Financials sections", () => {
    const a = accessFromFacts({ pmEnabled: true, financialsEnabled: true, company: null, accountantModeAllowed: true,
      fin: { role: "owner", permissions: ["view_company_financials", "view_project_financials", "create_invoices", "record_payments", "reconcile"], active: true, readOnly: false, sandbox: false } });
    for (const k of TEMPLATE_KEYS) for (const w of buildTemplate(k, a).widgets) expect(w.type.startsWith("fin_page_"), `${k}: ${w.type}`).toBe(false);
  });
  it("card choices never include essential alerts, and a card is titled after its choice", () => {
    expect(FIN_CARD_KEYS).not.toContain("overdue_invoices");
    expect(FIN_CARD_KEYS).toContain("ar_aging");
    expect(instanceTitle("fin_page_card", { card: "job_profitability" })).toBe("Job profitability");
    expect(sanitizeSettings(widgetDef("fin_page_card")!, { card: "overdue_invoices" }).card).toBe("ar_aging");
    expect(sanitizeSettings(widgetDef("fin_page_kpis")!, { kpis: ["collected", "nope", "invoiced", "ar_outstanding", "actual_cost", "overdue_amount", "contract_value", "committed_cost"] }).kpis).toHaveLength(6);
  });
});

describe("starting layout", () => {
  it("keeps the old page order: shortcuts, numbers, overview, attention, alerts, quick actions, cards, reports", () => {
    expect(start().widgets.map((w) => w.type)).toEqual(["fin_page_nav", "fin_page_kpis", "fin_page_overview", "fin_page_attention", "fin_page_alerts", "fin_page_quick", "fin_page_card", "fin_page_card", "fin_page_reports"]);
    expect(start("accountant").widgets[0].type).toBe("fin_page_accountant");
  });
  it("carries the person's numbers, quick actions and cards", () => {
    const l = start();
    expect(l.widgets.find((w) => w.type === "fin_page_kpis")!.settings.kpis).toEqual(["contract_value", "collected"]);
    expect(l.widgets.find((w) => w.type === "fin_page_quick")!.settings.actions).toEqual(["create_invoice", "record_payment"]);
    expect(l.widgets.filter((w) => w.type === "fin_page_card").map((w) => w.settings.card)).toEqual(["ar_aging", "job_profitability"]);
  });
  it("has stable ids and survives a save/load round trip", () => {
    const l = start();
    expect(start().widgets.map((w) => w.id)).toEqual(l.widgets.map((w) => w.id));
    expect(parseLayout({ widgets: l.widgets, template: null, schemaVersion: 1 }).widgets).toEqual(l.widgets);
  });
  it("leaves out quick actions when there are none", () => {
    expect(financialsStartLayout({ mode: "contractor", kpis: [], quickActions: [], cards: [] }).widgets.some((w) => w.type === "fin_page_quick")).toBe(false);
  });
});

describe("always-shown sections", () => {
  it("are marked required", () => {
    for (const t of REQUIRED_SECTIONS) expect(widgetDef(t)!.required).toBe(true);
  });
  it("come back after the headline numbers when a saved layout lost them, in order", () => {
    let w = start().widgets;
    w = remove(remove(w, "fp_attention"), "fp_alerts");
    const fixed = withRequiredSections(w).map((x) => x.type);
    expect(fixed.slice(1, 4)).toEqual(["fin_page_kpis", "fin_page_attention", "fin_page_alerts"]);
  });
  it("leave a complete layout alone", () => {
    const w = start().widgets;
    expect(withRequiredSections(w)).toBe(w);
  });
});
