"use client";
import { useEffect, useState } from "react";
import { Check, Copy, MessageSquare, Send, Share2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { workerInviteText, type InviteStatus } from "@/lib/workforce/hub/invite";

/**
 * V8.3.1 "Invite to the worker app" for a staff record (HR file, Team list, Time tracking → Employees).
 * Creates a one-time join link that signs them up, joins the company and links their login to this record, then the
 * owner copies it, texts it from their own phone, shares it, or has Built2Bid email it. Refused in Practice Mode.
 */
type Result = { status: "linked" } | { status: "invited"; link: string; expiresAt: string; emailed: boolean; emailNote: string | null };
const input = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function WorkerInviteButton({ resourceId, name, email, phone, companyName, size = "sm", onDone }: {
  resourceId: string; name: string; email?: string | null; phone?: string | null; companyName?: string | null; size?: "sm" | "md"; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)} data-testid={`worker-invite-${resourceId}`}><Smartphone className="h-4 w-4" aria-hidden /> Invite to the worker app</Button>
      {open && <WorkerInviteDialog resourceId={resourceId} name={name} email={email ?? null} phone={phone ?? null} companyName={companyName ?? null} onClose={() => { setOpen(false); onDone?.(); }} />}
    </>
  );
}

/** HR file card: shows whether they have a login and offers the invite. */
export function WorkerAppCard({ resourceId, name, email, phone }: { resourceId: string; name: string; email: string | null; phone: string | null }) {
  const [st, setSt] = useState<InviteStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    void api<InviteStatus>(`/api/workforce/hub/invite?resourceId=${resourceId}`).then((r) => { if (!off && r.ok) setSt(r.data); });
    return () => { off = true; };
  }, [resourceId, tick]);
  if (!st || st.kind !== "staff") return null;
  return (
    <section className="space-y-2 rounded-xl border border-line bg-surface p-4" data-testid="worker-app-card">
      <h2 className="flex items-center gap-2 text-xl font-extrabold text-navy"><Smartphone className="h-5 w-5 text-accent-ink" aria-hidden /> Worker app</h2>
      {st.linked ? (
        <p className="text-sm text-ink-soft"><Badge tone="ok">Has a login</Badge> {name} opens <strong>My work</strong> to see today&apos;s jobs, their week and the time clock.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">{name} doesn&apos;t have a login yet. Send them a link: they set up their login on their phone and land in <strong>My work</strong> (today&apos;s jobs, their week, the time clock).</p>
          {st.pending && <p className="text-sm"><Badge>Invite sent</Badge> to {st.pending.email}, works until {fmt(st.pending.expiresAt)}.</p>}
          <WorkerInviteButton resourceId={resourceId} name={name} email={email ?? st.email} phone={phone ?? st.phone} size="md" onDone={() => setTick((t) => t + 1)} />
        </>
      )}
    </section>
  );
}

function WorkerInviteDialog({ resourceId, name, email, phone, companyName, onClose }: { resourceId: string; name: string; email: string | null; phone: string | null; companyName: string | null; onClose: () => void }) {
  const [st, setSt] = useState<InviteStatus | null>(null);
  const [to, setTo] = useState(email ?? "");
  const [send, setSend] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let off = false;
    void api<InviteStatus>(`/api/workforce/hub/invite?resourceId=${resourceId}`).then((r) => {
      if (off) return;
      if (r.ok) { setSt(r.data); if (!email && r.data.email) setTo(r.data.email); } else setErr(r.message);
    });
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => { off = true; window.removeEventListener("keydown", k); };
  }, [resourceId, email, onClose]);

  async function create() {
    setBusy(true); setErr(null);
    const r = await api<Result>("/api/workforce/hub/invite", { method: "POST", body: JSON.stringify({ resourceId, email: to, send }) });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setRes(r.data);
  }
  const link = res?.status === "invited" ? res.link : null;
  const text = link ? workerInviteText(companyName || "Your company", link) : "";
  const tel = (phone ?? st?.phone ?? "").replace(/[^\d+]/g, "");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Invite ${name} to the worker app`} onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-testid="worker-invite-dialog">
        <div className="flex items-start gap-2">
          <h2 className="mr-auto text-lg font-extrabold text-navy">Invite {name} to the worker app</h2>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" aria-hidden /></Button>
        </div>
        {!st && !err && <p className="mt-3 text-sm text-muted">Loading…</p>}
        {err && <Notice tone="danger" className="mt-3">{err}</Notice>}
        {st && st.linked && !res && <Notice tone="ok" className="mt-3">{name} already has a login. They open My work at built2bid.org/clock.</Notice>}
        {st && !st.linked && !st.company && <Notice className="mt-3">Inviting workers needs a company account (Enterprise), so each worker gets their own login inside your company.</Notice>}
        {st && !st.linked && st.company && !st.canInvite && <Notice className="mt-3">Only people who can manage users (like the company owner) can send invites. Ask them to invite {name}.</Notice>}
        {st && !st.linked && st.canInvite && !res && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">They open the link on their phone, set up a login with this email, and land on <strong>My work</strong>: today&apos;s jobs, their week and the time clock. It uses one of your company seats, like any teammate.</p>
            {st.pending && <p className="text-sm"><Badge>Invite already sent</Badge> to {st.pending.email}, works until {fmt(st.pending.expiresAt)}. A new link replaces it.</p>}
            <label className="block text-sm font-semibold">Their email<input type="email" className={`${input} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" data-testid="worker-invite-email" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} data-testid="worker-invite-send" /> Email the link to them from Built2Bid</label>
            <Button loading={busy} onClick={create} disabled={busy || !to.trim()} className="w-full" data-testid="worker-invite-create"><Send className="h-4 w-4" aria-hidden /> {busy ? "Creating…" : "Create invite link"}</Button>
          </div>
        )}
        {res?.status === "linked" && <Notice tone="ok" className="mt-3">That email already belongs to a member of your company, so their login is now linked to {name}. They can open My work right away.</Notice>}
        {link && res?.status === "invited" && (
          <div className="mt-3 space-y-3" data-testid="worker-invite-result">
            {res.emailed ? <Notice tone="ok">Emailed to {to}. You can also text or share the link below.</Notice> : res.emailNote ? <Notice tone="warn">{res.emailNote}</Notice> : null}
            <div className="flex gap-2">
              <input readOnly value={link} className={`${input} min-w-0 flex-1 font-mono text-xs`} aria-label="Invite link" data-testid="worker-invite-link" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* select instead */ } }}>
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy"}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`sms:${tel}?&body=${encodeURIComponent(text)}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold" data-testid="worker-invite-sms"><MessageSquare className="h-4 w-4" aria-hidden /> Text it{tel ? "" : " (from your phone)"}</a>
              {canShare && <Button variant="secondary" onClick={() => { void navigator.share({ title: "Built2Bid worker app", text }).catch(() => undefined); }}><Share2 className="h-4 w-4" aria-hidden /> Share</Button>}
            </div>
            <p className="text-xs text-muted">The link works once, until {fmt(res.expiresAt)}, and only for {to}. Texting opens your own phone&apos;s messages app.</p>
          </div>
        )}
      </div>
    </div>
  );
}
