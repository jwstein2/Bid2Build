"use client";
import { useState } from "react";
import { Eye, EyeOff, Landmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";

/**
 * Encrypted bank account number for an employee (direct deposit) or a subcontractor (ACH payments). Masked to
 * the last 4; showing it hides again after 30 seconds. Every save, view and removal is recorded with who did it.
 */
export function BankAccountCard({ resourceId, status, ready, purpose, onDone, onError }: {
  resourceId: string; status: { onFile: boolean; last4: string | null }; ready: boolean; purpose: "direct deposit" | "ACH payments";
  onDone: (t: string) => void; onError: (t: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  async function reveal() {
    if (shown) { setShown(null); return; }
    const r = await api<{ account: string }>(`/api/team/bank/${resourceId}`);
    if (!r.ok) onError(r.message); else { setShown(r.data.account); setTimeout(() => setShown(null), 30_000); }
  }
  async function save() {
    setBusy(true);
    const r = await api(`/api/team/bank/${resourceId}`, { method: "POST", body: JSON.stringify({ account }) });
    setBusy(false);
    if (!r.ok) { onError(r.message); return; }
    setAccount(""); setEditing(false); onDone("Bank account number saved and encrypted.");
  }
  async function remove() {
    const r = await api(`/api/team/bank/${resourceId}`, { method: "DELETE" });
    if (!r.ok) onError(r.message); else { setShown(null); onDone("Bank account number removed."); }
  }
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="bank-account">
      <h2 className="text-xl font-extrabold text-navy">Bank account number ({purpose})</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="h-4 w-4 text-ink-soft" aria-hidden />
        {status.onFile ? <Badge tone="ok">On file, encrypted</Badge> : <Badge>Not on file</Badge>}
      </div>
      {!ready ? (
        <p className="text-sm text-ink-soft">Coming soon: storing bank account numbers turns on once the account owner sets the encryption key.</p>
      ) : (
        <>
          {status.onFile && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg" aria-live="polite">{shown ?? `••••${status.last4 ?? ""}`}</span>
              <Button size="sm" variant="secondary" onClick={reveal}>{shown ? <><EyeOff className="h-4 w-4" aria-hidden /> Hide</> : <><Eye className="h-4 w-4" aria-hidden /> Show</>}</Button>
              <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden /> Remove</Button>
            </div>
          )}
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">Account number</span><input className="field" inputMode="numeric" autoComplete="off" maxLength={20} value={account} onChange={(e) => setAccount(e.target.value.replace(/[^\d]/g, ""))} data-testid="bank-input" /></label>
              <Button loading={busy} size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setAccount(""); }}>Cancel</Button>
            </div>
          ) : <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{status.onFile ? "Replace" : "Enter account number"}</Button>}
        </>
      )}
      <p className="text-xs text-muted">Encrypted before it&apos;s stored. Bank name, account type and routing number are saved with the rest of the record. Every save, view and removal is recorded with who did it. Never included in exports or reports.</p>
    </section>
  );
}
