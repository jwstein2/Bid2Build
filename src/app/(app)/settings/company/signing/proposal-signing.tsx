"use client";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, UserCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { MODE_LABELS, type SigningMode } from "@/lib/esign/contractor/config";
import type { SignerRow, SigningSettings } from "@/lib/esign/contractor/settings";

type Policy = SigningSettings["policy"];
const fmt = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function ProposalSigning() {
  const [s, setS] = useState<SigningSettings | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const apply = (d: SigningSettings) => { setS(d); setDraft(d.policy); };
  const load = useCallback(async () => {
    const r = await fetch("/api/signing/policy", { cache: "no-store" }).catch(() => null);
    if (r?.ok) apply(await r.json()); else setMsg("Couldn't load the signing settings. Please refresh.");
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads server state
  useEffect(() => { void load(); }, [load]);

  const eligibleSigners = useMemo(() => (s?.signers ?? []).filter((x) => x.isOwner || x.authorization?.scope === "company_bids"), [s]);
  if (!s || !draft) return <Card className="p-5"><p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>{msg && <p className="mt-2 text-danger" role="alert">{msg}</p>}</Card>;

  const can = s.tenant.canManage;
  const solo = !s.tenant.companyId;
  const set = (p: Partial<Policy>) => { setDraft({ ...draft, ...p }); setStatus("idle"); };
  const designated = draft.defaultSignerId ?? (solo ? s.signers[0]?.userId : s.signers.find((x) => x.isOwner)?.userId) ?? null;
  const designatedRow = s.signers.find((x) => x.userId === designated) ?? null;
  const warnings = policyWarnings(draft, designatedRow, s.signers, solo);

  async function save() {
    setStatus("saving"); setMsg(null);
    const r = await fetch("/api/signing/policy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) { setStatus("error"); setMsg(d?.error?.message ?? "Couldn't save. Please try again."); return; }
    apply(d); setStatus("saved");
  }

  return (
    <div className="space-y-5">
      {!can && <Notice tone="neutral" title="View only">Only the company owner, or an administrator the owner trusted with company proposal policy, can change these settings.</Notice>}
      {!s.policy.configured && can && <Notice tone="warn" title="Not set up yet">Until you save a policy, every accepted proposal waits for a manual contractor countersignature (shown as Awaiting Contractor Signature).</Notice>}

      <Card className="p-5" aria-labelledby="pol-h" data-testid="signing-policy">
        <h2 id="pol-h" className="font-bold">Signing policy</h2>
        <fieldset disabled={!can} className="mt-3 space-y-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.required} onChange={(e) => set({ required: e.target.checked })} data-testid="policy-required" />
            <span><span className="font-semibold">Require a contractor signature on every accepted proposal</span><span className="block text-sm text-ink-soft">Recommended. When off, a proposal counts as accepted once the customer signs, and no contractor signature line is filled in.</span></span>
          </label>

          <div role="radiogroup" aria-label="Who signs for the company" className="grid gap-2 md:grid-cols-3">
            {(Object.keys(MODE_LABELS) as SigningMode[]).filter((m) => !(solo && m === "sales_rep")).map((m) => (
              <label key={m} className={`cursor-pointer rounded-xl border p-3 ${draft.mode === m ? "border-brand bg-brand-tint" : "border-line"}`}>
                <span className="flex items-center gap-2 font-semibold"><input type="radio" name="mode" value={m} checked={draft.mode === m} onChange={() => set({ mode: m })} data-testid={`mode-${m}`} /> {MODE_LABELS[m].title}</span>
                <span className="mt-1 block text-sm text-ink-soft">{MODE_LABELS[m].body}</span>
              </label>
            ))}
          </div>

          {!solo && (
            <div>
              <label htmlFor="sp-signer" className="mb-1 block text-sm font-semibold">Default authorized company signer</label>
              <select id="sp-signer" className="field max-w-md" value={draft.defaultSignerId ?? ""} onChange={(e) => set({ defaultSignerId: e.target.value || null })} data-testid="default-signer">
                <option value="">Company owner{s.signers.find((x) => x.isOwner) ? ` (${s.signers.find((x) => x.isOwner)!.name})` : ""}</option>
                {eligibleSigners.filter((x) => !x.isOwner).map((x) => <option key={x.userId} value={x.userId}>{x.name}{x.authorization?.title ? `, ${x.authorization.title}` : ""}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">Only the owner, or members you authorized to sign any company contract, can be the default signer.</p>
            </div>
          )}

          {draft.mode !== "manual" && (
            <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.autoApplyAllowed} onChange={(e) => set({ autoApplyAllowed: e.target.checked })} data-testid="policy-auto" />
                <span><span className="font-semibold">Allow automatic application</span><span className="block text-sm text-ink-soft">Only for a signer who personally authorized it in My Signature. It is recorded as applied under prior authorization, never as a signature made at that moment. Leave off to require fresh approval for each contract.</span></span>
              </label>
              {draft.autoApplyAllowed && (
                <div role="radiogroup" aria-label="When to apply it" className="flex flex-wrap gap-4 pl-8 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="timing" checked={draft.autoApplyTiming === "before_send"} onChange={() => set({ autoApplyTiming: "before_send" })} /> Before the proposal is sent (customer sees it signed)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="timing" checked={draft.autoApplyTiming === "after_customer"} onChange={() => set({ autoApplyTiming: "after_customer" })} /> Right after the customer signs</label>
                </div>
              )}
            </div>
          )}

          {!solo && draft.mode === "sales_rep" && (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={draft.repSignaturesAllowed} onChange={(e) => set({ repSignaturesAllowed: e.target.checked })} data-testid="policy-reps" />
              <span><span className="font-semibold">Allow sales representative signatures</span><span className="block text-sm text-ink-soft">A rep signs only if you authorized them below and they have a signature on file. Otherwise the company signer signs.</span></span>
            </label>
          )}
        </fieldset>

        {warnings.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-warn-tint p-3 text-sm text-warn" data-testid="policy-warnings">
            {warnings.map((w) => <li key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w}</li>)}
          </ul>
        )}
        {can && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="accent" onClick={() => void save()} disabled={status === "saving"} data-testid="save-policy">{status === "saving" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save signing policy</Button>
            <span role="status" className="text-sm text-muted">{status === "saved" ? `Saved (revision ${s.policy.revision}). Applies to signing links created from now on.` : status === "error" ? "" : s.policy.revision ? `Revision ${s.policy.revision}${s.policy.updatedAt ? `, saved ${fmt(s.policy.updatedAt)}` : ""}` : ""}</span>
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-danger" role="alert">{msg}</p>}
        <p className="mt-3 text-xs text-muted">Changing the policy or anyone&apos;s signature never changes contracts already signed. Each link keeps the rules that applied when it was created.</p>
      </Card>

      {!solo && can && <SignersCard s={s} onChange={apply} />}

      <Card className="p-5">
        <h2 className="font-bold">Your own signature</h2>
        <p className="mt-1 text-sm text-ink-soft">{s.me ? <>You have a signature on file (version {s.me.version}, {s.me.legalName}).</> : "You haven't set up a signature yet."} Manage it in <Link className="font-semibold text-accent-ink underline" href="/settings/account/signature">Account settings → My signature</Link>.</p>
      </Card>
    </div>
  );
}

function policyWarnings(p: Policy, designated: SignerRow | null, signers: SignerRow[], solo: boolean): string[] {
  if (!p.required) return [];
  const out: string[] = [];
  if (!designated?.credential) out.push(`${designated ? designated.name : "The designated signer"} has no signature on file yet. Accepted proposals will wait as Awaiting Contractor Signature until they set one up and sign.`);
  if (p.mode !== "manual" && p.autoApplyAllowed && designated?.credential && !designated.credential.autoApplyAuthorized) out.push(`${designated.name} hasn't authorized automatic application, so they'll be asked to countersign each contract.`);
  if (!solo && p.mode === "sales_rep" && p.repSignaturesAllowed && !signers.some((x) => x.authorization)) out.push("No sales representatives are authorized to sign yet. Authorize them below.");
  return out;
}

function SignersCard({ s, onChange }: { s: SigningSettings; onChange: (d: SigningSettings) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [form, setForm] = useState<{ scope: "own_bids" | "company_bids"; autoApplyAllowed: boolean; title: string }>({ scope: "own_bids", autoApplyAllowed: false, title: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function send(method: "POST" | "DELETE", userId: string) {
    setBusy(userId); setErr(null);
    const r = await fetch(method === "POST" ? "/api/signing/authorizations" : `/api/signing/authorizations?userId=${userId}`, {
      method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ userId, ...form }) : undefined,
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(null);
    if (!r?.ok) return setErr(d?.error?.message ?? "Couldn't update. Please try again.");
    onChange(d); setEdit(null);
  }
  return (
    <Card className="p-5" aria-labelledby="signers-h" data-testid="signers-card">
      <h2 id="signers-h" className="flex items-center gap-2 font-bold"><UserCheck className="h-5 w-5 text-brand" aria-hidden /> Who can sign for {s.tenant.companyName ?? "the company"}</h2>
      <p className="mt-1 text-sm text-ink-soft">Only you decide who may sign contracts on the company&apos;s behalf. Nobody can authorize themselves. Revoking stops future use right away; contracts already signed stay as they are.</p>
      <ul className="mt-4 divide-y divide-line">
        {s.signers.map((x) => (
          <li key={x.userId} className="py-3" data-testid={`signer-${x.email ?? x.userId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold [overflow-wrap:anywhere]">{x.name} <span className="text-sm font-normal text-muted">· {x.isOwner ? "Company owner" : x.role}</span></p>
                <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                  {x.isOwner ? <Badge tone="ok" className="gap-1"><ShieldCheck className="h-3 w-3" aria-hidden />Always authorized</Badge>
                    : x.authorization ? <Badge tone="ok" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden />{x.authorization.scope === "company_bids" ? "Signs any company contract" : "Signs own bids"}{x.authorization.autoApplyAllowed ? " · auto allowed" : ""}</Badge>
                    : <Badge>Not authorized</Badge>}
                  {x.credential ? <Badge tone="brand">Signature v{x.credential.version}{x.credential.autoApplyAuthorized ? " · auto authorized by signer" : ""}</Badge> : <Badge tone="warn">No signature on file</Badge>}
                  {x.authorization?.title ? <Badge>{x.authorization.title}</Badge> : null}
                </p>
              </div>
              {!x.isOwner && x.role !== "viewer" && x.userId !== edit && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setEdit(x.userId); setForm({ scope: x.authorization?.scope ?? "own_bids", autoApplyAllowed: x.authorization?.autoApplyAllowed ?? false, title: x.authorization?.title ?? "" }); }} data-testid="authorize">{x.authorization ? "Change" : "Authorize to sign"}</Button>
                  {x.authorization && <Button size="sm" variant="ghost" className="text-danger" onClick={() => void send("DELETE", x.userId)} disabled={busy === x.userId} data-testid="revoke-authorization">Revoke</Button>}
                </div>
              )}
            </div>
            {edit === x.userId && (
              <div className="mt-3 grid gap-3 rounded-lg border border-line bg-paper p-3 sm:grid-cols-2">
                <div role="radiogroup" aria-label="What they may sign" className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={form.scope === "own_bids"} onChange={() => setForm({ ...form, scope: "own_bids" })} /> Only bids assigned to them</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={form.scope === "company_bids"} onChange={() => setForm({ ...form, scope: "company_bids" })} /> Any company contract</label>
                  <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={form.autoApplyAllowed} onChange={(e) => setForm({ ...form, autoApplyAllowed: e.target.checked })} /> Allow automatic application (if they authorize it too)</label>
                </div>
                <div>
                  <label htmlFor={`t-${x.userId}`} className="mb-1 block text-sm font-semibold">Title on contracts</label>
                  <input id={`t-${x.userId}`} className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} placeholder="Sales Representative" />
                  <div className="mt-2 flex gap-2"><Button size="sm" variant="accent" onClick={() => void send("POST", x.userId)} disabled={busy === x.userId} data-testid="confirm-authorize">Save authorization</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
    </Card>
  );
}
