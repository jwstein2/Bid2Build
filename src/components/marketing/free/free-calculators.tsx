"use client";
import { Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { overheadPerHour, priceForMargin, roundUpTo, type CalculatorId } from "@/lib/marketing/free-resources";

const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "—");
const num = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? NaN : n;
};

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:border-navy print:hidden">
      <Printer className="h-4 w-4" aria-hidden /> Print or save as PDF
    </button>
  );
}

function NumField({ id, label, value, onChange, prefix = "$", suffix }: { id: string; label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string }) {
  const bad = Number.isNaN(num(value));
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-soft">{label}</label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{prefix}</span>}
        <input id={id} className={`field tabular ${prefix ? "pl-7" : ""}`} inputMode="decimal" autoComplete="off" value={value} aria-invalid={bad || undefined} onChange={(e) => onChange(e.target.value.slice(0, 14))} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span>}
      </div>
      {bad && <p className="mt-1 text-xs text-danger">Enter a number.</p>}
    </div>
  );
}

function Result({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className={strong ? "font-bold" : "text-ink-soft"}>{label}</span>
      <span className={`tabular ${strong ? "text-xl font-extrabold text-navy" : "font-semibold"}`} data-testid={strong ? "result" : undefined}>{value}</span>
    </div>
  );
}

const box = "rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6";

function PricingWorksheet() {
  const [materials, setMaterials] = useState("4800");
  const [hours, setHours] = useState("38");
  const [rate, setRate] = useState("60");
  const [overhead, setOverhead] = useState("1440");
  const [margin, setMargin] = useState("15");
  const labor = num(hours) * num(rate);
  const cost = num(materials) + labor + num(overhead);
  const price = priceForMargin(cost, num(margin));
  const rounded = roundUpTo(price, 25);
  return (
    <div className={box} data-testid="free-calculator">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField id="pw-mat" label="1. Materials, with waste" value={materials} onChange={setMaterials} />
        <NumField id="pw-ovh" label="3. This job's share of overhead" value={overhead} onChange={setOverhead} />
        <NumField id="pw-hrs" label="2a. Labor hours" value={hours} onChange={setHours} prefix="" suffix="h" />
        <NumField id="pw-rate" label="2b. Burdened labor rate" value={rate} onChange={setRate} suffix="/h" />
        <NumField id="pw-mgn" label="4. Margin you want (share of the price)" value={margin} onChange={setMargin} prefix="" suffix="%" />
      </div>
      <div className="mt-5 rounded-xl bg-paper p-4">
        <Result label="Labor" value={money(labor)} />
        <Result label="Total cost" value={money(cost)} />
        <Result label={`Price for a ${Number.isFinite(num(margin)) ? num(margin) : "?"}% margin`} value={money(price)} />
        <Result label="Rounded up to the next $25" value={money(rounded)} strong />
        <Result label="Left after cost" value={money(rounded - cost)} />
      </div>
      <p className="mt-3 text-sm text-ink-soft">5. Last check: would you do this job for {money(rounded - cost)} above cost? If not, look at the scope again before you send it.</p>
    </div>
  );
}

