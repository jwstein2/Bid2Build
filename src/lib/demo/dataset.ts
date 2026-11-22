/**
 * The versioned, reproducible sample dataset for Demo Mode (owner) and Practice Mode (any user).
 *
 * Pure and deterministic: the same (seed version, kind, namespace, anchor date) always produces the
 * same records. `namespace` is the demo workspace id, so ids never collide between workspaces, and
 * `anchor` is the day the workspace was seeded, so the demo always looks current (recent leads, jobs
 * in progress this week) instead of frozen in the past.
 *
 * Every estimate is priced with the real estimate engine (computeEstimate) and every proposal version
 * is built with the real proposal builder, so totals, tax and payment schedules are internally
 * consistent with what the app would produce. Prices are illustrative only (see catalog.ts).
 *
 * The dataset is applied by public.demo_apply() (migration 20270102001000), which runs the app's own
 * RPCs (save_estimate, set_estimate_stage, schedule_create, ...) as the demo login, so every database
 * rule and trigger applies exactly as it does for real work.
 */
import { createHash } from "node:crypto";
import { computeEstimate } from "../estimate/engine";
import { buildProposal } from "../proposal/build";
import { contentHash, versionSnapshot } from "../export/snapshot";
import { defaultProposalConfig, type BusinessProfile, type ProposalConfig } from "../proposal/types";
import type { Estimate, EstimateGroup, LineItem } from "../estimate/types";
import { RECIPES, type JobRecipe } from "./catalog";
import { BUSINESS_NAMES, EMAIL_DOMAINS, FIRST, LAST, STAFF, STREETS, SUBS, TOWNS, fictionalPhone } from "./names";

/** Bump when the dataset changes; Reset re-seeds with the current version. */
export const DEMO_SEED_VERSION = "2026.11.21-1"; // 2026.11.21: 24-month history, simulated bank, change orders, refund; Practice = full company
export type DemoKind = "owner_demo" | "practice";

export type Stage = "draft" | "ready_for_review" | "approved" | "sent" | "pending" | "won" | "scheduled" | "in_progress" | "completed" | "lost";

export interface DemoResource {
  id: string; kind: "staff" | "subcontractor" | "crew"; name: string; contactName?: string; trades: string[]; email: string; phone: string; notes?: string;
  employee?: { title: string; payType: string; hourlyCost: number; hireDate: string };
  /** V7.3 Contractors & Workforce: company / individual sub, worker's company, crew members, capacity. */
  entity?: "company" | "individual"; parentId?: string; members?: string[]; capacity?: number; capacityDeclared?: boolean; crewSize?: number; specialties?: string[];
}
export interface DemoCustomer { id: string; name: string; email: string; phone: string; address: string; customerType: "person" | "business"; companyName?: string; notes?: string; createdAt: string }
export interface DemoVersion { contentHash: string; snapshot: unknown; proposal: unknown; totalCost: string; subtotal: string; tax: string; total: string; createdAt: string }
export interface DemoEstimate {
  id: string; customerId: string; createdAt: string; trade: string; total: number;
  payload: Record<string, unknown>;
  version: DemoVersion | null;
  stages: { stage: Stage; at: string; note?: string }[];
  /** Displayed status, for the README and tests ("Delayed" is a job running behind its schedule). */
  label: string;
}
export interface DemoTask { key: string; kind: "section" | "item"; parentKey?: string; sourceGroupId: string; sourceItemId?: string; name: string; sortOrder: number; plannedStart: string; plannedEnd: string; durationDays: number }
export interface DemoSchedule {
  estimateId: string; name: string; startDate: string; targetEndDate: string; active: boolean;
  tasks: DemoTask[];
  progress: { key: string; status: "not_started" | "in_progress" | "complete" | "delayed"; percent: number; actualStart?: string; actualFinish?: string; notes?: string }[];
  assign: { key: string; resourceId: string; status: "tentative" | "confirmed" }[];
  closeout: { actualFinish: string } | null;
}
export interface DemoInvoice {
  estimateId: string; kind: "deposit" | "final"; issueDate: string; dueDate: string; memo: string;
  lines: { description: string; quantity: string; unitPrice: string; taxable: boolean }[];
  /** `allocate` (when set) is the part applied to this invoice; the rest stays as an unapplied overpayment. */
  payment: { amount: string; receivedOn: string; method: "check" | "ach" | "card"; reference: string; allocate?: string } | null;
}
export interface DemoComm {
  id: string; customerId: string; estimateId: string | null; kind: "nurture" | "project_update" | "financial"; trigger: "manual" | "weekly" | "milestone" | "financial";
  toEmail: string; toName: string; subject: string; body: string; status: "sent" | "delivered" | "replied"; sentAt: string;
  /** Financial messages only: which invoice template it used. */
  finTemplate?: "deposit" | "final";
}
/**
 * The COMPLETELY FAKE "connected bank" (Will meeting 2026-11-21, item C). Not Plaid, not Stripe: no credentials,
 * token, account linking, API call or money movement. The feed below is written straight into the demo book by
 * demo_apply, the connection is marked sandbox, never syncs, and every name says SIMULATED.
 */
export type DemoBankPost =
  | { type: "payment"; reference: string }
  | { type: "expense"; payee: string; description: string; estimateId?: string }
  | { type: "refund"; paymentReference: string; amount: string; reference: string }
  | { type: "excluded"; reason: "transfer" | "duplicate" | "owner" | "not_business" | "other"; note: string };
export interface DemoBankTxn { txnRef: string; date: string; description: string; amount: string; checkNumber?: string; post: DemoBankPost | null }
export interface DemoBankStatement { label: string; start: string; end: string; closingBalance: string; transactions: DemoBankTxn[] }
export interface DemoBank {
  institution: string; accountName: string; mask: string; itemRef: string;
  openingBalance: string; currentBalance: string; availableBalance: string; asOf: string;
  statements: DemoBankStatement[];
  reconcile: { periodEnd: string; statementBalance: string }[];
}
export interface DemoChangeOrder { estimateId: string; title: string; description: string; lines: { kind: "add" | "remove" | "modify"; description: string; amount: string }[]; scheduleDays: number; outcome: "approved" | "sent" | "declined"; note: string }
/** Forward-looking plan for the cash forecast (V9): recurring payroll, overhead and the next estimated tax payment. */
export interface DemoCashEvent { kind: "payroll" | "recurring_expense" | "other_outflow"; label: string; amount: string; expectedOn: string; recurrence: "none" | "biweekly" | "monthly"; note: string }
export interface DemoDataset {
  seedVersion: string; kind: DemoKind; anchor: string; companyName: string;
  business: Record<string, unknown>;
  resources: DemoResource[];
  customers: DemoCustomer[];
  estimates: DemoEstimate[];
  schedules: DemoSchedule[];
  invoices: DemoInvoice[];
  comms: DemoComm[];
  changeOrders: DemoChangeOrder[];
  bank: DemoBank;
  cashPlan: DemoCashEvent[];
}

