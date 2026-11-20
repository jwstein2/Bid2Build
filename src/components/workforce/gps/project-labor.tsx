import Link from "next/link";
import { HardHat } from "lucide-react";
import { laborVariance, type ProjectLaborSummary } from "@/lib/workforce/gps/model";

const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const hrs = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`);
const signed = (n: number | null, f: (x: number) => string) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${f(Math.abs(n))}`);

/**
 * Project labor (V8.2): estimated labor (from the estimate's labor lines, read-only) vs hours recorded on this project
 * by the time clock and GPS. Cost columns only for people who may see pay rates. Variance is to date.
 */
export function ProjectLabor({ labor }: { labor: ProjectLaborSummary }) {
  const v = laborVariance(labor);
  const cells: { label: string; value: string; sub?: string; tone?: string }[] = [
    { label: "Estimated labor hours", value: hrs(labor.estimatedHours), sub: labor.estimatedHours === null ? "Labor lines aren't in hours" : undefined },
    { label: "Actual hours recorded", value: hrs(labor.actualHours), sub: `${hrs(labor.approvedHours)} approved${labor.openHours > 0 ? ` · ${hrs(labor.openHours)} on the clock now` : ""}` },
    ...(labor.canSeeCost ? [
      { label: "Estimated labor cost", value: money(labor.estimatedCost) },
      { label: "Actual allocated labor cost", value: money(labor.allocatedCost), sub: labor.uncostedHours > 0 ? `${hrs(labor.uncostedHours)} without a cost rate` : `${money(labor.actualCost)} approved` },
      { label: "Variance", value: signed(v.cost, (x) => money(x)), sub: signed(v.hours, (x) => hrs(x)), tone: v.cost === null ? "" : v.cost > 0 ? "text-danger" : "text-ok" },
      { label: "Effect on expected profit", value: signed(v.profitImpact, (x) => money(x)), tone: v.profitImpact === null ? "" : v.profitImpact < 0 ? "text-danger" : "text-ok" },
    ] : [{ label: "Variance (hours)", value: signed(v.hours, (x) => hrs(x)) }]),
  ];
  return (
    <section className="mb-4 rounded-xl border border-line bg-surface p-4" data-testid="project-labor">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-lg font-extrabold text-navy"><HardHat className="h-5 w-5 text-accent-ink" aria-hidden />Labor: estimate vs actual</h2>
        <Link href="/projects/workforce/time-tracking?tab=payroll" className="text-sm font-semibold text-accent-ink hover:underline">Timesheets</Link>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label}><dt className="text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</dt><dd className={`text-lg font-extrabold ${c.tone ?? "text-navy"}`}>{c.value}</dd>{c.sub && <dd className="text-xs text-ink-soft">{c.sub}</dd>}</div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">To date, from the time clock (including GPS). Estimated cost is the estimate&apos;s labor lines before markup; actual cost uses each employee&apos;s cost rate.{labor.canSeeCost ? "" : " Cost figures are only shown to people who can see pay rates."}</p>
    </section>
  );
}
