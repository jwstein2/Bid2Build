"use client";
import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usd } from "@/components/financials/fin-client";
import { add, cmp, sub } from "@/lib/financials/money";
import { parseStatement, parseBankAmount, type ParsedStatement } from "@/lib/financials/accounting";
import { Status, useAct, type Opt } from "./controls";

const KIND_LABELS = { checking: "Checking", savings: "Savings", credit_card: "Credit card", other: "Other" } as const;
const EXCLUDE = { transfer: "Transfer between your own accounts", duplicate: "Duplicate line from the bank", owner: "Owner draw or contribution", not_business: "Not a business transaction", other: "Other (explain in the note)" } as const;

/** Add a bank account for statement imports: a name, type and last 4 digits only. No login, no connection, no money movement. */
export function AddBankAccount({ first }: { first: boolean }) {
  const { busy, msg, run } = useAct();
  const [open, setOpen] = useState(first);
  const [f, setF] = useState({ name: "", kind: "checking", last4: "", openingBalance: "", openingDate: "" });
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="fin-bank-add-open">Add bank account</Button>;
  return (
    <form className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="fin-bank-add" data-guide="fin.bank-add"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run({ action: "bank_account_save", p: { name: f.name, kind: f.kind, last4: f.last4 || undefined, openingBalance: f.openingBalance || "0", openingDate: f.openingDate || undefined } }, "Account added.");
        if (r) { setF({ name: "", kind: "checking", last4: "", openingBalance: "", openingDate: "" }); setOpen(false); }
      }}>
      <h2 className="font-display text-base font-extrabold">Add a bank account</h2>
      <p className="text-sm text-ink-soft">For importing statements you download from your bank. Built2Bid never asks for your bank login, never connects to the bank and can&apos;t move money.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="label lg:col-span-2" htmlFor="ba-name">Name<input id="ba-name" className="field mt-1" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Business checking" /></label>
        <label className="label" htmlFor="ba-kind">Type<select id="ba-kind" className="field mt-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="label" htmlFor="ba-last4">Last 4 digits<input id="ba-last4" className="field mt-1" inputMode="numeric" pattern="\d{4}" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} placeholder="Optional" /></label>
        <label className="label" htmlFor="ba-open">Opening balance<input id="ba-open" className="field mt-1" inputMode="decimal" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value.replace(/[^0-9.-]/g, "") })} placeholder="0.00" /></label>
        <label className="label" htmlFor="ba-date">Opening date<input id="ba-date" type="date" className="field mt-1" value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} /></label>
      </div>
      <p className="text-xs text-muted">Opening balance = the balance on the day before the first statement you&apos;ll import. It locks once lines are imported.</p>
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" disabled={busy || !f.name.trim()}>Add account</Button>{!first && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}<Status msg={msg} busy={busy} /></div>
    </form>
  );
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Import a CSV / OFX / QFX statement: parsed here, previewed, then sent. Lines already imported are skipped by the database. */
export function ImportStatement({ accounts, accountId }: { accounts: Opt[]; accountId: string }) {
  const { busy, msg, run, setMsg } = useAct();
  const [acct, setAcct] = useState(accountId);
  const [file, setFile] = useState<{ name: string; hash: string; parsed: ParsedStatement } | null>(null);
  const [openBal, setOpenBal] = useState(""); const [endBal, setEndBal] = useState("");
  const [inputKey, setInputKey] = useState(0);   // remount the file input after an import, so the same file can be picked again
  const totals = useMemo(() => file ? { in: add(0, ...file.parsed.rows.filter((r) => cmp(r.amount, 0) > 0).map((r) => r.amount)), out: add(0, ...file.parsed.rows.filter((r) => cmp(r.amount, 0) < 0).map((r) => sub(0, r.amount))) } : null, [file]);
  const o = parseBankAmount(openBal), en = parseBankAmount(endBal);
  const check = totals && o !== null && en !== null ? cmp(sub(add(o, totals.in), totals.out), en) === 0 : null;
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-labelledby="imp-h" data-guide="fin.bank-import" data-testid="fin-bank-import">
      <h2 id="imp-h" className="font-display text-base font-extrabold">Import a statement</h2>
      <p className="text-sm text-ink-soft">Download the statement from your bank as CSV, OFX or QFX. Lines are stored exactly as the bank reported them and never edited. Importing the same file again skips lines already here.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label" htmlFor="imp-acct">Account<select id="imp-acct" className="field mt-1" value={acct} onChange={(e) => setAcct(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label className="label" htmlFor="imp-file">Statement file
          <input key={inputKey} id="imp-file" type="file" accept=".csv,.ofx,.qfx,text/csv" className="field mt-1" data-testid="fin-bank-file"
            onChange={async (e) => {
              setMsg(null);
              const f = e.target.files?.[0];
              if (!f) { setFile(null); return; }
              if (f.size > 5_000_000) { setFile(null); setMsg({ tone: "danger", text: "That file is over 5 MB. Export one month at a time." }); return; }
              const text = await f.text();
              const parsed = parseStatement(text);
              setFile({ name: f.name.slice(0, 200), hash: await sha256(text), parsed });
              setEndBal(parsed.endingBalance ?? "");
            }} />
        </label>
      </div>
      {file && (
        <div className="space-y-3 rounded-lg border border-line p-3" data-testid="fin-bank-preview">
          <p className="text-sm"><strong>{file.parsed.rows.length}</strong> line{file.parsed.rows.length === 1 ? "" : "s"} read{file.parsed.start ? ` · ${file.parsed.start} to ${file.parsed.end}` : ""}{totals ? ` · money in ${usd(totals.in)} · money out ${usd(totals.out)}` : ""}</p>
          {file.parsed.errors.length > 0 && (
            <div className="text-sm text-danger" role="alert"><p className="font-semibold">{file.parsed.errors.length} line{file.parsed.errors.length === 1 ? "" : "s"} couldn&apos;t be read and won&apos;t be imported:</p>
              <ul className="list-disc pl-5">{file.parsed.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}</ul>{file.parsed.errors.length > 5 && <p>…and {file.parsed.errors.length - 5} more.</p>}</div>
          )}
          {file.parsed.rows.length > 0 && (
            <>
              <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{file.parsed.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1">{r.date}</td><td>{r.description}</td><td className="text-right tabular-nums">{usd(r.amount)}</td></tr>)}</tbody></table>
                {file.parsed.rows.length > 5 && <p className="text-xs text-muted">First 5 of {file.parsed.rows.length} shown.</p>}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="label" htmlFor="imp-open">Statement opening balance (optional)<input id="imp-open" className="field mt-1" inputMode="decimal" value={openBal} onChange={(e) => setOpenBal(e.target.value)} placeholder="From the statement" /></label>
                <label className="label" htmlFor="imp-end">Statement ending balance (optional)<input id="imp-end" className="field mt-1" inputMode="decimal" value={endBal} onChange={(e) => setEndBal(e.target.value)} placeholder="From the statement" /></label>
              </div>
              {check !== null && <p className={`text-sm ${check ? "text-ok" : "text-danger"}`}>{check ? "The lines add up to the statement's ending balance." : "The lines don't add up to the ending balance. The file may not cover the whole statement. You can still import; it will be flagged for review."}</p>}
              <p className="text-xs text-muted">The ending balance is what the dashboard shows as the bank-reported balance, with this file as its source.</p>
              <Button size="sm" disabled={busy} data-testid="fin-bank-import-go" onClick={async () => {
                const r = await run({ action: "bank_import", accountId: acct, p: { fileName: file.name, fileHash: file.hash, statementStart: file.parsed.start ?? undefined, statementEnd: file.parsed.end ?? undefined,
                  openingBalance: o ?? undefined, endingBalance: en ?? undefined, rows: file.parsed.rows } }, "Imported.");
                if (r) { setMsg({ tone: "ok", text: `Imported ${r.inserted} new line${r.inserted === 1 ? "" : "s"}${Number(r.skipped) ? `, skipped ${r.skipped} already here` : ""}.` }); setFile(null); setOpenBal(""); setEndBal(""); setInputKey((k) => k + 1); }
              }}><Upload className="h-4 w-4" aria-hidden /> Import {file.parsed.rows.length} line{file.parsed.rows.length === 1 ? "" : "s"}</Button>
            </>
          )}
        </div>
      )}
      <Status msg={msg} busy={busy} />
    </section>
  );
}

