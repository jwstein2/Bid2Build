"use client";
import { useState } from "react";
import { Briefcase, ChevronDown, ExternalLink, Pencil, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { EMPLOYMENT_LABEL, type SelfField, type WorkerJob, type WorkerProfile } from "@/lib/workforce/hub/profile";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const osm = (q: string) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1.5"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words text-right font-medium">{v ?? <span className="text-muted">Not set</span>}</dd></div>;
}

/**
 * My profile (worker dashboard): who I am at the company, who my supervisor is, and my contact + emergency details.
 * The worker can change only their own contact and emergency details; everything else is kept by their manager.
 */
export function MyProfile({ initial }: { initial: WorkerProfile }) {
  const [p, setP] = useState(initial);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Record<SelfField, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const display = p.preferredName ?? p.name;
  const startEdit = () => setEdit({ preferredName: p.preferredName ?? "", personalPhone: p.personalPhone ?? "", personalEmail: p.personalEmail ?? "",
    emergencyName: p.emergencyName ?? "", emergencyRelation: p.emergencyRelation ?? "", emergencyPhone: p.emergencyPhone ?? "" });
  const save = async () => {
    if (!edit) return;
    setBusy(true); setMsg(null);
    const r = await api<{ ok: true; profiles: WorkerProfile[] }>("/api/workforce/gps/me", { method: "POST", body: JSON.stringify({ action: "profile", resourceId: p.resourceId, fields: edit }) });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, t: r.message }); return; }
    const next = r.data.profiles.find((x) => x.resourceId === p.resourceId);
    if (next) setP(next);
    setEdit(null); setMsg({ ok: true, t: "Saved. Your manager sees the update." });
  };
  const field = (k: SelfField, label: string, type = "text", max = 100, placeholder?: string) => (
    <label className="block"><span className="label">{label}</span>
      <input className="field" type={type} maxLength={max} value={edit?.[k] ?? ""} placeholder={placeholder} autoComplete="off"
        onChange={(e) => edit && setEdit({ ...edit, [k]: e.target.value })} /></label>
  );

  return (
    <section className="rounded-xl border border-line bg-surface" data-testid="my-profile">
      <button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`profile-${p.resourceId}`}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-tint text-accent-ink"><UserRound className="h-6 w-6" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-extrabold text-navy">{display}</span>
          <span className="block truncate text-sm text-ink-soft">{[p.title, p.companyName].filter(Boolean).join(" · ") || "My profile"}</span>
        </span>
        <span className="flex items-center gap-1 text-sm font-semibold text-accent-ink">{open ? "Hide" : "My profile"}<ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /></span>
      </button>
      {open && (
        <div id={`profile-${p.resourceId}`} className="space-y-4 border-t border-line p-4 text-sm">
          {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.t}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="font-bold text-navy">Work</h3>
              <dl className="divide-y divide-line">
                <Row k="Name on file" v={p.name} />
                <Row k="Job title" v={p.title} />
                {p.department && <Row k="Department" v={p.department} />}
                <Row k="Supervisor" v={p.supervisorName} />
                {p.employmentType && <Row k="Type" v={EMPLOYMENT_LABEL[p.employmentType] ?? p.employmentType} />}
                {p.hireDate && <Row k="Start date" v={longDate(p.hireDate)} />}
                {p.trades.length > 0 && <Row k="Trades" v={p.trades.join(", ")} />}
                {p.workPhone && <Row k="Work phone" v={<a className="underline" href={tel(p.workPhone)}>{p.workPhone}</a>} />}
                {p.workEmail && <Row k="Work email" v={p.workEmail} />}
              </dl>
            </div>
            {!edit ? (
              <div>
                <h3 className="font-bold text-navy">Contact &amp; emergency</h3>
                <dl className="divide-y divide-line">
                  <Row k="Preferred name" v={p.preferredName} />
                  <Row k="Personal phone" v={p.personalPhone} />
                  <Row k="Personal email" v={p.personalEmail} />
                  <Row k="Emergency contact" v={p.emergencyName ? `${p.emergencyName}${p.emergencyRelation ? ` (${p.emergencyRelation})` : ""}` : null} />
                  <Row k="Emergency phone" v={p.emergencyPhone} />
                </dl>
                <Button size="sm" variant="secondary" className="mt-2" onClick={startEdit} data-testid="profile-edit"><Pencil className="h-4 w-4" aria-hidden />Update my contact info</Button>
              </div>
            ) : (
              <div className="space-y-2" data-testid="profile-form">
                <h3 className="font-bold text-navy">Update my contact info</h3>
                {field("preferredName", "Preferred name")}
                {field("personalPhone", "Personal phone", "tel", 40)}
                {field("personalEmail", "Personal email", "email", 320)}
                {field("emergencyName", "Emergency contact name", "text", 200)}
                {field("emergencyRelation", "Relationship", "text", 60, "e.g. Spouse, parent")}
                {field("emergencyPhone", "Emergency contact phone", "tel", 40)}
                <div className="flex gap-2 pt-1"><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button></div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Something else wrong, like your title or supervisor? Ask your manager to update it. Pay and tax details aren&apos;t shown here.</p>
        </div>
      )}
    </section>
  );
}

/** Jobs I'm on: open projects where I (or my crew) have unfinished work, or an upcoming shift. */
export function MyJobs({ jobs, today }: { jobs: WorkerJob[]; today: string }) {
  return (
    <section className="space-y-2" data-testid="my-jobs">
      <h2 className="flex items-center gap-2 font-extrabold text-navy"><Briefcase className="h-5 w-5 text-accent-ink" aria-hidden />Jobs I&apos;m on</h2>
      {jobs.length === 0 ? <p className="text-sm text-muted">You&apos;re not assigned to any open jobs right now.</p> : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {jobs.map((j) => (
            <li key={j.scheduleId} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 sm:flex-1">
                <p className="break-words font-semibold">{j.name}</p>
                {j.address && <a className="inline-flex items-center gap-1 text-ink-soft underline" href={osm(j.address)} target="_blank" rel="noopener noreferrer">{j.address}<ExternalLink className="h-3 w-3" aria-hidden /></a>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {j.nextDate && <Badge tone={j.nextDate === today ? "accent" : "neutral"}>{j.nextDate === today ? "Today" : `Next: ${dayLabel(j.nextDate)}`}</Badge>}
                {j.openTasks > 0 && <Badge>{j.openTasks} {j.openTasks === 1 ? "task" : "tasks"}</Badge>}
                {j.lastDate && <span className="text-xs text-muted">through {dayLabel(j.lastDate)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Small shortcut to the clock-in review form. */
export function ReviewShortcut() {
  return (
    <a href="#time-clock" className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-sm hover:bg-paper" data-testid="review-shortcut">
      <Phone className="h-5 w-5 shrink-0 text-accent-ink" aria-hidden />
      <span><strong>Forgot your phone or missed a clock-in?</strong> <span className="text-ink-soft">Use &quot;Add missing time&quot; or &quot;Request a fix&quot; under My week. Your manager reviews it.</span></span>
    </a>
  );
}
