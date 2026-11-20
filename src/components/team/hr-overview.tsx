"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { EMPLOYMENT_STATUSES, type HrOverview } from "@/lib/team/hr";

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Everyone's HR file at a glance (what's missing, what expires) and, for the owner, who the HR managers are. */
export function HrOverviewView({ overview, today }: { overview: HrOverview; today: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const soon = (d: string | null) => !!d && (new Date(d).getTime() - new Date(today).getTime()) / 86_400_000 <= 30;

  async function toggle(userId: string, on: boolean) {
    setBusy(userId); setMsg(null);
    const r = await api("/api/team/hr/managers", { method: "POST", body: JSON.stringify({ userId, on }) });
    setBusy(null);
    if (!r.ok) setMsg({ ok: false, text: r.message }); else { setMsg({ ok: true, text: on ? "HR manager added." : "HR manager removed." }); router.refresh(); }
  }

  return (
    <div className="space-y-6" data-testid="hr-overview">
      {msg && <Notice tone={msg.ok ? "ok" : "danger"}>{msg.text}</Notice>}
      {overview.people.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">No employees yet. Add staff on <Link href="/projects/team" className="font-semibold underline">People &amp; subs</Link>, then open their HR file here.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {overview.people.map((p) => {
            const missing = [!p.ssnOnFile && "SSN", !p.emergencyOnFile && "emergency contact", !p.i9OnFile && "I-9", !p.w4OnFile && "W-4", !p.bankOnFile && "direct deposit"].filter(Boolean) as string[];
            return (
              <li key={p.resourceId}>
                <Link href={`/projects/team/hr/${p.resourceId}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-paper">
                  <span className="mr-auto min-w-0">
                    <span className="font-semibold text-navy">{p.name}</span>
                    <span className="block text-xs text-muted">{missing.length ? `Missing: ${missing.join(", ")}` : "Paperwork on file"}{p.nextExpiry ? ` · next expiry ${fmt(p.nextExpiry)}` : ""}</span>
                  </span>
                  {p.employmentStatus !== "active" && <Badge>{EMPLOYMENT_STATUSES[p.employmentStatus] ?? p.employmentStatus}</Badge>}
                  {p.expired > 0 && <Badge tone="danger">{p.expired} expired</Badge>}
                  {p.expired === 0 && soon(p.nextExpiry) && <Badge tone="warn">Expires soon</Badge>}
                  {missing.length === 0 ? <Badge tone="ok">Complete</Badge> : <Badge tone="warn">{missing.length} missing</Badge>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {overview.isOwner && overview.managers.length > 0 && (
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4" data-testid="hr-managers">
          <h2 className="text-lg font-extrabold text-navy">Who can open HR files</h2>
          <p className="text-sm text-ink-soft">You always can. Tick the people who should also see HR files, including Social Security numbers. Nobody else can, whatever their role.</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {overview.managers.map((m) => (
              <li key={m.userId}><label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={m.hr} disabled={busy === m.userId} onChange={(e) => toggle(m.userId, e.target.checked)} />{m.name}</label></li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted">Social Security numbers are encrypted and shown only on request; every view is recorded with who looked. HR details never appear in exports, the activity feed or reports.</p>
    </div>
  );
}
