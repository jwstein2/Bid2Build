"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Eye, EyeOff, FileUp, Lock, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import {
  ACCOUNT_TYPES, CERT_PRESETS, describeHistory, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, FLSA_STATUSES, HR_DOC_TYPES, hrChanges, hrDocLabel, hrFormValues,
  PAY_FREQUENCIES, PAY_RATE_UNITS, routingOk, SEPARATION_REASONS, TIME_OFF_KINDS, W4_FILING_STATUSES,
  type HrDocType, type HrField, type HrFile,
} from "@/lib/team/hr";
import { BankAccountCard } from "@/components/team/bank-account";

const fmt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
const hrs = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
type Msg = { ok: boolean; text: string } | null;

/**
 * One employee's HR file. Owner and HR managers only (the page and every route check). The SSN is masked and
 * shown on request for 30 seconds; each view is recorded. Nothing here is exported or shown elsewhere.
 */
export function HrFileView({ file, piiReady, today }: { file: HrFile; piiReady: boolean; today: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const done = (text: string) => { setMsg({ ok: true, text }); router.refresh(); };
  const err = (text: string) => setMsg({ ok: false, text });
  return (
    <div className="space-y-6" data-testid="hr-file">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      <DetailsForm file={file} onSaved={() => done("HR file saved.")} onError={err} />
      <SsnCard file={file} ready={piiReady} onDone={done} onError={err} />
      <BankAccountCard resourceId={file.resourceId} status={file.bank} ready={piiReady} purpose="direct deposit" onDone={done} onError={err} />
      <Documents file={file} today={today} onDone={done} onError={err} />
      <Certifications file={file} today={today} onDone={done} onError={err} />
      <TimeOff file={file} onDone={done} onError={err} />
      {file.history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-extrabold text-navy">History</h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            {file.history.map((h, i) => <li key={i} className="flex flex-wrap gap-2 px-3 py-2"><span className="mr-auto">{describeHistory(h.action, h.fields)}</span><span className="text-xs text-muted">{h.by} · {new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></li>)}
          </ul>
          <p className="text-xs text-muted">The history records what changed and who changed it, never the values.</p>
        </section>
      )}
    </div>
  );
}

