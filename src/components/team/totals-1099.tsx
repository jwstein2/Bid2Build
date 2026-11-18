"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { Filing1099 } from "@/components/team/filing-1099";
import { maskTin, threshold1099, totals1099Csv, type Totals1099 } from "@/lib/team/records";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * 1099 totals: what you paid each subcontractor in a calendar year, from bills and expenses recorded in
 * Financials. Card payments are shown but not counted (the card company reports them on a 1099-K).
 * This prepares the numbers; it doesn't file anything.
 */
export function Totals1099View({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const [result, setResult] = useState<{ year: number; data: Totals1099 | null; err: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    api<Totals1099>(`/api/team/1099?year=${year}`).then((r) => { if (live) setResult({ year, data: r.ok ? r.data : null, err: r.ok ? null : r.message }); });
    return () => { live = false; };
  }, [year]);
  const data = result?.year === year ? result.data : null;
  const err = result?.year === year ? result.err : null;
  const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
  const needs = data?.rows.filter((r) => r.needs1099) ?? [];
  const missingW9 = needs.filter((r) => !r.w9OnFile);

  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([totals1099Csv(data)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `1099-totals-${data.year}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4" data-testid="totals-1099">
      <div className="flex flex-wrap items-end gap-2">
        <label><span className="label">Tax year</span>
          <select className="field h-10 py-0" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="year-1099">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <Button size="sm" variant="secondary" className="min-h-10" onClick={download} disabled={!data?.rows.length} data-testid="export-1099"><Download className="h-4 w-4" aria-hidden /> Download CSV</Button>
        <p className="basis-full text-sm text-ink-soft sm:basis-auto">1099-NEC threshold for {year}: <b>{money(data?.threshold ?? threshold1099(year))}</b></p>
      </div>
      {err && <Notice tone={/permission/.test(err) ? "warn" : "danger"}>{/permission/.test(err) ? "Only the company owner, people allowed to manage subcontractor compliance, and bookkeepers/accountants with financial reporting access can see 1099 totals." : err}</Notice>}
      {!data && !err && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:max-w-lg sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-muted">Need a 1099</p><p className="text-xl font-extrabold text-navy">{needs.length}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-muted">Missing W-9</p><p className={`text-xl font-extrabold ${missingW9.length ? "text-danger" : "text-navy"}`}>{missingW9.length}</p></div>
            <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-muted">Paid (not card)</p><p className="text-xl font-extrabold text-navy">{money(data.rows.reduce((s, r) => s + r.paid, 0))}</p></div>
          </div>
          {needs.length > 0 && <Filing1099 year={data.year} count={needs.length} />}
          {data.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted" data-testid="empty-1099">
              No subcontractor payments recorded in {year}. Totals come from bills you pay and expenses you record in <Link href="/financials" className="font-semibold underline">Financials</Link>.
            </div>
          ) : (
            <div className="relative overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-paper text-xs uppercase text-muted"><tr><th className="px-3 py-2">Payee</th><th className="px-3 py-2">W-9</th><th className="px-3 py-2 text-right">Paid (not card)</th><th className="px-3 py-2 text-right">By card</th><th className="px-3 py-2">1099-NEC</th></tr></thead>
                <tbody className="divide-y divide-line">{data.rows.map((r) => (
                  <tr key={r.vendorId} data-testid="row-1099">
                    <td className="px-3 py-2"><span className="font-semibold text-navy">{r.vendorName}</span>{r.legalName && r.legalName !== r.vendorName ? <span className="block text-xs text-muted">{r.legalName}</span> : null}
                      {r.resourceId ? <Link href={`/projects/team/subs/${r.resourceId}`} className="block text-xs text-accent-ink underline">Records</Link> : <span className="block text-xs text-muted">Not linked to Team &amp; Subcontractors</span>}</td>
                    <td className="px-3 py-2">{r.w9OnFile ? <Badge tone="ok">On file</Badge> : <Badge tone={r.needs1099 ? "danger" : "neutral"}>Missing</Badge>}<span className="block text-xs text-muted">{maskTin(r.tinType, r.tinLast4)}</span></td>
                    <td className="px-3 py-2 text-right font-semibold">{money(r.paid)}</td>
                    <td className="px-3 py-2 text-right text-muted">{r.cardPaid ? money(r.cardPaid) : "—"}</td>
                    <td className="px-3 py-2">{r.needs1099 ? <Badge tone="warn">Needed</Badge> : r.tracks1099 ? <span className="text-xs text-muted">Below threshold</span> : <span className="text-xs text-muted">Usually not (corporation)</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">Counts bill payments and approved expenses by check, ACH, cash, wire or other in the calendar year. Card payments are left out because the card company reports them. Corporations usually don&apos;t get a 1099-NEC (attorneys are an exception). Built2Bid prepares these numbers; your accountant or a filing service files the forms. Check with your tax advisor.</p>
        </>
      )}
    </div>
  );
}
