"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { parseCsv, sheetToRows } from "@/lib/pricing/import";
import {
  CUSTOMER_FIELD_LABELS, CUSTOMER_IMPORT_CHUNK, customerTemplateCsv, dupWords, MAX_CUSTOMER_ROWS, parseCustomer, sheetToCustomerRecords,
  type CustomerRow, type ParsedCustomer, type RowStatus,
} from "@/lib/customers/import";
import { FileDrop } from "@/components/ui/file-drop";

const MAX_BYTES = 10 * 1024 * 1024;
type Saved = { line: number; status: "created" } | { line: number; status: "failed"; message: string } | RowStatus;
type Done = { created: number; skipped: number; failed: number; results: Saved[] };

/**
 * Customers → Import. Upload a QuickBooks customer export (or any CSV / Excel list), see every row with duplicates
 * flagged, then import only the new customers. Nothing is saved until Import is pressed.
 */
export function CustomerImport() {
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCustomer[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<number, RowStatus>>({});
  const [allowNameOnly, setAllowNameOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const ready = useMemo(() => parsed.filter((p): p is ParsedCustomer & { row: CustomerRow } => !!p.row), [parsed]);
  const isNew = (line: number) => status[line]?.status === "new";
  const toImport = ready.filter((p) => isNew(p.line));
  const dupCount = ready.filter((p) => status[p.line]?.status === "duplicate" && !isNew(p.line)).length;
  const skipCount = parsed.length - ready.length;

  function reset() { setFile(null); setParsed([]); setRead([]); setIgnored([]); setError(null); setStatus({}); setDone(null); }

  function download() {
    const blob = new Blob([customerTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "built2bid-customers-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function check(rows: { line: number; row: CustomerRow }[], nameOnly: boolean) {
    setBusy("Checking for customers already in Built2Bid…");
    const r = await api<{ results: RowStatus[] }>("/api/customers/import", { method: "POST", body: JSON.stringify({ dryRun: true, allowNameOnly: nameOnly, rows }) });
    setBusy(null);
    if (!r.ok) { setError(r.message); return; }
    setStatus(Object.fromEntries(r.data.results.map((x) => [x.line, x])));
  }

  async function onFile(f: File | undefined) {
    reset();
    if (!f) return;
    if (f.size > MAX_BYTES) { setError("That file is over 10 MB. Split it into smaller files."); return; }
    try {
      let table: string[][];
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        table = sheetToRows((await readSheet(f)) as unknown[][]);
      } else if (/\.(csv|txt|tsv)$/i.test(f.name) || f.type.includes("csv") || f.type.startsWith("text/")) {
        table = parseCsv(await f.text());
      } else if (/\.xls$/i.test(f.name)) { setError("That's an older Excel (.xls) file. Open it in Excel and Save As .xlsx or CSV, then upload it."); return; }
      else { setError("Use a CSV or Excel (.xlsx) file."); return; }
      const { records, ignored: ign, headerFound } = sheetToCustomerRecords(table);
      if (!headerFound) { setError("We couldn't find a header row with a customer name column (for example Customer, Name, Company, or First name and Last name). Download the template to see one that works."); return; }
      if (records.length === 0) { setError("No customers found under the header row."); return; }
      const p = records.map((r) => parseCustomer(r.line, r.raw));
      setFile(f.name); setParsed(p); setIgnored(ign);
      setRead([...new Set(records.flatMap((r) => Object.keys(r.raw)))].map((k) => CUSTOMER_FIELD_LABELS[k as keyof typeof CUSTOMER_FIELD_LABELS]));
      if (records.length >= MAX_CUSTOMER_ROWS) setError(`Only the first ${MAX_CUSTOMER_ROWS.toLocaleString()} customers will be read. Import the rest in a second file.`);
      const rows = p.filter((x): x is ParsedCustomer & { row: CustomerRow } => !!x.row).map((x) => ({ line: x.line, row: x.row }));
      if (rows.length) await check(rows, false);
    } catch { setBusy(null); setError("We couldn't read that file. Save it as CSV (UTF-8) and try again."); }
  }

  async function onAllowName(v: boolean) {
    setAllowNameOnly(v);
    await check(ready.map((x) => ({ line: x.line, row: x.row })), v);
  }

  async function runImport() {
    const rows = toImport.map((x) => ({ line: x.line, row: x.row }));
    const all: Saved[] = [];
    for (let i = 0; i < rows.length; i += CUSTOMER_IMPORT_CHUNK) {
      setBusy(`Importing ${Math.min(i + CUSTOMER_IMPORT_CHUNK, rows.length)} of ${rows.length}…`);
      const r = await api<{ results: Saved[] }>("/api/customers/import", { method: "POST", body: JSON.stringify({ allowNameOnly, rows: rows.slice(i, i + CUSTOMER_IMPORT_CHUNK) }) });
      if (!r.ok) { all.push(...rows.slice(i).map((x) => ({ line: x.line, status: "failed" as const, message: r.message }))); break; }
      all.push(...r.data.results);
    }
    setBusy(null);
    const created = all.filter((x) => x.status === "created").length;
    const failed = all.filter((x) => x.status === "failed").length;
    setDone({ created, failed, skipped: parsed.length - created - failed, results: all });
  }

  const nameRow = (line: number) => parsed.find((p) => p.line === line)?.row?.name ?? "";
  return (
    <div className="space-y-6" data-testid="customer-import">
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-xl font-extrabold text-navy">1. Get your customer list</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li><strong>QuickBooks Online:</strong> go to Customers (Sales → Customers), then select the Export to Excel icon next to Print. Upload that file here as it is.</li>
          <li><strong>More detail from QuickBooks Online:</strong> Reports → Customer Contact List → Customize → Change columns (add Company, Billing address, Email, Phone) → Run report → Export to Excel.</li>
          <li><strong>QuickBooks Desktop:</strong> Customer Center → Excel → Export Customer List.</li>
          <li><strong>Anything else:</strong> a spreadsheet from Jobber, Housecall Pro, your CRM or your own list. Only a name column is required.</li>
        </ul>
        <Button size="sm" variant="secondary" onClick={download} data-testid="customer-import-template"><Download className="h-4 w-4" aria-hidden /> Download a template (CSV)</Button>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-xl font-extrabold text-navy">2. Upload it</h2>
        <FileDrop className="rounded-xl" label="Drop the file to read it">
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line p-4 text-center hover:bg-paper">
          <FileSpreadsheet className="h-6 w-6 text-accent-ink" aria-hidden />
          <span className="font-semibold text-navy">{file ?? "Choose or drag in a CSV or Excel file"}</span>
          <span className="text-xs text-muted">CSV, TSV, TXT or Excel (.xlsx). Up to {MAX_CUSTOMER_ROWS.toLocaleString()} customers, 10 MB. Nothing is saved until you press Import.</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="customer-import-file"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        </FileDrop>
        {error && <Notice tone="danger">{error}</Notice>}
        {read.length > 0 && <p className="text-xs text-muted" data-testid="customer-import-read">Columns we read: {read.join(", ")}</p>}
        {ignored.length > 0 && <p className="text-xs text-muted" data-testid="customer-import-ignored">Columns we skip: {ignored.join(", ")}</p>}
      </section>

      {parsed.length > 0 && !done && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="customer-import-preview">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-xl font-extrabold text-navy">3. Check and import</h2>
            <Badge tone="ok">{toImport.length} new</Badge>
            {dupCount > 0 && <Badge tone="warn">{dupCount} already here</Badge>}
            {skipCount > 0 && <Badge>{skipCount} skipped</Badge>}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={allowNameOnly} disabled={!!busy} onChange={(e) => void onAllowName(e.target.checked)} data-testid="customer-import-allow-name" />
            Also import customers that only share a name with someone already here (different email and phone)
          </label>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2 pr-2">Row</th><th className="pr-2">Customer</th><th className="pr-2">Contact</th><th className="pr-2">Will</th><th>Notes</th></tr></thead>
              <tbody>
                {parsed.map((p) => {
                  const s = status[p.line];
                  return (
                    <tr key={p.line} className="border-b border-line align-top" data-testid="customer-import-row">
                      <td className="py-2 pr-2 text-muted">{p.line}</td>
                      <td className="pr-2"><span className="font-semibold text-navy">{p.row?.name ?? "—"}</span>{p.row?.companyName && <span className="block text-xs text-muted">{p.row.companyName}</span>}</td>
                      <td className="pr-2 text-xs">{[p.row?.email, p.row?.phone].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}{p.row?.projectAddress && <span className="block text-muted">{p.row.projectAddress}</span>}</td>
                      <td className="pr-2">{!p.row ? <Badge>Skip</Badge> : isNew(p.line) ? <Badge tone="ok">Add</Badge> : s?.status === "duplicate" ? <Badge tone="warn">Already here</Badge> : <Badge>Checking</Badge>}</td>
                      <td className="text-xs">
                        {p.skip && <span className="block text-muted">{p.skip}</span>}
                        {s?.status === "duplicate" && !isNew(p.line) && <span className="block text-warn">{dupWords(s)}</span>}
                        {p.warnings.map((w) => <span key={w} className="block text-muted">{w}</span>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Customers already in Built2Bid are never changed or duplicated. QuickBooks sub-customers and jobs (“Parent:Job”) are skipped; open balances are kept in each customer&apos;s notes.</p>
          {busy && <p className="text-sm text-ink-soft" aria-live="polite">{busy}</p>}
          <Button onClick={runImport} disabled={!!busy || toImport.length === 0} data-testid="customer-import-run"><Upload className="h-4 w-4" aria-hidden /> Import {toImport.length} customer{toImport.length === 1 ? "" : "s"}</Button>
        </section>
      )}

      {done && (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="customer-import-done">
          <Notice tone={done.failed ? "warn" : "ok"} title="Import finished">
            {done.created} customer{done.created === 1 ? "" : "s"} added{done.skipped ? `, ${done.skipped} skipped` : ""}{done.failed ? `, ${done.failed} not saved` : ""}.{" "}
            <Link href="/dashboard/customers" className="font-semibold underline">Open Customers</Link>
          </Notice>
          {done.failed > 0 && (
            <ul className="divide-y divide-line text-sm">
              {done.results.filter((r) => r.status === "failed").map((r) => <li key={r.line} className="py-2"><span className="font-semibold">Row {r.line} {nameRow(r.line)}</span>: <span className="text-danger">{"message" in r ? r.message : ""}</span></li>)}
            </ul>
          )}
          <Button size="sm" variant="secondary" onClick={reset}>Import another file</Button>
        </section>
      )}
    </div>
  );
}
