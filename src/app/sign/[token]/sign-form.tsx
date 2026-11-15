"use client";
import { CheckCircle2, Download, Eraser, Loader2, PenLine, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Method = "typed" | "drawn";
type Errors = Partial<Record<"signerName" | "signerEmail" | "signatureText" | "signatureImage" | "consent" | "accept" | "form", string>>;

/**
 * Typed or drawn signature, explicit consent and acceptance (never pre-checked), one final
 * "Accept & Sign Proposal" action. The server re-validates everything.
 */
export function SignForm({ token, customerName, consentVersion, consent, acceptance }: {
  token: string; customerName: string; consentVersion: string; consent: string; acceptance: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<Method>("typed");
  const [typed, setTyped] = useState("");
  const [typedTouched, setTypedTouched] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [consentOk, setConsentOk] = useState(false);
  const [consentedAt, setConsentedAt] = useState<string | null>(null);
  const [acceptOk, setAcceptOk] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ pdfReady: boolean } | null>(null);
  const submitting = useRef(false);

  // The typed signature follows the legal name until the signer edits it.
  const typedValue = typedTouched ? typed : name;

  function check(): Errors {
    const e: Errors = {};
    if (name.trim().length < 2) e.signerName = "Enter your full legal name.";
    if (!/^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/.test(email.trim())) e.signerEmail = "Enter a valid email address.";
    if (method === "typed" && typedValue.trim().toLowerCase() !== name.trim().toLowerCase()) e.signatureText = "Your typed signature must match your full legal name.";
    if (method === "drawn" && !drawn) e.signatureImage = "Draw your signature in the box, or switch to a typed signature.";
    if (!consentOk) e.consent = "Agree to use electronic records and signatures to continue.";
    if (!acceptOk) e.accept = "Confirm that you accept this proposal to continue.";
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting.current) return;
    const e = check();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`sf-${first}`)?.focus(); return; }
    submitting.current = true; setBusy(true);
    try {
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signerName: name, signerEmail: email, method,
          signatureText: method === "typed" ? typedValue : undefined,
          signatureImage: method === "drawn" ? drawn : undefined,
          consent: consentOk, accept: acceptOk, consentVersion, consentedAt: consentedAt ?? undefined,
        }),
      }).catch(() => null);
      if (!res) { setErrors({ form: "We couldn't reach the server. Nothing was signed. Check your connection and try again." }); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const field = data?.error?.field as keyof Errors | undefined;
        setErrors(field ? { [field]: data.error.message } : { form: data?.error?.message ?? "Something went wrong. Nothing was signed. Please try again." });
        if (res.status === 409 || res.status === 410) router.refresh();
        return;
      }
      setDone({ pdfReady: Boolean(data.pdfReady) });
    } finally {
      submitting.current = false; setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-3 rounded-xl bg-ok-tint p-4" role="status" aria-live="polite">
        <p className="flex items-center gap-2 font-bold text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden /> Thank you. Your signature has been recorded.</p>
        <p className="mt-1 text-sm text-ink-soft">Keep a copy for your records. {done.pdfReady ? "" : "If the download isn't ready yet, try again in a minute; your signature is already saved."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={`/api/sign/${token}/pdf`} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-navy px-4 font-semibold text-white hover:bg-navy/90"><Download className="h-4 w-4" aria-hidden /> Download signed copy (PDF)</a>
          <button type="button" onClick={() => router.refresh()} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 font-semibold text-navy">Done</button>
        </div>
      </div>
    );
  }

  const err = (k: keyof Errors) => errors[k] ? <p id={`sf-${k}-err`} className="mt-1 text-sm font-medium text-danger">{errors[k]}</p> : null;
  const described = (k: keyof Errors) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `sf-${k}-err` } : {});

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-5" data-testid="sign-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sf-signerName" className="mb-1 block text-sm font-semibold">Full legal name <span className="text-danger" aria-hidden>*</span></label>
          <input id="sf-signerName" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={customerName || "Your full name"} maxLength={200} required {...described("signerName")} />
          {err("signerName")}
        </div>
        <div>
          <label htmlFor="sf-signerEmail" className="mb-1 block text-sm font-semibold">Email <span className="text-danger" aria-hidden>*</span></label>
          <input id="sf-signerEmail" type="email" className="field" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} required {...described("signerEmail")} />
          {err("signerEmail")}
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Your signature</legend>
        <div role="radiogroup" aria-label="Signature method" className="inline-flex rounded-lg border border-line p-1">
          {([["typed", "Type", Type], ["drawn", "Draw", PenLine]] as const).map(([m, label, Icon]) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-4 text-sm font-semibold ${method === m ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5"}`}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
        {method === "typed" ? (
          <div className="mt-3">
            <label htmlFor="sf-signatureText" className="mb-1 block text-sm text-ink-soft">Type your full legal name to sign</label>
            <input id="sf-signatureText" className="field" value={typedValue} onChange={(e) => { setTypedTouched(true); setTyped(e.target.value); }} maxLength={200} {...described("signatureText")} />
            <div className="mt-2 flex min-h-16 items-end rounded-lg border border-dashed border-line-strong bg-white px-4 pb-2" aria-hidden>
              <span className="truncate font-serif text-3xl italic text-ink">{typedValue}</span>
            </div>
            {err("signatureText")}
          </div>
        ) : (
          <div className="mt-3">
            <SignaturePad onChange={setDrawn} invalid={Boolean(errors.signatureImage)} />
            {err("signatureImage")}
            <p className="mt-1 text-xs text-muted">Use your finger, a stylus, or a mouse. If drawing is hard to use, choose Type instead: it is an equally valid electronic signature.</p>
          </div>
        )}
      </fieldset>

      <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
        <label className="flex items-start gap-3">
          <input id="sf-consent" type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consentOk}
            onChange={(e) => { setConsentOk(e.target.checked); setConsentedAt(e.target.checked ? new Date().toISOString() : null); }} {...described("consent")} />
          <span className="text-sm text-ink-soft"><span className="font-semibold text-ink">Consent to electronic records and signatures. </span>{consent}</span>
        </label>
        {err("consent")}
        <label className="flex items-start gap-3">
          <input id="sf-accept" type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acceptOk} onChange={(e) => setAcceptOk(e.target.checked)} {...described("accept")} />
          <span className="text-sm text-ink-soft"><span className="font-semibold text-ink">Acceptance. </span>{acceptance}</span>
        </label>
        {err("accept")}
      </div>

      {errors.form && <p className="rounded-lg bg-danger-tint p-3 text-sm font-medium text-danger" role="alert">{errors.form}</p>}
      <button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-base font-bold text-navy hover:bg-accent-hover disabled:opacity-60 sm:w-auto">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <PenLine className="h-5 w-5" aria-hidden />} Accept &amp; Sign Proposal
      </button>
    </form>
  );
}

