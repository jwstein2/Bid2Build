"use client";
import { Check, ChevronDown, Copy, Download, FileText, Link2, Loader2, Mail, Pencil, Share2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { buildShareEmail, canShareFile, mailtoHref, plainEmail, webComposeFits, webComposeHref, type ShareEmailInput, type WebMail } from "@/lib/proposal/share-email";
import type { CreatedLink } from "../esign/signing-panel";
import { LocalTime } from "../esign/local-time";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { Modal } from "./dialogs";

export type SendPhase =
  | { k: "idle" }
  | { k: "preparing" }
  | { k: "error"; message: string }
  | { k: "ready"; file: File; note?: string };

/** What the email delivers. Both reuse the same recipient, subject and message fields. */
export type SendMode = "pdf" | "link";

type Status = { tone: "ok" | "warn" | "danger"; text: ReactNode } | null;

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Phones and tablets: the share sheet is how a file reaches the Gmail or Outlook app. */
function isTouchDevice() {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}

/**
 * Email Proposal ("Send via My Email"). The PDF is prepared first through the normal export, so the
 * usual bid-credit rules apply; then one tap on Gmail, Outlook or Other Email App hands it over.
 * Built2Bid never sends the email, never stores it, and never asks for mailbox access.
 *
 * - Gmail / Outlook on a computer: downloads the PDF and opens a filled-in draft in that webmail.
 * - Gmail / Outlook on a phone, and Other Email App wherever files can be shared: the share sheet,
 *   which attaches the PDF. It needs its own tap, which is why the PDF is ready before the buttons are.
 * - Otherwise: downloads the PDF and opens the default email app (mailto: can't attach files).
 * - Signing link mode sends the online signing link instead, with no attachment.
 */
export function SendEmailDialog({ open, onOpenChange, phase, emailInput, onRetry, mode, onModeChange, allowLink, link, onCreateLink, creatingLink }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  phase: SendPhase;
  emailInput: ShareEmailInput;
  onRetry: () => void;
  mode: SendMode;
  onModeChange: (m: SendMode) => void;
  /** E-signatures on: offer "Signing link" next to "PDF attachment". */
  allowLink: boolean;
  link: CreatedLink | null;
  onCreateLink: () => void;
  creatingLink: boolean;
}) {
  // Never offer a link that has run out (a revoked one is cleared by the builder). The dialog is
  // remounted on every open, so "now" is when it opened.
  const [openedAt] = useState(() => Date.now());
  const liveLink = link && Date.parse(link.expiresAt) > openedAt ? link : null;
  // Each mode has its own subject and message. The subject is known before the link exists.
  const built = useMemo(() => ({
    pdf: buildShareEmail(emailInput),
    link: buildShareEmail({ ...emailInput, signingUrl: liveLink?.url ?? "https://built2bid.org/sign/pending" }),
  }), [emailInput, liveLink]);
  const [to, setTo] = useState(built.pdf.to);
  // What the contractor typed, per mode: kept when they switch tabs and back, never overwritten.
  const [subjects, setSubjects] = useState<Partial<Record<SendMode, string>>>({});
  const [edits, setEdits] = useState<Partial<Record<SendMode, string>>>({});
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const downloaded = useRef(false);

  const file = phase.k === "ready" ? phase.file : null;
  const shareable = useMemo(() => (file ? canShareFile(file) : false), [file]);
  const subject = subjects[mode] ?? built[mode].subject;
  const body = edits[mode] ?? (mode === "link" ? (liveLink ? built.link.body : "") : built.pdf.body);
  const email = { to, subject, body };
  const ready = mode === "pdf" ? Boolean(file) : Boolean(liveLink);
  const setSubject = (v: string) => setSubjects((x) => ({ ...x, [mode]: v }));

  function flash(key: string) { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500); }
  function switchMode(m: SendMode) { if (m !== mode) { setStatus(null); onModeChange(m); } }

  /** Downloads once per dialog; later taps say where the file already is instead of piling up copies. */
  function ensureDownloaded(f: File) {
    if (downloaded.current) return false;
    downloaded.current = true;
    downloadFile(f);
    return true;
  }

  async function share(appName?: string) {
    if (!file || sharing) return;
    setSharing(true); setStatus(null);
    try {
      // Most email apps ignore a recipient from the share sheet, so the message text carries the rest.
      await navigator.share({ files: [file], title: subject, text: body });
      setStatus({ tone: "ok", text: <>Finish in {appName ?? "your email app"}: check that <b>{file.name}</b> is attached{to ? <>, add <b>{to}</b> as the recipient</> : null}, then press Send. Built2Bid didn&apos;t send anything.</> });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") setStatus({ tone: "warn", text: "Sharing was canceled. Nothing was sent." });
      else {
        // Share sheet refused (old browser, policy): fall back to download + default email app.
        ensureDownloaded(file);
        window.location.assign(mailtoHref(email));
        setStatus({ tone: "warn", text: <>This browser couldn&apos;t share the file, so we downloaded <b>{file.name}</b> and opened your email app. Attach the PDF, then press Send.</> });
      }
    } finally {
      setSharing(false);
    }
  }

  /** Gmail or Outlook. Returns false to stop the link opening (the share sheet is used instead). */
  function webmail(app: WebMail, e: React.MouseEvent) {
    const name = app === "gmail" ? "Gmail" : "Outlook";
    const personal = app === "outlook" && <> Using Outlook.com and no draft opened? <a className="font-semibold underline" href={webComposeHref("outlook-personal", email)} target="_blank" rel="noopener noreferrer">Open Outlook.com</a>.</>;
    // A very long message would be cut short in the link: copy the whole thing so it can be pasted.
    if (!webComposeFits(body) && !(mode === "pdf" && shareable && isTouchDevice())) {
      void copyText(plainEmail(email));
      setStatus({ tone: "warn", text: <>Your message is too long for a {name} link, so the draft has only the start of it. We copied the full message: paste it into the draft{mode === "pdf" ? " and attach the downloaded PDF" : ""}.</> });
      if (mode === "pdf" && file) ensureDownloaded(file);
      return;
    }
    if (mode === "link") {
      setStatus({ tone: "ok", text: <>{name} opened in a new tab with your signing link. Check it, then press Send there.{personal}</> });
      return;
    }
    if (!file) { e.preventDefault(); return; }
    if (shareable && isTouchDevice()) { e.preventDefault(); void share(name); return; }
    const fresh = ensureDownloaded(file);
    setStatus({ tone: "ok", text: <>{name} opened in a new tab. Attach <b>{file.name}</b> ({fresh ? "just downloaded" : "already in your downloads"}): drag it into the email or click the paperclip, then press Send.{personal}</> });
  }

  function otherApp() {
    if (mode === "pdf" && file) {
      if (shareable) { void share(); return; }
      const fresh = ensureDownloaded(file);
      window.location.assign(mailtoHref(email));
      setStatus({ tone: "ok", text: <>Your email app should open with this message. {fresh ? "We downloaded" : "Attach the downloaded"} <b>{file.name}</b>{fresh ? ", so attach it" : ""}, then press Send. Nothing opened? Use Copy message below.</> });
      return;
    }
    if (mode === "link" && liveLink) {
      window.location.assign(mailtoHref(email));
      setStatus({ tone: "ok", text: <>Your email app should open with the signing link in the message. Nothing opened? Use Copy message below.</> });
    }
  }

  const busy = (mode === "pdf" && phase.k === "preparing") || (mode === "link" && creatingLink);
  const appBtn = "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface px-2 py-2 text-sm font-bold text-navy shadow-sm transition hover:border-brand hover:bg-paper focus-visible:outline-2 focus-visible:outline-brand aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:flex-row sm:gap-2";
  const linkBtn = "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-brand hover:bg-black/5 disabled:opacity-40";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Email Proposal" description="You review and send it from your own email. Built2Bid never emails your customer.">
      <div className="space-y-3" data-testid="email-proposal">
        {allowLink && (
          <div role="radiogroup" aria-label="What to send" onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const next: SendMode = mode === "pdf" ? "link" : "pdf";
            switchMode(next);
            (e.currentTarget.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
          }} className="grid grid-cols-2 gap-1 rounded-lg bg-black/5 p-1 text-sm font-semibold">
            {([["pdf", "PDF attachment", FileText], ["link", "Signing link", Link2]] as const).map(([m, label, Icon]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} aria-label={label} data-mode={m} tabIndex={mode === m ? 0 : -1} onClick={() => switchMode(m)}
                className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md ${mode === m ? "bg-surface text-navy shadow-sm" : "text-ink-soft hover:text-navy"}`}>
                <Icon className="h-4 w-4" aria-hidden />{m === "pdf" ? <><span className="min-[360px]:hidden">PDF</span><span className="max-[359px]:hidden">PDF attachment</span></> : label}
              </button>
            ))}
          </div>
        )}

        <dl className="divide-y divide-line rounded-xl border border-line text-sm">
          <div className="flex items-center gap-3 px-3 py-1.5">
            <dt><label htmlFor="se-to" className="w-16 shrink-0 font-semibold text-ink-soft">To</label></dt>
            <dd className="min-w-0 flex-1"><input id="se-to" type="email" inputMode="email" autoComplete="off" className="w-full bg-transparent py-1.5 outline-none placeholder:text-placeholder" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Customer email" /></dd>
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5">
            <dt><label htmlFor="se-subject" className="w-16 shrink-0 font-semibold text-ink-soft">Subject</label></dt>
            <dd className="min-w-0 flex-1"><input id="se-subject" className="w-full bg-transparent py-1.5 outline-none" value={subject} onChange={(e) => setSubject(e.target.value)} /></dd>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5" data-testid="se-attachment">
            <dt className="w-16 shrink-0 font-semibold text-ink-soft">{mode === "pdf" ? "Attach" : "Link"}</dt>
            <dd className="min-w-0 flex-1">
              {mode === "pdf" && phase.k === "preparing" && <span className="inline-flex items-center gap-1.5 text-ink-soft" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Preparing PDF…</span>}
              {mode === "pdf" && phase.k === "idle" && <span className="text-ink-soft">Proposal PDF</span>}
              {mode === "pdf" && phase.k === "error" && <span className="text-danger">PDF not ready</span>}
              {mode === "pdf" && file && (
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="truncate font-medium" title={file.name}>{file.name}</span>
                  <span className="shrink-0 rounded-full bg-ok-tint px-2 py-0.5 text-xs font-bold text-ok">Ready<span className="max-sm:hidden"> · {kb(file.size)}</span></span>
                </span>
              )}
              {mode === "link" && creatingLink && <span className="inline-flex items-center gap-1.5 text-ink-soft" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Creating signing link…</span>}
              {mode === "link" && !creatingLink && !liveLink && (
                <Button size="sm" variant="accent" onClick={onCreateLink} data-testid="se-create-link"><Link2 className="h-4 w-4" aria-hidden /> Create signing link</Button>
              )}
              {mode === "link" && !creatingLink && liveLink && (
                <span className="flex min-w-0 items-center gap-2">
                  <input readOnly value={liveLink.url} aria-label="Signing link" className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs outline-none" onFocus={(e) => e.currentTarget.select()} data-testid="signing-url" />
                  <button type="button" className={linkBtn} onClick={async () => { if (await copyText(liveLink.url)) flash("url"); }}>{copied === "url" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied === "url" ? "Copied" : "Copy"}</button>
                </span>
              )}
            </dd>
          </div>
        </dl>

        {mode === "pdf" && phase.k === "ready" && phase.note && <p className="text-xs text-muted" role="status">{phase.note}</p>}
        {mode === "pdf" && phase.k === "error" && (
          <div className="space-y-2">
            <Notice tone="danger">{phase.message}</Notice>
            <div className="flex justify-end"><Button size="sm" onClick={onRetry}>Try again</Button></div>
          </div>
        )}
        {mode === "link" && !liveLink && !creatingLink && (
          <p className="text-xs text-muted">Your customer reviews and signs this exact version online. No attachment or account needed. A new link turns off any earlier one.</p>
        )}
        {mode === "link" && liveLink && (
          <p className="text-xs text-muted">{liveLink.message ? <>{liveLink.message} </> : null}Version {liveLink.versionNumber} · {liveLink.total} · works until <LocalTime iso={liveLink.expiresAt} relative={false} />. Anyone with the link can view and sign, so send it only to your customer.</p>
        )}

        <div>
          {!editing ? (
            <button type="button" className={`${linkBtn} -ml-2.5`} onClick={() => setEditing(true)} aria-expanded={false} aria-controls="se-body" data-testid="se-edit-message">
              <Pencil className="h-4 w-4" aria-hidden /> Edit message
            </button>
          ) : (
            <div>
              <label htmlFor="se-body" className="label">Message</label>
              <textarea id="se-body" rows={7} className="field text-sm" value={body} disabled={!ready && mode === "link"} onChange={(e) => setEdits((x) => ({ ...x, [mode]: e.target.value }))} />
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>You can also edit it in your email app.</span>
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setEditing(false)}>Done</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-navy" id="se-send-h">Open draft in</p>
          <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="se-send-h">
            {(["gmail", "outlook"] as const).map((app) => (
              <a key={app} href={ready ? webComposeHref(app, email) : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!ready || busy || sharing}
                className={appBtn} onClick={(e) => webmail(app, e)} data-testid={`se-${app}`}>
                <Mail className="h-5 w-5 text-brand" aria-hidden />{app === "gmail" ? "Gmail" : "Outlook"}
              </a>
            ))}
            <button type="button" className={appBtn} onClick={otherApp} aria-disabled={!ready || busy || sharing} disabled={!ready || busy || sharing} data-testid="se-other">
              {sharing ? <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden /> : mode === "pdf" && shareable ? <Share2 className="h-5 w-5 text-brand" aria-hidden /> : <Mail className="h-5 w-5 text-brand" aria-hidden />}
              <span className="text-center leading-tight">Other email app</span>
            </button>
          </div>
          {mode === "pdf" && file && (
            <p className="mt-2 text-xs text-muted">{shareable ? "On a phone, your PDF is attached through the share menu. On a computer, we download it for you to drag into the draft." : "Web email can't attach files from a link, so we download the PDF for you to drag into the draft."}</p>
          )}
        </div>

        <div aria-live="polite">{status && <Notice tone={status.tone}>{status.text}</Notice>}</div>

        <details className="group rounded-lg text-sm">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 font-semibold text-ink-soft hover:text-navy">
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden /> More options
          </summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {(mode === "pdf" ? file : liveLink?.file) && (
              <button type="button" className={linkBtn} onClick={() => { const f = (mode === "pdf" ? file : liveLink?.file)!; downloaded.current = true; downloadFile(f); }}><Download className="h-4 w-4" aria-hidden /> Download PDF</button>
            )}
            <button type="button" className={linkBtn} disabled={!ready} onClick={async () => { if (await copyText(plainEmail(email))) flash("msg"); }}>
              {copied === "msg" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied === "msg" ? "Copied" : "Copy message"}
            </button>
            {mode === "pdf" && shareable && (
              <a className={linkBtn} href={ready ? mailtoHref(email) : undefined} aria-disabled={!ready} onClick={() => { if (file) ensureDownloaded(file); }}><Mail className="h-4 w-4" aria-hidden /> Default email app (attach yourself)</a>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}