function CostPerHour() {
  const [rows, setRows] = useState([
    { name: "Insurance", amount: "6000" }, { name: "Truck and fuel", amount: "12000" }, { name: "Phone and software", amount: "3600" },
    { name: "Licenses and fees", amount: "1200" }, { name: "Tools and repairs", amount: "4800" }, { name: "Marketing", amount: "2400" }, { name: "Accounting and office", amount: "5400" },
  ]);
  const [weeks, setWeeks] = useState("50");
  const [billable, setBillable] = useState("30");
  const [labor, setLabor] = useState("38");
  const [margin, setMargin] = useState("15");
  const yearly = rows.reduce((s, r) => s + (Number.isNaN(num(r.amount)) ? 0 : num(r.amount)), 0);
  const perWeek = num(weeks) > 0 ? yearly / num(weeks) : NaN;
  const perHour = overheadPerHour(yearly, num(weeks), num(billable));
  const cost = perHour + num(labor);
  const price = priceForMargin(cost, num(margin));
  return (
    <div className={box} data-testid="free-calculator">
      <h2 className="font-bold">Yearly overhead</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
            <input aria-label={`Cost ${i + 1} name`} className="field" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 60) } : x)))} />
            <input aria-label={`${r.name || `Cost ${i + 1}`} per year`} className="field tabular" inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.slice(0, 14) } : x)))} />
            <button type="button" aria-label={`Remove ${r.name || "row"}`} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-danger print:hidden" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-ink hover:underline print:hidden" onClick={() => setRows([...rows, { name: "", amount: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add a cost</button>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <NumField id="ch-weeks" label="Working weeks a year" value={weeks} onChange={setWeeks} prefix="" />
        <NumField id="ch-bill" label="Billable hours a week (not all hours)" value={billable} onChange={setBillable} prefix="" suffix="h" />
        <NumField id="ch-labor" label="Your labor cost per hour" value={labor} onChange={setLabor} suffix="/h" />
        <NumField id="ch-margin" label="Margin you want" value={margin} onChange={setMargin} prefix="" suffix="%" />
      </div>
      <div className="mt-5 rounded-xl bg-paper p-4">
        <Result label="Overhead per year" value={money(yearly)} />
        <Result label="Overhead per week" value={money(perWeek)} />
        <Result label="Overhead per billable hour" value={money(perHour)} strong />
        <Result label="Overhead + labor per hour" value={money(cost)} />
        <Result label={`Hourly price for a ${Number.isFinite(num(margin)) ? num(margin) : "?"}% margin`} value={money(price)} />
        <Result label="Overhead a 40-hour job carries" value={money(perHour * 40)} />
      </div>
    </div>
  );
}

type Line = { name: string; cost: string; billed: string };
function BidVsActual() {
  const [bidCost, setBidCost] = useState("17460");
  const [bidPrice, setBidPrice] = useState("20550");
  const [lines, setLines] = useState<Line[]>([
    { name: "Rotten subfloor (change order)", cost: "440", billed: "520" },
    { name: "Tile upgrade (change order)", cost: "480", billed: "480" },
    { name: "Delay: extra labor", cost: "608", billed: "0" },
    { name: "Delay: rental", cost: "300", billed: "0" },
    { name: "Extras done for free", cost: "472.50", billed: "0" },
  ]);
  const v = (s: string) => (Number.isNaN(num(s)) ? 0 : num(s));
  const extraCost = lines.reduce((s, l) => s + v(l.cost), 0);
  const extraBilled = lines.reduce((s, l) => s + v(l.billed), 0);
  const revenue = v(bidPrice) + extraBilled;
  const cost = v(bidCost) + extraCost;
  const planned = v(bidPrice) - v(bidCost);
  const actual = revenue - cost;
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
  const set = (i: number, k: keyof Line, val: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: val.slice(0, k === "name" ? 80 : 14) } : l)));
  return (
    <div className={box} data-testid="free-calculator">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField id="bva-cost" label="Bid: total cost" value={bidCost} onChange={setBidCost} />
        <NumField id="bva-price" label="Bid: price" value={bidPrice} onChange={setBidPrice} />
      </div>
      <h2 className="mt-5 font-bold">What happened on the job</h2>
      <div className="mt-2 hidden grid-cols-[1fr_7rem_7rem_auto] gap-2 text-xs font-semibold text-muted sm:grid"><span>Item</span><span>Cost to you</span><span>Billed</span><span /></div>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] items-center gap-2">
            <input aria-label={`Item ${i + 1}`} className="field" value={l.name} onChange={(e) => set(i, "name", e.target.value)} />
            <input aria-label={`${l.name || `Item ${i + 1}`} cost to you`} className="field tabular" inputMode="decimal" value={l.cost} onChange={(e) => set(i, "cost", e.target.value)} />
            <input aria-label={`${l.name || `Item ${i + 1}`} billed`} className="field tabular" inputMode="decimal" value={l.billed} onChange={(e) => set(i, "billed", e.target.value)} />
            <button type="button" aria-label={`Remove ${l.name || "item"}`} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-danger print:hidden" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-ink hover:underline print:hidden" onClick={() => setLines([...lines, { name: "", cost: "", billed: "0" }])}><Plus className="h-4 w-4" aria-hidden /> Add an item</button>
      <div className="mt-5 rounded-xl bg-paper p-4">
        <Result label="Planned: left after cost" value={`${money(planned)} (${pct(planned, v(bidPrice))})`} />
        <Result label="Final revenue" value={money(revenue)} />
        <Result label="Final cost" value={money(cost)} />
        <Result label="Actual: left after cost" value={`${money(actual)} (${pct(actual, revenue)})`} strong />
        <Result label="Cost you absorbed (not billed)" value={money(lines.reduce((s, l) => s + Math.max(0, v(l.cost) - v(l.billed)), 0))} />
      </div>
    </div>
  );
}

function SetupSheet() {
  const [overhead, setOverhead] = useState("24000");
  const [hours, setHours] = useState("1200");
  const [pay, setPay] = useState("50000");
  const [margin, setMargin] = useState("15");
  const oh = num(hours) > 0 ? num(overhead) / num(hours) : NaN;
  const ph = num(hours) > 0 ? num(pay) / num(hours) : NaN;
  const cost = oh + ph;
  const price = priceForMargin(cost, num(margin));
  return (
    <div className={box} data-testid="free-calculator">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField id="ss-ovh" label="1. Yearly overhead" value={overhead} onChange={setOverhead} />
        <NumField id="ss-hrs" label="2. Billable hours a year" value={hours} onChange={setHours} prefix="" suffix="h" />
        <NumField id="ss-pay" label="3. Owner pay you plan for the year" value={pay} onChange={setPay} />
        <NumField id="ss-mgn" label="5. Margin you want" value={margin} onChange={setMargin} prefix="" suffix="%" />
      </div>
      <div className="mt-5 rounded-xl bg-paper p-4">
        <Result label="Overhead per hour" value={money(oh)} />
        <Result label="Owner pay per hour" value={money(ph)} />
        <Result label="4. Cost per hour" value={money(cost)} />
        <Result label="5. Hourly price for that margin" value={money(price)} strong />
      </div>
      <p className="mt-3 text-sm text-ink-soft">Materials and any helpers’ pay go on top, job by job. Billable hours are the hours you charge for, not every hour you work.</p>
    </div>
  );
}

export function FreeCalculator({ id }: { id: CalculatorId }) {
  if (id === "pricing-worksheet") return <PricingWorksheet />;
  if (id === "cost-per-hour") return <CostPerHour />;
  if (id === "bid-vs-actual") return <BidVsActual />;
  return <SetupSheet />;
}
