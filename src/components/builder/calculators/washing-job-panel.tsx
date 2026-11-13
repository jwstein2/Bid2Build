"use client";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Plus, ShieldCheck } from "lucide-react";
import { useMemo, useState, type Dispatch } from "react";
import { computeEstimate } from "@/lib/estimate/engine";
import { newGroup, uid } from "@/lib/estimate/factory";
import { D, formatCurrency, toDec } from "@/lib/estimate/money";
import type { Estimate } from "@/lib/estimate/types";
import { cn } from "@/lib/cn";
import { Button } from "../../ui/button";
import type { Action } from "../state";

/**
 * Job setup for the Pressure Washing and Soft Washing trades. Collapsed by default.
 *  - Adds a cleaning area as an ordinary line item (surface, condition and access in its
 *    description) with NO price: the contractor enters their own rate.
 *  - Optional "quote my rate directly" (0% markup on the cleaning section).
 *  - Minimum job charge, applied deliberately as a labeled project adjustment.
 * Never recommends chemicals, mixtures, pressure settings or application methods.
 */
export const WASHING_TRADES = ["pressure-washing", "soft-washing"] as const;
export const MINIMUM_LABEL = "Minimum job charge";

type Pricing = "sf" | "lf" | "flat";
interface AreaKind { value: string; label: string; item: string; group: string; pricing: Pricing; roof?: boolean }

