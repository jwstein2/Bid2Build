/**
 * Example estimate for a bid-check result: built from the contractor's trade, kind of job and pain
 * point, with that pain point broken out into separate labor and material lines and every other part
 * kept as a package line. Rendered with the real estimate engine and proposal renderer, and openable
 * in the real builder. Prices are examples only and labelled as such everywhere they appear.
 */
import type { CostType, Estimate, EstimateGroup, LineItem } from "../estimate/types";
import { defaultProposalConfig, type BusinessProfile, type ProposalConfig } from "../proposal/types";
import { getBank, painsFor, type TradeBank } from "./banks";
import { focusOf, isGoal } from "./engine";
import type { Answers, SampleLine } from "./types";

export interface Sample {
  estimate: Estimate;
  config: ProposalConfig;
  business: BusinessProfile;
  /** Section broken out for the pain point (id), if any. */
  focusGroupId: string | null;
  focusGroupName: string | null;
}

const LUMP = "lump sum";
const roundMoney = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n * 100) / 100);

function scaleLine([name, unit, cost, qty, unitCost]: SampleLine, scale: number | undefined): SampleLine {
  if (!scale || scale === 1) return [name, unit, cost, qty, unitCost];
  // A lump sum scales by price; anything counted scales by quantity (whole units, at least one).
  if (unit === LUMP || qty === 1) return [name, unit, cost, 1, roundMoney(unitCost * scale)];
  return [name, unit, cost, Math.max(1, Math.ceil(qty * scale)), unitCost];
}

export const SAMPLE_BUSINESS: BusinessProfile = {
  companyName: "Example Builders Co.",
  phone: "(555) 010-0100",
  email: "office@example.com",
  primaryColor: "#0B2D4D",
  secondaryColor: "#14B8A6",
  logoLayout: "left",
  headerStyle: "solid",
};

/** Deeper-path answers that change the example (material choice, allowances at cost, margin pricing). */
function adjust(bank: TradeBank, a: Answers, line: SampleLine): { line: SampleLine; passThrough?: boolean } {
  const [name, unit, cost, qty, unitCost] = line;
  if (bank.key === "decks" && /composite/i.test(name)) {
    const deep = a["decks.deep"];
    if (deep === "pt") return { line: [name.replace(/composite/i, "pressure-treated"), unit, cost, qty, roundMoney(unitCost * 0.45)] };
    if (deep === "hardwood") return { line: [name.replace(/composite/i, "cedar"), unit, cost, qty, roundMoney(unitCost * 0.85)] };
  }
  if (bank.key === "remodeling" && a["remodeling.follow.profit.allowances"] === "no" && /allowance/i.test(name)) return { line, passThrough: true };
  return { line };
}

/** The example estimate for these answers, or null for trades without a priced example. */
export function buildSample(answers: Answers, now = new Date()): Sample | null {
  const f = focusOf(answers);
  if (!f || f.kind !== "bank") return null;
  const bank = getBank(f.key)!;
  const job = bank.jobs.find((j) => j.value === answers[`${bank.key}.job`]) ?? bank.jobs[0];
  const pain = painsFor(bank, job.value).find((p) => p.value === answers[`${bank.key}.pain`]);
  const goal = isGoal(answers.goal) ? answers.goal : "speed";

  const groups: EstimateGroup[] = [];
  const items: LineItem[] = [];
  let focusGroupId: string | null = null;
  let focusGroupName: string | null = null;
  job.areas.forEach((areaKey, gi) => {
    const area = job.overrides?.[areaKey] ?? bank.areas[areaKey];
    if (!area) return;
    const isFocus = pain?.area === areaKey;
    const gid = `g${gi}`;
    if (isFocus) { focusGroupId = gid; focusGroupName = area.group; }
    groups.push({
      id: gid, name: area.group, sortOrder: gi, trade: job.templateSlug ?? bank.catalogSlug,
      // The pain point is itemized; everything else shows as a package total on the proposal.
      visibility: isFocus ? "itemized" : goal === "proposals" ? "names_only" : "group_total",
    });
    (isFocus ? area.detail : area.pkg).forEach((raw, ii) => {
      const { line, passThrough } = adjust(bank, answers, scaleLine(raw, job.scale));
      const [name, unit, cost, qty, unitCost] = line;
      const costType = cost as CostType;
      items.push({
        id: `${gid}i${ii}`, groupId: gid, name, costType,
        treatment: passThrough || costType === "permit" ? "pass_through" : "marked_up",
        quantity: String(qty), unit, unitCost: String(unitCost), taxable: costType === "material",
        showOnProposal: true, sortOrder: ii,
      });
    });
  });

  const marginPricing = answers["follow.profit"] === "margin";
  const iso = now.toISOString().slice(0, 10);
  const estimate: Estimate = {
    id: "bid-check-sample",
    title: job.title,
    trades: [job.templateSlug ?? bank.catalogSlug],
    estimateNumber: "EST-EXAMPLE",
    estimateDate: iso,
    expirationDate: new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
    status: "draft",
    customer: { name: "Example Customer", projectAddress: "123 Sample Street" },
    location: {},
    pricing: marginPricing ? { mode: "margin", percent: "25" } : { mode: "markup", percent: "25" },
    fixedAdjustment: "0",
    taxRate: "0",
    displayMode: "by_group",
    defaultGroupVisibility: "group_total",
    groups,
    items,
    templateRef: { trade: job.templateSlug ?? bank.catalogSlug, version: 1 },
  };

  const config: ProposalConfig = {
    ...defaultProposalConfig(),
    introduction: "Example proposal for illustration only. Not a real customer or real pricing.",
    scopeOfWork: job.scope,
    allowances: bank.key === "remodeling" ? "Allowances are budgets for items the customer selects. If a selection costs more or less than its allowance, the difference is added or credited by written change order." : "",
    terms: "Example terms for illustration only.",
  };
  return { estimate, config, business: SAMPLE_BUSINESS, focusGroupId, focusGroupName };
}

/** A copy that can be opened in the builder as the visitor's own draft (fresh id, clear title). */
export function sampleForBuilder(s: Sample, newId: string): { estimate: Estimate; proposalConfig: ProposalConfig } {
  return {
    estimate: { ...s.estimate, id: newId, title: `Example: ${s.estimate.title}` },
    proposalConfig: s.config,
  };
}
