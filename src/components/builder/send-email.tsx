"use client";
import { Check, Copy, Download, Loader2, Mail, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { canShareFile, mailtoHref, type ShareEmail } from "@/lib/proposal/share-email";
import { Button, buttonClass } from "../ui/button";
import { Notice } from "../ui/misc";
import { Modal } from "./dialogs";

export type SendPhase =
  | { k: "preparing" }
  | { k: "error"; message: string }
  | { k: "ready"; file: File; note?: string };

type Status = { tone: "ok" | "warn" | "danger" | "info"; text: string } | null;

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${label}`} disabled={!value}
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked: the text stays selectable */ } }}
      className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-brand hover:bg-black/5 disabled:opacity-40">
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}{done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * "Send via My Email". The PDF is prepared first (through the normal export, so the usual bid-credit
 * rules apply), then the contractor shares it with a separate click: the share sheet needs a fresh
 * tap, which an export request can outlast. Built2Bid never sends the email itself.
 */
export function SendEmailDialog({ open, onOpenChange, phase, email, onRetry }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  phase: SendPhase;
  email: ShareEmail;
  onRetry: () => void;
}) {
  const [to, setTo] = useState(email.to);
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [status, setStatus] = useState<Status>(null);
  const [sharing, setSharing] = useState(false);
  const file = phase.k === "ready" ? phase.file : null;
  const shareable = useMemo(() => (file ? canShareFile(file) : false), [file]);
  const href = mailtoHref({ to, subject, body });

  async function share() {
    if (!file || sharing) return;
    setSharing(true); setStatus(null);
    try {
      // Most email apps ignore a recipient from the share sheet, so the message text carries the rest.
      await navigator.share({ files: [file], title: subject, text: body });
      setStatus({ tone: "ok", text: `The share sheet closed. If you chose an email app, check that ${file.name} is attached${to ? `, add ${to} as the recipient` : ""}, then press Send there. Built2Bid didn't send anything.` });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") setStatus({ tone: "warn", text: "Sharing was canceled. Nothing was sent." });
      else setStatus({ tone: "danger", text: "This browser couldn't open the share sheet. Use the download and email steps below instead." });
    } finally {
      setSharing(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Send via My Email" description="Send the proposal from your own email. You review and send it yourself; Built2Bid never emails your customer." wide>
      {phase.k === "preparing" && (
        <p className="flex items-center justify-center gap-2 py-8 text-sm font-semibold" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing your PDF…</p>
      )}
      {phase.k === "error" && (
        <div className="space-y-3">
          <Notice tone="danger">{phase.message}</Notice>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button><Button onClick={onRetry}>Try again</Button></div>
        </div>
      )}
      {phase.k === "ready" && file && (
        <div className="space-y-4">
          {phase.note && <p className="text-sm text-ink-soft" role="status">{phase.note}</p>}

          <div className="grid gap-3">
            <div>
              <div className="flex items-center justify-between"><label htmlFor="se-to" className="label mb-0">To</label><CopyButton value={to} label="recipient" /></div>
              <input id="se-to" type="email" className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Customer email (optional)" />
            </div>
            <div>
              <div className="flex items-center justify-between"><label htmlFor="se-subject" className="label mb-0">Subject</label><CopyButton value={subject} label="subject" /></div>
              <input id="se-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <div className="flex items-center justify-between"><label htmlFor="se-body" className="label mb-0">Message</label><CopyButton value={body} label="message" /></div>
              <textarea id="se-body" rows={8} className="field text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="mt-1 text-xs text-muted">You can still edit everything in your email app before sending.</p>
            </div>
          </div>

          {shareable && (
            <section className="rounded-xl border border-line bg-paper p-4" aria-labelledby="se-share-h">
              <h3 id="se-share-h" className="font-bold">Attach automatically</h3>
              <p className="mt-1 text-sm text-ink-soft">Opens your device&apos;s share menu with the PDF. Pick Mail, Gmail, Outlook or another email app. Not every app accepts attachments; if the PDF is missing, use the steps below.</p>
              <Button className="mt-3 w-full sm:w-auto" variant="accent" onClick={share} disabled={sharing}>{sharing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />} Share PDF to email app</Button>
            </section>
          )}

          <section className="rounded-xl border border-line p-4" aria-labelledby="se-manual-h">
            <h3 id="se-manual-h" className="font-bold">{shareable ? "Or attach it yourself" : "Two quick steps"}</h3>
            <ol className="mt-2 space-y-3 text-sm">
              <li className="flex flex-wrap items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white" aria-hidden>1</span>
                <Button variant="secondary" onClick={() => { downloadFile(file); setStatus({ tone: "info", text: `Downloaded ${file.name}. Now open your email draft and attach it.` }); }}><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
              </li>
              <li className="flex flex-wrap items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white" aria-hidden>2</span>
                <a href={href} className={buttonClass(shareable ? "secondary" : "accent", "md")} onClick={() => setStatus({ tone: "info", text: `Your email app should open with this message. Attach ${file.name} from your downloads, then press Send. Nothing opened? Copy the details above into any email.` })}><Mail className="h-4 w-4" aria-hidden /> Open email draft</a>
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted">Email links can&apos;t attach files, so attach the downloaded PDF before you send.</p>
          </section>

          <div aria-live="polite">{status && <Notice tone={status.tone === "info" ? "ok" : status.tone}>{status.text}</Notice>}</div>
        </div>
      )}
    </Modal>
  );
}
