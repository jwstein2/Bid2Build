"use client";
import { useState } from "react";
import { Check, Copy, Download, Link2, Loader2, Mail, Share2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { downloadFile } from "@/components/builder/send-email";
import { canShareFile, mailtoHref, plainEmail, validEmail, webComposeHref, type WebMail } from "@/lib/proposal/share-email";
import { buildUpdateEmail, reportFilename, type DeliveryMethod } from "@/lib/schedule/report";
import type { Publication } from "@/lib/schedule/publications";
import { api } from "./client";

type Status = { tone: "ok" | "warn" | "danger"; text: string } | null;

/**
 * After publishing: the contractor decides how the customer gets it. Built2Bid never emails the
 * customer: Gmail, Outlook or the email app opens with a filled-in draft that the contractor sends.
 * Recorded as "email draft opened", never as delivered.
 */
export function UpdateDelivery({ scheduleId, publication, customerEmail, contactName, onChange }: {
  scheduleId: string; publication: Publication; customerEmail: string | null; contactName: string | null; onChange: (p: Publication) => void;
}) {
  const pub = publication;
  const [url, setUrl] = useState<string | null>(null);
  const [to, setTo] = useState(validEmail(customerEmail));
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const base = `/api/schedules/${scheduleId}/updates/${pub.id}`;
  const linkActive = pub.link.state === "active";
  const email = { to, ...buildUpdateEmail(pub.content, { link: url, contactName }) };

  async function record(method: DeliveryMethod) {
    const r = await api<{ publication: Publication }>(base, { method: "POST", body: JSON.stringify({ action: "delivery", method }) });
    if (r.ok && r.data.publication) onChange(r.data.publication);
  }

  async function pdfFile(): Promise<File | null> {
    if (file) return file;
    setBusy("pdf");
    try {
      const res = await fetch(`${base}/pdf?download=1`);
      if (!res.ok) throw new Error();
      const f = new File([await res.blob()], reportFilename(pub.content, pub.version), { type: "application/pdf" });
      setFile(f);
      return f;
    } catch {
      setStatus({ tone: "danger", text: "We couldn't prepare the PDF. Please try again." });
      return null;
    } finally { setBusy(null); }
  }

  async function createLink() {
    setBusy("link"); setStatus(null);
    const r = await api<{ publication: Publication; url: string }>(base, { method: "POST", body: JSON.stringify({ action: "link", days: 30 }) });
    setBusy(null);
    if (!r.ok) { setStatus({ tone: "danger", text: r.message }); return; }
    setUrl(r.data.url); onChange(r.data.publication);
    setStatus({ tone: "ok", text: "Secure link created. It shows only this update and works for 30 days. A new link replaces this one." });
  }

  async function revoke() {
    setBusy("revoke");
    const r = await api<{ publication: Publication }>(base, { method: "POST", body: JSON.stringify({ action: "revoke" }) });
    setBusy(null);
    if (!r.ok) { setStatus({ tone: "danger", text: r.message }); return; }
    setUrl(null); onChange(r.data.publication);
    setStatus({ tone: "ok", text: "The link is turned off. Anyone opening it now sees that it's no longer active." });
  }

  async function openDraft(app: WebMail | "other") {
    setStatus(null);
    const name = app === "gmail" ? "Gmail" : app === "outlook" ? "Outlook" : "your email app";
    if (!url) {
      const f = await pdfFile();
      if (!f) return;
      if (app === "other" && canShareFile(f)) {
        try {
          await navigator.share({ files: [f], title: email.subject, text: email.body });
          void record("share_sheet");
          setStatus({ tone: "ok", text: "Finish in your email app: check the PDF is attached and press Send. Built2Bid didn't send anything." });
        } catch { setStatus({ tone: "warn", text: "Sharing was canceled. Nothing was sent." }); }
        return;
      }
      downloadFile(f);
    }
    if (app === "other") window.location.assign(mailtoHref(email));
    else window.open(webComposeHref(app, email), "_blank", "noopener,noreferrer");
    void record("email_draft");
    setStatus({ tone: "ok", text: url ? `${name} opened with the secure link in the message. Check it, then press Send there.` : `${name} opened. Attach the downloaded PDF (${reportFilename(pub.content, pub.version)}), then press Send there. Built2Bid didn't send anything.` });
  }

  const tile = "flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-bold text-navy shadow-sm hover:border-brand hover:bg-paper disabled:opacity-40";
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid="update-delivery">
      <div>
        <h2 className="font-display text-lg font-extrabold text-navy">Share update {pub.version} with your customer</h2>
        <p className="text-sm text-ink-soft">Nothing has been sent yet. Choose how your customer gets it.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <a className={tile} href={`${base}/pdf?download=1`} onClick={() => void record("pdf_download")} data-testid="update-pdf"><Download className="h-4 w-4 text-brand" aria-hidden /> Download PDF</a>
        <a className={tile} href={`${base}/pdf`} target="_blank" rel="noopener noreferrer"><Share2 className="h-4 w-4 text-brand" aria-hidden /> Preview PDF</a>
      </div>

      <div className="rounded-xl border border-line p-3">
        <p className="flex items-center gap-2 font-bold text-navy"><Link2 className="h-4 w-4 text-brand" aria-hidden /> Secure link</p>
        {url ? (
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={url} aria-label="Secure link" className="field min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="update-link" />
            <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); void record("link_copied"); } catch { /* ignore */ } }}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy"}</Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
            {linkActive ? `A link is active until ${new Date(pub.link.expiresAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. For your security the link itself is shown only once, when it's created. Create a new one to copy it again (the old one stops working).`
              : pub.link.state === "revoked" ? "The link for this update was turned off." : pub.link.state === "expired" ? "The link for this update has expired." : "Your customer opens this update in a browser. No account needed."}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant={url ? "secondary" : "accent"} onClick={createLink} disabled={busy !== null} data-testid="update-create-link">{busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}{linkActive || url ? "Create a new link" : "Create secure link"}</Button>
          {linkActive && <Button size="sm" variant="secondary" onClick={revoke} disabled={busy !== null} data-testid="update-revoke"><Unlink className="h-4 w-4" aria-hidden /> Turn off link</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">Anyone with the link can view this update, so send it only to your customer.</p>
      </div>

      <div className="rounded-xl border border-line p-3">
        <p className="flex items-center gap-2 font-bold text-navy"><Mail className="h-4 w-4 text-brand" aria-hidden /> Send via My Email</p>
        <label className="mt-2 block"><span className="label">To</span><input type="email" className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Customer email" /></label>
        <p className="mt-1 text-xs text-muted">{url ? "The email includes the secure link." : "Create a secure link first to include it, or we'll download the PDF for you to attach."}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button type="button" className={tile} onClick={() => openDraft("gmail")} disabled={busy !== null} data-testid="update-gmail">Gmail</button>
          <button type="button" className={tile} onClick={() => openDraft("outlook")} disabled={busy !== null}>Outlook</button>
          <button type="button" className={tile} onClick={() => openDraft("other")} disabled={busy !== null}>{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Other app</button>
        </div>
        <button type="button" className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand" onClick={async () => { try { await navigator.clipboard.writeText(plainEmail(email)); setStatus({ tone: "ok", text: "Message copied. Paste it into any email app." }); } catch { /* ignore */ } }}><Copy className="h-4 w-4" aria-hidden /> Copy message</button>
      </div>

      <div aria-live="polite">{status && <Notice tone={status.tone}>{status.text}</Notice>}</div>
    </section>
  );
}
