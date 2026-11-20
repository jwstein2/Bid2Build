"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Globe, ImageUp, Loader2, Sparkles, X } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { colorCheck, FIELD_LABELS, isDefaultColor, TRADE_OPTIONS, type BrandField } from "@/lib/onboarding/brand-review";

export type ExistingBrand = null | Partial<Record<Exclude<BrandField, "logo">, string | null>> & { logoUrl: string | null };
type FieldKey = "companyName" | "tagline" | "trade" | "email" | "phone" | "address" | "licenseNumber" | "services" | "primaryColor" | "secondaryColor";
interface Discovery {
  website: string; finalUrl: string;
  fields: Partial<Record<FieldKey, { value: string; source: string }>>;
  logo: { value: string; source: string } | null;
  warnings: string[];
}
type Row = { value: string; on: boolean; source?: string; replace: boolean };
type Step = "intro" | "website" | "discovering" | "review" | "manual" | "saving" | "done";

const TEXT_FIELDS: FieldKey[] = ["companyName", "tagline", "trade", "phone", "email", "address", "licenseNumber", "services"];
const STEPS: { key: Step[]; label: string }[] = [
  { key: ["intro", "website"], label: "Website" }, { key: ["discovering", "review", "manual"], label: "Your brand" }, { key: ["saving", "done"], label: "Ready" },
];

