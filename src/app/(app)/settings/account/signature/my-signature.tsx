"use client";
import Link from "next/link";
import { CheckCircle2, Loader2, Mail, PenLine, ShieldCheck, Type, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { SignaturePad } from "@/components/esign/signature-pad";
import { getBrowserClient } from "@/lib/supabase/client";
import { ADOPTION_VERSION, adoptionText, autoApplyText } from "@/lib/esign/contractor/config";
import type { SigningSettings } from "@/lib/esign/contractor/settings";
import { FileDrop } from "@/components/ui/file-drop";

type Method = "drawn" | "typed" | "uploaded";
interface Credential { id: string; version: number; legal_name: string; title: string | null; method: Method; signature_text: string | null; signature_image: string | null; auto_apply_authorized: boolean; auto_apply_revoked_at: string | null; created_at: string }
interface Data { credential: Credential | null; settings: SigningSettings; recentAuth: { ok: boolean; at: string | null }; email: string | null }

const fmt = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function MySignature() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/signing/credential", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setData(await r.json()); else setErr("Couldn't load your signature. Please refresh.");
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads server state
  useEffect(() => { void load(); }, [load]);

  async function revoke(scope: "auto_apply" | "all") {
    setBusy(scope); setErr(null);
    const r = await fetch(`/api/signing/credential?scope=${scope}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setData(await r.json()); else setErr("Couldn't update your signature. Please try again.");
    setBusy(null);
  }

  if (!data) return <Card className="p-5"><p className="flex items-center gap-2 text-ink-soft"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</p>{err && <p className="mt-2 text-danger" role="alert">{err}</p>}</Card>;
  const c = data.credential;
  const t = data.settings.tenant;
  const auth = data.settings.myAuthorization;
  const autoOn = Boolean(c?.auto_apply_authorized && !c.auto_apply_revoked_at);

  return (
    <div className="space-y-5">
      <Card className="p-5" aria-labelledby="authz-h" data-testid="my-authorization">
        <h2 id="authz-h" className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5 text-brand" aria-hidden /> Your signing authorization</h2>
        {!t.companyId ? (
          <p className="mt-1 text-sm text-ink-soft">You sign for your own business. Your signing rules are in <Link className="font-semibold text-accent-ink underline" href="/settings/company/signing">Company profile → Proposal signing</Link>.</p>
        ) : t.isOwner ? (
          <p className="mt-1 text-sm text-ink-soft">As the owner of <b>{t.companyName}</b>, you can sign contracts for the company. You decide who else can in <Link className="font-semibold text-accent-ink underline" href="/settings/company/signing">Company profile → Proposal signing</Link>.</p>
        ) : auth ? (
          <p className="mt-1 text-sm text-ink-soft">The owner of <b>{t.companyName}</b> authorized you to sign {auth.scope === "company_bids" ? "any company contract" : "contracts for bids assigned to you"}{auth.title ? <> as <b>{auth.title}</b></> : null}, since {fmt(auth.grantedAt)}. Automatic application: <b>{auth.autoApplyAllowed ? "allowed by the company" : "not allowed by the company"}</b>.</p>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">You aren&apos;t authorized to sign contracts for <b>{t.companyName}</b>. You can still set up your signature; only the company owner can authorize you to use it for the company.</p>
        )}
      </Card>

      {c && !editing ? (
        <Card className="p-5" aria-labelledby="mysig-h" data-testid="my-signature-current">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="mysig-h" className="font-bold">Signature on file</h2>
            <Badge tone="ok" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Active · version {c.version}</Badge>
          </div>
          <div className="theme-light mt-3 flex min-h-24 items-center justify-center rounded-lg border border-line bg-white p-3 text-ink">
            {c.method === "typed"
              ? <span className="text-center"><span className="block font-serif text-3xl italic">{c.signature_text}</span>{c.signature_text && c.signature_text.toLowerCase() !== c.legal_name.toLowerCase() && <span className="mt-1 block text-xs text-ink-soft">By: {c.legal_name}{c.title ? `, ${c.title}` : ""}</span>}</span>
              // eslint-disable-next-line @next/next/no-img-element
              : c.signature_image && <img src={c.signature_image} alt={`Signature of ${c.legal_name}`} className="max-h-24 max-w-full object-contain" />}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Legal name</dt><dd className="font-semibold">{c.legal_name}</dd></div>
            <div><dt className="text-muted">Title</dt><dd className="font-semibold">{c.title || "Not set"}</dd></div>
            <div><dt className="text-muted">Adopted</dt><dd className="font-semibold">{fmt(c.created_at)}</dd></div>
            <div><dt className="text-muted">Automatic application</dt><dd className="font-semibold">{autoOn ? "Authorized (only where company policy allows)" : c.auto_apply_revoked_at ? `Stopped ${fmt(c.auto_apply_revoked_at)}` : "Not authorized: I sign each contract myself"}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted">Changing or revoking your signature never changes contracts already signed. Each one keeps the exact signature it was signed with.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Update signature</Button>
            {autoOn && <Button loading={busy === "auto_apply"} variant="ghost" onClick={() => void revoke("auto_apply")} disabled={busy !== null} data-testid="stop-auto"> Stop automatic use</Button>}
            <Button loading={busy === "all"} variant="ghost" className="text-danger" onClick={() => void revoke("all")} disabled={busy !== null} data-testid="revoke-signature"> Revoke signature</Button>
          </div>
          {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
        </Card>
      ) : (
        <SignatureForm data={data} onSaved={(d) => { setData(d); setEditing(false); }} onCancel={c ? () => setEditing(false) : undefined} onReauthed={load} />
      )}
    </div>
  );
}

function SignatureForm({ data, onSaved, onCancel, onReauthed }: { data: Data; onSaved: (d: Data) => void; onCancel?: () => void; onReauthed: () => void }) {
  const prev = data.credential;
  const [legalName, setLegalName] = useState(prev?.legal_name ?? "");
  const [title, setTitle] = useState(prev?.title ?? "");
  const companyDefault = data.settings.tenant.companyName ?? "";
  // Default: the company's name as the signature, signed by this person ("By: name, title" under it).
  const [method, setMethod] = useState<Method>(companyDefault ? "typed" : "drawn");
  const [typedAs, setTypedAs] = useState<"company" | "name">(companyDefault ? "company" : "name");
  const [typed, setTyped] = useState(companyDefault);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [auto, setAuto] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const company = data.settings.tenant.companyName;
  const wording = { legalName: legalName.trim() || "[your legal name]", companyName: company };

  function onFile(f: File | undefined) {
    setErrors((e) => ({ ...e, signatureImage: "" }));
    if (!f) return setUpload(null);
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setErrors((e) => ({ ...e, signatureImage: "Choose a PNG or JPG image." }));
    if (f.size > 2_000_000) return setErrors((e) => ({ ...e, signatureImage: "Use an image under 2 MB." }));
    const r = new FileReader();
    r.onload = () => setUpload(String(r.result));
    r.readAsDataURL(f);
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (legalName.trim().length < 2) e.legalName = "Enter your full legal name.";
    if (method === "typed" && typedAs === "name" && typed.trim().toLowerCase() !== legalName.trim().toLowerCase()) e.signatureText = "A typed signature must match your full legal name.";
    if (method === "typed" && typedAs === "company" && typed.trim().toLowerCase() !== companyDefault.trim().toLowerCase()) e.signatureText = `A company signature must be your company's name: ${companyDefault}.`;
    if (method === "drawn" && !drawn) e.signatureImage = "Draw your signature in the box.";
    if (method === "uploaded" && !upload) e.signatureImage = "Choose an image of your signature.";
    if (!adopt) e.adopt = "Confirm that this is your signature to continue.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = await fetch("/api/signing/credential", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ legalName, title, method, signatureText: method === "typed" ? typed : undefined, typedAs, signatureImage: method === "drawn" ? drawn : method === "uploaded" ? upload : undefined, adopt, autoApply: auto, adoptionVersion: ADOPTION_VERSION }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setErrors({ form: "We couldn't reach the server. Nothing was saved." });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d?.error?.code === "reauth_required") { onReauthed(); return setErrors({ form: d.error.message }); }
      return setErrors(d?.error?.field ? { [d.error.field]: d.error.message } : { form: d?.error?.message ?? "Couldn't save your signature." });
    }
    onSaved(d as Data);
  }

  const err = (k: string) => errors[k] ? <p className="mt-1 text-sm font-medium text-danger" id={`ms-${k}-err`}>{errors[k]}</p> : null;

  return (
    <Card className="p-5" aria-labelledby="newsig-h" data-testid="signature-form">
      <h2 id="newsig-h" className="font-bold">{prev ? "Update your signature" : "Set up your signature"}</h2>
      <p className="text-sm text-ink-soft">{prev ? "Saving creates a new version. Contracts already signed keep the signature they were signed with." : "Draw, upload or type the signature you'll use on proposals and contracts."}</p>

      {!data.recentAuth.ok && <ConfirmIdentity email={data.email} onDone={onReauthed} />}

      <form onSubmit={save} noValidate className="mt-4 space-y-5" aria-disabled={!data.recentAuth.ok}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ms-legalName" className="mb-1 block text-sm font-semibold">Full legal name <span className="text-danger" aria-hidden>*</span></label>
            <input id="ms-legalName" className="field" autoComplete="name" value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} aria-invalid={Boolean(errors.legalName)} aria-describedby={errors.legalName ? "ms-legalName-err" : undefined} />
            {err("legalName")}
          </div>
          <div>
            <label htmlFor="ms-title" className="mb-1 block text-sm font-semibold">Title <span className="font-normal text-muted">(optional)</span></label>
            <input id="ms-title" className="field" autoComplete="organization-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Owner, Sales Manager…" />
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Signature</legend>
          <div role="radiogroup" aria-label="Signature method" className="inline-flex flex-wrap rounded-lg border border-line p-1">
            {([["drawn", "Draw", PenLine], ["uploaded", "Upload", Upload], ["typed", "Type", Type]] as const).map(([m, label, Icon]) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-4 text-sm font-semibold ${method === m ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5"}`}>
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
          {method === "drawn" && <div className="mt-3"><SignaturePad id="ms-signatureImage" onChange={setDrawn} invalid={Boolean(errors.signatureImage)} />{err("signatureImage")}</div>}
          {method === "uploaded" && (
            <div className="mt-3">
              <FileDrop className="rounded-lg" label="Drop your signature image"><input id="ms-signatureImage" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-navy file:px-4 file:font-semibold file:text-white" /></FileDrop>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {upload && <div className="theme-light mt-2 flex min-h-20 items-center justify-center rounded-lg border border-line bg-white p-2"><img src={upload} alt="Uploaded signature preview" className="max-h-24 max-w-full object-contain" /></div>}
              <p className="mt-1 text-xs text-muted">A clear scan or photo of your signature on white paper. We trim and re-save it; the original file isn&apos;t kept.</p>
              {err("signatureImage")}
            </div>
          )}
          {method === "typed" && (
            <div className="mt-3">
              {companyDefault && (
                <div role="radiogroup" aria-label="What to type" className="mb-3 flex flex-wrap gap-4 text-sm" data-testid="typed-as">
                  <label className="flex items-center gap-2"><input type="radio" name="typedAs" checked={typedAs === "company"} onChange={() => { setTypedAs("company"); setTyped(companyDefault); }} /> Company name</label>
                  <label className="flex items-center gap-2"><input type="radio" name="typedAs" checked={typedAs === "name"} onChange={() => { setTypedAs("name"); setTyped(legalName); }} /> My name</label>
                </div>
              )}
              <label htmlFor="ms-signatureText" className="mb-1 block text-sm text-ink-soft">{typedAs === "company" ? "Your company's name" : "Type your full legal name"}</label>
              <input id="ms-signatureText" className="field" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={200} readOnly={typedAs === "company"} />
              <div className="theme-light mt-2 rounded-lg border border-dashed border-line-strong bg-white px-4 pb-2 pt-3 text-ink" aria-hidden>
                <span className="block truncate font-serif text-3xl italic">{typed}</span>
                {typedAs === "company" && <span className="mt-1 block border-t border-line pt-1 text-xs text-ink-soft">By: {legalName.trim() || "your name"}{title.trim() ? `, ${title.trim()}` : ""}</span>}
              </div>
              {typedAs === "company" && <p className="mt-1 text-xs text-muted">Contracts show the company name as the signature with &quot;By:&quot; and your name and title under it. It is still your signature: only you (or the system, if you authorize automatic application) can apply it.</p>}
              {err("signatureText")}
            </div>
          )}
        </fieldset>

        <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
          <label className="flex items-start gap-3">
            <input id="ms-adopt" type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} />
            <span className="text-sm text-ink-soft"><span className="font-semibold text-ink">Adopt this signature. </span>{adoptionText(wording)}</span>
          </label>
          {err("adopt")}
          <label className="flex items-start gap-3">
            <input id="ms-auto" type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="auto-apply-consent" />
            <span className="text-sm text-ink-soft"><span className="font-semibold text-ink">Optional: automatic application. </span>{autoApplyText(wording)}</span>
          </label>
          <p className="text-xs text-muted">Leave it unchecked to approve every contract yourself. Your company can also require that, whatever you choose here.</p>
        </div>

        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} type="submit" variant="accent" disabled={busy || !data.recentAuth.ok} data-testid="save-signature"> Save signature</Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    </Card>
  );
}

