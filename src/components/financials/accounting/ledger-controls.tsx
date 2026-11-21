"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newKey, today, usd } from "@/components/financials/fin-client";
import { finErrorText } from "@/lib/financials/ui-labels";
import { checkJournal, journalPayload, journalTotals, GL_TYPES, GL_TYPE_SINGULAR, type DraftLine, type GlType } from "@/lib/financials/general-ledger";
import { Status, useAct, type Opt } from "./controls";

const blank = (): DraftLine => ({ account: "", debit: "", credit: "", jobId: "", description: "" });

/** Manual journal entry: balanced lines, at least one debit and one credit. The database checks again. */
export function JournalForm({ accounts, jobs, minDate }: { accounts: Opt[]; jobs: Opt[]; minDate: string | null }) {
  const { busy, msg, run, setMsg } = useAct();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [opening, setOpening] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([blank(), blank()]);
  const [key, setKey] = useState(newKey());
  const t = journalTotals(lines);
  const set = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  if (!open) return <Button size="sm" onClick={() => setOpen(true)} data-testid="gl-new-entry"><Plus className="h-4 w-4" aria-hidden /> New journal entry</Button>;
  return (
    <form className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="gl-journal-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const err = checkJournal(memo, date, lines);
        if (err) { setMsg({ tone: "danger", text: finErrorText(err) }); return; }
        const r = await run({ action: "gl_journal_post", key, p: { date, memo: memo.trim(), opening: opening || undefined, lines: journalPayload(lines) } }, "Entry posted.");
        if (r) { setLines([blank(), blank()]); setMemo(""); setOpening(false); setKey(newKey()); setOpen(false); }
      }}>
      <h3 className="font-display text-lg font-extrabold">New journal entry</h3>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold text-ink-soft" htmlFor="gl-date">Date
          <input id="gl-date" type="date" className="field field-sm mt-1 block" value={date} min={minDate ?? undefined} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="min-w-60 flex-1 text-xs font-semibold text-ink-soft" htmlFor="gl-memo">Memo
          <input id="gl-memo" className="field field-sm mt-1 block w-full" maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What this entry is for" required />
        </label>
        <label className="flex min-h-11 items-end gap-2 text-sm"><input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} /> Opening balance</label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1 pr-2">Account</th><th className="py-1 pr-2">Debit</th><th className="py-1 pr-2">Credit</th><th className="py-1 pr-2">Project</th><th className="py-1 pr-2">Line note</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2"><select aria-label={`Line ${i + 1} account`} className="field field-sm w-full" value={l.account} onChange={(e) => set(i, { account: e.target.value })}><option value="">Choose…</option>{accounts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" className="field field-sm w-28 text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value.replace(/[^0-9.]/g, ""), credit: e.target.value ? "" : l.credit })} /></td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" className="field field-sm w-28 text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value.replace(/[^0-9.]/g, ""), debit: e.target.value ? "" : l.debit })} /></td>
                <td className="py-1 pr-2"><select aria-label={`Line ${i + 1} project`} className="field field-sm w-full" value={l.jobId} onChange={(e) => set(i, { jobId: e.target.value })}><option value="">None</option>{jobs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></td>
                <td className="py-1 pr-2"><input aria-label={`Line ${i + 1} note`} className="field field-sm w-full" maxLength={300} value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td className="py-1">{lines.length > 2 && <Button type="button" size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line font-semibold"><td className="py-2">Totals</td><td className="py-2 tabular-nums">{usd(t.debit)}</td><td className="py-2 tabular-nums">{usd(t.credit)}</td><td colSpan={3} className={`py-2 ${Number(t.difference) ? "text-danger" : "text-muted"}`}>{Number(t.difference) ? `Off by ${usd(Math.abs(Number(t.difference)).toFixed(2))}` : "Balanced"}</td></tr></tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])} disabled={lines.length >= 100}><Plus className="h-4 w-4" aria-hidden /> Add line</Button>
        <Button type="submit" size="sm" disabled={busy}>Post entry</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Status msg={msg} busy={busy} />
      </div>
      <p className="text-xs text-muted">Posted entries can&apos;t be edited. To correct one, reverse it and post a new entry.</p>
    </form>
  );
}