export function WelcomeWizard({ existing, giftUntil }: { existing: ExistingBrand; giftUntil: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(existing?.companyName ? "website" : "intro");
  const [url, setUrl] = useState(existing?.website ?? "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [found, setFound] = useState<Discovery | null>(null);
  const [rows, setRows] = useState<Partial<Record<FieldKey, Row>>>({});
  const [logo, setLogo] = useState<{ dataUrl: string; on: boolean; replace: boolean; source?: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; logo: string | null } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const until = giftUntil ? new Date(giftUntil).toLocaleDateString("en-US", { dateStyle: "long" }) : null;
  const has = (k: FieldKey) => {
    const v = existing?.[k];
    return Boolean(v) && !(k.endsWith("Color") && isDefaultColor(String(v)));
  };

  async function discover() {
    setUrlError(null);
    const v = url.trim();
    if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) { setUrlError("Enter your website address, like yourcompany.com"); return; }
    setStep("discovering");
    const r = await fetch("/api/onboarding/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: v }) }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (!r?.ok || !body) {
      setLookupNote(body?.error?.message ?? body?.message ?? "We couldn't read that website.");
      startManual();
      return;
    }
    const d = body as Discovery;
    setFound(d);
    const next: Partial<Record<FieldKey, Row>> = {};
    for (const k of [...TEXT_FIELDS, "primaryColor", "secondaryColor"] as FieldKey[]) {
      const f = d.fields[k];
      if (!f) continue;
      let value = f.value;
      if (k === "primaryColor") { const c = colorCheck(value); if (!c.ok && c.suggestion) value = c.suggestion; }
      next[k] = { value, on: true, source: f.source, replace: !has(k) };
    }
    setRows(next);
    setLogo(d.logo ? { dataUrl: d.logo.value, on: true, replace: !existing?.logoUrl, source: d.logo.source } : null);
    setStep(Object.keys(next).length || d.logo ? "review" : (setLookupNote("We couldn't find business details on that page."), "manual"));
  }

  function startManual() {
    const next: Partial<Record<FieldKey, Row>> = {};
    for (const k of ["companyName", "trade", "phone", "email"] as FieldKey[]) next[k] = { value: existing?.[k] ?? "", on: true, replace: true };
    next.primaryColor = { value: existing?.primaryColor && !isDefaultColor(existing.primaryColor) ? existing.primaryColor : "#0b2a4a", on: true, replace: true };
    setRows(next);
    setStep("manual");
  }

  async function save(skipped = false) {
    setSaveError(null);
    setStep("saving");
    const fields: Record<string, string> = {};
    const replace: string[] = [];
    if (!skipped) {
      for (const [k, r] of Object.entries(rows) as [FieldKey, Row][]) {
        if (!r.on || !r.value.trim()) continue;
        fields[k] = r.value.trim();
        if (r.replace) replace.push(k);
      }
      if (found?.website) fields.website = found.website;
      if (found?.website && !has("website" as FieldKey)) replace.push("website");
      if (logo?.on && logo.replace) replace.push("logo");
    }
    const r = await fetch("/api/onboarding/branding", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, replace, logoDataUrl: !skipped && logo?.on ? logo.dataUrl : undefined, website: found?.website, skipped }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (!r?.ok) { setSaveError(body?.error?.message ?? body?.message ?? "We couldn't save that. Check the fields and try again."); setStep(found ? "review" : "manual"); return; }
    await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed" }) }).catch(() => null);
    if (skipped) { router.push("/dashboard"); return; }
    setSaved({ name: fields.companyName ?? existing?.companyName ?? "Your company", logo: logo?.on && logo.replace ? logo.dataUrl : existing?.logoUrl ?? null });
    setStep("done");
  }

  const set = (k: FieldKey, patch: Partial<Row>) => setRows((r) => ({ ...r, [k]: { ...(r[k] ?? { value: "", on: true, replace: true }), ...patch } }));
  const stepIndex = STEPS.findIndex((s) => s.key.includes(step));

  return (
    <main id="main" className="min-h-screen bg-paper">
      <header className="on-dark bg-navy text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4"><Logo tone="dark" />
          {step !== "done" && step !== "saving" && <button type="button" onClick={() => save(true)} className="min-h-11 rounded-md px-3 text-sm font-medium text-[#C9D6E3] hover:bg-white/10 hover:text-white">Skip for now</button>}
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <ol aria-label="Setup progress" className="mb-8 flex items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.label} className="flex flex-1 items-center gap-2" aria-current={i === stepIndex ? "step" : undefined}>
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", i < stepIndex ? "bg-teal text-white" : i === stepIndex ? "bg-navy text-white" : "bg-black/10 text-ink-soft")}>{i < stepIndex ? <Check className="h-4 w-4" aria-hidden /> : i + 1}</span>
              <span className={cn("font-medium", i === stepIndex ? "text-navy" : "text-ink-soft")}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
            </li>
          ))}
        </ol>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8">
          {step === "intro" && (
            <div className="space-y-5">
              <p className="inline-flex items-center gap-2 rounded-full bg-accent-tint px-3 py-1 text-sm font-semibold text-accent-dark"><Sparkles className="h-4 w-4" aria-hidden /> Your Built2Bid Individual Unlimited membership is active{until ? ` until ${until}` : ""}</p>
              <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-extrabold text-navy sm:text-4xl">Welcome to Built2Bid</h1>
              <p className="text-lg text-ink-soft">Let&apos;s get your contracting business ready to send professional bids. It takes about a minute.</p>
              <Button variant="accent" size="lg" onClick={() => setStep("website")}>Get started <ArrowRight className="h-4 w-4" aria-hidden /></Button>
            </div>
          )}

          {step === "website" && (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); discover(); }} noValidate>
              <h1 ref={heading} tabIndex={-1} className="font-display text-2xl font-extrabold text-navy sm:text-3xl">What&apos;s your company&apos;s website?</h1>
              <p className="text-ink-soft">We&apos;ll look at your public homepage and suggest your logo, colors and contact details. You review everything before it&apos;s saved.</p>
              <div>
                <label htmlFor="site" className="label">Company website</label>
                <div className="relative"><Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                  <input id="site" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="https://yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={Boolean(urlError)} aria-describedby={urlError ? "site-err" : undefined} className="min-h-12 w-full rounded-lg border border-line-strong bg-surface pl-10 pr-3 text-base" /></div>
                {urlError && <p id="site-err" className="mt-1 text-sm text-danger">{urlError}</p>}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button type="submit" variant="accent" size="lg">Find my branding</Button>
                <Button variant="ghost" onClick={() => { setLookupNote(null); startManual(); }}>I don&apos;t have a website</Button>
              </div>
            </form>
          )}

          {step === "discovering" && (
            <div className="space-y-4 py-6 text-center" aria-live="polite">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" aria-hidden />
              <h1 ref={heading} tabIndex={-1} className="font-display text-2xl font-extrabold text-navy">Looking at your website…</h1>
              <p className="text-ink-soft">Reading your homepage&apos;s public details: name, logo, colors and contact info.</p>
            </div>
          )}

          {step === "review" && found && (
            <div className="space-y-6">
              <div>
                <h1 ref={heading} tabIndex={-1} className="font-display text-2xl font-extrabold text-navy sm:text-3xl">Here&apos;s what we found for your business</h1>
                <p className="mt-1 text-ink-soft">From {new URL(found.finalUrl).hostname}. Keep what&apos;s right, edit anything, or remove it. Nothing is saved until you confirm.</p>
              </div>
              {found.warnings.map((w) => <Notice key={w} tone="warn"><span className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w}</span></Notice>)}
              {saveError && <Notice tone="danger">{saveError}</Notice>}

              <LogoRow logo={logo} setLogo={setLogo} existingLogo={existing?.logoUrl ?? null} />
              <div className="divide-y divide-line rounded-xl border border-line">
                {TEXT_FIELDS.filter((k) => rows[k]).map((k) => <FieldRow key={k} k={k} row={rows[k]!} current={has(k) ? String(existing?.[k]) : null} onChange={(p) => set(k, p)} />)}
                {(["primaryColor", "secondaryColor"] as const).filter((k) => rows[k]).map((k) => <ColorRow key={k} k={k} row={rows[k]!} found={found.fields[k]?.value ?? ""} current={has(k) ? String(existing?.[k]) : null} onChange={(p) => set(k, p)} />)}
              </div>
              {Object.keys(rows).length === 0 && !logo && <p className="text-ink-soft">We didn&apos;t find any business details on that page.</p>}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="accent" size="lg" onClick={() => save(false)}>Confirm and save</Button>
                <Button variant="secondary" onClick={() => { setFound(null); startManual(); }}>Enter details myself</Button>
              </div>
            </div>
          )}

          {step === "manual" && (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save(false); }}>
              <h1 ref={heading} tabIndex={-1} className="font-display text-2xl font-extrabold text-navy sm:text-3xl">Tell us about your business</h1>
              {lookupNote && <Notice tone="neutral">{lookupNote} No problem: add the basics below. You can change them anytime in Company profile.</Notice>}
              {saveError && <Notice tone="danger">{saveError}</Notice>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Company name" value={rows.companyName?.value ?? ""} onChange={(v) => set("companyName", { value: v })} autoComplete="organization" />
                <div><label htmlFor="trade" className="label">Primary trade</label>
                  <select id="trade" className="min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3" value={rows.trade?.value ?? ""} onChange={(e) => set("trade", { value: e.target.value })}>
                    <option value="">Choose…</option>{TRADE_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></div>
                <Input label="Business phone" value={rows.phone?.value ?? ""} onChange={(v) => set("phone", { value: v })} type="tel" autoComplete="tel" />
                <Input label="Business email" value={rows.email?.value ?? ""} onChange={(v) => set("email", { value: v })} type="email" autoComplete="email" />
              </div>
              <LogoRow logo={logo} setLogo={setLogo} existingLogo={existing?.logoUrl ?? null} manual />
              <ColorRow k="primaryColor" row={rows.primaryColor ?? { value: "#0b2a4a", on: true, replace: true }} found="" current={null} onChange={(p) => set("primaryColor", p)} manual />
              <Button type="submit" variant="accent" size="lg">Save and continue</Button>
            </form>
          )}

          {step === "saving" && <div className="flex items-center gap-3 py-8" aria-live="polite"><Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden /><h1 ref={heading} tabIndex={-1} className="font-display text-xl font-bold">Saving your company profile…</h1></div>}

          {step === "done" && saved && (
            <div className="space-y-6 text-center">
              {saved.logo ? <PreviewImg src={saved.logo} alt={`${saved.name} logo`} className="mx-auto max-h-20 max-w-[240px] object-contain" /> : null}
              <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-extrabold text-navy">Welcome, {saved.name}.</h1>
              <p className="text-lg text-ink-soft">Your proposals will now carry your branding. Let&apos;s build your first professional bid.</p>
              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <ButtonLink href="/bids" variant="accent" size="lg">Create your first bid</ButtonLink>
                <ButtonLink href="/dashboard" variant="secondary" size="lg">Go to my dashboard</ButtonLink>
              </div>
              <p className="text-sm text-muted">You can update any of this later in Company profile.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Input({ label, value, onChange, type = "text", autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string }) {
  const id = label.toLowerCase().replace(/\W+/g, "-");
  return <div><label htmlFor={id} className="label">{label}</label><input id={id} type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-base" /></div>;
}

function FieldRow({ k, row, current, onChange }: { k: FieldKey; row: Row; current: string | null; onChange: (p: Partial<Row>) => void }) {
  const id = `f-${k}`;
  return (
    <div className={cn("grid gap-2 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-start", !row.on && "bg-paper")}>
      <label htmlFor={id} className="pt-2 text-sm font-semibold">{FIELD_LABELS[k]}</label>
      <div>
        {k === "trade" ? (
          <select id={id} disabled={!row.on} value={row.value} onChange={(e) => onChange({ value: e.target.value })} className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2.5">
            {[row.value, ...TRADE_OPTIONS.filter((t) => t !== row.value)].map((t) => <option key={t}>{t}</option>)}</select>
        ) : k === "services" || k === "address" ? (
          <textarea id={id} disabled={!row.on} rows={2} value={row.value} onChange={(e) => onChange({ value: e.target.value })} className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-2" />
        ) : (
          <input id={id} disabled={!row.on} value={row.value} onChange={(e) => onChange({ value: e.target.value })} className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2.5" />
        )}
        {row.source && <p className="mt-1 text-xs text-muted">Found: {row.source}</p>}
        {current && row.on && (
          <fieldset className="mt-2 flex flex-wrap gap-3 text-sm"><legend className="sr-only">{FIELD_LABELS[k]}: keep or replace</legend>
            <label className="flex items-center gap-1.5"><input type="radio" checked={!row.replace} onChange={() => onChange({ replace: false })} /> Keep current: <span className="font-medium">{current.slice(0, 60)}</span></label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={row.replace} onChange={() => onChange({ replace: true })} /> Use this</label>
          </fieldset>
        )}
      </div>
      <button type="button" onClick={() => onChange({ on: !row.on })} aria-pressed={!row.on} aria-label={`${row.on ? "Remove" : "Restore"} ${FIELD_LABELS[k]}`}
        className="inline-flex min-h-11 items-center gap-1 justify-self-start rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-black/5">
        {row.on ? <><X className="h-4 w-4" aria-hidden /> Remove</> : <><Check className="h-4 w-4" aria-hidden /> Use</>}
      </button>
    </div>
  );
}

function ColorRow({ k, row, found, current, onChange, manual }: { k: "primaryColor" | "secondaryColor"; row: Row; found: string; current: string | null; onChange: (p: Partial<Row>) => void; manual?: boolean }) {
  const check = k === "primaryColor" ? colorCheck(row.value) : null;
  const foundCheck = k === "primaryColor" && found ? colorCheck(found) : null;
  return (
    <div className={cn("grid gap-2 p-4 sm:grid-cols-[10rem_1fr_auto] sm:items-center", manual && "rounded-xl border border-line")}>
      <label htmlFor={`c-${k}`} className="text-sm font-semibold">{FIELD_LABELS[k]}</label>
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <input id={`c-${k}`} type="color" disabled={!row.on} value={row.value} onChange={(e) => onChange({ value: e.target.value })} className="h-11 w-14 cursor-pointer rounded-md border border-line-strong" />
          <span className="font-mono text-sm">{row.value}</span>
          <span className="rounded px-2 py-1 text-xs font-bold text-white" style={{ background: row.value }}>Proposal heading</span>
        </div>
        {foundCheck && !foundCheck.ok && found.toLowerCase() !== row.value.toLowerCase() && (
          <p className="text-xs text-ink-soft">Your site&apos;s color ({found}) is too light to read on white proposals ({foundCheck.ratio}:1), so we darkened it to pass accessibility contrast. <button type="button" className="underline" onClick={() => onChange({ value: found })}>Use original anyway</button></p>
        )}
        {check && !check.ok && <p className="text-xs text-warn">Low contrast on white ({check.ratio}:1).{check.suggestion && <> <button type="button" className="underline" onClick={() => onChange({ value: check.suggestion! })}>Use {check.suggestion}</button></>}</p>}
        {current && row.on && !manual && (
          <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="sr-only">Keep or replace</legend>
            <label className="flex items-center gap-1.5"><input type="radio" checked={!row.replace} onChange={() => onChange({ replace: false })} /> Keep current <span className="inline-block h-4 w-4 rounded" style={{ background: current }} /></label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={row.replace} onChange={() => onChange({ replace: true })} /> Use this</label>
          </fieldset>
        )}
      </div>
      {!manual && <button type="button" onClick={() => onChange({ on: !row.on })} aria-pressed={!row.on} className="min-h-11 justify-self-start rounded-md px-2 text-sm font-medium text-ink-soft hover:bg-black/5">{row.on ? "Remove" : "Use"}</button>}
    </div>
  );
}

function LogoRow({ logo, setLogo, existingLogo, manual }: { logo: { dataUrl: string; on: boolean; replace: boolean; source?: string } | null; setLogo: (l: { dataUrl: string; on: boolean; replace: boolean; source?: string } | null) => void; existingLogo: string | null; manual?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setErr("Use a PNG, JPG or WebP image."); return; }
    if (f.size > 2 * 1024 * 1024) { setErr("Logos must be 2 MB or smaller."); return; }
    const r = new FileReader();
    r.onload = () => setLogo({ dataUrl: String(r.result), on: true, replace: true, source: "Uploaded by you" });
    r.readAsDataURL(f);
  };
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-4 sm:flex-row sm:items-center">
      <div className="grid h-24 w-full place-items-center rounded-lg bg-paper sm:w-48">
        {logo?.on ? <PreviewImg src={logo.dataUrl} alt="Logo preview" className="max-h-20 max-w-[90%] object-contain" />
          : existingLogo ? <PreviewImg src={existingLogo} alt="Current logo" className="max-h-20 max-w-[90%] object-contain" />
          : <span className="text-sm text-muted">No logo</span>}
      </div>
      <div className="flex-1 space-y-2 text-sm">
        <p className="font-semibold">Logo</p>
        {logo?.source && logo.on && <p className="text-xs text-muted">{logo.source}. Only use a logo you own.</p>}
        {!manual && !logo && <p className="text-ink-soft">We didn&apos;t find a usable logo. You can upload one.</p>}
        {existingLogo && logo?.on && (
          <fieldset className="flex flex-wrap gap-3"><legend className="sr-only">Keep or replace logo</legend>
            <label className="flex items-center gap-1.5"><input type="radio" checked={!logo.replace} onChange={() => setLogo({ ...logo, replace: false })} /> Keep current logo</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={logo.replace} onChange={() => setLogo({ ...logo, replace: true })} /> Use this one</label>
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-3 font-medium hover:bg-paper"><ImageUp className="h-4 w-4" aria-hidden /> {logo ? "Replace" : "Upload"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label>
          {logo && <button type="button" onClick={() => setLogo({ ...logo, on: !logo.on })} className="min-h-11 rounded-md px-3 font-medium text-ink-soft hover:bg-black/5">{logo.on ? "Remove" : "Use logo"}</button>}
        </div>
        {err && <p className="text-danger">{err}</p>}
      </div>
    </div>
  );
}

/** Data-URL previews and short-lived signed URLs: next/image can't optimize either. */
function PreviewImg(props: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- see above
  return <img {...props} alt={props.alt} />;
}
