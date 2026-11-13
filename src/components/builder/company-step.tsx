"use client";
import { Check, Globe, Loader2, Upload, X } from "lucide-react";
import { AddressInput } from "../ui/address-input";
import { useRef, useState } from "react";
import type { BusinessProfile } from "@/lib/proposal/types";
import { Button } from "../ui/button";
import { Field, Notice } from "../ui/misc";

type Biz = BusinessProfile & { logoPath?: string | null };

interface Imported {
  companyName?: string; description?: string; phone?: string; email?: string; address?: string; services?: string;
  primaryColor?: string; secondaryColor?: string; logoDataUrl?: string | null; website?: string;
}

const IMPORT_FIELDS: { key: keyof Imported; label: string; target: keyof Biz }[] = [
  { key: "companyName", label: "Company name", target: "companyName" },
  { key: "phone", label: "Phone", target: "phone" },
  { key: "email", label: "Email", target: "email" },
  { key: "address", label: "Address", target: "address" },
  { key: "description", label: "Company description", target: "description" },
  { key: "primaryColor", label: "Primary color", target: "primaryColor" },
  { key: "secondaryColor", label: "Secondary color", target: "secondaryColor" },
];

export function CompanyStep({ business, onChange, signedIn, onDone }: { business: Biz; onChange: (b: Biz) => void; signedIn: boolean; onDone?: () => void }) {
  const [hasSite, setHasSite] = useState<boolean | null>(business.website ? true : null);
  const [url, setUrl] = useState(business.website ?? "");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [review, setReview] = useState<Imported | null>(null);
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Biz>) => onChange({ ...business, ...patch });

  async function runImport() {
    setImporting(true); setImportError(null); setReview(null);
    try {
      const r = await fetch("/api/import-website", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await r.json();
      if (!r.ok) { setImportError(data?.error?.message ?? "We couldn't import that website."); return; }
      setReview(data);
      const a: Record<string, boolean> = { logo: Boolean(data.logoDataUrl) };
      for (const f of IMPORT_FIELDS) a[f.key] = Boolean(data[f.key]) && !(business[f.target] as string | undefined)?.trim();
      setAccept(a);
    } catch {
      setImportError("We couldn't reach the import service. You can enter details manually.");
    } finally {
      setImporting(false);
    }
  }

  async function applyImport() {
    if (!review) return;
    const patch: Partial<Biz> = { website: review.website ?? url };
    for (const f of IMPORT_FIELDS) if (accept[f.key] && review[f.key]) (patch as Record<string, unknown>)[f.target] = review[f.key];
    onChange({ ...business, ...patch });
    if (accept.logo && review.logoDataUrl) await uploadDataUrl(review.logoDataUrl, { ...business, ...patch });
    setReview(null);
  }

  async function upload(file: File, base: Biz = business) {
    setUploading(true); setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/logo", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) { setUploadError(data?.error?.message ?? "Upload failed."); return; }
      onChange(data.stored ? { ...base, logoUrl: data.url, logoPath: data.path } : { ...base, logoUrl: data.dataUrl, logoPath: null });
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }
  async function uploadDataUrl(dataUrl: string, base: Biz) {
    const blob = await (await fetch(dataUrl)).blob();
    await upload(new File([blob], "logo.png", { type: "image/png" }), base);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold">Your company</h2>
        <p className="mt-1 text-ink-soft">This appears on every proposal. {signedIn ? "It's saved to your account and reused on future bids." : "It's saved on this device until you create an account."}</p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-bold">Do you have a company website?</h3>
        <p className="text-sm text-muted">We can pull your name, logo, colors, and contact details so you don&apos;t have to type them. You review everything first.</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant={hasSite === true ? "primary" : "secondary"} onClick={() => setHasSite(true)}>Yes</Button>
          <Button size="sm" variant={hasSite === false ? "primary" : "secondary"} onClick={() => setHasSite(false)}>No, I&apos;ll enter it</Button>
        </div>
        {hasSite && (
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) runImport(); }}>
            <label htmlFor="site-url" className="sr-only">Website address</label>
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input id="site-url" className="field pl-9" placeholder="yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="url" />
            </div>
            <Button type="submit" disabled={importing || !url.trim()}>{importing ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : "Import my branding"}</Button>
          </form>
        )}
        {importError && <Notice tone="warn" className="mt-3" title="Import didn't work">{importError} You can fill in the details below instead.</Notice>}
        {review && (
          <div className="mt-4 rounded-lg border border-brand/30 bg-brand-tint/40 p-4">
            <p className="font-semibold">Review what we found</p>
            <p className="text-sm text-muted">Only checked items are applied. Please confirm they are accurate and belong to your business.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {review.logoDataUrl && (
                <li className="flex items-center gap-3">
                  <input type="checkbox" id="imp-logo" checked={!!accept.logo} onChange={(e) => setAccept({ ...accept, logo: e.target.checked })} className="accent-[var(--color-brand)]" />
                  <label htmlFor="imp-logo" className="flex items-center gap-3">
                    <span className="w-28 font-semibold text-ink-soft">Logo</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={review.logoDataUrl} alt="Imported logo" className="h-10 max-w-[160px] rounded bg-white object-contain p-1 ring-1 ring-line" />
                  </label>
                </li>
              )}
              {IMPORT_FIELDS.filter((f) => review[f.key]).map((f) => (
                <li key={f.key} className="flex items-start gap-3">
                  <input type="checkbox" id={`imp-${f.key}`} checked={!!accept[f.key]} onChange={(e) => setAccept({ ...accept, [f.key]: e.target.checked })} className="mt-1 accent-[var(--color-brand)]" />
                  <label htmlFor={`imp-${f.key}`} className="flex flex-1 gap-3">
                    <span className="w-28 shrink-0 font-semibold text-ink-soft">{f.label}</span>
                    {f.key.endsWith("Color") ? (
                      <span className="flex items-center gap-2"><span className="h-5 w-5 rounded ring-1 ring-black/10" style={{ background: String(review[f.key]) }} />{String(review[f.key])}</span>
                    ) : (
                      <span className="break-words">{String(review[f.key])}</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {!review.logoDataUrl && <p className="mt-2 text-xs text-muted">We couldn&apos;t find a usable logo. Upload one below.</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={applyImport}><Check className="h-4 w-4" /> Apply selected</Button>
              <Button size="sm" variant="secondary" onClick={() => setReview(null)}>Discard</Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-bold">Business information</h3>
        <p className="text-sm text-muted">Fields marked <span className="text-danger">*</span> are required for a professional proposal. Everything appears only on proposals you create.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required htmlFor="b-name"><input id="b-name" className="field" value={business.companyName} onChange={(e) => set({ companyName: e.target.value })} autoComplete="organization" /></Field>
          <Field label="Contact name" required htmlFor="b-contact"><input id="b-contact" className="field" value={business.contactName ?? ""} onChange={(e) => set({ contactName: e.target.value })} autoComplete="name" /></Field>
          <Field label="Business email" required htmlFor="b-email" hint="Shown on proposals so customers can reach you."><input id="b-email" type="email" className="field" value={business.email ?? ""} onChange={(e) => set({ email: e.target.value })} autoComplete="email" /></Field>
          <Field label="Phone number" required htmlFor="b-phone"><input id="b-phone" type="tel" className="field" value={business.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" /></Field>
          <div className="sm:col-span-2"><Field label="Business address" required htmlFor="b-addr"><AddressInput id="b-addr" value={business.address ?? ""} onChange={(v) => set({ address: v })} placeholder="Start typing your business address" /></Field></div>
          <Field label="Website" optional htmlFor="b-web"><input id="b-web" className="field" value={business.website ?? ""} onChange={(e) => set({ website: e.target.value })} inputMode="url" /></Field>
          <Field label="License number" optional htmlFor="b-lic"><input id="b-lic" className="field" value={business.licenseNumber ?? ""} onChange={(e) => set({ licenseNumber: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Tagline" optional htmlFor="b-tag"><input id="b-tag" className="field" value={business.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} maxLength={200} /></Field></div>
          <div className="sm:col-span-2"><Field label="Company description" optional htmlFor="b-desc"><textarea id="b-desc" rows={3} className="field" value={business.description ?? ""} onChange={(e) => set({ description: e.target.value })} maxLength={2000} /></Field></div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h3 className="font-bold">Logo and colors</h3>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-44 place-items-center rounded-lg border border-dashed border-line-strong bg-paper">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="Your logo" className="max-h-16 max-w-[160px] object-contain" />
            ) : (
              <span className="text-xs text-muted">No logo yet</span>
            )}
          </div>
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" id="logo-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {business.logoUrl ? "Replace logo" : "Upload logo"}</Button>
              {business.logoUrl && <Button size="sm" variant="ghost" onClick={() => set({ logoUrl: null, logoPath: null })}><X className="h-4 w-4" /> Remove</Button>}
            </div>
            <p className="text-xs text-muted">JPG, PNG, WebP, or SVG up to 2 MB. Images are converted to PNG for your PDF.</p>
            {uploadError && <p className="text-xs text-danger" role="alert">{uploadError}</p>}
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ColorField label="Primary brand color" value={business.primaryColor} onChange={(v) => set({ primaryColor: v })} />
          <ColorField label="Secondary brand color" value={business.secondaryColor} onChange={(v) => set({ secondaryColor: v })} />
          <Field label="Logo layout" htmlFor="b-layout">
            <select id="b-layout" className="field" value={business.logoLayout} onChange={(e) => set({ logoLayout: e.target.value as Biz["logoLayout"] })}>
              <option value="left">Logo left, contact right</option><option value="center">Centered</option><option value="stacked">Stacked</option>
            </select>
          </Field>
          <Field label="Header style" htmlFor="b-header" hint="Proposal templates may adjust the header.">
            <select id="b-header" className="field" value={business.headerStyle} onChange={(e) => set({ headerStyle: e.target.value as Biz["headerStyle"] })}>
              <option value="solid">Solid color band</option><option value="line">Accent line</option><option value="minimal">Minimal</option>
            </select>
          </Field>
        </div>
      </section>

      {onDone && <div className="flex justify-end"><Button size="lg" onClick={onDone}>Continue to estimate</Button></div>}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const id = label.replace(/\s/g, "-").toLowerCase();
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => { onChange(e.target.value); setText(e.target.value); }} className="h-10 w-12 cursor-pointer rounded border border-line-strong bg-surface p-1" />
        <input id={id} className="field tabular" value={text} onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} aria-invalid={!/^#[0-9a-f]{6}$/i.test(text)} />
      </div>
    </Field>
  );
}
