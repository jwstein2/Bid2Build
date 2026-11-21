"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, Link2, RefreshCw, Send, Unplug } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, Notice } from "@/components/ui/misc";
import { api } from "@/components/schedule/client";
import { addDays, weekStart } from "@/lib/team/records";

type Entity = { id: string; name: string; type: "Employee" | "Vendor" | "Customer" };
type Conn = { id: string; companyName: string | null; environment: "sandbox" | "production"; status: "active" | "needs_reauth"; lastSyncAt: string | null; lastError: string | null };
type Status = {
  configured: boolean; connection: Conn | null; entities: Entity[]; entitiesError?: string;
  links: { workers: { resourceId: string; qbType: "Employee" | "Vendor"; qbId: string; qbName: string | null }[]; jobs: { scheduleId: string; qbCustomerId: string; qbName: string | null }[] };
};
type SyncResult = { sent: number; failed: { entryId: string; message: string }[]; skipped: Record<string, number>; remaining: number };

const SKIP_LABEL: Record<string, string> = {
  not_approved: "not approved yet", still_open: "still clocked in", unpaid: "marked unpaid", no_match: "worker not matched", already_sent: "already sent", zero_hours: "zero hours",
};
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export function QuickBooksSync({ configured, workers, projects }: { configured: boolean; workers: { id: string; name: string }[]; projects: { id: string; name: string }[] }) {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lastWeek = weekStart(addDays(today(), -7));
  const [from, setFrom] = useState(lastWeek);
  const [to, setTo] = useState(addDays(lastWeek, 6));
  const [result, setResult] = useState<SyncResult | null>(null);

  const load = useCallback(() => api<Status>("/api/integrations/quickbooks?entities=1").then((r) => {
    if (r.ok) { setS(r.data); setErr(null); } else setErr(r.message);
  }), []);
  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => (s?.entities ?? []).filter((e) => e.type !== "Customer"), [s]);
  const customers = useMemo(() => (s?.entities ?? []).filter((e) => e.type === "Customer"), [s]);
  const workerLink = (id: string) => s?.links.workers.find((w) => w.resourceId === id);
  const jobLink = (id: string) => s?.links.jobs.find((j) => j.scheduleId === id);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key); setErr(null);
    const r = await api<SyncResult | { ok: true }>("/api/integrations/quickbooks", { method: "POST", body: JSON.stringify(body) });
    setBusy(null);
    if (!r.ok) { setErr(r.message); if (r.code === "reauth") void load(); return null; }
    return r.data;
  }
  async function linkWorker(resourceId: string, value: string) {
    const e = people.find((p) => `${p.type}:${p.id}` === value);
    if (await post({ action: "link_worker", resourceId, qbType: e?.type ?? null, qbId: e?.id ?? null, qbName: e?.name ?? null }, `w:${resourceId}`)) void load();
  }
  async function linkJob(scheduleId: string, value: string) {
    const e = customers.find((c) => c.id === value);
    if (await post({ action: "link_job", scheduleId, qbId: e?.id ?? null, qbName: e?.name ?? null }, `j:${scheduleId}`)) void load();
  }
  async function sync() {
    setResult(null);
    const r = await post({ action: "sync", from, to }, "sync");
    if (r && "sent" in r) { setResult(r); void load(); }
  }
  async function disconnect() {
    if (await post({ action: "disconnect" }, "disconnect")) { setResult(null); void load(); }
  }

  if (!configured) {
    return <Notice title="Coming soon">Connecting QuickBooks Online is almost ready. Until then, use <Link className="underline" href="/projects/workforce/time-tracking?tab=payroll">Payroll CSV</Link> to export hours.</Notice>;
  }
  if (!s) return err ? <Notice tone="danger">{err}</Notice> : <p className="text-sm text-muted">Loading…</p>;
  const c = s.connection;
  const matched = s.links.workers.length;

  return (
    <div className="space-y-5">
      {err && <Notice tone="danger">{err}</Notice>}
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-navy"><Link2 className="h-5 w-5 text-accent-ink" aria-hidden /> Connection</h2>
            {c ? (
              <p className="text-sm text-ink-soft">
                {c.companyName ?? "Your QuickBooks company"} {c.environment === "sandbox" && <Badge tone="warn">Sandbox</Badge>} · last sent {fmt(c.lastSyncAt)}
              </p>
            ) : <p className="text-sm text-ink-soft">Connect the QuickBooks Online company you run payroll in.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(!c || c.status === "needs_reauth") && (
              <a href="/api/integrations/quickbooks/connect" className={buttonClass("primary", "md")} data-testid="qb-connect">{c ? "Reconnect QuickBooks" : "Connect QuickBooks"}</a>
            )}
            {c && <Button variant="secondary" onClick={disconnect} disabled={busy === "disconnect"} data-testid="qb-disconnect"><Unplug className="h-4 w-4" aria-hidden /> Disconnect</Button>}
          </div>
        </div>
        {c?.status === "needs_reauth" && <Notice tone="warn">QuickBooks asked you to sign in again. Your matches are kept.</Notice>}
        {s.entitiesError && <Notice tone="warn">{s.entitiesError}</Notice>}
        <p className="text-xs text-muted">Built2Bid only adds time entries. It doesn&apos;t run payroll, change pay rates or move money. You review and run payroll in QuickBooks.</p>
      </Card>

      {c && c.status === "active" && (
        <>
          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-bold text-navy">1. Match your workers</h2>
            <p className="text-sm text-ink-soft">Pick the QuickBooks employee (or vendor, for 1099 workers) for each person. Unmatched people are skipped.</p>
            {workers.length === 0 ? <p className="text-sm text-muted">No active workers yet.</p> : (
              <ul className="divide-y divide-line">
                {workers.map((w) => {
                  const l = workerLink(w.id);
                  return (
                    <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium text-navy">{w.name}</span>
                      <select aria-label={`QuickBooks match for ${w.name}`} className="min-h-11 rounded-lg border border-line-strong bg-surface px-2 text-sm" value={l ? `${l.qbType}:${l.qbId}` : ""}
                        onChange={(e) => linkWorker(w.id, e.target.value)} disabled={busy === `w:${w.id}`}>
                        <option value="">Not matched</option>
                        <optgroup label="Employees">{people.filter((p) => p.type === "Employee").map((p) => <option key={p.id} value={`Employee:${p.id}`}>{p.name}</option>)}</optgroup>
                        <optgroup label="Vendors (1099)">{people.filter((p) => p.type === "Vendor").map((p) => <option key={p.id} value={`Vendor:${p.id}`}>{p.name}</option>)}</optgroup>
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-bold text-navy">2. Match projects <span className="text-sm font-normal text-muted">(optional)</span></h2>
            <p className="text-sm text-ink-soft">Matching a project to a QuickBooks customer tags its hours for job costing in QuickBooks.</p>
            {projects.length === 0 ? <p className="text-sm text-muted">No active projects.</p> : (
              <ul className="divide-y divide-line">
                {projects.map((p) => {
                  const l = jobLink(p.id);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium text-navy">{p.name}</span>
                      <select aria-label={`QuickBooks customer for ${p.name}`} className="min-h-11 rounded-lg border border-line-strong bg-surface px-2 text-sm" value={l?.qbCustomerId ?? ""}
                        onChange={(e) => linkJob(p.id, e.target.value)} disabled={busy === `j:${p.id}`}>
                        <option value="">No customer</option>
                        {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-lg font-bold text-navy">3. Send approved hours</h2>
            <p className="text-sm text-ink-soft">Only approved, clocked-out time is sent, and each entry only once. Approve time in <Link className="underline" href="/projects/workforce/time-tracking?tab=payroll">Timesheets</Link> first.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-navy">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block min-h-11 rounded-lg border border-line-strong bg-surface px-2" /></label>
              <label className="text-sm font-medium text-navy">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block min-h-11 rounded-lg border border-line-strong bg-surface px-2" /></label>
              <Button onClick={sync} disabled={busy === "sync" || matched === 0} data-testid="qb-sync">
                {busy === "sync" ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Send to QuickBooks
              </Button>
            </div>
            {matched === 0 && <p className="text-sm text-muted">Match at least one worker first.</p>}
            {result && (
              <div className="space-y-2" data-testid="qb-result">
                <p className="flex items-center gap-2 font-semibold text-navy"><CircleCheck className="h-5 w-5 text-ok" aria-hidden /> Sent {result.sent} time {result.sent === 1 ? "entry" : "entries"} to QuickBooks.</p>
                {Object.entries(result.skipped).filter(([, n]) => n > 0).length > 0 && (
                  <p className="text-sm text-ink-soft">Skipped: {Object.entries(result.skipped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${SKIP_LABEL[k] ?? k}`).join(", ")}.</p>
                )}
                {result.remaining > 0 && <p className="text-sm text-ink-soft">{result.remaining} more to send. Click Send again.</p>}
                {result.failed.length > 0 && <Notice tone="warn" title={`${result.failed.length} didn't go through`}>{result.failed[0].message} They&apos;ll be retried next time you send.</Notice>}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