/** Identity check: a one-time code to the account's email refreshes the sign-in (real Auth event). */
function ConfirmIdentity({ email, onDone }: { email: string | null; onDone: () => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabase = getBrowserClient();
  async function send() {
    if (!supabase || !email) return setErr("Add a verified email to your account first.");
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) return setErr("Couldn't send the code. Please wait a minute and try again.");
    setSent(true);
  }
  async function verify() {
    if (!supabase || !email) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" }).catch((e: unknown) => ({ error: e as { message?: string } }));
    setBusy(false);
    if (error) return setErr("That code didn't work. Check it, or send a new one.");
    onDone();
  }
  return (
    <div className="mt-4 rounded-xl border border-brand/30 bg-brand-tint p-4" data-testid="confirm-identity">
      <p className="flex items-center gap-2 font-semibold text-navy"><Mail className="h-4 w-4" aria-hidden /> First, confirm it&apos;s you</p>
      <p className="mt-1 text-sm text-ink-soft">Before we store a signature, we send a one-time code to <b>{email ?? "your email"}</b>. This proves the signature is being set up by you.</p>
      {!sent ? (
        <Button loading={busy} className="mt-3" variant="primary" onClick={() => void send()} disabled={busy}> Email me a code</Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div><label htmlFor="ms-code" className="mb-1 block text-sm font-semibold">Code from the email</label><input id="ms-code" className="field w-40" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} /></div>
          <Button loading={busy} variant="primary" onClick={() => void verify()} disabled={busy || code.trim().length < 6}> Confirm</Button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
    </div>
  );
}