function Section({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  return <section className="space-y-3 rounded-xl border border-line bg-surface p-4" data-testid={testid}><h2 className="text-xl font-extrabold text-navy">{title}</h2>{children}</section>;
}

function DetailsForm({ file, onSaved, onError }: { file: HrFile; onSaved: () => void; onError: (t: string) => void }) {
  const initial = hrFormValues(file.hr);
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const changes = hrChanges(saved, f);
  const dirty = Object.keys(changes).length > 0;
  const input = (k: HrField, label: string, props: Record<string, unknown> = {}) => (
    <label className="block"><span className="label">{label}</span><input className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>
  );
  const select = (k: HrField, label: string, opts: Record<string, string>, blank = "—") => (
    <label className="block"><span className="label">{label}</span>
      <select className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">{blank}</option>{Object.entries(opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  );
  const yesNo = { yes: "Yes", no: "No" };
  async function save() {
    if (f.ddRouting.trim() && !routingOk(f.ddRouting.trim())) { onError("That routing number isn't valid. Check the 9 digits on the check or bank letter."); return; }
    setBusy(true);
    const r = await api(`/api/team/hr/${file.resourceId}`, { method: "POST", body: JSON.stringify({ values: changes }) });
    setBusy(false);
    if (!r.ok) onError(r.message); else { setSaved(f); onSaved(); }
  }
  return (
    <Section title="Personal and employment details" testid="hr-details">
      <h3 className="font-semibold text-navy">Legal name and contact</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {input("legalFirstName", "Legal first name", { maxLength: 100, autoComplete: "off" })}
        {input("legalMiddleName", "Middle name", { maxLength: 100, autoComplete: "off" })}
        {input("legalLastName", "Legal last name", { maxLength: 100, autoComplete: "off" })}
        {input("preferredName", "Preferred name", { maxLength: 100 })}
        {input("dateOfBirth", "Date of birth", { type: "date", max: new Date().toISOString().slice(0, 10) })}
        {input("personalPhone", "Personal phone", { type: "tel", maxLength: 40 })}
        {input("personalEmail", "Personal email", { type: "email", maxLength: 320 })}
        <div className="sm:col-span-2">{input("addressLine1", "Home address", { maxLength: 200 })}</div>
        {input("addressLine2", "Apt / unit", { maxLength: 200 })}
        {input("city", "City", { maxLength: 100 })}
        <div className="grid grid-cols-2 gap-3">{input("state", "State", { maxLength: 40 })}{input("zip", "ZIP", { maxLength: 20, inputMode: "numeric" })}</div>
      </div>
      <h3 className="font-semibold text-navy">Emergency contacts</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        {input("emergency1Name", "Primary contact", { maxLength: 200 })}
        {input("emergency1Relation", "Relationship", { maxLength: 60 })}
        {input("emergency1Phone", "Phone", { type: "tel", maxLength: 40 })}
        {input("emergency1AltPhone", "Other phone", { type: "tel", maxLength: 40 })}
        {input("emergency2Name", "Second contact", { maxLength: 200 })}
        {input("emergency2Relation", "Relationship", { maxLength: 60 })}
        {input("emergency2Phone", "Phone", { type: "tel", maxLength: 40 })}
      </div>
      <h3 className="font-semibold text-navy">Employment</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {select("employmentStatus", "Status", EMPLOYMENT_STATUSES as unknown as Record<string, string>, "Active")}
        {select("employmentType", "Type", EMPLOYMENT_TYPES as unknown as Record<string, string>)}
        {input("department", "Department / crew", { maxLength: 100 })}
        {select("supervisorId", "Supervisor", Object.fromEntries(file.supervisors.map((s) => [s.id, s.name])), "None")}
        {input("workLocation", "Work location", { maxLength: 200 })}
        <p className="self-end pb-2 text-sm text-ink-soft">Hire date: {file.profile?.hireDate ? fmt(file.profile.hireDate) : "set on Employees & time"}</p>
        {input("i9CompletedOn", "I-9 completed on", { type: "date" })}
        {input("i9ReverifyOn", "I-9 reverify by (if any)", { type: "date" })}
        <span />
        {input("ptoHoursPerYear", "Paid time off per year (hours)", { inputMode: "decimal", maxLength: 7 })}
        {input("sickHoursPerYear", "Sick time per year (hours)", { inputMode: "decimal", maxLength: 7 })}
      </div>
      <h3 className="font-semibold text-navy">Pay and classification</h3>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="hr-pay">
        {input("employeeNumber", "Employee ID", { maxLength: 40 })}
        <div className="grid grid-cols-2 gap-2">{input("payRate", "Pay rate ($)", { inputMode: "decimal", maxLength: 12 })}{select("payRateUnit", "Per", PAY_RATE_UNITS as unknown as Record<string, string>)}</div>
        {select("payFrequency", "Pay frequency", PAY_FREQUENCIES as unknown as Record<string, string>)}
        {select("flsaStatus", "Overtime (FLSA)", FLSA_STATUSES as unknown as Record<string, string>)}
        {input("tradeClassification", "Trade classification", { maxLength: 100, placeholder: "e.g. Electrician - Journeyman" })}
        {input("wcClassCode", "Workers' comp class code", { maxLength: 20, placeholder: "e.g. 5190" })}
        {input("unionLocal", "Union local (if any)", { maxLength: 100 })}
        {input("newHireReportedOn", "Reported to state new-hire registry on", { type: "date" })}
      </div>
      <p className="text-xs text-muted">Pay rate is what you pay the employee. The loaded hourly cost used for job costing stays on Employees &amp; time. Trade classification and class code are what prevailing-wage (certified payroll) reports and your workers&apos; comp audit ask for.</p>
      <h3 className="font-semibold text-navy">Tax withholding (W-4 and state)</h3>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="hr-w4">
        {select("w4FilingStatus", "W-4 filing status (step 1c)", W4_FILING_STATUSES as unknown as Record<string, string>)}
        {select("w4MultipleJobs", "Multiple jobs or spouse works (step 2)", yesNo)}
        {input("w4DependentsAmount", "Dependents amount, step 3 ($)", { inputMode: "decimal", maxLength: 12 })}
        {input("w4OtherIncome", "Other income, step 4a ($)", { inputMode: "decimal", maxLength: 12 })}
        {input("w4Deductions", "Deductions, step 4b ($)", { inputMode: "decimal", maxLength: 12 })}
        {input("w4ExtraWithholding", "Extra withholding per pay, step 4c ($)", { inputMode: "decimal", maxLength: 12 })}
        {select("w4Exempt", "Claims exempt", yesNo)}
        {input("w4SignedOn", "W-4 signed on", { type: "date" })}
        <span />
        {input("stateWithholdingState", "Withholding state", { maxLength: 2, placeholder: "MN" })}
        {input("stateAllowances", "State allowances", { inputMode: "numeric", maxLength: 2 })}
        {input("stateExtraWithholding", "State extra withholding ($)", { inputMode: "decimal", maxLength: 12 })}
        {select("stateExempt", "State exempt", yesNo)}
      </div>
      <p className="text-xs text-muted">Record what the employee wrote on their W-4 and state form so your payroll service can be set up from it. Keep the signed form under Documents below.</p>
      <h3 className="font-semibold text-navy">Direct deposit</h3>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="hr-dd">
        {input("ddBankName", "Bank name", { maxLength: 100 })}
        {select("ddAccountType", "Account type", ACCOUNT_TYPES as unknown as Record<string, string>)}
        {input("ddRouting", "Routing number (9 digits)", { inputMode: "numeric", maxLength: 9, autoComplete: "off" })}
      </div>
      <p className="text-xs text-muted">The account number itself is saved separately, encrypted, in the Bank account card.</p>
      {f.employmentStatus === "separated" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {input("separationDate", "Last day", { type: "date" })}
          {select("separationReason", "Reason", SEPARATION_REASONS as unknown as Record<string, string>)}
          {select("rehireEligible", "Eligible for rehire", { yes: "Yes", no: "No" }, "Not decided")}
        </div>
      )}
      <label className="block"><span className="label">HR notes (private)</span><textarea className="field" rows={3} maxLength={5000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !dirty} data-testid="hr-save">{busy ? "Saving…" : "Save HR file"}</Button>
        {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
      </div>
    </Section>
  );
}

function SsnCard({ file, ready, onDone, onError }: { file: HrFile; ready: boolean; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [ssn, setSsn] = useState("");
  const [busy, setBusy] = useState(false);
  async function reveal() {
    if (shown) { setShown(null); return; }
    const r = await api<{ ssn: string }>(`/api/team/hr/${file.resourceId}/ssn`);
    if (!r.ok) onError(r.message); else { setShown(r.data.ssn); setTimeout(() => setShown(null), 30_000); }
  }
  async function save() {
    setBusy(true);
    const r = await api(`/api/team/hr/${file.resourceId}/ssn`, { method: "POST", body: JSON.stringify({ ssn }) });
    setBusy(false);
    if (!r.ok) { onError(r.message); return; }
    setSsn(""); setEditing(false); onDone("Social Security number saved and encrypted.");
  }
  async function remove() {
    const r = await api(`/api/team/hr/${file.resourceId}/ssn`, { method: "DELETE" });
    if (!r.ok) onError(r.message); else { setShown(null); onDone("Social Security number removed."); }
  }
  return (
    <Section title="Social Security number" testid="hr-ssn">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 text-ink-soft" aria-hidden />
        {file.ssn.onFile ? <Badge tone="ok">On file, encrypted</Badge> : <Badge>Not on file</Badge>}
      </div>
      {!ready ? (
        <p className="text-sm text-ink-soft">Coming soon: storing Social Security numbers turns on once the account owner sets the encryption key.</p>
      ) : (
        <>
          {file.ssn.onFile && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg" aria-live="polite">{shown ?? `•••-••-${file.ssn.last4}`}</span>
              <Button size="sm" variant="secondary" onClick={reveal}>{shown ? <><EyeOff className="h-4 w-4" aria-hidden /> Hide</> : <><Eye className="h-4 w-4" aria-hidden /> Show</>}</Button>
              <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden /> Remove</Button>
            </div>
          )}
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">9-digit SSN</span><input className="field" inputMode="numeric" autoComplete="off" maxLength={11} value={ssn} onChange={(e) => setSsn(e.target.value.replace(/[^\d-]/g, ""))} /></label>
              <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setSsn(""); }}>Cancel</Button>
            </div>
          ) : <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{file.ssn.onFile ? "Replace" : "Enter SSN"}</Button>}
        </>
      )}
      <p className="text-xs text-muted">Encrypted before it&apos;s stored. Showing it hides again after 30 seconds. Every save, view and removal is recorded with who did it. It&apos;s never included in exports or reports.</p>
    </Section>
  );
}

