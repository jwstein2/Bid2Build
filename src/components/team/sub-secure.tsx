"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, Lock, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { REQUEST_LABEL, SUB_REQUEST_KINDS, type SubRequestKind } from "@/lib/team/sub-requests";

export interface SubDocRequest { id: string; kinds: SubRequestKind[]; toEmail: string | null; createdAt: string; expiresAt: string; openedAt: string | null; completedAt: string | null; revokedAt: string | null }

const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const stateOf = (r: SubDocRequest, now: number) => r.completedAt ? "completed" : r.revokedAt ? "canceled" : new Date(r.expiresAt).getTime() < now ? "expired" : r.openedAt ? "opened" : "sent";

/**
 * "Request documents": a one-time link the sub uses to fill in their W-9 and upload certificates themselves.
 * Emailed under the company's name when customer email is on; the link can always be copied and texted.
 */
export function RequestDocsCard({ resourceId, requests, defaultEmail, now }: { resourceId: string; requests: SubDocRequest[]; defaultEmail: string; now: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<SubRequestKind[]>(["w9", "coi_general_liability"]);
  const [email, setEmail] = useState(defaultEmail);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const toggle = (k: SubRequestKind) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  async function create() {
    setBusy(true); setMsg(null);
    const r = await api<{ link: string; emailed: boolean; emailNote: string | null }>(`/api/team/subs/${resourceId}/request`, { method: "POST", body: JSON.stringify({ kinds, toEmail: email.trim() || undefined, note: note.trim() || undefined, send: !!email.trim() }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setLink(r.data.link);
    setMsg({ ok: true, text: r.data.emailed ? `Emailed to ${email.trim()}. You can also copy the link below.` : r.data.emailNote ?? "Link ready. Copy it and send it to them." });
    setOpen(false);
    router.refresh();
  }
  async function revoke(id: string) {
    const r = await api(`/api/team/subs/${resourceId}/request?request=${id}`, { method: "DELETE" });
    if (!r.ok) setMsg({ ok: false, text: r.message }); else { setMsg({ ok: true, text: "Link canceled." }); router.refresh(); }
  }
  const recent = requests.slice(0, 5);

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="sub-request">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold text-navy">Ask the sub to send paperwork</h2>
        {!open && <Button size="sm" onClick={() => setOpen(true)}><Send className="h-4 w-4" aria-hidden /> Request documents</Button>}
      </div>
      <p className="text-sm text-ink-soft">They get a secure link to fill in their W-9 online and upload certificates. No account needed. What they send lands on this page.</p>
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper p-2">
          <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
          <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(link); setMsg({ ok: true, text: "Link copied." }); }}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
        </div>
      )}
      {open && (
        <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
          <fieldset>
            <legend className="label">What to ask for</legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {SUB_REQUEST_KINDS.map((k) => <label key={k} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} />{REQUEST_LABEL[k]}</label>)}
            </div>
          </fieldset>
          <label className="block"><span className="label">Their email (leave blank to just copy the link)</span><input type="email" className="field" value={email} maxLength={320} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block"><span className="label">Note (optional)</span><input className="field" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please list us as additional insured" /></label>
          <div className="flex gap-2">
            <Button loading={busy} size="sm" onClick={create} disabled={busy || kinds.length === 0}>{busy ? "Creating…" : email.trim() ? "Send request" : "Create link"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {recent.map((r) => {
            const st = stateOf(r, now);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="mr-auto">{r.kinds.map((k) => REQUEST_LABEL[k].replace(/ \(.*\)$/, "")).join(", ")}<span className="block text-xs text-muted">{r.toEmail ? `To ${r.toEmail} · ` : ""}Sent {fmt(r.createdAt)}{st === "sent" || st === "opened" ? ` · expires ${fmt(r.expiresAt)}` : ""}</span></span>
                <Badge tone={st === "completed" ? "ok" : st === "opened" ? "warn" : undefined}>{st === "completed" ? "Received" : st === "opened" ? "Opened" : st === "sent" ? "Waiting" : st === "expired" ? "Expired" : "Canceled"}</Badge>
                {(st === "sent" || st === "opened") && <Button size="sm" variant="ghost" onClick={() => revoke(r.id)} aria-label="Cancel this link"><X className="h-4 w-4" aria-hidden /> Cancel</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The full SSN/EIN for 1099-NEC filing: encrypted, masked by default, and every reveal is logged. */
export function FullTinCard({ resourceId, status, ready, tinType }: { resourceId: string; status: { onFile: boolean; last4?: string; updatedAt?: string } | null; ready: boolean; tinType: "ssn" | "ein" | null }) {
  const router = useRouter();
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tin, setTin] = useState("");
  const [type, setType] = useState<"ssn" | "ein">(tinType ?? "ein");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!status) return null;

  async function reveal() {
    if (shown) { setShown(null); return; }
    const r = await api<{ tin: string }>(`/api/team/subs/${resourceId}/tin`);
    if (!r.ok) setMsg({ ok: false, text: r.message }); else { setShown(r.data.tin); setTimeout(() => setShown(null), 30_000); }
  }
  async function save() {
    setBusy(true); setMsg(null);
    const r = await api(`/api/team/subs/${resourceId}/tin`, { method: "POST", body: JSON.stringify({ tin, tinType: type }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setTin(""); setEditing(false); setMsg({ ok: true, text: "Full tax ID saved and encrypted." }); router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid="full-tin">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-xl font-extrabold text-navy"><Lock className="h-5 w-5" aria-hidden />Full tax ID for 1099s</h2>
        {status.onFile ? <Badge tone="ok">On file, encrypted</Badge> : <Badge>Not on file</Badge>}
      </div>
      {!ready ? (
        <p className="text-sm text-ink-soft">Coming soon: storing the full SSN or EIN turns on once the account owner sets the encryption key. Until then only the last 4 digits are kept.</p>
      ) : (
        <>
          {status.onFile && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg" aria-live="polite">{shown ?? `•••-••-${status.last4}`}</span>
              <Button size="sm" variant="secondary" onClick={reveal}>{shown ? <><EyeOff className="h-4 w-4" aria-hidden /> Hide</> : <><Eye className="h-4 w-4" aria-hidden /> Show</>}</Button>
            </div>
          )}
          {editing ? (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
              <label className="block"><span className="label">Type</span><select className="field" value={type} onChange={(e) => setType(e.target.value as "ssn" | "ein")}><option value="ein">EIN</option><option value="ssn">SSN</option></select></label>
              <label className="block"><span className="label">9-digit number</span><input className="field" inputMode="numeric" autoComplete="off" maxLength={11} value={tin} onChange={(e) => setTin(e.target.value.replace(/[^\d-]/g, ""))} /></label>
              <div className="flex items-end gap-2"><Button loading={busy} size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
            </div>
          ) : <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{status.onFile ? "Replace" : "Enter full tax ID"}</Button>}
          <p className="text-xs text-muted">Encrypted before it&apos;s stored. Showing it hides again after 30 seconds, and every save and view is recorded with who did it.</p>
        </>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
    </section>
  );
}
