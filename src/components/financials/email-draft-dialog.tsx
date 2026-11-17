"use client";
import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Notice } from "@/components/ui/misc";
import { FinDialog } from "./fin-dialog";
import { finAction, newKey } from "./fin-client";

const KIND_LABELS: Record<string, string> = {
  deposit: "Deposit invoice", progress: "Progress / milestone invoice", final: "Final invoice", time_materials: "Time & materials invoice", change_order: "Change order invoice",
  balance_reminder: "Balance reminder", overdue_reminder: "Past-due reminder", receipt: "Payment receipt", partial_payment: "Partial payment thank-you",
  final_thanks: "Paid in full thank-you", credit_refund: "Credit or refund notice",
};
const TONE_LABELS = { friendly: "Friendly", professional: "Professional", brief: "Brief" } as const;
type Tone = keyof typeof TONE_LABELS;

interface Rendered {
  kind: string; tone: Tone; options: string[]; toEmail: string; toName: string; subject: string; body: string; fieldsHash: string;
  standard: { subject: string; body: string }; template: { subject: string; body: string }; standardTemplate: { subject: string; body: string };
  companyTemplate: boolean; canSaveTemplate: boolean; sendingEnabled: boolean;
}

/**
 * Invoice / receipt email draft (V4.4). Built from the recorded facts with the standard or company wording,
 * three tones, editable subject and body, preview, save as the company's wording, restore the standard.
 * The draft is saved on the existing Customer Hub messages for review. Sending is NOT built: the send
 * button stays disabled ("Sending turns on after approval") and no code path here emails anyone.
 */
export function EmailDraftDialog({ open, onOpenChange, invoiceId, paymentId }: { open: boolean; onOpenChange: (o: boolean) => void; invoiceId?: string; paymentId?: string }) {
  const [r, setR] = useState<Rendered | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [tpl, setTpl] = useState<{ subject: string; body: string } | null>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [showTpl, setShowTpl] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger" | "neutral"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftKey] = useState(newKey);

  const load = useCallback(async (kind?: string, tone?: Tone) => {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/financials/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId, paymentId, kind, tone }) }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok || !data) return setMsg({ tone: "danger", text: data?.message ?? "We couldn't build the email." });
    setR(data); setSubject(data.subject); setBody(data.body); setToEmail(data.toEmail); setTpl(data.template);
  }, [invoiceId, paymentId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- render the email from the records when the dialog opens
  useEffect(() => { if (open) void load(); }, [open, load]);

  const saveDraft = async () => {
    if (!r) return;
    setBusy(true); setMsg(null);
    const res = await finAction({ action: "email_draft_save", p: { templateKind: r.kind, tone: r.tone, toEmail, toName: r.toName, subject, body, invoiceId, paymentId, fieldsHash: r.fieldsHash, idempotencyKey: `fin-draft-${draftKey}` } });
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: "Draft saved for review. It has not been sent." } : { tone: "danger", text: res.message });
  };
  const saveTemplate = async () => {
    if (!r || !tpl) return;
    setBusy(true); setMsg(null);
    const res = await finAction({ action: "email_template_save", templateKind: r.kind, tone: r.tone, subject: tpl.subject, body: tpl.body });
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "danger", text: res.message });
    setMsg({ tone: "ok", text: "Saved as your company's wording for this email and tone." });
    void load(r.kind, r.tone);
  };

  return (
    <FinDialog open={open} onOpenChange={onOpenChange} title="Email draft" wide description="Review and edit before anything goes out. Nothing is sent from here.">
      {!r ? <p className="text-sm text-ink-soft">{busy ? "Building the email from your records…" : msg?.text}</p> : (
        <div className="space-y-3" data-testid="fin-email-dialog">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email type" htmlFor="em-kind">
              <select id="em-kind" className="field" value={r.kind} onChange={(e) => void load(e.target.value, r.tone)} disabled={busy}>
                {r.options.map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
              </select>
            </Field>
            <fieldset>
              <legend className="label">Tone</legend>
              <div className="flex gap-1">
                {(Object.keys(TONE_LABELS) as Tone[]).map((t) => (
                  <button key={t} type="button" aria-pressed={r.tone === t} disabled={busy} onClick={() => void load(r.kind, t)}
                    className={`min-h-11 flex-1 rounded-lg border px-2 text-sm font-semibold ${r.tone === t ? "border-brand bg-brand text-white" : "border-line text-ink-soft hover:text-ink"}`}>{TONE_LABELS[t]}</button>
                ))}
              </div>
            </fieldset>
          </div>
          <Field label="To" htmlFor="em-to" hint={r.companyTemplate ? "Using your company's saved wording." : "Using the standard wording."}>
            <input id="em-to" type="email" className="field" value={toEmail} onChange={(e) => setToEmail(e.target.value)} inputMode="email" autoComplete="off" />
          </Field>
          <div className="flex gap-1" role="group" aria-label="Edit or preview">
            <Button variant={mode === "edit" ? "primary" : "secondary"} size="sm" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
            <Button variant={mode === "preview" ? "primary" : "secondary"} size="sm" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}><Eye className="h-4 w-4" aria-hidden /> Preview</Button>
          </div>
          {mode === "edit" ? (
            <>
              <Field label="Subject" htmlFor="em-subject"><input id="em-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} /></Field>
              <Field label="Message" htmlFor="em-body"><textarea id="em-body" className="field min-h-56 font-mono text-sm" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} /></Field>
            </>
          ) : (
            <div className="rounded-lg border border-line bg-paper p-4 text-sm" data-testid="fin-email-preview">
              <p className="text-xs text-muted">To: {r.toName} &lt;{toEmail || "no email on file"}&gt;</p>
              <p className="mt-1 font-semibold">{subject}</p>
              <div className="mt-3 whitespace-pre-wrap leading-relaxed">{body}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setSubject(r.standard.subject); setBody(r.standard.body); }}><RotateCcw className="h-4 w-4" aria-hidden /> Restore standard</Button>
            {r.canSaveTemplate && <Button variant="ghost" size="sm" onClick={() => setShowTpl(!showTpl)} aria-expanded={showTpl}>Company wording…</Button>}
          </div>
          {showTpl && tpl && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-xs text-ink-soft">Wording for every future {KIND_LABELS[r.kind]?.toLowerCase()} ({TONE_LABELS[r.tone].toLowerCase()} tone). Keep the {"{placeholders}"}: they fill in amounts, dates and names from your records.</p>
              <Field label="Subject template" htmlFor="em-tsubject"><input id="em-tsubject" className="field" value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} /></Field>
              <Field label="Message template" htmlFor="em-tbody"><textarea id="em-tbody" className="field min-h-40 font-mono text-sm" value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={saveTemplate} disabled={busy}><Save className="h-4 w-4" aria-hidden /> Save as company template</Button>
                <Button variant="ghost" size="sm" onClick={() => setTpl(r.standardTemplate)}><RotateCcw className="h-4 w-4" aria-hidden /> Restore standard wording</Button>
              </div>
            </div>
          )}
          {msg && <Notice tone={msg.tone === "neutral" ? "neutral" : msg.tone}>{msg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button onClick={saveDraft} disabled={busy || !toEmail || !subject.trim() || !body.trim()} data-testid="fin-email-save">Save draft</Button>
            {/* No send path exists in this release: the button is permanently disabled until sending is approved. */}
            <Button variant="secondary" disabled aria-describedby="em-send-note" data-testid="fin-email-send">Send</Button>
            <span id="em-send-note" className="text-xs text-muted">Sending turns on after approval.</span>
          </div>
        </div>
      )}
    </FinDialog>
  );
}