/** Pointer-events signature pad (mouse, touch, pen). Exports a trimmed-size PNG data URL. */
function SignaturePad({ onChange, invalid }: { onChange: (png: string | null) => void; invalid: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokes = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * ratio); c.height = Math.round(height * ratio);
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0e2238";
    strokes.current = 0; onChange(null);
  }, [onChange]);
  useEffect(() => { setup(); }, [setup]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    if (strokes.current >= 8 && canvas.current) onChange(exportPng(canvas.current));
  };

  return (
    <div>
      <canvas
        id="sf-signatureImage"
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label="Signature drawing area. Draw your signature with a finger, stylus or mouse."
        className={`block h-40 w-full touch-none rounded-lg border-2 border-dashed bg-white ${invalid ? "border-danger" : "border-line-strong"}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = pos(e), ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          last.current = p; strokes.current++;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
      <button type="button" onClick={setup} className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-navy hover:bg-black/5">
        <Eraser className="h-4 w-4" aria-hidden /> Clear
      </button>
    </div>
  );
}

/** Copy onto a white, max-800px-wide canvas so the stored PNG stays small. */
function exportPng(src: HTMLCanvasElement): string {
  const scale = Math.min(1, 800 / src.width);
  const out = document.createElement("canvas");
  out.width = Math.max(50, Math.round(src.width * scale)); out.height = Math.max(20, Math.round(src.height * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