// ── Deterministic helpers ────────────────────────────────────────────────────────────────────────
/** Stable UUID (v4 layout) for a key inside a namespace. */
export function demoId(namespace: string, key: string): string {
  const h = createHash("sha256").update(`${namespace}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** mulberry32: small, fast, seedable PRNG. */
function prng(seed: string) {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    weighted: <T extends { weight: number }>(xs: readonly T[]) => {
      const total = xs.reduce((n, x) => n + x.weight, 0);
      let r = next() * total;
      for (const x of xs) { r -= x.weight; if (r <= 0) return x; }
      return xs[xs.length - 1];
    },
  };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY));
const at = (d: string, hour = 15) => `${d}T${String(hour).padStart(2, "0")}:00:00Z`;
/** Add working days (Mon-Fri). */
function addWorkdays(d: string, n: number): string {
  let cur = d, left = n;
  while (left > 0) { cur = addDays(cur, 1); const wd = new Date(`${cur}T12:00:00Z`).getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return cur;
}
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const nonWeekend = (d: string) => { const wd = new Date(`${d}T12:00:00Z`).getUTCDay(); return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d; };

// ── Plan: how many records of each status (owner demo) ──────────────────────────────────────────
interface Slot { stage: Stage; label: string; ageMin: number; ageMax: number; delayed?: boolean; schedule?: boolean; invoices?: number; seasonal?: boolean }
function ownerPlan(): Slot[] {
  const s: Slot[] = [];
  const add = (n: number, slot: Slot) => { for (let i = 0; i < n; i++) s.push({ ...slot }); };
  add(8, { stage: "draft", label: "Estimate in progress", ageMin: 0, ageMax: 12 });
  add(4, { stage: "ready_for_review", label: "Estimate in progress (ready for review)", ageMin: 1, ageMax: 10 });
  add(2, { stage: "approved", label: "Approved internally, ready to send", ageMin: 1, ageMax: 6 });
  add(10, { stage: "sent", label: "Proposal sent", ageMin: 2, ageMax: 20 });
  add(6, { stage: "pending", label: "Awaiting customer approval", ageMin: 5, ageMax: 25 });
  add(5, { stage: "lost", label: "Lost", ageMin: 30, ageMax: 600 });
  add(10, { stage: "won", label: "Approved by customer", ageMin: 3, ageMax: 18 });
  add(12, { stage: "scheduled", label: "Scheduled", ageMin: 8, ageMax: 30, schedule: true });
  add(10, { stage: "in_progress", label: "In progress", ageMin: 18, ageMax: 55, schedule: true, invoices: 1 });
  add(5, { stage: "in_progress", label: "Delayed", ageMin: 25, ageMax: 60, schedule: true, invoices: 1, delayed: true });
  add(18, { stage: "completed", label: "Completed and paid", ageMin: 45, ageMax: 120, schedule: true, invoices: 2 });
  add(7, { stage: "completed", label: "Completed and invoiced", ageMin: 60, ageMax: 160, invoices: 2 });
  // 24 months of history: invoiced and collected, busier in the building season (seasonal ages).
  add(72, { stage: "completed", label: "Completed and paid (history)", ageMin: 120, ageMax: 735, invoices: 2, seasonal: true });
  return s;
}

/** Share of work that starts in each month (Jan..Dec): a northern building season. */
const SEASON = [0.35, 0.35, 0.55, 0.8, 1, 1, 1, 1, 0.95, 0.85, 0.6, 0.4];

// ── Builder ──────────────────────────────────────────────────────────────────────────────────────
export interface BuildOptions { kind: DemoKind; namespace: string; anchor: string; seedVersion?: string }

export function buildDemoDataset(o: BuildOptions): DemoDataset {
  const seedVersion = o.seedVersion ?? DEMO_SEED_VERSION;
  const r = prng(`${seedVersion}:${o.kind}`);           // content: same for every workspace of a kind
  const id = (key: string) => demoId(o.namespace, key); // ids: unique per workspace
  const practice = o.kind === "practice";
  const today = o.anchor;

  const companyName = practice ? "Practice Builders (sample)" : "Northfield Ridge Builders (Demo)";
  const businessProfile: BusinessProfile = {
    companyName,
    contactName: practice ? "You (practice)" : "Demo Owner",
    email: practice ? "practice@example.com" : "office@example.com",
    phone: fictionalPhone(0),
    address: "100 Demo Way, Maple Hollow",
    website: "https://example.com",
    licenseNumber: "DEMO-000000",
    tagline: "Sample company for demonstration only",
    primaryColor: "#0B2D4D",
    secondaryColor: "#14B8A6",
    logoLayout: "left",
    headerStyle: "solid",
  };
  const business = {
    company_name: businessProfile.companyName, contact_name: businessProfile.contactName, email: businessProfile.email, phone: businessProfile.phone,
    address: businessProfile.address, website: businessProfile.website, license_number: businessProfile.licenseNumber, tagline: businessProfile.tagline,
    description: "Fictional company used for Built2Bid demonstrations. Every customer, price and message is sample data.",
    primary_color: businessProfile.primaryColor, secondary_color: businessProfile.secondaryColor, primary_trade: practice ? "decks" : "general-contracting",
  };

  // Team -------------------------------------------------------------------------------------------
  const resources: DemoResource[] = [
    ...STAFF.map((s, i): DemoResource => ({
      id: id(`staff:${i}`), kind: "staff", name: s.name, trades: [...s.trades],
      email: `${s.name.split(" ")[0].toLowerCase()}@example.com`, phone: fictionalPhone(10 + i),
      employee: { title: s.title, payType: s.pay, hourlyCost: s.rate, hireDate: addDays(today, -(200 + i * 137)) },
    })),
    ...SUBS.map((s, i): DemoResource => ({
      id: id(`sub:${i}`), kind: "subcontractor", name: s.name, contactName: s.contact, trades: [...s.trades],
      email: `office@${["example.com", "example.net", "example.org"][i % 3]}`, phone: fictionalPhone(30 + i), notes: "Sample subcontractor (fictional).", entity: "company",
    })),
  ];

  // Customers --------------------------------------------------------------------------------------
  const customerCount = 150;
  const customers: DemoCustomer[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < customerCount; i++) {
    const business = i % 30 === 7;
    let name = "";
    for (let tries = 0; tries < 20 && (!name || usedNames.has(name)); tries++) name = business ? BUSINESS_NAMES[(i / 30) | 0] ?? `${r.pick(LAST)} Holdings` : `${r.pick(FIRST)} ${r.pick(LAST)}`;
    usedNames.add(name);
    const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
    customers.push({
      id: id(`customer:${i}`), name, customerType: business ? "business" : "person", companyName: business ? name : undefined,
      email: `${slug}@${EMAIL_DOMAINS[i % 3]}`, phone: fictionalPhone(i),
      address: `${100 + ((i * 37) % 9800)} ${r.pick(STREETS)}, ${r.pick(TOWNS)}`,
      notes: i % 9 === 0 ? "Prefers text messages in the afternoon. (sample note)" : undefined,
      createdAt: "", // filled from their first bid or lead date below
    });
  }

  // Estimates --------------------------------------------------------------------------------------
  const plan = ownerPlan();
  const estimates: DemoEstimate[] = [];
  const schedules: DemoSchedule[] = [];
  const invoices: DemoInvoice[] = [];
  const config0 = defaultProposalConfig();
  // Repeat customers: the first 18 customers get a second bid; leads (no bid) are the last ones.
  const bidCustomer = (i: number) => (i < 107 ? i : (i - 107) % 18);
  const staffFor = (trade: string) => resources.filter((x) => x.kind === "staff" && x.trades.includes(trade));
  const subsFor = (trade: string) => resources.filter((x) => x.kind === "subcontractor" && x.trades.includes(trade));

  // History is spread evenly through the season curve (a steady, believable flow of work), not clumped at random.
  const seasonalCount = plan.filter((x) => x.seasonal).length;
  let seasonalIdx = 0;
  const seasonalAge = (slot: Slot, i: number, count: number, jitter: number) => {
    const days = Array.from({ length: slot.ageMax - slot.ageMin + 1 }, (_, k) => slot.ageMin + k);
    const w = days.map((age) => SEASON[new Date(`${addDays(today, -age)}T12:00:00Z`).getUTCMonth()]);
    const total = w.reduce((x, y) => x + y, 0);
    let target = ((i + 0.25 + jitter * 0.5) / count) * total;
    for (let k = days.length - 1; k >= 0; k--) { target -= w[k]; if (target <= 0) return days[k]; }   // oldest first
    return slot.ageMin;
  };
  plan.forEach((slot, n) => {
    const recipe: JobRecipe = r.weighted(RECIPES);
    const cust = customers[bidCustomer(n)];
    const age = slot.seasonal ? seasonalAge(slot, seasonalIdx++, seasonalCount, r.next()) : r.int(slot.ageMin, slot.ageMax);
    const created = addDays(today, -age);
    const eid = id(`estimate:${n}`);
    const last = cust.customerType === "business" ? cust.name.split(" ")[0] : cust.name.split(" ").slice(-1)[0];
    const groups: EstimateGroup[] = [];
    const items: LineItem[] = [];
    recipe.groups.forEach((g, gi) => {
      const gid = id(`estimate:${n}:g${gi}`);
      groups.push({ id: gid, name: g.name, sortOrder: gi, visibility: null, trade: recipe.trade });
      g.items.forEach(([name, unit, costType, min, max, unitCost], ii) => {
        const qty = min === max ? min : Number((min + r.next() * (max - min)).toFixed(min < 10 ? 0 : 0));
        items.push({
          id: id(`estimate:${n}:g${gi}:i${ii}`), groupId: gid, name, costType,
          treatment: costType === "permit" ? "pass_through" : "marked_up",
          quantity: String(Math.max(min, qty)), unit, unitCost: String(unitCost), taxable: costType === "material", showOnProposal: true, sortOrder: ii,
        });
      });
    });
    // A third of drafts are still being priced: the last section has no prices yet.
    if (slot.stage === "draft" && n % 3 === 0) {
      const lastGroup = groups[groups.length - 1].id;
      for (const it of items) if (it.groupId === lastGroup) it.unitCost = "";
    }
    const estimate: Estimate = {
      id: eid,
      title: recipe.title.replace("{last}", last),
      trades: [recipe.trade],
      estimateNumber: `${practice ? "PR" : "NR"}-${1001 + n}`,
      estimateDate: created,
      expirationDate: addDays(created, 30),
      status: slot.stage === "draft" || slot.stage === "ready_for_review" ? "draft" : "finalized",
      customer: { name: cust.name, email: cust.email, phone: cust.phone, projectAddress: cust.address },
      location: { city: cust.address.split(", ")[1], state: "MN" },
      pricing: { mode: "markup", percent: String(recipe.markup) },
      fixedAdjustment: "0",
      taxRate: "6.875",
      displayMode: "by_group",
      defaultGroupVisibility: "names_only",
      groups,
      items,
      templateRef: { trade: recipe.trade, version: 1 },
      customerId: cust.id,
    };
    const config: ProposalConfig = {
      ...config0,
      introduction: `Thank you for considering ${companyName.replace(" (Demo)", "").replace(" (sample)", "")}. This sample proposal is for demonstration only.`,
      scopeOfWork: recipe.scope,
      terms: "Sample terms for demonstration only. Not an offer.",
    };
    const totals = computeEstimate(estimate);
    const sectionTrades = Object.fromEntries(groups.map((g) => [g.id, recipe.trade]));
    const payload = { ...estimate, proposalConfig: { ...config, worksheet: { sectionTrades } } };
    let version: DemoVersion | null = null;
    if (estimate.status === "finalized") {
      const snapshot = versionSnapshot(estimate, businessProfile, config);
      const proposal = buildProposal(estimate, businessProfile, config);
      version = {
        contentHash: contentHash(snapshot), snapshot, proposal,
        totalCost: totals.totalCost.toFixed(2), subtotal: totals.subtotal.toFixed(2), tax: totals.tax.toFixed(2), total: totals.total.toFixed(2),
        createdAt: at(addDays(created, 1), 16),
      };
    }

    // Stage history, oldest first, never in the future.
    const stages: DemoEstimate["stages"] = [];
    const clamp = (d: string) => (d > today ? today : d);
    const sentOn = clamp(addDays(created, 1));
    const wonOn = clamp(addDays(created, r.int(4, 12)));
    if (slot.stage === "ready_for_review") stages.push({ stage: "ready_for_review", at: at(clamp(addDays(created, 1)), 17) });
    if (slot.stage === "approved") stages.push({ stage: "ready_for_review", at: at(created, 17) }, { stage: "approved", at: at(clamp(addDays(created, 1)), 10) });
    if (["sent", "pending", "lost", "won", "scheduled", "in_progress", "completed"].includes(slot.stage)) stages.push({ stage: "sent", at: at(sentOn, 16) });
    if (slot.stage === "pending") stages.push({ stage: "pending", at: at(clamp(addDays(sentOn, 3)), 11), note: "Customer reviewing with spouse (sample note)" });
    if (slot.stage === "lost") stages.push({ stage: "lost", at: at(clamp(addDays(sentOn, r.int(5, 20))), 10), note: r.pick(["Went with a lower bid (sample)", "Project postponed to next year (sample)", "Chose a different material (sample)"]) });
    if (["won", "scheduled", "in_progress", "completed"].includes(slot.stage)) stages.push({ stage: "won", at: at(wonOn, 13), note: "Accepted by customer (simulated, no real signature)" });

    // Schedule (Project Command Center) and job stages.
    if (slot.schedule) {
      const span = r.int(recipe.days[0], recipe.days[1]);
      let start: string;
      if (slot.stage === "scheduled") start = nonWeekend(addDays(today, r.int(2, 24)));
      else if (slot.stage === "in_progress") start = nonWeekend(addDays(today, -Math.max(1, Math.round(span * (slot.delayed ? 0.75 : 0.45)))));
      else start = nonWeekend(addDays(wonOn, r.int(7, 20)));
      if (slot.stage === "completed" && addWorkdays(start, span) >= today) start = nonWeekend(addDays(today, -(span * 2 + 10)));
      const tasks: DemoTask[] = [];
      let cursor = start;
      groups.forEach((g, gi) => {
        const share = Math.max(1, Math.round(span / groups.length));
        const gStart = cursor, gEnd = addWorkdays(gStart, share - 1);
        tasks.push({ key: `s${gi}`, kind: "section", sourceGroupId: g.id, name: g.name, sortOrder: gi, plannedStart: gStart, plannedEnd: gEnd, durationDays: share });
        items.filter((it) => it.groupId === g.id).slice(0, 3).forEach((it, ii) => {
          tasks.push({ key: `s${gi}i${ii}`, kind: "item", parentKey: `s${gi}`, sourceGroupId: g.id, sourceItemId: it.id, name: it.name, sortOrder: ii, plannedStart: gStart, plannedEnd: gEnd, durationDays: share });
        });
        cursor = addWorkdays(gEnd, 1);
      });
      const end = tasks.reduce((m, t) => (t.plannedEnd > m ? t.plannedEnd : m), start);
      const progress: DemoSchedule["progress"] = tasks.map((t) => {
        if (slot.stage === "completed") return { key: t.key, status: "complete", percent: 100, actualStart: t.plannedStart, actualFinish: t.plannedEnd };
        if (slot.stage === "scheduled" || t.plannedStart > today) return { key: t.key, status: "not_started", percent: 0 };
        if (t.plannedEnd < today && !slot.delayed) return { key: t.key, status: "complete", percent: 100, actualStart: t.plannedStart, actualFinish: t.plannedEnd };
        if (slot.delayed && t.plannedEnd < today) return { key: t.key, status: "delayed", percent: 60, actualStart: t.plannedStart, notes: "Waiting on back-ordered materials (sample)" };
        return { key: t.key, status: "in_progress", percent: 40, actualStart: t.plannedStart };
      });
      const assign: DemoSchedule["assign"] = [];
      tasks.filter((t) => t.kind === "section").forEach((t, k) => {
        const g = groups.find((x) => x.id === t.sourceGroupId)!;
        const subcontracted = items.some((it) => it.groupId === g.id && it.costType === "subcontractor");
        const pool = subcontracted ? subsFor(recipe.trade).concat(subsFor("general-contracting")) : staffFor(recipe.trade);
        const who = (pool.length ? pool : resources.filter((x) => x.kind === "staff"))[(n + k) % Math.max(1, (pool.length || 8))];
        if (who) assign.push({ key: t.key, resourceId: who.id, status: slot.stage === "scheduled" && k > 0 ? "tentative" : "confirmed" });
      });
      schedules.push({
        estimateId: eid, name: estimate.title, startDate: start, targetEndDate: end, active: true, tasks, progress, assign,
        closeout: slot.stage === "completed" ? { actualFinish: end } : null,
      });
      stages.push({ stage: "scheduled", at: at(clamp(addDays(wonOn, 1)), 9) });
      if (slot.stage === "in_progress" || slot.stage === "completed") stages.push({ stage: "in_progress", at: at(clamp(start), 8) });
      if (slot.stage === "completed") stages.push({ stage: "completed", at: at(clamp(addDays(end, 1)), 17) });
    } else if (slot.stage === "completed") {
      const done = clamp(addDays(wonOn, r.int(14, 45)));
      stages.push({ stage: "scheduled", at: at(clamp(addDays(wonOn, 2)), 9) }, { stage: "in_progress", at: at(clamp(addDays(wonOn, 8)), 8) }, { stage: "completed", at: at(done, 17) });
    }

    // Invoices (Financials): deposit at the payment schedule's first percent, final for the balance.
    if (slot.invoices && version) {
      const total = Number(version.total);
      const depositPct = Number(config.paymentSchedule[0]?.percent ?? 30) / 100;
      const deposit = Math.round(total * depositPct * 100) / 100;
      const depDate = clamp(addDays(wonOn, 1));
      const sched = schedules.find((s) => s.estimateId === eid);
      const pays = slot.label !== "Delayed" || n % 2 === 0;
      invoices.push({
        estimateId: eid, kind: "deposit", issueDate: depDate, dueDate: addDays(depDate, 7), memo: "Deposit due at signing (sample invoice)",
        lines: [{ description: `${config.paymentSchedule[0]?.label ?? "Deposit"} (${config.paymentSchedule[0]?.percent ?? 30}%)`, quantity: "1", unitPrice: money(deposit), taxable: false }],
        payment: pays ? { amount: money(deposit), receivedOn: clamp(addDays(depDate, r.int(1, 6))), method: r.pick(["check", "ach", "card"] as const), reference: `SIM-${1000 + n}` } : null,
      });
      if (slot.invoices > 1) {
        const finalDate = clamp(sched?.closeout ? addDays(sched.closeout.actualFinish, 1) : addDays(wonOn, r.int(20, 50)));
        const balance = Math.round((total - deposit) * 100) / 100;
        const paid = slot.label.startsWith("Completed and paid") || n % 3 !== 0;
        invoices.push({
          estimateId: eid, kind: "final", issueDate: finalDate, dueDate: addDays(finalDate, 15), memo: "Balance due at completion (sample invoice)",
          lines: [{ description: "Balance due at completion", quantity: "1", unitPrice: money(balance), taxable: false }],
          payment: paid ? { amount: money(balance), receivedOn: clamp(addDays(finalDate, r.int(2, 12))), method: r.pick(["check", "ach", "card"] as const), reference: `SIM-${5000 + n}` } : null,
        });
      }
    }

    estimates.push({ id: eid, customerId: cust.id, createdAt: at(created, 14), trade: recipe.trade, total: totals.total.toNumber(), payload, version, stages, label: slot.label });
  });

  // Customer created dates: their first bid, or a recent lead date for leads with no bid yet.
  for (const c of customers) {
    const first = estimates.filter((e) => e.customerId === c.id).map((e) => e.createdAt).sort()[0];
    c.createdAt = first ?? at(addDays(today, -r.int(0, 21)), 10);
    if (!first && !c.notes) c.notes = "New lead from the website contact form (sample).";
  }

  // Communications (history only: every message is already "sent" and nothing is queued) -------------
  const comms: DemoComm[] = [];
  {
    let k = 0;
    const push = (e: DemoEstimate, kind: DemoComm["kind"], trigger: DemoComm["trigger"], subject: string, body: string, day: string, status: DemoComm["status"] = "delivered", finTemplate?: DemoComm["finTemplate"]) => {
      const c = customers.find((x) => x.id === e.customerId)!;
      comms.push({ id: id(`comm:${k++}`), customerId: c.id, estimateId: e.id, kind, trigger, toEmail: c.email, toName: c.name, subject, body: `${body}\n\n(Sample message. Never sent to a real person.)`, status, sentAt: at(day > today ? today : day, 10 + (k % 7)), ...(finTemplate ? { finTemplate } : {}) });
    };
    for (const e of estimates) {
      const sent = e.stages.find((s) => s.stage === "sent");
      if (sent) {
        push(e, "nurture", "manual", `Your proposal: ${e.payload.title as string}`, "Hi! Your proposal is ready to review. Reply with any questions.", sent.at.slice(0, 10));
        push(e, "nurture", "manual", `Following up on your ${String(e.payload.title).toLowerCase()} proposal`, "Just checking in on the proposal we sent last week.", addDays(sent.at.slice(0, 10), 5), e.stages.some((s) => s.stage === "won") ? "replied" : "delivered");
      }
      const sch = schedules.find((s) => s.estimateId === e.id);
      if (sch && sch.startDate <= today) {
        push(e, "project_update", "weekly", `Weekly update: ${sch.name}`, "Here's where your project stands this week.", addDays(sch.startDate, 4));
        if (sch.closeout) push(e, "project_update", "milestone", `Your project is complete`, "Thank you for choosing us. We'd love a review.", sch.closeout.actualFinish);
      }
      for (const inv of invoices.filter((x) => x.estimateId === e.id)) push(e, "financial", "financial", `Invoice for ${e.payload.title as string}`, `Your ${inv.kind} invoice is ready.`, inv.issueDate, "delivered", inv.kind);
    }
  }

  addWorkforceDemo(resources, schedules, estimates, id, today);
  const fin = buildFinance({ seed: `${seedVersion}:${o.kind}:finance`, namespace: o.namespace, today, estimates, schedules, invoices, customers, resources });
  return { seedVersion, kind: o.kind, anchor: o.anchor, companyName, business, resources, customers, estimates, schedules, invoices, comms, ...fin };
}

/**
 * V7.3 Contractors & Workforce demo: Red's Electric with four electricians, a painting company with a stated
 * capacity, two concrete crews, plus assignments across active projects, including one deliberate
 * double booking for an electrician. Added after the main plan so earlier picks stay the same.
 * Companies come before their workers and crews come last (demo_apply inserts rows in order).
 */
function addWorkforceDemo(resources: DemoResource[], schedules: DemoSchedule[], estimates: DemoEstimate[], id: (k: string) => string, today: string) {
  const reds = id("wf:reds");
  const workers = ["Marco Diaz", "Tia Brooks", "Owen Castellano", "Lena Park"].map((name, i) => ({ id: id(`wf:reds:${i}`), name }));
  const paint = id("wf:paint");
  const staff = (name: string) => resources.find((x) => x.kind === "staff" && x.name === name)?.id;
  resources.push(
    { id: reds, kind: "subcontractor", entity: "company", name: "Red's Electric (sample)", contactName: "Red Alvarez", trades: ["electrical", "low-voltage"],
      specialties: ["Panel upgrades", "EV chargers"], crewSize: 4, email: "reds.office@example.com", phone: fictionalPhone(60), notes: "Sample subcontracting company (fictional)." },
    ...workers.map((w, i): DemoResource => ({ id: w.id, kind: "subcontractor", entity: "individual", parentId: reds, name: w.name, trades: i === 2 ? ["electrical", "low-voltage"] : ["electrical"],
      email: `${w.name.split(" ")[0].toLowerCase()}.reds@example.com`, phone: fictionalPhone(61 + i) })),
    { id: paint, kind: "subcontractor", entity: "company", name: "Fresh Coat Painting Co. (sample)", contactName: "Dee Hart", trades: ["painting", "drywall"],
      specialties: ["Exterior repaint", "Cabinet finishing"], capacity: 2, capacityDeclared: true, crewSize: 6, email: "freshcoat.jobs@example.net", phone: fictionalPhone(66) },
    { id: id("wf:crew:flat"), kind: "crew", name: "Flatwork Crew A (sample)", trades: ["concrete"], members: [staff("Dmitri Novak"), staff("Leo Vang")].filter((x): x is string => !!x),
      capacity: 1, capacityDeclared: true, crewSize: 3, email: "", phone: "" },
    { id: id("wf:crew:found"), kind: "crew", name: "Foundation Crew B (sample)", trades: ["concrete", "excavation"], capacity: 1, capacityDeclared: true, crewSize: 4, email: "", phone: "" },
  );
  // Sections on open (not closed-out) projects that are still ahead or underway.
  const open = schedules.filter((s) => !s.closeout).map((s) => ({ s, trade: estimates.find((e) => e.id === s.estimateId)?.trade ?? "", secs: s.tasks.filter((t) => t.kind === "section" && t.plannedEnd >= today) }));
  const put = (s: DemoSchedule, key: string, resourceId: string, status: "tentative" | "confirmed") => { s.assign = [...s.assign.filter((a) => a.key !== key), { key, resourceId, status }]; };
  const used = new Set<string>();
  const ELEC = /electric|panel|service|lighting|wiring|fixture|rough-in/i;
  const elecJob = (o: (typeof open)[number]) => /electric/.test(o.trade) || o.secs.some((t) => ELEC.test(t.name));
  // 1. A double booking: Marco on two projects whose sections overlap (electrical work first).
  const double = (strict: boolean) => {
    for (const a of open) for (const b of open) {
      if (a.s === b.s) continue;
      for (const x of a.secs) for (const y of b.secs) {
        if (strict && !(ELEC.test(x.name) || ELEC.test(y.name))) continue;
        if (x.plannedStart <= y.plannedEnd && y.plannedStart <= x.plannedEnd) {
          put(a.s, x.key, workers[0].id, "confirmed"); put(b.s, y.key, workers[0].id, "tentative");
          used.add(`${a.s.estimateId}:${x.key}`); used.add(`${b.s.estimateId}:${y.key}`);
          return true;
        }
      }
    }
    return false;
  };
  if (!double(true)) double(false);
  const pick = (pred: (o: (typeof open)[number]) => boolean) => {
    for (const o of open.filter(pred)) for (const t of o.secs) if (!used.has(`${o.s.estimateId}:${t.key}`)) { used.add(`${o.s.estimateId}:${t.key}`); return { s: o.s, t }; }
    return null;
  };
  // 2. The company itself and two more workers on other jobs; painters and crews on matching trades.
  const plan: [string, (o: (typeof open)[number]) => boolean, "tentative" | "confirmed"][] = [
    [reds, elecJob, "confirmed"], [workers[1].id, elecJob, "confirmed"], [workers[2].id, elecJob, "tentative"],
    [paint, (o) => /paint|kitchen|bath/.test(o.trade), "confirmed"], [paint, (o) => /paint|kitchen|bath/.test(o.trade), "tentative"],
    [id("wf:crew:flat"), (o) => /concrete|deck/.test(o.trade), "confirmed"], [id("wf:crew:found"), (o) => /concrete|addition|general/.test(o.trade), "tentative"],
  ];
  for (const [rid, pred, status] of plan) { const hit = pick(pred) ?? pick(() => true); if (hit) put(hit.s, hit.t.key, rid, status); }
}

// ── Simulated bank, change orders, refund and cash plan ─────────────────────────────────────────
/**
 * Built after everything else from its own random stream, so the rest of the dataset is unchanged by it.
 * Every bank line is derived from the books: deposits mirror recorded payments (same reference), job costs
 * come from each estimate's own cost lines (a few jobs overrun into a loss), labour runs through payroll,
 * and overhead, estimated tax and owner draws fill in the rest. The opening balance keeps the running
 * balance above $8,000, and month-end statement balances are exact sums, so every reconciliation balances.
 */
const BANK_DAYS_UNMATCHED = 7;
const lastName = (n: string) => n.split(" ").slice(-1)[0];
function monthEnd(d: string) { const x = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return iso(x); }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildFinance(a: { seed: string; namespace: string; today: string; estimates: DemoEstimate[]; schedules: DemoSchedule[]; invoices: DemoInvoice[]; customers: DemoCustomer[]; resources: DemoResource[] }) {
  const r = prng(a.seed);
  const { today } = a;
  const posted = addDays(today, -1);                        // the bank has posted everything through yesterday
  const startD = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); startD.setUTCMonth(startD.getUTCMonth() - 24);
  const start = iso(startD);                               // first day of the month 24 months ago
  const inRange = (d: string) => d >= start && d <= posted;
  const txns: Omit<DemoBankTxn, "txnRef">[] = [];
  const push = (date: string, description: string, amount: number, post: DemoBankPost | null, checkNumber?: string) => {
    const d = nonWeekend(date);
    if (inRange(d) && Math.abs(amount) >= 0.01) txns.push({ date: d, description: `${description} (SIMULATED)`, amount: money(amount), post, ...(checkNumber ? { checkNumber } : {}) });
  };
  const custName = (e: DemoEstimate) => a.customers.find((c) => c.id === e.customerId)?.name ?? "Customer";

  // 1. One refund: a customer overpaid a final invoice by $250 and was sent a refund check two weeks later.
  const refundInv = a.invoices.find((i) => i.kind === "final" && i.payment && i.payment.receivedOn > addDays(start, 60) && i.payment.receivedOn < addDays(today, -60)
    && a.estimates.find((e) => e.id === i.estimateId)?.label.startsWith("Completed and paid"));
  if (refundInv?.payment) refundInv.payment = { ...refundInv.payment, allocate: refundInv.payment.amount, amount: money(Number(refundInv.payment.amount) + 250) };

  // 2. Deposits mirror payments (checks clear next business day, cards settle in two).
  let check = 2101;
  for (const inv of a.invoices) {
    const p = inv.payment;
    if (!p) continue;
    const e = a.estimates.find((x) => x.id === inv.estimateId)!;
    const who = lastName(custName(e));
    if (p.method === "check") push(addDays(p.receivedOn, 1), `Mobile check deposit ${who} ${p.reference}`, Number(p.amount), { type: "payment", reference: p.reference });
    else if (p.method === "ach") push(p.receivedOn, `ACH credit ${who.toUpperCase()} ${p.reference}`, Number(p.amount), { type: "payment", reference: p.reference });
    else push(addDays(p.receivedOn, 2), `Card settlement batch ${p.reference}`, Number(p.amount), { type: "payment", reference: p.reference });
  }
  if (refundInv?.payment) {
    const e = a.estimates.find((x) => x.id === refundInv.estimateId)!;
    const n = check++;
    push(addDays(refundInv.payment.receivedOn, 14), `Check ${n} refund ${lastName(custName(e))}`, -250, { type: "refund", paymentReference: refundInv.payment.reference, amount: "250.00", reference: `SIM-R${n}` }, String(n));
  }

  // 3. Job costs from each estimate's own cost lines: supplies at the start, subcontractors at the end, labour via payroll.
  const subs = a.resources.filter((x) => x.kind === "subcontractor" && x.entity === "company");
  const laborByDay = new Map<string, number>();
  let jobNo = 0;
  for (const e of a.estimates) {
    if (!a.invoices.some((i) => i.estimateId === e.id)) continue;      // only jobs with a job in the books
    const st = Object.fromEntries(e.stages.map((s) => [s.stage, s.at.slice(0, 10)]));
    const sch = a.schedules.find((s) => s.estimateId === e.id);
    const jobStart = sch?.startDate ?? st.in_progress;
    if (!jobStart || jobStart > posted) continue;
    const jobEnd = sch?.closeout?.actualFinish ?? (st.completed ?? null);
    const cost: Record<string, number> = {};
    for (const it of (e.payload.items as { costType: string; quantity: string; unitCost: string }[])) cost[it.costType] = (cost[it.costType] ?? 0) + Number(it.quantity || 0) * Number(it.unitCost || 0);
    const k = jobNo++;
    const factor = k % 7 === 3 ? 1.12 + r.next() * 0.08 : 0.9 + r.next() * 0.14;   // every 7th job overruns (and, once finished, ends in a loss)
    const title = String(e.payload.title);
    const supplies = ((cost.material ?? 0) + (cost.equipment ?? 0) + (cost.other ?? 0)) * factor;
    const end = jobEnd ?? null;
    const span = Math.max(3, end ? Math.round((Date.parse(end) - Date.parse(jobStart)) / DAY) : 21);
    if (cost.permit) push(addDays(jobStart, -6), `City of Maple Hollow permit ${title}`, -cost.permit, { type: "expense", payee: "City of Maple Hollow (sample)", description: `Permit: ${title}`, estimateId: e.id });
    if (supplies > 0) {
      push(addDays(jobStart, -2), `Maple Hollow Lumber & Supply ${title}`, -supplies * 0.7, { type: "expense", payee: "Maple Hollow Lumber & Supply (sample)", description: `Materials: ${title}`, estimateId: e.id });
      push(addDays(jobStart, Math.round(span / 2)), `Maple Hollow Lumber & Supply ${title}`, -supplies * 0.3, { type: "expense", payee: "Maple Hollow Lumber & Supply (sample)", description: `Materials (second delivery): ${title}`, estimateId: e.id });
    }
    if (cost.subcontractor) {
      const sub = subs[k % Math.max(1, subs.length)]?.name ?? "Subcontractor (sample)";
      const n = check++;
      if (end) push(addDays(end, 5), `Check ${n} ${sub}`, -cost.subcontractor * factor, { type: "expense", payee: sub, description: `Subcontract: ${title}`, estimateId: e.id }, String(n));
      else push(addDays(jobStart, Math.round(span / 2)), `Check ${n} ${sub} progress payment`, -cost.subcontractor * factor * 0.5, { type: "expense", payee: sub, description: `Subcontract progress (50%): ${title}`, estimateId: e.id }, String(n));
    }
    // Loss-making jobs: rework after a failed inspection pushes job costs past the contract price.
    if (k % 7 === 3 && end) {
      const booked = (cost.permit ?? 0) + supplies + (cost.subcontractor ?? 0) * factor;
      const rework = e.total * (1.04 + r.next() * 0.1) - booked;
      if (rework > 0) push(addDays(end, -3), `Maple Hollow Lumber & Supply rework ${title}`, -rework, { type: "expense", payee: "Maple Hollow Lumber & Supply (sample)", description: `Rework after failed inspection (overtime crew and replacement materials): ${title}`, estimateId: e.id });
    }
    const labor = (cost.labor ?? 0) * factor;
    for (let d = 0; d < span; d++) laborByDay.set(addDays(jobStart, d), (laborByDay.get(addDays(jobStart, d)) ?? 0) + labor / span);
  }

  // 4. Payroll every other Friday (office wages + crew labour earned in the period), tax deposit the next day.
  let payday = start;
  while (new Date(`${payday}T12:00:00Z`).getUTCDay() !== 5) payday = addDays(payday, 1);
  const payrolls: number[] = [];
  for (; payday <= posted; payday = addDays(payday, 14)) {
    let crew = 0;
    for (let d = 1; d <= 14; d++) crew += laborByDay.get(addDays(payday, -d)) ?? 0;
    const gross = 1650 + crew;                                 // part-time office help + crew
    payrolls.push(gross);
    push(payday, "Payroll direct deposits", -gross * 0.8, { type: "expense", payee: "Payroll (sample)", description: "Net wages, two-week pay period" });
    push(addDays(payday, 1), "Federal and state payroll tax deposit", -gross * 0.2, { type: "expense", payee: "Payroll taxes (sample)", description: "Withholding and employer payroll taxes" });
  }

  // 5. Overhead, seasonal utilities and fuel, quarterly estimated tax, quarterly owner draw (excluded: not a business expense).
  for (let m = start; m <= posted; m = addDays(monthEnd(m), 1)) {
    const mo = new Date(`${m}T12:00:00Z`).getUTCMonth();
    const day = (n: number) => `${m.slice(0, 8)}${String(n).padStart(2, "0")}`;
    const winter = [0, 1, 2, 10, 11].includes(mo);
    push(day(1), "Shop rent 100 Demo Way", -2200, { type: "expense", payee: "Demo Way Properties (sample)", description: "Shop and yard rent" });
    push(day(3), "Software subscriptions", -189, { type: "expense", payee: "Software (sample)", description: "Estimating, accounting and phone apps" });
    push(day(5), "General liability insurance", -640, { type: "expense", payee: "Insurance (sample)", description: "Monthly liability and auto insurance" });
    push(day(12), "Truck loan payment", -815, { type: "expense", payee: "Truck loan (sample)", description: "Work truck loan payment" });
    push(day(18), "Phone and internet", -212.4, { type: "expense", payee: "Phone and internet (sample)", description: "Phones and shop internet" });
    push(day(22), "Shop utilities", -(winter ? 380 + r.int(0, 90) : 170 + r.int(0, 60)), { type: "expense", payee: "Utilities (sample)", description: "Shop heat and electric" });
    for (const d of [4, 11, 18, 25]) push(day(d), "Fuel", -(winter ? 120 : 190) - r.int(0, 80), { type: "expense", payee: "Fuel (sample)", description: "Truck fuel" });
    push(monthEnd(m), "Monthly service fee", -15, { type: "expense", payee: "Maple Hollow Community Bank (SIMULATED)", description: "Bank service fee" });
    if ([0, 3, 5, 8].includes(mo)) push(day(15), "Estimated tax payment", -(1800 + r.int(0, 1400)), { type: "expense", payee: "Estimated income tax (sample)", description: "Quarterly estimated tax" });
    if ([2, 5, 8, 11].includes(mo)) push(day(27), "Online transfer to personal savings", -3000, { type: "excluded", reason: "owner", note: "Owner draw to the owner's personal account (sample)" });
  }

  // 6. Order, refs, opening balance (running balance never below $8,000), monthly statements.
  txns.sort((x, y) => (x.date === y.date ? Number(y.amount) - Number(x.amount) : x.date < y.date ? -1 : 1));
  let run = 0, min = 0;
  for (const t of txns) { run = Math.round((run + Number(t.amount)) * 100) / 100; min = Math.min(min, run); }
  const opening = Math.max(18000, Math.ceil((8000 - min) / 500) * 500);
  const all: DemoBankTxn[] = txns.map((t, i) => ({ ...t, txnRef: `sim-${a.namespace.slice(0, 8)}-${String(i + 1).padStart(5, "0")}`, post: t.date > addDays(today, -BANK_DAYS_UNMATCHED) ? null : t.post }));
  const statements: DemoBankStatement[] = [];
  let bal = opening;
  for (let m = start; m <= posted; m = addDays(monthEnd(m), 1)) {
    const end = monthEnd(m) > posted ? posted : monthEnd(m);
    const rows = all.filter((t) => t.date >= m && t.date <= end);
    bal = Math.round((bal + rows.reduce((s, t) => s + Number(t.amount), 0)) * 100) / 100;
    const mo = new Date(`${m}T12:00:00Z`);
    statements.push({ label: `${MONTHS[mo.getUTCMonth()]} ${mo.getUTCFullYear()}${end < monthEnd(m) ? " (month to date)" : ""}`, start: m, end, closingBalance: money(bal), transactions: rows });
  }
  // Reconciled through the last month end at least 20 days back; the newest lines are left to match.
  const reconcile = statements.filter((s) => s.end === monthEnd(s.start) && s.end <= addDays(today, -20)).map((s) => ({ periodEnd: s.end, statementBalance: s.closingBalance }));
  const bank: DemoBank = {
    institution: "Maple Hollow Community Bank (SIMULATED)", accountName: "Business Checking (SIMULATED)", mask: "0000", itemRef: `demo-sim:${a.namespace}`,
    openingBalance: money(opening), currentBalance: money(bal), availableBalance: money(bal - 350), asOf: `${today}T13:00:00Z`, statements, reconcile,
  };

  // 7. Change orders on jobs underway: two approved, one waiting on the customer, one declined.
  const underway = a.estimates.filter((e) => e.stages.some((s) => s.stage === "in_progress") && !e.stages.some((s) => s.stage === "completed") && e.version);
  const coSpecs: Omit<DemoChangeOrder, "estimateId">[] = [
    { title: "Add recessed lighting (sample)", description: "Customer asked for six extra recessed lights.", lines: [{ kind: "add", description: "Six LED recessed lights, wiring and trim", amount: "1180.00" }], scheduleDays: 1, outcome: "approved", note: "Customer approved on site (simulated, no real signature)" },
    { title: "Hidden rot repair (sample)", description: "Rotted framing found behind the old finish.", lines: [{ kind: "add", description: "Replace rotted framing and sheathing", amount: "2460.00" }, { kind: "remove", description: "Credit: reuse existing trim", amount: "-320.00" }], scheduleDays: 2, outcome: "approved", note: "Approved by phone, confirmed by email (simulated)" },
    { title: "Upgrade to premium finish (sample)", description: "Option offered at the customer's request.", lines: [{ kind: "modify", description: "Premium finish instead of standard", amount: "1875.00" }], scheduleDays: 0, outcome: "sent", note: "" },
    { title: "Extra outlet circuit (sample)", description: "Customer decided against the extra circuit.", lines: [{ kind: "add", description: "Dedicated 20A circuit and two outlets", amount: "640.00" }], scheduleDays: 0, outcome: "declined", note: "Customer declined (simulated)" },
  ];
  const changeOrders: DemoChangeOrder[] = coSpecs.map((c, i) => (underway[i] ? { ...c, estimateId: underway[i].id } : null)).filter((x): x is DemoChangeOrder => !!x);

  // 8. Forward cash plan (the forecast's scheduled outflows); the bank feed above is the past.
  const avgPay = payrolls.slice(-6).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(6, payrolls.length));
  const nextPay = payday;
  const nextMonth = addDays(monthEnd(today), 1);
  const nextTaxMonth = [0, 3, 5, 8].map((mo) => { const y = Number(today.slice(0, 4)) + (mo < new Date(`${today}T12:00:00Z`).getUTCMonth() || (mo === new Date(`${today}T12:00:00Z`).getUTCMonth() && Number(today.slice(8)) >= 15) ? 1 : 0); return `${y}-${String(mo + 1).padStart(2, "0")}-15`; }).sort()[0];
  const cashPlan: DemoCashEvent[] = [
    { kind: "payroll", label: "Payroll (sample)", amount: money(avgPay), expectedOn: nextPay, recurrence: "biweekly", note: "Average of the last six pay periods, wages plus payroll taxes (sample)" },
    { kind: "recurring_expense", label: "Shop rent (sample)", amount: "2200.00", expectedOn: nextMonth, recurrence: "monthly", note: "Sample overhead" },
    { kind: "recurring_expense", label: "Insurance (sample)", amount: "640.00", expectedOn: addDays(nextMonth, 4), recurrence: "monthly", note: "Sample overhead" },
    { kind: "recurring_expense", label: "Truck loan (sample)", amount: "815.00", expectedOn: addDays(nextMonth, 11), recurrence: "monthly", note: "Sample overhead" },
    { kind: "other_outflow", label: "Estimated income tax (sample)", amount: "2500.00", expectedOn: nextTaxMonth, recurrence: "none", note: "Next quarterly estimate (sample)" },
  ];
  return { bank, changeOrders, cashPlan };
}

/** Counts by area, for the README, the Demo panel and tests. */
export function datasetSummary(d: DemoDataset) {
  return {
    customers: d.customers.length,
    estimates: d.estimates.length,
    projects: d.estimates.filter((e) => e.stages.some((s) => s.stage === "won")).length,
    schedules: d.schedules.length,
    invoices: d.invoices.length,
    employees: d.resources.filter((x) => x.kind === "staff").length,
    subcontractors: d.resources.filter((x) => x.kind === "subcontractor").length,
    crews: d.resources.filter((x) => x.kind === "crew").length,
    communications: d.comms.length,
    bankTransactions: d.bank.statements.reduce((n, s) => n + s.transactions.length, 0),
    bankStatements: d.bank.statements.length,
    reconciliations: d.bank.reconcile.length,
    changeOrders: d.changeOrders.length,
  };
}
