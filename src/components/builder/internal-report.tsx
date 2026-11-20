"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Download, Eye, FileSpreadsheet, Loader2, Mail, Share2 } from "lucide-react";
import { Modal } from "./dialogs";
import { Button } from "../ui/button";
import { Notice } from "../ui/misc";
import { PremiumDiamond, PremiumUpgrade } from "../billing/premium";
import { canShareFile, mailtoHref, validEmail, webComposeHref } from "@/lib/proposal/share-email";
import { downloadFile } from "./send-email";

type Check = { k: "loading" } | { k: "allowed"; canDownload: boolean; canSend: boolean } | { k: "blocked"; code: string; message: string } | { k: "error" };

const domain = (e?: string | null) => (validEmail(e) ? validEmail(e).split("@")[1].toLowerCase() : "");

/** True when the address is outside the company (a different email domain than the business email). */
export function isOutsideCompany(to: string, businessEmail?: string | null) {
  const d = domain(to), own = domain(businessEmail);
  return Boolean(d) && (!own || d !== own);
}

/**
 * Internal Estimate Report: Preview, Download PDF, Send via My Email. Locked accounts see a diamond and
 * the upgrade panel; the server decides on every request (?check=1 only reports the decision).
 * The send flow never pre-fills the customer and warns before sharing outside the company.
 */
export function InternalReportButton({ estimateId, locked, saved, signedIn, businessEmail, title }: {
  estimateId: string; locked: boolean; saved: boolean; signedIn: boolean; businessEmail?: string | null; title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="internal-report-open" data-feature="internal_report" data-guide="builder.internal-report" aria-label={`Internal estimate report${locked ? " (Individual Unlimited feature)" : ""}`}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Internal report</span>{locked && <PremiumDiamond />}
      </Button>
      {open && <InternalReportDialog estimateId={estimateId} saved={saved} signedIn={signedIn} businessEmail={businessEmail} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function InternalReportDialog({ estimateId, saved, signedIn, businessEmail, title, onClose }: { estimateId: string; saved: boolean; signedIn: boolean; businessEmail?: string | null; title: string; onClose: () => void }) {
  const [check, setCheck] = useState<Check>({ k: "loading" });
  const [sending, setSending] = useState(false);
  const base = `/api/estimates/${estimateId}/internal-report`;
  useEffect(() => {
    let live = true;
    fetch(`${base}?check=1`).then((r) => r.json()).then((d) => { if (live) setCheck(d?.allowed ? { k: "allowed", canDownload: d.canDownload !== false, canSend: d.canSend !== false } : d?.code ? { k: "blocked", code: d.code, message: d.message } : { k: "error" }); })
      .catch(() => { if (live) setCheck({ k: "error" }); });
    return () => { live = false; };
  }, [base]);
  const upgrade = check.k === "blocked" && check.code === "upgrade_required";
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title="Internal Estimate Report" description="Your private cost, markup, margin and profit breakdown. Not the customer proposal." wide>
      <div data-testid="internal-report-dialog">
        {check.k === "loading" && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Checking access…</p>}
        {check.k === "error" && <Notice tone="danger">Couldn&apos;t check access. Please try again.</Notice>}
        {upgrade && <PremiumUpgrade feature="internal_report" signedIn={signedIn} onNotNow={onClose} />}
        {check.k === "blocked" && !upgrade && <Notice tone="warn" title="Not available for your role">{check.message}</Notice>}
        {check.k === "allowed" && (sending
          ? <SendInternal base={base} title={title} businessEmail={businessEmail} onBack={() => setSending(false)} />
          : (
            <div className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
                <li>Every section and line item with quantity, unit cost, extended cost and selling price</li>
                <li>Markup and gross margin per line, section and project, kept as separate measures</li>
                <li>Direct cost by type, gross profit, tax and customer total</li>
              </ul>
              {!saved && <Notice tone="warn">Saving your latest changes… the report uses the saved estimate.</Notice>}
              <div className="grid gap-2 sm:grid-cols-3">
                <a href={base} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 font-semibold hover:bg-paper" data-testid="internal-report-preview"><Eye className="h-4 w-4" aria-hidden />Preview</a>
                {check.canDownload && <a href={`${base}?download=1`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-navy hover:bg-accent-hover" data-testid="internal-report-download"><Download className="h-4 w-4" aria-hidden />Download PDF</a>}
                {check.canSend && <Button variant="secondary" onClick={() => setSending(true)} data-testid="internal-report-send"><Mail className="h-4 w-4" aria-hidden />Send via My Email</Button>}
              </div>
              <p className="text-xs text-muted">Confidential: contains costs and profit. It&apos;s never added to proposals, signing links or anything your customer sees.</p>
            </div>
          ))}
      </div>
    </Modal>
  );
}

function SendInternal({ base, title, businessEmail, onBack }: { base: string; title: string; businessEmail?: string | null; onBack: () => void }) {
  const [to, setTo] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const outside = isOutsideCompany(to, businessEmail);
  const valid = Boolean(validEmail(to));
  const subject = `INTERNAL cost report: ${title}`;
  const body = "Internal estimate report attached (costs, markup, margin and profit). Internal use only: please don't forward to the customer.";

  async function go(app: "gmail" | "outlook" | "other") {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${base}?download=1&purpose=send`);
      if (!r.ok) { const d = await r.json().catch(() => null); throw new Error(d?.error?.message ?? "Couldn't create the report."); }
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "internal-report.pdf";
      const file = new File([await r.blob()], name, { type: "application/pdf" });
      const touch = (() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } })();
      if (touch && canShareFile(file)) {
        await navigator.share({ files: [file], title: subject, text: body });
        setMsg({ tone: "ok", text: "Pick your email app, check the recipient, then press Send." });
      } else {
        downloadFile(file);
        const href = app === "other" ? mailtoHref({ to, subject, body }) : webComposeHref(app, { to, subject, body });
        if (app === "other") window.location.assign(href); else window.open(href, "_blank", "noopener");
        setMsg({ tone: "ok", text: `We downloaded ${name}. Attach it to the draft that opened, then press Send. Nothing is sent until you do.` });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg({ tone: "danger", text: (e as Error).message || "Something went wrong." });
    } finally { setBusy(false); }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()} data-testid="internal-send">
      <Notice tone="warn" title="This report is confidential">It shows your costs, markup, margin and profit. Send it only to people inside your company, never to the customer.</Notice>
      <div>
        <label htmlFor="ir-to" className="label">Send to (teammate, bookkeeper, partner)</label>
        <input id="ir-to" type="email" className="field" value={to} onChange={(e) => { setTo(e.target.value); setAck(false); }} placeholder="name@yourcompany.com" autoComplete="off" />
      </div>
      {outside && (
        <label className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm" data-testid="outside-warning">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          <span><AlertTriangle className="mr-1 inline h-4 w-4 text-danger" aria-hidden /><b>{to}</b> isn&apos;t on your business email domain. I confirm this person is allowed to see our internal costs and profit.</span>
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {(["gmail", "outlook", "other"] as const).map((a) => (
          <Button key={a} variant="secondary" disabled={busy || !valid || (outside && !ack)} onClick={() => void go(a)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : a === "other" ? <Share2 className="h-4 w-4" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
            {a === "gmail" ? "Gmail" : a === "outlook" ? "Outlook" : "Other email app"}
          </Button>
        ))}
      </div>
      {msg && <p role={msg.tone === "danger" ? "alert" : "status"} className={`text-sm ${msg.tone === "ok" ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <button type="button" onClick={onBack} className="text-sm font-semibold text-accent-ink underline">Back</button>
    </form>
  );
}
