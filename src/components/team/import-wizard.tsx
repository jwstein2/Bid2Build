"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, HardHat, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { parseCsv, sheetToRows } from "@/lib/pricing/import";
import {
  acceptedValues, columnsFor, IMPORT_CHUNK, MAX_IMPORT_PEOPLE, parseRecord, sheetToRecords, templateCsv,
  type Column, type ImportKind, type ImportResult, type ParsedRow,
} from "@/lib/team/import";
import { FileDrop } from "@/components/ui/file-drop";

const MAX_BYTES = 5 * 1024 * 1024;
type Rec = { line: number; raw: Record<string, string> };
type Done = { created: number; updated: number; failed: number; results: ImportResult[] };

const LABEL: Record<ImportKind, { one: string; many: string }> = { employees: { one: "employee", many: "employees" }, subs: { one: "subcontractor", many: "subcontractors" } };

/**
 * Projects → Team → Import. Download a template (or use a payroll / HR export), upload it, review every row with
 * plain-words problems, then import. Rows that match someone already here (by email, then name) update them.
 */
export function ImportWizard({ canHr, canSubs }: { canHr: boolean; canSubs: boolean }) {
  const [kind, setKind] = useState<ImportKind>("employees");
  const [file, setFile] = useState<string | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Record<number, "new" | "match">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const parsed: ParsedRow[] = useMemo(() => recs.map((r) => parseRecord(kind, r.line, r.raw)), [recs, kind]);
  const good = parsed.filter((p) => p.errors.length === 0);
  const bad = parsed.filter((p) => p.errors.length > 0);

  function reset(k: ImportKind = kind) { setKind(k); setFile(null); setRecs([]); setIgnored([]); setError(null); setMatches({}); setDone(null); }

  function download() {
    const blob = new Blob([templateCsv(kind)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `built2bid-${kind}-template.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function onFile(f: File | undefined) {
    reset();
    if (!f) return;
    if (f.size > MAX_BYTES) { setError("That file is over 5 MB. Split it into smaller files."); return; }
    try {
      let table: string[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        table = sheetToRows((await readSheet(f)) as unknown[][]);
      } else if (/\.(csv|txt|tsv)$/i.test(f.name) || f.type.includes("csv") || f.type.startsWith("text/")) {
        table = parseCsv(await f.text());
      } else { setError("Use a CSV or Excel (.xlsx) file. For an older .xls file, open it in Excel and Save As .xlsx or CSV."); return; }
      const { records, ignored: ign, missingRequired } = sheetToRecords(kind, table);
      if (missingRequired.length) { setError(`The file needs a ${missingRequired.join(", ")} column. Download the template to see the headers.`); return; }
      if (records.length === 0) { setError("No rows found under the header row."); return; }
      if (table.length - 1 > MAX_IMPORT_PEOPLE) setError(`Only the first ${MAX_IMPORT_PEOPLE.toLocaleString()} rows will be read.`);
      setFile(f.name); setRecs(records); setIgnored(ign);
      // Which rows are already here (no writes).
      setBusy("Checking who's already in Built2Bid…");
      const m: Record<number, "new" | "match"> = {};
      for (let i = 0; i < records.length; i += IMPORT_CHUNK * 4) {
        const r = await api<{ results: ImportResult[] }>("/api/team/import", { method: "POST", body: JSON.stringify({ kind, dryRun: true, rows: records.slice(i, i + IMPORT_CHUNK * 4) }) });
        if (!r.ok) break;
        for (const x of r.data.results) if (x.action === "new" || x.action === "match") m[x.line] = x.action;
      }
      setMatches(m); setBusy(null);
    } catch { setBusy(null); setError("We couldn't read that file. Save it as CSV (UTF-8) and try again."); }
  }

  async function runImport() {
    const rows = recs.filter((r) => good.some((g) => g.line === r.line));
    const all: ImportResult[] = [];
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      setBusy(`Importing ${Math.min(i + IMPORT_CHUNK, rows.length)} of ${rows.length}…`);
      const r = await api<{ results: ImportResult[] }>("/api/team/import", { method: "POST", body: JSON.stringify({ kind, rows: rows.slice(i, i + IMPORT_CHUNK) }) });
      if (!r.ok) { all.push(...rows.slice(i).map((x) => ({ line: x.line, name: x.raw.name ?? "", action: "failed" as const, message: r.message, warnings: [] }))); break; }
      all.push(...r.data.results);
    }
    setBusy(null);
    setDone({ created: all.filter((x) => x.action === "created").length, updated: all.filter((x) => x.action === "updated").length, failed: all.filter((x) => x.action === "failed").length, results: all });
  }

  const L = LABEL[kind];
  const restricted = kind === "employees" ? !canHr : !canSubs;
  return (
    <div className="space-y-6" data-testid="team-import">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="What to import">
        {(["employees", "subs"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => reset(k)} data-testid={`import-kind-${k}`}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${kind === k ? "border-accent-ink bg-accent-tint text-navy" : "border-line bg-surface text-ink-soft"}`}>
            {k === "employees" ? <Users className="h-4 w-4" aria-hidden /> : <HardHat className="h-4 w-4" aria-hidden />}{k === "employees" ? "Employees" : "Subcontractors"}
          </button>
        ))}
      </div>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-xl font-extrabold text-navy">1. Get your list ready</h2>
        <p className="text-sm text-ink-soft">
          {kind === "employees"
            ? "Download the template, or upload an export from Gusto, ADP, Paychex, QuickBooks Payroll or a spreadsheet you already keep. We match common column names. Only Name is required (or first and last name)."
            : "Download the template, or upload a vendor list from QuickBooks or your own spreadsheet. We match common column names. Only the company or person name is required."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={download} data-testid="import-template"><Download className="h-4 w-4" aria-hidden /> Download {L.one} template (CSV)</Button>
        </div>
        <details className="rounded-lg border border-line bg-paper p-3 text-sm" data-testid="import-guide">
          <summary className="cursor-pointer font-semibold text-navy">Every column, and what it accepts</summary>
          <FieldGuide columns={columnsFor(kind)} />
        </details>
        {restricted && (
          <Notice tone="warn">
            {kind === "employees"
              ? "You can add people to the directory, but HR columns (personal details, pay, W-4, direct deposit, SSN) are only saved for the owner and HR managers."
              : "You can add subs to the directory, but W-9, insurance and payment columns are only saved for people allowed to “Manage subcontractor compliance”."}
          </Notice>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-xl font-extrabold text-navy">2. Upload it</h2>
        <FileDrop className="rounded-xl" label="Drop the file to read it">
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line p-4 text-center hover:bg-paper">
          <FileSpreadsheet className="h-6 w-6 text-accent-ink" aria-hidden />
          <span className="font-semibold text-navy">{file ?? "Choose or drag in a CSV or Excel file"}</span>
          <span className="text-xs text-muted">Up to {MAX_IMPORT_PEOPLE.toLocaleString()} rows, 5 MB. Nothing is saved until you press Import.</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="import-file"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        </FileDrop>
        {error && <Notice tone="danger">{error}</Notice>}
        {ignored.length > 0 && <p className="text-xs text-muted" data-testid="import-ignored">Columns we don&apos;t use (skipped): {ignored.join(", ")}</p>}
      </section>

      {recs.length > 0 && !done && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="import-preview">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xl font-extrabold text-navy">3. Check and import</h2>
            <Badge tone="ok">{good.length} ready</Badge>
            {bad.length > 0 && <Badge tone="danger">{bad.length} need fixing</Badge>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-2">Row</th><th className="pr-2">Name</th><th className="pr-2">Will</th><th>Notes</th></tr></thead>
              <tbody>
                {parsed.map((p) => (
                  <tr key={p.line} className="border-b border-line align-top" data-testid="import-row">
                    <td className="py-2 pr-2 text-muted">{p.line}</td>
                    <td className="pr-2 font-semibold text-navy">{p.name || "—"}</td>
                    <td className="pr-2">{p.errors.length ? <Badge tone="danger">Skip</Badge> : matches[p.line] === "match" ? <Badge>Update</Badge> : <Badge tone="ok">Add</Badge>}</td>
                    <td className="text-xs">{[...p.errors.map((e) => <span key={e} className="block text-danger">{e}</span>), ...p.warnings.map((w) => <span key={w} className="block text-muted">{w}</span>)]}
                      {!p.errors.length && !p.warnings.length && <span className="text-muted">{Object.keys(p.values).length} fields</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Rows that match someone already in Built2Bid (same email, or the same name) update them; blank cells never erase what&apos;s there. SSNs, tax IDs and bank account numbers are encrypted on arrival.</p>
          {busy && <p className="text-sm text-ink-soft" aria-live="polite">{busy}</p>}
          <Button onClick={runImport} disabled={!!busy || good.length === 0} data-testid="import-run"><Upload className="h-4 w-4" aria-hidden /> Import {good.length} {good.length === 1 ? L.one : L.many}</Button>
        </section>
      )}

      {done && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="import-done">
          <Notice tone={done.failed ? "warn" : "ok"} title="Import finished">
            {done.created} added, {done.updated} updated{done.failed ? `, ${done.failed} not imported` : ""}.{" "}
            <Link href={kind === "employees" ? "/projects/team/hr" : "/projects/team/subs"} className="font-semibold underline">Open {kind === "employees" ? "HR files" : "Sub records"}</Link>
          </Notice>
          <ul className="divide-y divide-line text-sm">
            {done.results.filter((r) => r.action === "failed" || r.warnings.length).map((r) => (
              <li key={r.line} className="py-2"><span className="font-semibold">Row {r.line} {r.name}</span>: {r.action === "failed" ? <span className="text-danger">{r.message}</span> : r.warnings.join("; ")}</li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" onClick={() => reset()}>Import another file</Button>
        </section>
      )}
    </div>
  );
}

function FieldGuide({ columns }: { columns: Column[] }) {
  const sections = [...new Set(columns.map((c) => c.section))];
  return (
    <div className="mt-2 space-y-3">
      {sections.map((s) => (
        <div key={s}>
          <p className="font-semibold text-navy">{s}</p>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {columns.filter((c) => c.section === s).map((c) => (
              <li key={c.key} className="text-xs"><span className="font-semibold">{c.header}{c.required ? " *" : ""}</span>{acceptedValues(c) ? <span className="text-muted"> · {acceptedValues(c)}</span> : null}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
