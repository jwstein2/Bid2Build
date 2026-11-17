"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function CoSignForm({ token, customerName, consentVersion, consent, acceptance }: { token: string; customerName: string; consentVersion: string; consent: string; acceptance: string }) {
  const [name, setName] = useState(customerName);
  const [email, setEmail] = useState("");
  const [sig, setSig] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <p className="mt-2 font-semibold text-ok" role="status">Thank you. Your signature was recorded. Keep this link for your records.</p>;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/co/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signerName: name, signerEmail: email, signatureText: sig, consent: agree, consentVersion }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "We couldn't record your signature. Nothing was signed.");
      setDone(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="label">Full name<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} /></label>
        <label className="label">Email<input className="field mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={320} /></label>
      </div>
      <label className="label block">Type your name to sign<input className="field mt-1 font-serif text-xl italic" value={sig} onChange={(e) => setSig(e.target.value)} maxLength={200} /></label>
      <label className="flex items-start gap-2 text-sm text-ink-soft"><input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{consent}</span></label>
      <p className="rounded-lg bg-paper p-3 text-sm text-ink-soft">{acceptance}</p>
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <button type="button" onClick={() => void submit()} disabled={busy || !agree || name.trim().length < 2 || sig.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email)}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-navy px-5 font-semibold text-white hover:bg-navy/90 disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Approve &amp; sign
      </button>
    </div>
  );
}