function Documents({ file, today, onDone, onError }: { file: HrFile; today: string; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [type, setType] = useState<HrDocType | "">("");
  const [f, setF] = useState({ title: "", signedOn: "", expiresOn: "", note: "" });
  const [upload, setUpload] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!type) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("docType", type);
    for (const [k, v] of Object.entries(f)) if (v.trim()) fd.set(k, v.trim());
    if (upload) fd.set("file", upload);
    try {
      const res = await fetch(`/api/team/hr/${file.resourceId}/documents`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { onError((body as { error?: { message?: string } }).error?.message ?? "Couldn't save the document."); return; }
      setType(""); setF({ title: "", signedOn: "", expiresOn: "", note: "" }); setUpload(null);
      onDone(`${hrDocLabel(type)} recorded.`);
    } catch { setBusy(false); onError("You appear to be offline. Nothing was saved."); }
  }
  async function remove(id: string, t: string) {
    const r = await api(`/api/team/hr/documents/${id}`, { method: "DELETE" });
    if (!r.ok) onError(r.message); else onDone(`${hrDocLabel(t)} removed.`);
  }
  const groups = [["hiring", "Hiring"], ["payroll", "Payroll and eligibility"], ["policy", "Policies"], ["credentials", "Licenses"], ["employment", "During employment"]] as const;
  return (
    <Section title="Documents" testid="hr-docs">
      <label className="block max-w-sm"><span className="label">Add a document</span>
        <select className="field" value={type} onChange={(e) => setType(e.target.value as HrDocType | "")}>
          <option value="">Choose…</option>
          {groups.map(([g, l]) => <optgroup key={g} label={l}>{HR_DOC_TYPES.filter((d) => d.group === g).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</optgroup>)}
        </select></label>
      {type && (
        <div className="grid gap-3 rounded-xl border border-line bg-paper p-3 sm:grid-cols-2">
          <label className="block"><span className="label">Title (optional)</span><input className="field" maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="block"><span className="label">Signed / dated</span><input type="date" className="field" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></label>
          <label className="block"><span className="label">Expires (if it does)</span><input type="date" className="field" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
          <label className="block"><span className="label">File (PDF or photo, up to 15 MB)</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="field py-2" onChange={(e) => setUpload(e.target.files?.[0] ?? null)} /></label>
          <label className="block sm:col-span-2"><span className="label">Note (optional)</span><input className="field" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy}><FileUp className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="secondary" onClick={() => setType("")}>Cancel</Button></div>
        </div>
      )}
      {file.documents.length === 0 ? <p className="text-sm text-muted">Nothing on file yet: application, W-4, I-9, direct deposit form, handbook acknowledgment.</p> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {file.documents.map((d) => (
            <li key={d.id} className="rounded-xl border border-line p-3">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">{hrDocLabel(d.docType)}{d.expiresOn && d.expiresOn < today && <Badge tone="danger">Expired {fmt(d.expiresOn)}</Badge>}</p>
              {d.title && <p className="text-sm text-ink-soft">{d.title}</p>}
              <p className="text-xs text-muted">{[d.signedOn && `Dated ${fmt(d.signedOn)}`, d.expiresOn && d.expiresOn >= today && `Expires ${fmt(d.expiresOn)}`, `Recorded ${fmt(d.recordedAt)}`].filter(Boolean).join(" · ")}</p>
              {d.note && <p className="text-xs text-muted">{d.note}</p>}
              <div className="mt-2 flex gap-2">
                {d.hasFile && <a href={`/api/team/hr/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-sm font-semibold"><ExternalLink className="h-4 w-4" aria-hidden />Open {d.fileName ?? "file"}</a>}
                <Button size="sm" variant="ghost" onClick={() => remove(d.id, d.docType)} aria-label={`Remove ${hrDocLabel(d.docType)}`}><Trash2 className="h-4 w-4" aria-hidden /> Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Certifications({ file, today, onDone, onError }: { file: HrFile; today: string; onDone: (t: string) => void; onError: (t: string) => void }) {
  const blank = { id: "", name: "", issuer: "", number: "", issuedOn: "", expiresOn: "", note: "" };
  const [f, setF] = useState<typeof blank | null>(null);
  const [busy, setBusy] = useState(false);
  const soon = (d: string) => (new Date(d).getTime() - new Date(today).getTime()) / 86_400_000 <= 30;
  async function save() {
    if (!f) return;
    setBusy(true);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
    const r = await api(`/api/team/hr/${file.resourceId}/certifications`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) onError(r.message); else { setF(null); onDone("Certification saved."); }
  }
  async function remove(id: string) {
    const r = await api(`/api/team/hr/${file.resourceId}/certifications?cert=${id}`, { method: "DELETE" });
    if (!r.ok) onError(r.message); else onDone("Certification removed.");
  }
  return (
    <Section title="Licenses and certifications" testid="hr-certs">
      {file.certifications.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {file.certifications.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="mr-auto"><span className="font-semibold">{c.name}</span><span className="block text-xs text-muted">{[c.issuer, c.number && `#${c.number}`, c.issuedOn && `Issued ${fmt(c.issuedOn)}`].filter(Boolean).join(" · ")}</span></span>
              {c.expiresOn ? (c.expiresOn < today ? <Badge tone="danger">Expired {fmt(c.expiresOn)}</Badge> : <Badge tone={soon(c.expiresOn) ? "warn" : "ok"}>Expires {fmt(c.expiresOn)}</Badge>) : <Badge>No expiry</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setF({ ...blank, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ""])) } as typeof blank)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
      {f ? (
        <div className="grid gap-3 rounded-xl border border-line bg-paper p-3 sm:grid-cols-3">
          <label className="block sm:col-span-2"><span className="label">Name</span><input className="field" maxLength={200} list="hr-cert-presets" placeholder="e.g. OSHA 30, CDL Class A, First Aid/CPR" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <datalist id="hr-cert-presets">{CERT_PRESETS.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className="block"><span className="label">Number</span><input className="field" maxLength={80} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
          <label className="block"><span className="label">Issued by</span><input className="field" maxLength={200} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></label>
          <label className="block"><span className="label">Issued on</span><input type="date" className="field" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></label>
          <label className="block"><span className="label">Expires on</span><input type="date" className="field" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
          <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="secondary" onClick={() => setF(null)}>Cancel</Button></div>
        </div>
      ) : <Button size="sm" variant="secondary" onClick={() => setF(blank)}>Add a license or certification</Button>}
    </Section>
  );
}

function TimeOff({ file, onDone, onError }: { file: HrFile; onDone: (t: string) => void; onError: (t: string) => void }) {
  const b = file.balances;
  const [f, setF] = useState<{ kind: keyof typeof TIME_OFF_KINDS; startDate: string; endDate: string; hours: string; status: "approved" | "requested"; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f) return;
    setBusy(true);
    const r = await api(`/api/team/hr/${file.resourceId}/time-off`, { method: "POST", body: JSON.stringify({ kind: f.kind, startDate: f.startDate, endDate: f.endDate || undefined, hours: Number(f.hours), status: f.status, note: f.note.trim() || undefined }) });
    setBusy(false);
    if (!r.ok) onError(r.message); else { setF(null); onDone("Time off recorded."); }
  }
  async function decide(entryId: string, status: "approved" | "denied" | "canceled") {
    const r = await api(`/api/team/hr/${file.resourceId}/time-off`, { method: "PATCH", body: JSON.stringify({ entryId, status }) });
    if (!r.ok) onError(r.message); else onDone(`Time off ${status}.`);
  }
  const left = (allow: number | null, used: number) => (allow === null ? `${hrs(used)} used` : `${hrs(Math.max(0, allow - used))} left of ${hrs(allow)}`);
  return (
    <Section title={`Time off in ${b.year}`} testid="hr-pto">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <div className="rounded-xl border border-line p-3"><p className="text-xs text-muted">Paid time off</p><p className="font-extrabold text-navy">{left(b.ptoAllowance, b.ptoUsed)}</p></div>
        <div className="rounded-xl border border-line p-3"><p className="text-xs text-muted">Sick time</p><p className="font-extrabold text-navy">{left(b.sickAllowance, b.sickUsed)}</p></div>
      </div>
      {file.timeOff.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {file.timeOff.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="mr-auto">{TIME_OFF_KINDS[e.kind] ?? e.kind} · {hrs(e.hours)}<span className="block text-xs text-muted">{fmt(e.startDate)}{e.endDate !== e.startDate ? ` – ${fmt(e.endDate)}` : ""}{e.note ? ` · ${e.note}` : ""}</span></span>
              <Badge tone={e.status === "approved" ? "ok" : e.status === "requested" ? "warn" : undefined}>{e.status === "requested" ? "Requested" : e.status[0].toUpperCase() + e.status.slice(1)}</Badge>
              {e.status === "requested" && <><Button size="sm" variant="ghost" onClick={() => decide(e.id, "approved")}><Check className="h-4 w-4" aria-hidden /> Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(e.id, "denied")}><X className="h-4 w-4" aria-hidden /> Deny</Button></>}
              {e.status === "approved" && <Button size="sm" variant="ghost" onClick={() => decide(e.id, "canceled")}>Cancel</Button>}
            </li>
          ))}
        </ul>
      )}
      {f ? (
        <div className="grid gap-3 rounded-xl border border-line bg-paper p-3 sm:grid-cols-3">
          <label className="block"><span className="label">Kind</span><select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as keyof typeof TIME_OFF_KINDS })}>{Object.entries(TIME_OFF_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="block"><span className="label">First day</span><input type="date" className="field" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="block"><span className="label">Last day</span><input type="date" className="field" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
          <label className="block"><span className="label">Hours</span><input className="field" inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value.replace(/[^\d.]/g, "") })} /></label>
          <label className="block"><span className="label">Status</span><select className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "approved" | "requested" })}><option value="approved">Approved</option><option value="requested">Requested</option></select></label>
          <label className="block"><span className="label">Note</span><input className="field" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy || !f.startDate || !Number(f.hours)}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="secondary" onClick={() => setF(null)}>Cancel</Button></div>
        </div>
      ) : <Button size="sm" variant="secondary" onClick={() => setF({ kind: "pto", startDate: "", endDate: "", hours: "8", status: "approved", note: "" })}>Record time off</Button>}
      <p className="text-xs text-muted">Allowances are set in the details above. Balances count approved time off in the calendar year; carry-over and accrual rules aren&apos;t applied.</p>
    </Section>
  );
}