export interface LineView { id: string; amount: string; posted_on: string; locked: boolean; match: { id: string; target_type: string; exclude_reason: string | null; note: string | null; label: string } | null;
  suggestions: { type: string; id: string; label: string; why: string }[] }

/** The next step for one bank line: confirm a suggested match, pick another record, exclude it, or record an expense. */
export function BankLineActions({ line, others, jobs, codes, canWrite, canExpense }: { line: LineView; others: { type: string; id: string; label: string }[]; jobs: Opt[]; codes: Opt[]; canWrite: boolean; canExpense: boolean }) {
  const { busy, msg, run } = useAct();
  const [mode, setMode] = useState<"" | "other" | "exclude" | "expense" | "undo">("");
  const [pick, setPick] = useState(""); const [reason, setReason] = useState("transfer"); const [note, setNote] = useState("");
  const [job, setJob] = useState(""); const [code, setCode] = useState(""); const [undo, setUndo] = useState("");
  if (line.match) {
    return (
      <div className="text-sm">
        <p><span className="font-semibold">{line.match.target_type === "excluded" ? `Excluded: ${EXCLUDE[line.match.exclude_reason as keyof typeof EXCLUDE] ?? line.match.exclude_reason}` : `Matched: ${line.match.label}`}</span>{line.match.note ? <span className="text-muted"> · {line.match.note}</span> : null}</p>
        {line.locked ? <p className="text-xs text-muted">In a reconciled period. Reopen the period to change it.</p>
          : canWrite && (mode === "undo"
            ? <form className="mt-1 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: "bank_unmatch", matchId: line.match!.id, reason: undo }, "Match undone."); }}>
                <label className="sr-only" htmlFor={`un-${line.id}`}>Why undo</label><input id={`un-${line.id}`} className="field field-sm max-w-xs" required maxLength={500} value={undo} onChange={(e) => setUndo(e.target.value)} placeholder="Why undo? (kept in the audit trail)" />
                <Button size="sm" type="submit" variant="secondary" disabled={busy || !undo.trim()}>Undo match</Button><Button size="sm" type="button" variant="ghost" onClick={() => setMode("")}>Cancel</Button></form>
            : <button type="button" className="mt-1 text-xs font-semibold text-accent-ink underline" onClick={() => setMode("undo")}>Undo match</button>)}
        <Status msg={msg} busy={busy} />
      </div>
    );
  }
  if (!canWrite) return <p className="text-sm text-muted">Not matched</p>;
  if (line.locked) return <p className="text-sm text-muted">Not matched, in a period confirmed with differences. Reopen the period to match it.</p>;
  const out = cmp(line.amount, 0) < 0;
  return (
    <div className="space-y-2 text-sm" data-testid={`fin-line-actions-${line.id}`}>
      {line.suggestions.length > 0
        ? <ul className="flex flex-wrap gap-2">{line.suggestions.map((s) => (
            <li key={`${s.type}:${s.id}`}><Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "bank_match", txnId: line.id, p: { targetType: s.type, targetId: s.id } }, "Matched.")}
              title={s.why} data-testid="fin-line-suggest" className="h-auto min-h-9 whitespace-normal py-1.5 text-left">Match: {s.label} <span className="font-normal text-muted">({s.why})</span></Button></li>))}</ul>
        : <p className="text-muted">No record with this amount nearby.</p>}
      <div className="flex flex-wrap gap-3">
        {others.length > 0 && <button type="button" className="text-xs font-semibold text-accent-ink underline" onClick={() => setMode(mode === "other" ? "" : "other")}>Pick another record</button>}
        <button type="button" className="text-xs font-semibold text-accent-ink underline" onClick={() => setMode(mode === "exclude" ? "" : "exclude")}>Exclude</button>
        {out && canExpense && <button type="button" className="text-xs font-semibold text-accent-ink underline" onClick={() => setMode(mode === "expense" ? "" : "expense")}>Record as expense</button>}
      </div>
      {mode === "other" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const [t, i] = pick.split(":"); void run({ action: "bank_match", txnId: line.id, p: { targetType: t, targetId: i } }, "Matched."); }}>
          <label className="sr-only" htmlFor={`pk-${line.id}`}>Record with the same amount</label>
          <select id={`pk-${line.id}`} className="field field-sm max-w-md" value={pick} onChange={(e) => setPick(e.target.value)} required><option value="">Records with the same amount…</option>{others.map((o) => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}</select>
          <Button size="sm" type="submit" disabled={busy || !pick}>Match</Button>
        </form>
      )}
      {mode === "exclude" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: "bank_match", txnId: line.id, p: { targetType: "excluded", excludeReason: reason, note: note || undefined } }, "Excluded."); }}>
          <label className="sr-only" htmlFor={`ex-${line.id}`}>Reason</label>
          <select id={`ex-${line.id}`} className="field field-sm max-w-xs" value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(EXCLUDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="sr-only" htmlFor={`exn-${line.id}`}>Note</label><input id={`exn-${line.id}`} className="field field-sm max-w-xs" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "other" ? "Note (required)" : "Note (optional)"} required={reason === "other"} />
          <Button size="sm" type="submit" variant="secondary" disabled={busy}>Exclude</Button>
        </form>
      )}
      {mode === "expense" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: "bank_create_expense", txnId: line.id, p: { jobId: job || undefined, costCodeId: code || undefined } }, "Expense recorded (pending approval) and matched."); }}>
          <label className="sr-only" htmlFor={`ej-${line.id}`}>Project</label>
          <select id={`ej-${line.id}`} className="field field-sm max-w-xs" value={job} onChange={(e) => setJob(e.target.value)}><option value="">Overhead (no project)</option>{jobs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <label className="sr-only" htmlFor={`ec-${line.id}`}>Cost code</label>
          <select id={`ec-${line.id}`} className="field field-sm max-w-xs" value={code} onChange={(e) => setCode(e.target.value)}><option value="">Cost code (optional)</option>{codes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          <Button size="sm" type="submit" variant="secondary" disabled={busy}>Record expense</Button>
        </form>
      )}
      <Status msg={msg} busy={busy} />
    </div>
  );
}