/** Reverse a manual, opening or payroll entry, with a reason. */
export function ReverseEntry({ entryId }: { entryId: string }) {
  const { busy, msg, run } = useAct();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reverse</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: "gl_journal_reverse", entryId, reason }, "Reversed."); }}>
      <label className="text-xs font-semibold text-ink-soft" htmlFor={`rv-${entryId}`}>Reason
        <input id={`rv-${entryId}`} className="field field-sm mt-1 block" maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || !reason.trim()}>Post reversal</Button>
      <Status msg={msg} busy={busy} />
    </form>
  );
}

/** Close the books through a date (or reopen with a reason). */
export function ClosePeriod({ lockedThrough }: { lockedThrough: string | null }) {
  const { busy, msg, run } = useAct();
  const [through, setThrough] = useState(lockedThrough ?? "");
  const [reason, setReason] = useState("");
  const reopening = Boolean(lockedThrough) && (!through || through < (lockedThrough ?? ""));
  return (
    <form className="flex flex-wrap items-end gap-2" data-guide="fin.gl-close" data-testid="gl-close"
      onSubmit={(e) => { e.preventDefault(); void run({ action: "gl_lock_period", through: through || null, reason: reason || undefined }, through ? `Books closed through ${through}.` : "Books reopened."); }}>
      <label className="text-xs font-semibold text-ink-soft" htmlFor="gl-lock">Books closed through
        <input id="gl-lock" type="date" className="field field-sm mt-1 block" value={through} max={today()} onChange={(e) => setThrough(e.target.value)} />
      </label>
      {reopening && (
        <label className="min-w-48 flex-1 text-xs font-semibold text-ink-soft" htmlFor="gl-lock-reason">Why reopen?
          <input id="gl-lock-reason" className="field field-sm mt-1 block w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
      )}
      <Button type="submit" size="sm" variant="secondary" disabled={busy || through === (lockedThrough ?? "") || (reopening && !reason.trim())}>{reopening ? "Reopen" : "Close books"}</Button>
      <Status msg={msg} busy={busy} />
    </form>
  );
}

/** Add an account, or rename / deactivate one. Built-in accounts keep their type and stay active. */
export function AccountForm({ account }: { account?: { id: string; code: string; name: string; type: GlType; active: boolean; system: boolean } }) {
  const { busy, msg, run } = useAct();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<GlType>(account?.type ?? "expense");
  if (!open) return <Button size="sm" variant={account ? "ghost" : "primary"} onClick={() => setOpen(true)} data-testid={account ? undefined : "gl-add-account"}>{account ? "Edit" : <><Plus className="h-4 w-4" aria-hidden /> Add account</>}</Button>;
  const idp = account?.id.slice(0, 8) ?? "new";
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run({ action: "gl_account_save", p: { id: account?.id, code, name, ...(account?.system ? {} : { type }) } }, "Saved.");
      if (r) setOpen(false);
    }}>
      <label className="text-xs font-semibold text-ink-soft" htmlFor={`ac-code-${idp}`}>Number
        <input id={`ac-code-${idp}`} className="field field-sm mt-1 block w-24" inputMode="numeric" pattern="[0-9]{3,6}(\.[0-9]{1,3})?" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      <label className="min-w-48 flex-1 text-xs font-semibold text-ink-soft" htmlFor={`ac-name-${idp}`}>Name
        <input id={`ac-name-${idp}`} className="field field-sm mt-1 block w-full" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {!account?.system && (
        <label className="text-xs font-semibold text-ink-soft" htmlFor={`ac-type-${idp}`}>Type
          <select id={`ac-type-${idp}`} className="field field-sm mt-1 block" value={type} onChange={(e) => setType(e.target.value as GlType)}>{GL_TYPES.map((t) => <option key={t} value={t}>{GL_TYPE_SINGULAR[t]}</option>)}</select>
        </label>
      )}
      <Button type="submit" size="sm" disabled={busy}>Save</Button>
      {account && !account.system && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "gl_account_save", p: { id: account.id, active: !account.active } }, account.active ? "Turned off." : "Turned on.")}>{account.active ? "Turn off" : "Turn on"}</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <Status msg={msg} busy={busy} />
    </form>
  );
}