const PRESSURE_AREAS: AreaKind[] = [
  { value: "driveway", label: "Driveway", item: "Driveway cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "sidewalk", label: "Sidewalk / walkway", item: "Sidewalk and walkway cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "patio", label: "Patio", item: "Patio cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "concrete", label: "Other concrete surface", item: "Concrete surface cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "pavers", label: "Pavers", item: "Paver cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "deck", label: "Deck", item: "Deck cleaning", group: "Cleaning Areas", pricing: "sf" },
  { value: "fence", label: "Fence", item: "Fence cleaning", group: "Cleaning Areas", pricing: "lf" },
  { value: "other", label: "Other surface", item: "Custom surface cleaning", group: "Cleaning Areas", pricing: "sf" },
];
const SOFT_AREAS: AreaKind[] = [
  { value: "siding", label: "House siding", item: "House siding soft wash", group: "Wall & Siding Cleaning", pricing: "sf" },
  { value: "walls", label: "Exterior walls", item: "Exterior wall cleaning", group: "Wall & Siding Cleaning", pricing: "sf" },
  { value: "roof", label: "Roof", item: "Roof soft wash", group: "Roof Cleaning", pricing: "sf", roof: true },
  { value: "fence", label: "Fence", item: "Fence soft wash", group: "Other Surfaces", pricing: "lf" },
  { value: "other", label: "Other compatible surface", item: "Other compatible surface", group: "Other Surfaces", pricing: "sf" },
];

const PRESSURE_SURFACES = ["Concrete", "Pavers", "Brick", "Natural stone", "Asphalt", "Wood", "Composite", "Vinyl", "Other"];
const SOFT_SURFACES = ["Vinyl siding", "Fiber cement", "Wood", "Stucco", "Brick", "Stone", "EIFS", "Painted surface", "Asphalt shingle roof", "Metal roof", "Tile roof", "Other"];
/** Surfaces where high pressure risks damage. We warn; we never suggest a pressure. */
const DELICATE = new Set(["Wood", "Composite", "Vinyl", "Vinyl siding", "Stucco", "EIFS", "Painted surface", "Asphalt shingle roof", "Tile roof"]);
const CONDITIONS = ["Light (dust, light mildew)", "Moderate (algae, dirt)", "Heavy buildup", "Oil, rust or other stains"];
const ACCESS = ["Easy access", "Moderate access", "Difficult access"];
const STORIES = ["1 story", "2 stories", "3+ stories"];

export function isWashingEstimate(e: Pick<Estimate, "trades">): boolean {
  return e.trades.some((t) => (WASHING_TRADES as readonly string[]).includes(t));
}

export function WashingJobPanel({ estimate, dispatch }: { estimate: Estimate; dispatch: Dispatch<Action> }) {
  const [open, setOpen] = useState(false);
  // Mixed estimates follow the primary trade.
  const soft = estimate.trades[0] === "soft-washing" || (estimate.trades.includes("soft-washing") && !estimate.trades.includes("pressure-washing"));
  const totals = useMemo(() => computeEstimate(estimate), [estimate]);
  const min = toDec(estimate.worksheet?.minimumCharge ?? "");
  const minSet = min.valid && min.value.gt(0);
  const subtotal = totals.subtotal;
  const shortfall = minSet ? min.value.minus(subtotal) : new D(0);
  const minLabelled = (estimate.adjustmentLabel ?? "").trim() === MINIMUM_LABEL;
  if (!isWashingEstimate(estimate)) return null;

  const summary = minSet
    ? shortfall.gt(0) ? `Bid is ${formatCurrency(shortfall)} under your ${formatCurrency(min.value)} minimum` : `Minimum ${formatCurrency(min.value)} met`
    : "Add cleaning areas · minimum charge · pricing";

  return (
    <section className="mb-4 rounded-xl border border-line bg-surface" aria-label={`${soft ? "Soft washing" : "Pressure washing"} job setup`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left sm:px-4">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="shrink-0 whitespace-nowrap font-display text-sm font-bold">{soft ? "Soft washing" : "Pressure washing"} job setup</span>
        <span className={cn("ml-auto min-w-0 truncate rounded px-1.5 py-0.5 text-xs font-semibold", minSet && shortfall.gt(0) ? "bg-warn-tint text-warn" : minSet ? "bg-ok-tint text-ok" : "text-muted")}>{summary}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <AddArea estimate={estimate} dispatch={dispatch} soft={soft} />
          <div className="space-y-4">
            <MinimumCharge estimate={estimate} dispatch={dispatch} min={minSet ? min.value : null} shortfall={shortfall} itemsPrice={totals.itemsPrice} minLabelled={minLabelled} />
            <RateMode estimate={estimate} dispatch={dispatch} soft={soft} />
            <p className="flex gap-2 rounded-lg bg-paper px-3 py-2 text-xs text-ink-soft">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
              <span>
                Built2Bid prices the work only. It never recommends cleaning products, mixtures, pressure settings, or application methods: those are chosen on site by the applicator following product labels and local rules.
                {soft && " Roof cleaning scopes note that access, fall protection and method are confirmed on site."}
              </span>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function AddArea({ estimate, dispatch, soft }: { estimate: Estimate; dispatch: Dispatch<Action>; soft: boolean }) {
  const areas = soft ? SOFT_AREAS : PRESSURE_AREAS;
  const surfaces = soft ? SOFT_SURFACES : PRESSURE_SURFACES;
  const [kind, setKind] = useState(areas[0].value);
  const [surface, setSurface] = useState("");
  const [condition, setCondition] = useState("");
  const [access, setAccess] = useState("");
  const [stories, setStories] = useState("");
  const [pricing, setPricing] = useState<Pricing | "">("");
  const [added, setAdded] = useState<string | null>(null);
  const area = areas.find((a) => a.value === kind) ?? areas[0];
  const mode: Pricing = pricing || area.pricing;
  const delicate = !soft && DELICATE.has(surface);

  const add = () => {
    let groups = [...estimate.groups].sort((a, b) => a.sortOrder - b.sortOrder);
    let group = groups.find((g) => g.name.trim().toLowerCase() === area.group.toLowerCase());
    if (!group) {
      group = newGroup(area.group, groups.length);
      groups = [...groups, group];
      dispatch({ type: "patch", patch: { groups } });
    }
    const details = [surface && `Surface: ${surface.toLowerCase()}`, stories, condition && `Condition: ${condition.toLowerCase()}`, access && access.toLowerCase()].filter(Boolean).join(" · ");
    const description = [details, area.roof ? "Roof access, safety and cleaning method to be confirmed on site before work begins." : ""].filter(Boolean).join(". ");
    dispatch({
      type: "addItem", groupId: group.id, newId: uid(),
      from: {
        name: area.item, description, costType: "labor", taxable: false,
        unit: mode === "flat" ? "lump sum" : mode === "lf" ? "linear foot" : "square foot",
        // Measured areas start empty so the calculator can fill them; flat rate is one job.
        quantity: mode === "flat" ? "1" : "",
      },
    });
    setAdded(`Added “${area.item}” to ${area.group}. Use the calculator beside its quantity to measure it, then enter your rate.`);
  };

  return (
    <div>
      <h3 className="text-sm font-bold">Add a cleaning area</h3>
      <p className="mt-0.5 text-xs text-muted">Adds one line item with these details in its description. No price is filled in.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select id="wa-kind" label="Area" value={kind} onChange={(v) => { setKind(v); setAdded(null); }} options={areas.map((a) => ({ value: a.value, label: a.label }))} />
        <Select id="wa-surface" label="Surface" value={surface} onChange={setSurface} options={surfaces.map((x) => ({ value: x, label: x }))} placeholder="Not specified" />
        <Select id="wa-condition" label="Condition / buildup" value={condition} onChange={setCondition} options={CONDITIONS.map((x) => ({ value: x, label: x }))} placeholder="Not specified" />
        <Select id="wa-access" label="Access" value={access} onChange={setAccess} options={ACCESS.map((x) => ({ value: x, label: x }))} placeholder="Not specified" />
        {soft && <Select id="wa-stories" label="Working height" value={stories} onChange={setStories} options={STORIES.map((x) => ({ value: x, label: x }))} placeholder="Not specified" />}
        <Select id="wa-pricing" label="Price by" value={pricing || area.pricing} onChange={(v) => setPricing(v as Pricing)} options={[{ value: "sf", label: "Square foot" }, { value: "lf", label: "Linear foot" }, { value: "flat", label: "Flat rate" }]} />
      </div>
      {delicate && (
        <p className="mt-2 flex gap-1.5 rounded-lg border border-warn/25 bg-warn-tint px-3 py-2 text-xs text-ink-soft">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          {surface} can be damaged by high pressure. Confirm the cleaning method on site; a soft washing scope may fit this surface better.
        </p>
      )}
      {area.roof && (
        <p className="mt-2 flex gap-1.5 rounded-lg border border-warn/25 bg-warn-tint px-3 py-2 text-xs text-ink-soft">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          Roof cleaning is estimated here only. Access, fall protection, and cleaning method must be approved on site before any work.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={add}><Plus className="h-4 w-4" /> Add {area.label.toLowerCase()} to estimate</Button>
        {added && <span role="status" className="text-xs text-ok"><Check className="mr-1 inline h-3.5 w-3.5" />{added}</span>}
      </div>
    </div>
  );
}

function MinimumCharge({ estimate, dispatch, min, shortfall, itemsPrice, minLabelled }: {
  estimate: Estimate; dispatch: Dispatch<Action>; min: InstanceType<typeof D> | null; shortfall: InstanceType<typeof D>; itemsPrice: InstanceType<typeof D>; minLabelled: boolean;
}) {
  const raw = estimate.worksheet?.minimumCharge ?? "";
  const adj = toDec(estimate.fixedAdjustment);
  const otherAdjustment = adj.valid && !adj.value.isZero() && !minLabelled;
  // The adjustment that makes the bid reach the minimum from the line items alone.
  const needed = min ? D.max(new D(0), min.minus(itemsPrice)) : new D(0);
  const current = minLabelled && adj.valid ? adj.value : new D(0);
  const stale = minLabelled && !current.eq(needed);

  const applyMinimum = () => dispatch({ type: "patch", patch: { fixedAdjustment: needed.toFixed(2), adjustmentLabel: needed.gt(0) ? MINIMUM_LABEL : "" } });
  const remove = () => dispatch({ type: "patch", patch: { fixedAdjustment: "0", adjustmentLabel: "" } });

  return (
    <div>
      <label htmlFor="wa-min" className="text-sm font-bold">Minimum job charge</label>
      <p className="text-xs text-muted">Your own minimum. Applied only when you choose to.</p>
      <div className="relative mt-1.5 max-w-[12rem]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <input
          id="wa-min" className="field field-sm tabular pl-6" inputMode="decimal" placeholder="0.00" value={raw}
          aria-invalid={raw !== "" && !toDec(raw).valid ? true : undefined}
          onChange={(e) => dispatch({ type: "setMinimumCharge", value: e.target.value.replace(/[^\d.]/g, "").slice(0, 12) })}
        />
      </div>
      {min && (
        <div className="mt-2 text-xs text-ink-soft">
          {shortfall.gt(0) && !minLabelled && (
            otherAdjustment
              ? <p>This bid is {formatCurrency(shortfall)} under your minimum. You already have a project adjustment ({estimate.adjustmentLabel || "unlabeled"}); change it in the pricing panel.</p>
              : <div className="flex flex-wrap items-center gap-2"><span>This bid is {formatCurrency(shortfall)} under your minimum.</span><Button size="sm" onClick={applyMinimum}>Add {formatCurrency(needed)} minimum charge</Button></div>
          )}
          {minLabelled && !stale && <p className="text-ok"><Check className="mr-1 inline h-3.5 w-3.5" />A {formatCurrency(current)} “{MINIMUM_LABEL}” adjustment brings the bid to your minimum. <button className="font-semibold underline" onClick={remove}>Remove</button></p>}
          {stale && (
            <div className="flex flex-wrap items-center gap-2 text-warn">
              <span>Line items changed: the minimum charge adjustment should now be {formatCurrency(needed)} (currently {formatCurrency(current)}).</span>
              <Button size="sm" variant="secondary" onClick={applyMinimum}>Update to {formatCurrency(needed)}</Button>
            </div>
          )}
          {shortfall.lte(0) && !minLabelled && <p className="text-ok"><Check className="mr-1 inline h-3.5 w-3.5" />Bid meets your minimum.</p>}
        </div>
      )}
    </div>
  );
}

function RateMode({ estimate, dispatch, soft }: { estimate: Estimate; dispatch: Dispatch<Action>; soft: boolean }) {
  const names = soft ? ["wall & siding cleaning", "roof cleaning", "other surfaces"] : ["cleaning areas"];
  const groups = estimate.groups.filter((g) => names.includes(g.name.trim().toLowerCase()));
  if (!groups.length) return null;
  const direct = groups.every((g) => g.pricingOverride?.mode === "markup" && Number(g.pricingOverride.percent) === 0);
  const set = (on: boolean) => groups.forEach((g) => dispatch({ type: "updateGroup", id: g.id, patch: { pricingOverride: on ? { mode: "markup", percent: "0" } : null } }));
  return (
    <div>
      <h3 className="text-sm font-bold">How you price cleaning</h3>
      <label className="mt-1 flex items-start gap-2 text-xs text-ink-soft">
        <input type="checkbox" className="mt-0.5 accent-[var(--color-brand)]" checked={direct} onChange={(e) => set(e.target.checked)} />
        <span>I quote my own rate per square foot, linear foot, or flat rate. Use the unit cost I enter as the customer price for {groups.map((g) => g.name).join(", ")} (0% markup). Other sections keep the estimate&apos;s markup.</span>
      </label>
    </div>
  );
}

function Select({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-xs font-semibold text-ink-soft">{label}</label>
      <select id={id} className="field field-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