/** Confirm an account through a statement date. Differences and unmatched lines can only be confirmed with a note. */
export function ReconcilePanel({ accountId, openingBalance, openingDate, lines, lastEnd, canWrite }: {
  accountId: string; openingBalance: string; openingDate: string; lines: { posted_on: string; amount: string; matched: boolean }[]; lastEnd: string | null; canWrite: boolean;
}) {
  const { busy, msg, run } = useAct();
  const latest = lines.map((l) => l.posted_on).sort().at(-1) ?? "";
  const [endIn, setEnd] = useState(""); const end = endIn || latest; const [stmt, setStmt] = useState(""); const [note, setNote] = useState("");
  const inPeriod = lines.filter((l) => l.posted_on >= openingDate && l.posted_on <= end);
  const bankBal = add(openingBalance, ...inPeriod.map((l) => l.amount));
  const unmatched = inPeriod.filter((l) => !l.matched).length;
  const st = parseBankAmount(stmt);
  const diff = st !== null ? sub(st, bankBal) : null;
  const clean = diff !== null && cmp(diff, 0) === 0 && unmatched === 0;
  if (!canWrite) return null;
  return (
    <form className="space-y-3 rounded-xl border border-line bg-surface p-4" data-guide="fin.bank-reconcile" data-testid="fin-reconcile"
      onSubmit={(e) => { e.preventDefault(); void run({ action: "bank_reconcile", accountId, p: { periodEnd: end, statementBalance: st, note: note || undefined } }, "Period confirmed."); }}>
      <h2 className="font-display text-base font-extrabold">Confirm a period</h2>
      <p className="text-sm text-ink-soft">{lastEnd ? `Confirmed through ${lastEnd}. ` : ""}Pick the statement&apos;s end date and type its ending balance. Lines in a confirmed period are locked until it is reopened.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label" htmlFor="rc-end">Statement end date<input id="rc-end" type="date" className="field mt-1" required min={lastEnd ?? openingDate} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="label" htmlFor="rc-bal">Statement ending balance<input id="rc-bal" className="field mt-1" inputMode="decimal" required value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="0.00" /></label>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-xs text-muted">Bank balance from imported lines</dt><dd className="font-semibold tabular-nums">{usd(bankBal)}</dd></div>
        <div><dt className="text-xs text-muted">Difference</dt><dd className={`font-semibold tabular-nums ${diff !== null && cmp(diff, 0) !== 0 ? "text-danger" : ""}`}>{diff === null ? "—" : usd(diff)}</dd></div>
        <div><dt className="text-xs text-muted">Unmatched lines</dt><dd className={`font-semibold ${unmatched ? "text-danger" : ""}`}>{unmatched}</dd></div>
      </dl>
      {!clean && diff !== null && <label className="label" htmlFor="rc-note">Note explaining the difference (required to confirm anyway)<textarea id="rc-note" className="field mt-1" rows={2} maxLength={1000} required value={note} onChange={(e) => setNote(e.target.value)} /></label>}
      <div className="flex flex-wrap items-center gap-2"><Button type="submit" size="sm" disabled={busy || st === null || !end}>{clean ? "Confirm reconciled" : "Confirm with differences"}</Button><Status msg={msg} busy={busy} /></div>
    </form>
  );
}

export function ReopenPeriod({ id }: { id: string }) {
  const { busy, msg, run } = useAct();
  const [open, setOpen] = useState(false); const [reason, setReason] = useState("");
  if (!open) return <button type="button" className="text-xs font-semibold text-accent-ink underline" onClick={() => setOpen(true)}>Reopen</button>;
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: "bank_reconcile_reopen", reconciliationId: id, reason }, "Period reopened."); }}>
      <label className="sr-only" htmlFor={`ro-${id}`}>Why reopen</label><input id={`ro-${id}`} className="field field-sm max-w-xs" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why reopen? (kept in the audit trail)" />
      <Button size="sm" type="submit" variant="secondary" disabled={busy || !reason.trim()}>Reopen</Button><Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Status msg={msg} busy={busy} />
    </form>
  );
}
