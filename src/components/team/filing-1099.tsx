"use client";
import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";

type Payer = { legalName: string; ein: string | null; address: string | null; phone: string | null };

/**
 * Filing help for 1099-NEC: your payer details, recipient copies (Copy B PDF, last 4 of the TIN only) and an
 * e-file CSV with full tax IDs for an IRS IRIS upload or a filing service. Built2Bid doesn't file the forms.
 */
export function Filing1099({ year, count }: { year: number; count: number }) {
  const [payer, setPayer] = useState<Payer | null | undefined>(undefined);
  const [f, setF] = useState({ legalName: "", ein: "", address: "", phone: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<Payer | null>("/api/team/1099/payer").then((r) => {
      if (!live) return;
      const p = r.ok ? r.data : null;
      setPayer(p);
      if (p) setF({ legalName: p.legalName, ein: p.ein ?? "", address: p.address ?? "", phone: p.phone ?? "" });
      else setEditing(true);
    });
    return () => { live = false; };
  }, []);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await api("/api/team/1099/payer", { method: "POST", body: JSON.stringify({ legalName: f.legalName, ein: f.ein || undefined, address: f.address || undefined, phone: f.phone || undefined }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    const ein = f.ein.replace(/\D/g, "");
    setPayer({ legalName: f.legalName, ein: ein ? `${ein.slice(0, 2)}-${ein.slice(2)}` : null, address: f.address || null, phone: f.phone || null });
    setEditing(false); setMsg({ ok: true, text: "Payer details saved." });
  }
  async function get(path: string, name: string) {
    setMsg(null);
    const res = await fetch(path);
    if (!res.ok) { const b = await res.json().catch(() => ({})); setMsg({ ok: false, text: b?.error?.message ?? "Couldn't make the file." }); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const ready = !!payer?.ein;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="filing-1099">
      <h2 className="text-lg font-extrabold text-navy">File {year} 1099-NECs</h2>
      {payer === undefined ? <p className="text-sm text-muted">Loading…</p> : editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Your legal business name</span><input className="field" value={f.legalName} maxLength={200} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></label>
          <label className="block"><span className="label">Your EIN</span><input className="field" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="12-3456789" value={f.ein} onChange={(e) => setF({ ...f, ein: e.target.value })} /></label>
          <label className="block"><span className="label">Address</span><input className="field" value={f.address} maxLength={500} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label className="block"><span className="label">Phone</span><input className="field" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <div className="flex gap-2 sm:col-span-2"><Button loading={busy} size="sm" onClick={save} disabled={busy || !f.legalName.trim()}>{busy ? "Saving…" : "Save payer details"}</Button>{payer && <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>}</div>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Payer: <b>{payer?.legalName}</b> · EIN {payer?.ein ?? "not set"} <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button></p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!ready || count === 0} onClick={() => get(`/api/team/1099/copy-b?year=${year}`, `1099-nec-${year}-copy-b.pdf`)}><FileText className="h-4 w-4" aria-hidden /> Recipient copies (PDF)</Button>
        <Button size="sm" variant="secondary" disabled={!ready || count === 0} onClick={() => get(`/api/team/1099/efile?year=${year}`, `1099-nec-${year}-efile.csv`)}><Download className="h-4 w-4" aria-hidden /> E-file CSV (full tax IDs)</Button>
      </div>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <p className="text-xs text-muted">Recipient copies show only the last 4 digits of each tax ID; mail or email one to each sub by January 31. The e-file CSV has full tax IDs for the IRS IRIS portal or your filing service, and each download is recorded. Subs without a full tax ID on file have that column blank. Built2Bid prepares these files; it doesn&apos;t file with the IRS.</p>
    </section>
  );
}
