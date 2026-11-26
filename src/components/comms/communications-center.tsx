"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Mail, MailX, PauseCircle, PlayCircle, Power, RefreshCw, Send, ShieldCheck, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Notice } from "@/components/ui/misc";
import { MetricCard } from "@/components/ui/metric-card";
import { cn } from "@/lib/cn";
import { AUDIENCE_GROUPS, CONTACT_STATUS_LABEL, FREQUENCY_LABEL, MESSAGE_STATUS_LABEL, OFFER_TYPE_LABEL, type AudienceGroup, type CommAccess, type CommSettings, type ContactStatus, type MessageStatus, type Offer, type OfferType, type UpdateFrequency } from "@/lib/comms/types";
import { DEFAULT_BODY, DEFAULT_SUBJECT, PLACEHOLDERS, PLACEHOLDER_HELP } from "@/lib/comms/template";
import { COMM_TERMS, COMM_TERMS_VERSION, RECOMMENDED, RECOMMENDED_NOTES, termsCurrent } from "@/lib/comms/rollout";
import { LegalStatusCompact } from "@/components/legal/legal-status";

interface Msg {
  id: string; kind: "nurture" | "project_update"; trigger: string; contact_id: string | null; schedule_id: string | null; to_email: string | null; to_name: string | null;
  subject: string; body_text: string; status: MessageStatus; status_reason: string | null; scheduled_for: string | null; sent_at: string | null; delivered_at: string | null;
  replied_at: string | null; approved_at: string | null; automation: boolean; created_at: string;
}
interface Evt { id: string; kind: string; message_id: string | null; from_email: string | null; subject: string | null; excerpt: string | null; details: { label?: string; classification?: string }; needs_attention: boolean; handled_at: string | null; created_at: string }
interface Contact { id: string; email: string; name: string | null; customer_id?: string | null; status: ContactStatus; status_reason: string | null; basis: string; last_nurture_at: string | null; last_reply_at: string | null }
interface Proj { schedule_id: string; name: string; frequency: UpdateFrequency; mode: string; paused_at: string | null; scheduleStatus: string | null }
interface Data {
  available: boolean; locked?: boolean; access?: CommAccess; settings: CommSettings; owner?: boolean;
  suggested?: { senderName: string | null; postalAddress: string | null; replyTo: string | null }; offers: Offer[]; messages: Msg[]; events: Evt[]; contacts: Contact[]; projects: Proj[];
  platform: { sending: string; sendingReason: string | null; paused: boolean; monitoring: { configured: boolean; active: boolean; reason: string | null; verifiedAt: string | null } };
}
interface Entry { email: string; name: string; groups: AudienceGroup[]; basis: string | null; estimate: { title: string; estimateDate: string }; estimateCount: number; nextDueAt: string; due: boolean; contactId: string | null; contactStatus: ContactStatus | null; excluded: string | null }

const TABS = [
  { id: "attention", label: "Needs attention" },
  { id: "scheduled", label: "Scheduled" },
  { id: "sent", label: "Sent history" },
  { id: "replies", label: "Replies" },
  { id: "contacts", label: "Contacts" },
  { id: "settings", label: "Automation settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const REPLY_KINDS = new Set(["reply", "ambiguous_reply", "opt_out_request", "auto_reply"]);
const STATUS_TONE: Partial<Record<MessageStatus, "ok" | "warn" | "danger" | "brand" | "neutral">> = { awaiting_review: "warn", scheduled: "brand", approved: "brand", sent: "ok", delivered: "ok", failed: "danger", replied: "brand", paused: "warn" };
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? "Something went wrong. Please try again.");
  return d;
}

export function CommunicationsCenter() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS.some((t) => t.id === sp.get("tab")) ? sp.get("tab") : "attention") as Tab;
  const type = sp.get("type") ?? "all";
  const status = sp.get("status") ?? "all";
  const range = sp.get("range") ?? "30";
  const q = sp.get("q") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const [now, setNow] = useState(0);
  const load = useCallback(() => {
    fetch("/api/comms", { cache: "no-store" }).then((r) => r.json()).then((d) => { setNow(Date.now()); setData(d); }).catch(() => setErr("We couldn't load communications."));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Success messages fade after a few seconds; errors stay until the next action.
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 5000); return () => clearTimeout(t); }, [flash]);

  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "" || v === "all") p.delete(k); else p.set(k, v); }
    router.replace(`?${p.toString()}`, { scroll: false });
  };
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setErr(null); setFlash(null);
    try { const r = await fn() as { message?: string } | undefined; setFlash(r?.message ?? ok ?? null); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const perms = new Set(data?.access?.perms ?? []);
  const filtered = useMemo(() => {
    if (!data?.messages) return [];
    const since = now - Number(range) * 86_400_000;
    const needle = q.trim().toLowerCase();
    return data.messages.filter((m) => (type === "all" || m.kind === type) && (status === "all" || m.status === status)
      && Date.parse(m.sent_at ?? m.scheduled_for ?? m.created_at) >= since - (["awaiting_review", "scheduled", "approved"].includes(m.status) ? 1e13 : 0)
      && (!needle || `${m.to_name ?? ""} ${m.to_email ?? ""} ${m.subject}`.toLowerCase().includes(needle)));
  }, [data, type, status, range, q, now]);

  if (!data) return err ? <Notice tone="danger">{err}</Notice> : <div className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…</div>;
  if (!data.available) return <Notice tone="warn" title="Not set up yet">Customer communications need a database update before they can be used.</Notice>;
  if (data.locked) return <LockedCard />;

  const s = data.settings;
  const review = data.messages.filter((m) => m.status === "awaiting_review" || m.status === "failed");
  const scheduled = data.messages.filter((m) => m.status === "scheduled" || m.status === "approved");
  const sent = data.messages.filter((m) => ["sent", "delivered", "replied"].includes(m.status));
  const replies = data.events.filter((e) => REPLY_KINDS.has(e.kind));
  const unread = replies.filter((e) => e.needs_attention && !e.handled_at);
  const paused = data.contacts.filter((c) => c.status === "paused" || c.status === "replied");
  const unsub = data.contacts.filter((c) => ["unsubscribed", "bounced", "suppressed"].includes(c.status));
  const sent30 = sent.filter((m) => Date.parse(m.sent_at ?? m.created_at) > now - 30 * 86_400_000).length;
  const show = (list: Msg[]) => filtered.filter((m) => list.includes(m));
  const off = Boolean(s.disabledAt);
  // While the owner has customer emails off, only history, replies and opt-outs stay (nothing else could do anything).
  const tabs = off ? TABS.filter((t) => ["sent", "replies", "contacts"].includes(t.id)) : TABS;
  const activeTab: Tab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const canAcceptTerms = perms.has("enable_customer_nurture") || perms.has("configure_project_updates");

  return (
    <div className="space-y-5" data-testid="communications-center">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold">Communications</h2>
          <p className="text-sm text-ink-soft">Follow-ups for past customers and progress emails for active projects. Everything is off until you turn it on.</p>
        </div>
        {off ? null : s.pausedAt
          ? <Button variant="secondary" disabled={busy === "pause"} onClick={() => run("pause", () => call("/api/comms/pause-all", "POST", { paused: false }), "Customer emails resumed.")} data-testid="resume-all"><PlayCircle className="h-4 w-4" aria-hidden /> Resume all</Button>
          : <Button variant="secondary" disabled={busy === "pause"} onClick={() => run("pause", () => call("/api/comms/pause-all", "POST", { paused: true }), "All customer emails are paused.")} data-testid="pause-all"><PauseCircle className="h-4 w-4" aria-hidden /> Pause all</Button>}
      </div>

      {off ? <DisabledNotice settings={s} owner={Boolean(data.owner)} busy={busy} run={run} /> : <StatusBanner data={data} />}
      {!off && !termsCurrent(s) && <TermsCard canAccept={canAcceptTerms} busy={busy} run={run} />}
      {(flash || err) && (
        <div className="sticky top-2 z-20 rounded-lg bg-paper shadow-md" role={err ? "alert" : "status"} aria-live="polite" data-testid="comms-feedback">
          {err ? <Notice tone="danger">{err}</Notice> : <Notice tone="ok">{flash}</Notice>}
        </div>
      )}

      {!off && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard size="sm" title="Needs review" value={review.length} tone={review.length ? "warn" : "default"} empty={!review.length} onSelect={() => setParam({ tab: "attention", status: null })} pressed={activeTab === "attention"} action="Review" testId="kpi-review" />
        <MetricCard size="sm" title="Replies to read" value={unread.length} tone={unread.length ? "danger" : "default"} empty={!unread.length} onSelect={() => setParam({ tab: "replies" })} pressed={activeTab === "replies"} action="Open replies" testId="kpi-replies" />
        <MetricCard size="sm" title="Scheduled" value={scheduled.length} empty={!scheduled.length} onSelect={() => setParam({ tab: "scheduled", status: null })} pressed={activeTab === "scheduled"} action="See scheduled emails" testId="kpi-scheduled" />
        <MetricCard size="sm" title="Paused contacts" value={paused.length} empty={!paused.length} onSelect={() => setParam({ tab: "contacts", status: "paused" })} pressed={activeTab === "contacts" && status === "paused"} action="View paused" testId="kpi-paused" />
        <MetricCard size="sm" title="Unsubscribed" value={unsub.length} empty={!unsub.length} onSelect={() => setParam({ tab: "contacts", status: "unsubscribed" })} pressed={activeTab === "contacts" && status === "unsubscribed"} action="View opt-outs" testId="kpi-unsub" />
        <MetricCard size="sm" title="Sent (30 days)" value={sent30} empty={!sent30} onSelect={() => setParam({ tab: "sent", status: null, range: "30" })} pressed={activeTab === "sent"} action="Sent history" testId="kpi-sent" />
      </div>}

      <div role="tablist" aria-label="Communications sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} onClick={() => setParam({ tab: t.id, status: null })}
            className={cn("min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold", activeTab === t.id ? "bg-navy text-white" : "text-ink-soft hover:bg-black/5")} data-testid={`tab-${t.id}`}>
            {t.label}{t.id === "attention" && review.length ? ` (${review.length})` : t.id === "replies" && unread.length ? ` (${unread.length})` : ""}
          </button>
        ))}
      </div>

      {["attention", "scheduled", "sent"].includes(activeTab) && (
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="sr-only" htmlFor="f-q">Customer or project</label>
          <input id="f-q" className="field" placeholder="Customer, email or subject" defaultValue={q} onChange={(e) => setParam({ q: e.target.value })} />
          <select aria-label="Communication type" className="field" value={type} onChange={(e) => setParam({ type: e.target.value })}>
            <option value="all">All types</option><option value="nurture">Customer follow-ups</option><option value="project_update">Project updates</option>
          </select>
          <select aria-label="Status" className="field" value={status} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="all">Any status</option>
            {(Object.keys(MESSAGE_STATUS_LABEL) as MessageStatus[]).map((k) => <option key={k} value={k}>{MESSAGE_STATUS_LABEL[k]}</option>)}
          </select>
          <select aria-label="Date range" className="field" value={range} onChange={(e) => setParam({ range: e.target.value })}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="120">Last 120 days</option>
          </select>
        </div>
      )}

      {activeTab === "attention" && (
        <div className="space-y-3">
          {unread.length > 0 && <Notice tone="warn" title={`${unread.length} customer ${unread.length === 1 ? "reply needs" : "replies need"} a personal response`}><button className="font-semibold underline" onClick={() => setParam({ tab: "replies" })}>Open replies</button></Notice>}
          <MessageList list={show(review)} empty="Nothing waiting for review. Follow-ups for past customers and progress emails for active projects land here as drafts. Nothing sends until someone approves it." open={open} setOpen={setOpen} busy={busy} run={run} perms={perms} />
        </div>
      )}
      {activeTab === "scheduled" && <MessageList list={show(scheduled)} empty="No emails are scheduled. Approved follow-ups and project updates wait here until their send time." open={open} setOpen={setOpen} busy={busy} run={run} perms={perms} />}
      {activeTab === "sent" && <MessageList list={filtered.filter((m) => !["awaiting_review", "scheduled", "approved"].includes(m.status))} empty="No emails in this period. Try a longer date range, or check Needs attention for drafts waiting on approval." open={open} setOpen={setOpen} busy={busy} run={run} perms={perms} />}
      {activeTab === "replies" && <Replies events={replies} messages={data.messages} busy={busy} run={run} canRead={perms.has("view_customer_replies")} />}
      {activeTab === "contacts" && <Contacts contacts={data.contacts} filter={status} busy={busy} run={run} canManage={perms.has("manage_opt_outs")} />}
      {activeTab === "settings" && <Settings key={`${s.senderName}|${s.postalAddress}|${s.replyTo}`} data={data} perms={perms} busy={busy} run={run} reload={load} />}
    </div>
  );
}

type Run = (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/** Shown instead of the status cards while the account owner has customer emails turned off. */
function DisabledNotice({ settings, owner, busy, run }: { settings: CommSettings; owner: boolean; busy: string | null; run: Run }) {
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4" data-testid="comms-disabled">
      <p className="flex items-center gap-2 font-semibold"><Power className="h-4 w-4" aria-hidden /> Customer emails are off for your company</p>
      <p className="text-sm text-ink-soft">
        {owner ? "You" : "Your account owner"} turned off customer follow-ups and project update emails on {day(settings.disabledAt)}. Nothing is drafted, approved or sent, and it stays off until {owner ? "you turn" : "the owner turns"} it back on.
        {settings.disabledReason ? ` Reason: ${settings.disabledReason}` : ""}
      </p>
      <p className="text-sm text-ink-soft">Past emails, replies and opt-outs are still here. Unsubscribes keep being honored.</p>
      {owner && <CompanySwitch off busy={busy} run={run} />}
    </div>
  );
}

/** The account owner's switch. Off cancels everything queued; on restarts nothing by itself. */
function CompanySwitch({ off, busy, run }: { off: boolean; busy: string | null; run: Run }) {
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return off
    ? <Button variant="secondary" onClick={() => setOpen(true)} data-testid="company-on">Turn customer emails back on</Button>
    : <Button variant="secondary" onClick={() => setOpen(true)} data-testid="company-off"><Power className="h-4 w-4" aria-hidden /> Turn off customer emails for the company</Button>;
  return (
    <div className="space-y-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" role="group" aria-label={off ? "Turn customer emails back on" : "Turn off customer emails"} data-testid="company-switch-confirm">
      {off ? (
        <p>Your team can set up follow-ups and project updates again. Nothing restarts by itself: follow-ups stay off until someone reviews the audience and activates them, and every project stays on review first.</p>
      ) : (<>
        <p>This stops all customer follow-ups and project update emails for everyone in your company. Everything waiting to send is canceled, follow-ups are deactivated and every project goes back to review first. It stays off until you turn it back on, and only you can.</p>
        <Field label="Reason" htmlFor="cs-reason" optional hint="Shown to your team."><input id="cs-reason" className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </>)}
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4" checked={ok} onChange={(e) => setOk(e.target.checked)} /> {off ? "Turn customer emails back on" : "I want customer emails off for the whole company"}</label>
      <div className="flex gap-2">
        <Button size="sm" disabled={!ok || busy !== null} data-testid="company-switch-submit"
          onClick={() => run("switch", () => call("/api/comms/company-switch", "POST", { off: !off, confirm: true, ...(off ? {} : { reason: reason || undefined }) }), off ? "Customer emails are available again. Nothing was restarted." : "Customer emails are off for your company. Nothing will send.").then(() => setOpen(false))}>
          {off ? "Turn back on" : "Turn off"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function TermsList() {
  return (
    <ul className="space-y-2 text-sm">
      {COMM_TERMS.map((t) => <li key={t.title}><span className="font-semibold">{t.title}.</span> <span className="text-ink-soft">{t.body}</span></li>)}
    </ul>
  );
}

/** Customer email terms: accepted once per account (per version) before anything can be approved or sent. */
function TermsCard({ canAccept, busy, run }: { canAccept: boolean; busy: string | null; run: Run }) {
  const [ok, setOk] = useState(false);
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="comms-terms">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div>
          <h3 className="font-bold">Before your first customer email</h3>
          <p className="text-sm text-ink-soft">Please read how customer emails work. Nothing can be approved or sent until someone on your team accepts this.</p>
        </div>
      </div>
      <TermsList />
      {canAccept ? (<>
        <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="terms-check" /> I&apos;ve read this, I&apos;ll only email people we have a real relationship with, and I accept the customer email terms for our company.</label>
        <Button disabled={!ok || busy !== null} onClick={() => run("terms", () => call("/api/comms/terms", "POST", { accept: true, version: COMM_TERMS_VERSION }), "Thanks. You can now set up follow-ups and project updates.")} data-testid="terms-accept">Accept and continue</Button>
      </>) : <p className="text-xs text-muted">Someone allowed to turn on customer emails (usually your company owner) needs to accept this first.</p>}
      <LegalStatusCompact />
    </Card>
  );
}

/** One click to the recommended starting point. Never turns follow-ups or a project's updates on. */
function Recommended({ data, perms, busy, run }: { data: Data; perms: Set<string>; busy: string | null; run: Run }) {
  const s = data.settings, sug = data.suggested;
  const canApply = perms.has("enable_customer_nurture") && perms.has("edit_nurture_templates") && perms.has("configure_project_updates");
  const apply = () => {
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
    const patch: Record<string, unknown> = { ...RECOMMENDED, ...(tz ? { timezone: tz } : {}) };
    if (!s.senderName && sug?.senderName) patch.senderName = sug.senderName;
    if (!s.postalAddress && sug?.postalAddress) patch.postalAddress = sug.postalAddress;
    if (!s.replyTo && sug?.replyTo) patch.replyTo = sug.replyTo;
    return run("recommended", () => call("/api/comms/settings", "PUT", patch), "Recommended settings applied. Nothing was turned on or sent.");
  };
  return (
    <Card className="space-y-2 p-4 sm:p-5 lg:col-span-2" data-testid="recommended">
      <h3 className="font-bold">Recommended settings</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">{RECOMMENDED_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
      {canApply
        ? <Button size="sm" variant="secondary" disabled={busy !== null} onClick={apply} data-testid="apply-recommended">Use recommended settings</Button>
        : <p className="text-xs text-muted">Someone allowed to change follow-ups and project updates can apply these.</p>}
      <p className="text-xs text-muted">This changes defaults only. Follow-ups stay off until you review who gets them, and each project&apos;s updates are turned on in that project.</p>
    </Card>
  );
}

function OwnerControls({ data, busy, run }: { data: Data; busy: string | null; run: Run }) {
  const s = data.settings;
  return (
    <Card className="space-y-3 p-4 sm:p-5 lg:col-span-2" data-testid="owner-controls">
      <h3 className="font-bold">Company controls</h3>
      {s.termsAcceptedAt && (
        <details className="text-sm"><summary className="cursor-pointer text-ink-soft">Customer email terms accepted {day(s.termsAcceptedAt)}</summary><div className="mt-2"><TermsList /></div></details>
      )}
      {data.owner
        ? (<><p className="text-sm text-ink-soft">As the account owner you can turn customer emails off for everyone in your company. It stays off until you turn it back on.</p><CompanySwitch off={false} busy={busy} run={run} /></>)
        : <p className="text-sm text-ink-soft">Only the account owner can turn customer emails off for the whole company. Use Pause all to stop sending for now.</p>}
    </Card>
  );
}

function LockedCard() {
  return (
    <Card className="p-6" data-testid="comms-locked">
      <h2 className="text-xl font-extrabold">Customer Communications</h2>
      <p className="mt-1 text-ink-soft">Part of Project Command Center: optional six-month follow-ups for past customers, and weekly or milestone progress emails for active projects, with review before anything sends.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
        <li>Off by default. You choose who gets follow-ups.</li>
        <li>Unsubscribes and bounces stop follow-ups automatically. Replies come straight to you.</li>
        <li>Progress emails only say work is complete when your PM confirmed it.</li>
      </ul>
      <Link href="/settings/billing#pm" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-navy px-4 font-semibold text-white">Unlock Project Command Center</Link>
    </Card>
  );
}

function StatusBanner({ data }: { data: Data }) {
  const p = data.platform, s = data.settings;
  return (
    <div className="grid gap-2 md:grid-cols-3" data-testid="comms-status">
      <div className="rounded-lg border border-line bg-surface p-3 text-sm">
        <p className="font-semibold">Customer follow-ups</p>
        <p className="text-ink-soft">{s.pausedAt ? "Paused (Pause all)" : s.nurtureEnabled && s.nurtureActivatedAt ? `On · every ${s.nurtureMonths} months · ${s.nurtureMode === "automatic" ? "automatic" : "review first"}` : "Off"}</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-3 text-sm">
        <p className="font-semibold">Project updates</p>
        <p className="text-ink-soft">{s.pausedAt ? "Paused (Pause all)" : `${data.projects.filter((x) => x.frequency !== "off" && !x.paused_at).length} project(s) on · default ${FREQUENCY_LABEL[s.updatesFrequency].toLowerCase()}`}</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-3 text-sm" data-testid="reply-monitoring">
        <p className="font-semibold">Reply monitoring</p>
        <p className="text-ink-soft">{p.monitoring.active ? "Active: customer replies pause follow-ups automatically." : `Not active. Replies go to your own inbox, so use "Mark replied" when someone writes back. ${p.monitoring.reason ?? ""}`}</p>
      </div>
      {(p.paused || p.sending === "off") && (
        <Notice tone="warn" className="md:col-span-3">{p.paused ? "Built2Bid has temporarily paused all automated customer emails." : "Customer email sending isn't switched on for Built2Bid yet. You can set everything up and review drafts; nothing will be sent."}</Notice>
      )}
      {p.sending === "test" && <Notice className="md:col-span-3">Test mode: only Built2Bid test addresses receive these emails.</Notice>}
    </div>
  );
}

function MessageList({ list, empty, open, setOpen, busy, run, perms }: { list: Msg[]; empty: string; open: string | null; setOpen: (v: string | null) => void; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>; perms: Set<string> }) {
  if (!list.length) return <Card className="p-6 text-center text-sm text-muted">{empty}</Card>;
  return (
    <ul className="space-y-2" data-testid="message-list">
      {list.map((m) => {
        const canAct = perms.has(m.kind === "nurture" ? "approve_marketing_outreach" : "approve_customer_updates");
        const pending = ["awaiting_review", "scheduled", "approved", "failed", "paused"].includes(m.status);
        const act = (action: string, ok: string) => run(`${m.id}:${action}`, () => call(`/api/comms/messages/${m.id}`, "POST", { action }), ok);
        return (
          <li key={m.id}>
            <Card className="p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                  <p className="truncate font-semibold">{m.subject || "(no subject)"}</p>
                  <p className="truncate text-sm text-ink-soft">To {m.to_name || m.to_email}{m.to_name && m.to_email ? ` <${m.to_email}>` : ""}</p>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={m.kind === "nurture" ? "accent" : "neutral"}>{m.kind === "nurture" ? "Follow-up" : m.trigger === "milestone" ? "Section complete" : "Weekly update"}</Badge>
                  <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{MESSAGE_STATUS_LABEL[m.status]}</Badge>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted">
                {m.sent_at ? `Sent ${when(m.sent_at)}` : m.scheduled_for ? `Planned ${when(m.scheduled_for)}` : `Created ${when(m.created_at)}`}
                {m.delivered_at ? ` · Delivered ${when(m.delivered_at)}` : m.sent_at ? " · Delivery not confirmed yet" : ""}
                {m.replied_at ? ` · Replied ${when(m.replied_at)}` : ""}{m.automation ? " · Automated" : ""}
              </p>
              {m.status_reason && <p className="mt-1 text-xs font-medium text-warn">{m.status_reason}</p>}
              {open === m.id && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 font-sans text-sm" data-testid="email-preview">{m.body_text}</pre>}
              {pending && canAct && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setOpen(open === m.id ? null : m.id)}><Mail className="h-4 w-4" aria-hidden /> {open === m.id ? "Hide email" : "Preview email"}</Button>
                  {m.kind === "project_update" && m.schedule_id && <>
                    <Link className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-3 text-sm font-semibold" href={`/projects/${m.schedule_id}`}><CalendarClock className="h-4 w-4" aria-hidden /> Review schedule</Link>
                    <Link className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-3 text-sm font-semibold" href={`/projects/${m.schedule_id}?focus=progress`}>Edit progress</Link>
                    <Link className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-3 text-sm font-semibold" href={`/projects/${m.schedule_id}?focus=dates`}>Adjust dates</Link>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("refresh", "Preview updated from the latest schedule.")}><RefreshCw className="h-4 w-4" aria-hidden /> Refresh</Button>
                  </>}
                  {m.status !== "approved" && m.status !== "scheduled" && <Button size="sm" disabled={busy !== null} onClick={() => act("approve", "Approved. It will send at the planned time.")} data-testid="approve"><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve scheduled send</Button>}
                  <Button loading={busy === `${m.id}:send_now`} size="sm" variant="accent" disabled={busy !== null} onClick={() => act("send_now", "Sent.")} data-testid="send-now">{!(busy === `${m.id}:send_now`) && <Send className="h-4 w-4" aria-hidden />} Send now</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act("skip", "Skipped. Nothing was sent.")} data-testid="skip"><SkipForward className="h-4 w-4" aria-hidden /> Skip</Button>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Replies({ events, messages, busy, run, canRead }: { events: Evt[]; messages: Msg[]; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>; canRead: boolean }) {
  if (!canRead) return <Notice>You don&apos;t have permission to read customer replies.</Notice>;
  if (!events.length) return <Card className="p-6 text-center text-sm text-muted">No replies yet. When reply monitoring is active, replies to your emails show up here and pause follow-ups.</Card>;
  return (
    <ul className="space-y-2" data-testid="reply-list">
      {events.map((e) => {
        const m = messages.find((x) => x.id === e.message_id);
        const subject = encodeURIComponent(`Re: ${m?.subject ?? e.subject ?? ""}`);
        return (
          <li key={e.id}>
            <Card className={cn("p-3 sm:p-4", e.needs_attention && !e.handled_at && "border-warn/50")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{m?.to_name || e.from_email}</p>
                <Badge tone={e.kind === "opt_out_request" ? "danger" : e.kind === "ambiguous_reply" ? "warn" : e.kind === "auto_reply" ? "neutral" : "brand"}>{e.details?.label ?? e.kind}</Badge>
              </div>
              <p className="text-xs text-muted">{when(e.created_at)} · re: {m?.subject ?? e.subject}</p>
              {e.excerpt && <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-sm text-ink-soft">{e.excerpt}</blockquote>}
              {e.kind === "reply" && <p className="mt-2 text-xs text-ink-soft">Automated follow-ups for this person are off until you resume them on the Contacts tab.</p>}
              {e.kind === "opt_out_request" && <p className="mt-2 text-xs text-ink-soft">They asked to stop, so they won&apos;t get any more automated email from you.</p>}
              {e.kind === "ambiguous_reply" && <p className="mt-2 text-xs text-ink-soft">This might be an opt-out, so follow-ups are off for them to be safe.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {e.from_email && e.kind !== "auto_reply" && <a className="inline-flex min-h-9 items-center gap-1 rounded-md bg-navy px-3 text-sm font-semibold text-white" href={`mailto:${e.from_email}?subject=${subject}`}><Mail className="h-4 w-4" aria-hidden /> Reply personally</a>}
                {e.needs_attention && !e.handled_at && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(`evt:${e.id}`, () => call(`/api/comms/events/${e.id}`, "POST"), "Marked handled.")}>Mark handled</Button>}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Contacts({ contacts, filter, busy, run, canManage }: { contacts: Contact[]; filter: string; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>; canManage: boolean }) {
  const list = contacts.filter((c) => filter === "all" || (filter === "paused" ? c.status === "paused" || c.status === "replied" : filter === "unsubscribed" ? ["unsubscribed", "bounced", "suppressed"].includes(c.status) : c.status === filter));
  if (!contacts.length) return <Card className="p-6 text-center text-sm text-muted">Nobody is enrolled in follow-ups yet. Turn on Customer follow-ups in Automation settings to review who&apos;s eligible.</Card>;
  const act = (c: Contact, action: string, ok: string) => run(`${c.id}:${action}`, () => call("/api/comms/contacts", "POST", { id: c.id, action }), ok);
  return (
    <Card>
      <ul className="divide-y divide-line" data-testid="contact-list">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{c.customer_id ? <Link className="underline-offset-2 hover:underline" href={`/dashboard/customers/${c.customer_id}`}>{c.name || c.email}</Link> : (c.name || c.email)}</p>
              <p className="truncate text-xs text-muted">{c.email} · last follow-up {day(c.last_nurture_at)}{c.status_reason ? ` · ${c.status_reason}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={c.status === "eligible" ? "ok" : c.status === "replied" ? "brand" : ["unsubscribed", "bounced", "suppressed"].includes(c.status) ? "danger" : "warn"}>{CONTACT_STATUS_LABEL[c.status]}</Badge>
              {canManage && c.status === "eligible" && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(c, "pause", "Paused.")}>Pause</Button>}
              {canManage && c.status === "eligible" && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(c, "mark_replied", "Marked replied. Follow-ups stopped.")}>Mark replied</Button>}
              {canManage && (c.status === "paused" || c.status === "replied") && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act(c, "resume", "Follow-ups resumed for this person.")}>Resume</Button>}
              {canManage && !["unsubscribed", "bounced", "suppressed"].includes(c.status) && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(c, "suppress", "Suppressed. They won't get follow-ups again.")} aria-label={`Never email ${c.name || c.email} again`}><MailX className="h-4 w-4" aria-hidden /></Button>}
            </div>
          </li>
        ))}
        {!list.length && <li className="p-6 text-center text-sm text-muted">No contacts match this filter.</li>}
      </ul>
    </Card>
  );
}

function Settings({ data, perms, busy, run, reload }: { data: Data; perms: Set<string>; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>; reload: () => void }) {
  const s = data.settings;
  const [audience, setAudience] = useState<Entry[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(s.nurtureSubject ?? DEFAULT_SUBJECT);
  const [body, setBody] = useState(s.nurtureBody ?? DEFAULT_BODY);
  const [preview, setPreview] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [sender, setSender] = useState({ senderName: s.senderName ?? "", postalAddress: s.postalAddress ?? "", replyTo: s.replyTo ?? "" });
  const [autoConfirm, setAutoConfirm] = useState<"nurture" | null>(null);
  const save = (patch: Record<string, unknown>, ok = "Saved.") => run("settings", () => call("/api/comms/settings", "PUT", patch), ok);
  const loadAudience = () => run("aud", async () => {
    const d = await call("/api/comms/audience", "GET") as { entries: Entry[] };
    setAudience(d.entries);
    setPicked(new Set(d.entries.filter((e) => !e.excluded && !e.contactId).map((e) => e.email)));
  });
  const active = s.nurtureEnabled && s.nurtureActivatedAt;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {termsCurrent(s) && <Recommended data={data} perms={perms} busy={busy} run={run} />}
      <Card className="space-y-4 p-4 sm:p-5" data-testid="nurture-settings">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold">Customer follow-ups</h3>
            <p className="text-sm text-ink-soft">A friendly check-in with past customers and people you quoted, at most once every few months.</p>
          </div>
          <Badge tone={active ? "ok" : "neutral"}>{active ? "On" : "Off"}</Badge>
        </div>
        {perms.has("enable_customer_nurture") ? (
          active ? <Button variant="secondary" disabled={busy !== null} onClick={() => save({ nurtureEnabled: false }, "Follow-ups turned off. Nothing queued will send.")} data-testid="nurture-off">Turn off follow-ups</Button>
            : <Button disabled={busy !== null} onClick={loadAudience} data-testid="nurture-review">Review who would get follow-ups</Button>
        ) : <p className="text-xs text-muted">Only someone your company owner allows can turn follow-ups on.</p>}
        {audience && !active && (
          <div className="space-y-2 rounded-lg border border-line p-3" data-testid="audience">
            <p className="text-sm font-semibold">{audience.filter((e) => !e.excluded).length} eligible · {audience.filter((e) => e.excluded).length} not eligible</p>
            <p className="text-xs text-muted">One email per person, even if they have several bids. Uncheck anyone you don&apos;t want to contact. Nobody gets anything until you activate.</p>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {audience.map((e) => {
                const draftOnly = e.excluded?.startsWith("Draft only");
                return (
                  <li key={e.email} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Include ${e.name || e.email}`} disabled={Boolean(e.excluded) && !(draftOnly && confirmed.has(e.email))}
                      checked={picked.has(e.email)} onChange={(ev) => setPicked((p) => { const n = new Set(p); if (ev.target.checked) n.add(e.email); else n.delete(e.email); return n; })} />
                    <span className="min-w-0">
                      <span className={cn("font-medium", e.excluded && !(draftOnly && confirmed.has(e.email)) && "text-muted")}>{e.name || e.email}</span>
                      <span className="block text-xs text-muted">{e.groups.map((g) => AUDIENCE_GROUPS.find((x) => x.value === g)?.label).join(", ") || "—"} · {e.estimate.title || "Untitled bid"}{e.estimateCount > 1 ? ` (+${e.estimateCount - 1} more)` : ""} · first email {e.due ? "soon after activation" : `around ${day(e.nextDueAt)}`}</span>
                      {e.excluded && !(draftOnly && confirmed.has(e.email)) && <span className="block text-xs text-warn">{e.excluded}</span>}
                      {draftOnly && <label className="mt-0.5 flex items-center gap-1 text-xs"><input type="checkbox" checked={confirmed.has(e.email)} onChange={(ev) => setConfirmed((c) => { const n = new Set(c); if (ev.target.checked) n.add(e.email); else n.delete(e.email); return n; })} /> I have a real relationship with this person and may follow up</label>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!s.postalAddress && <Notice tone="warn">Add your business postal address below first. The law requires it in follow-up emails.</Notice>}
            <Button disabled={busy !== null || !picked.size || !s.postalAddress} onClick={() => run("activate", () => call("/api/comms/audience", "POST", { emails: [...picked], confirmRelationship: [...confirmed].filter((e) => picked.has(e)), activate: true }), `Follow-ups are on for ${picked.size} ${picked.size === 1 ? "person" : "people"}. Each one waits for your review before sending.`).then(() => setAudience(null))} data-testid="activate">
              Activate for {picked.size} {picked.size === 1 ? "person" : "people"}
            </Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Frequency" htmlFor="n-freq">
            <select id="n-freq" className="field" value={s.nurtureMonths} disabled={!perms.has("enable_customer_nurture")} onChange={(e) => save({ nurtureMonths: Number(e.target.value) })}>
              <option value={6}>Every 6 months</option><option value={12}>Every 12 months</option><option value={3}>Every 3 months</option>
            </select>
          </Field>
          {data.platform.monitoring.active && perms.has("enable_customer_nurture") ? (
            <Field label="Sending mode" htmlFor="n-mode">
              <select id="n-mode" className="field" value={s.nurtureMode} disabled={busy !== null}
                onChange={(e) => (e.target.value === "automatic" ? setAutoConfirm("nurture") : save({ nurtureMode: "review" }, "Follow-ups will wait for your review."))} data-testid="nurture-mode">
                <option value="review">Review first (recommended)</option>
                <option value="automatic">Automatic</option>
              </select>
            </Field>
          ) : (
            <FixedSetting label="Sending mode" value="Review first" testId="nurture-mode-fixed"
              note={data.platform.monitoring.active
                ? "Only someone your company owner allows can turn on automatic follow-ups."
                : "Every follow-up waits for your approval. Automatic sending becomes available once reply monitoring is set up and tested, so anyone who replies is never emailed again automatically."} />
          )}
        </div>
        {autoConfirm === "nurture" && (
          <ConfirmAuto text="Follow-ups will send automatically to enrolled contacts when they're due. Replies, unsubscribes and bounces stop them automatically, and you can pause at any time."
            onCancel={() => setAutoConfirm(null)} onConfirm={() => { setAutoConfirm(null); save({ nurtureMode: "automatic", confirmAutomatic: true }, "Automatic follow-ups are on."); }} />
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={s.nurtureIncludeOffers} disabled={!perms.has("edit_nurture_templates")} onChange={(e) => save({ nurtureIncludeOffers: e.target.checked })} data-testid="include-offers" /> Include an approved offer when one fits</label>

        <div className="space-y-2 border-t border-line pt-3">
          <h4 className="font-semibold">Email template</h4>
          <Field label="Subject" htmlFor="n-subj"><input id="n-subj" className="field" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={!perms.has("edit_nurture_templates")} /></Field>
          <Field label="Message" htmlFor="n-body" hint={`Placeholders: ${PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}`}>
            <textarea id="n-body" className="field min-h-56 font-sans" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} disabled={!perms.has("edit_nurture_templates")} />
          </Field>
          <details className="text-xs text-muted"><summary className="cursor-pointer">What the placeholders mean</summary><ul className="mt-1 space-y-0.5">{PLACEHOLDERS.map((p) => <li key={p}><code>{`{${p}}`}</code>: {PLACEHOLDER_HELP[p]}</li>)}</ul></details>
          <p className="text-xs text-muted">Your business name, postal address and an unsubscribe link are added at the bottom of every follow-up.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run("preview", async () => { const d = await call("/api/comms/preview", "POST", { subject, body }) as { preview: typeof preview }; setPreview(d.preview); })} data-testid="preview-template">Preview with a real customer</Button>
            {perms.has("edit_nurture_templates") && <Button size="sm" disabled={busy !== null} onClick={() => save({ nurtureSubject: subject, nurtureBody: body }, "Template saved.")}>Save template</Button>}
          </div>
          {preview && <div className="rounded-lg border border-line bg-paper p-3 text-sm" data-testid="template-preview"><p className="text-xs text-muted">To {preview.to}</p><p className="font-semibold">{preview.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans">{preview.body}</pre></div>}
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <h4 className="font-semibold">Sender details</h4>
          <Field label="From name" htmlFor="s-name" optional hint="Defaults to your company name."><input id="s-name" className="field" value={sender.senderName} onChange={(e) => setSender({ ...sender, senderName: e.target.value })} /></Field>
          <Field label="Business postal address" htmlFor="s-addr" required hint="Required in follow-up emails by law. A PO box or registered mailbox works."><input id="s-addr" className="field" value={sender.postalAddress} onChange={(e) => setSender({ ...sender, postalAddress: e.target.value })} /></Field>
          <Field label="Replies go to" htmlFor="s-reply" optional hint={data.platform.monitoring.active ? "Replies are received by Built2Bid and shown here." : "Your email address for replies (defaults to your company profile email)."}><input id="s-reply" type="email" className="field" value={sender.replyTo} onChange={(e) => setSender({ ...sender, replyTo: e.target.value })} /></Field>
          <Button size="sm" disabled={busy !== null} onClick={() => save({ senderName: sender.senderName || null, postalAddress: sender.postalAddress || null, replyTo: sender.replyTo || "" }, "Sender details saved.")} data-testid="save-sender">Save sender details</Button>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="space-y-3 p-4 sm:p-5" data-testid="update-settings">
          <h3 className="font-bold">Project updates</h3>
          <p className="text-sm text-ink-soft">Defaults for new projects. Each project can change these in its Customer updates panel.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Frequency" htmlFor="u-freq">
              <select id="u-freq" className="field" value={s.updatesFrequency} disabled={!perms.has("configure_project_updates")} onChange={(e) => save({ updatesFrequency: e.target.value })}>
                {(Object.keys(FREQUENCY_LABEL) as UpdateFrequency[]).map((k) => <option key={k} value={k}>{FREQUENCY_LABEL[k]}</option>)}
              </select>
            </Field>
            <FixedSetting label="Sending mode" value="Review first" testId="updates-mode-fixed"
              note="New projects always start with review first. Automatic sending is turned on per project, in its Customer updates panel, with a confirmation." />
            <Field label="Weekly send day" htmlFor="u-day">
              <select id="u-day" className="field" value={s.updatesWeekday} disabled={!perms.has("configure_project_updates")} onChange={(e) => save({ updatesWeekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </Field>
            <Field label="Send time" htmlFor="u-hour" hint={s.timezone.replace("_", " ")}>
              <select id="u-hour" className="field" value={s.updatesHour} disabled={!perms.has("configure_project_updates")} onChange={(e) => save({ updatesHour: Number(e.target.value) })}>
                {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-xs text-muted">Your PM gets a reminder the day before each planned update. Work is only described as complete after someone confirms it.</p>
          {data.projects.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {data.projects.map((p) => (
                <li key={p.schedule_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <Link className="min-w-0 truncate font-medium underline-offset-2 hover:underline" href={`/projects/${p.schedule_id}#customer-updates`}>{p.name}</Link>
                  <span className="shrink-0 text-xs text-muted">{p.paused_at ? "Paused" : FREQUENCY_LABEL[p.frequency]} · {p.mode === "automatic" ? "Automatic" : "Review first"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Offers offers={data.offers} canEdit={perms.has("edit_nurture_templates")} busy={busy} run={run} reload={reload} />
      </div>
      <OwnerControls data={data} busy={busy} run={run} />
    </div>
  );
}

/** A setting with one valid value right now: shown as text, not as a control that does nothing. */
function FixedSetting({ label, value, note, testId }: { label: string; value: string; note: string; testId: string }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-ok" aria-hidden /> {value}</p>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

function ConfirmAuto({ text, onConfirm, onCancel }: { text: string; onConfirm: () => void; onCancel: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-warn/40 bg-warn-tint p-3 text-sm" role="group" aria-label="Confirm automatic sending" data-testid="confirm-auto">
      <p>{text}</p>
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" className="h-4 w-4" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I understand and want automatic sending</label>
      <div className="flex gap-2"><Button size="sm" disabled={!ok} onClick={onConfirm}>Turn on automatic</Button><Button size="sm" variant="ghost" onClick={onCancel}>Keep review first</Button></div>
    </div>
  );
}

const EMPTY_OFFER = { name: "", offerType: "percent" as OfferType, startsOn: new Date().toISOString().slice(0, 10), endsOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), conditions: "", discountValue: null as number | null, message: "", materialCurrent: "", materialAlternative: "", priceBasis: "contractor_estimate" as "verified" | "contractor_estimate", estimatedSavings: "", trades: [] as string[], audience: [] as AudienceGroup[], active: false };

function Offers({ offers, canEdit, busy, run }: { offers: Offer[]; canEdit: boolean; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>; reload: () => void }) {
  const [form, setForm] = useState<(typeof EMPTY_OFFER & { id?: string; approveComparison?: boolean }) | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const submit = () => form && run("offer", () => call("/api/comms/offers", "POST", {
    ...form, discountValue: form.discountValue ? Number(form.discountValue) : null, materialCurrent: form.materialCurrent || null, materialAlternative: form.materialAlternative || null,
    estimatedSavings: form.estimatedSavings || null, priceBasis: form.offerType === "material" ? form.priceBasis : null, approveComparison: Boolean(form.approveComparison),
  }), "Offer saved.").then(() => setForm(null));
  return (
    <Card className="space-y-3 p-4 sm:p-5" data-testid="offers">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">Offers</h3>
        {canEdit && !form && <Button size="sm" variant="secondary" onClick={() => setForm({ ...EMPTY_OFFER })} data-testid="new-offer">New offer</Button>}
      </div>
      <p className="text-sm text-ink-soft">Optional. An offer only appears in a follow-up when it&apos;s active, in date, and fits that customer. Nothing is ever discounted automatically, and signed contracts never change.</p>
      {!offers.length && !form && <p className="text-sm text-muted">No offers yet.</p>}
      <ul className="space-y-2">
        {offers.map((o) => {
          const expired = o.endsOn < today;
          return (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-semibold">{o.name}</span><span className="block text-xs text-muted">{OFFER_TYPE_LABEL[o.offerType]} · {o.startsOn} to {o.endsOn}{o.offerType === "material" && !o.comparisonApprovedAt ? " · comparison not approved" : ""}</span></span>
              <span className="flex items-center gap-1.5">
                <Badge tone={expired ? "neutral" : o.active ? "ok" : "warn"}>{expired ? "Expired" : o.active ? "Active" : "Inactive"}</Badge>
                {canEdit && <Button size="sm" variant="ghost" onClick={() => setForm({ ...EMPTY_OFFER, ...o, discountValue: o.discountValue, materialCurrent: o.materialCurrent ?? "", materialAlternative: o.materialAlternative ?? "", priceBasis: o.priceBasis ?? "contractor_estimate", estimatedSavings: o.estimatedSavings ?? "" })}>Edit</Button>}
              </span>
            </li>
          );
        })}
      </ul>
      {form && (
        <div className="space-y-3 rounded-lg border border-line p-3" data-testid="offer-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Offer name" htmlFor="o-name" required><input id="o-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type" htmlFor="o-type">
              <select id="o-type" className="field" value={form.offerType} onChange={(e) => setForm({ ...form, offerType: e.target.value as OfferType })}>
                {(Object.keys(OFFER_TYPE_LABEL) as OfferType[]).map((k) => <option key={k} value={k}>{OFFER_TYPE_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Starts" htmlFor="o-start"><input id="o-start" type="date" className="field" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></Field>
            <Field label="Ends" htmlFor="o-end"><input id="o-end" type="date" className="field" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></Field>
            {(form.offerType === "percent" || form.offerType === "fixed") && <Field label={form.offerType === "percent" ? "Discount (%)" : "Discount ($)"} htmlFor="o-val"><input id="o-val" type="number" min={1} className="field" value={form.discountValue ?? ""} onChange={(e) => setForm({ ...form, discountValue: e.target.value ? Number(e.target.value) : null })} /></Field>}
            <Field label="Who it's for" htmlFor="o-aud" hint="None selected = everyone eligible.">
              <div id="o-aud" className="flex flex-wrap gap-2 text-xs">{AUDIENCE_GROUPS.map((g) => <label key={g.value} className="flex items-center gap-1"><input type="checkbox" checked={form.audience.includes(g.value)} onChange={(e) => setForm({ ...form, audience: e.target.checked ? [...form.audience, g.value] : form.audience.filter((x) => x !== g.value) })} /> {g.label}</label>)}</div>
            </Field>
          </div>
          {form.offerType === "material" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current material" htmlFor="o-cur" required><input id="o-cur" className="field" value={form.materialCurrent} onChange={(e) => setForm({ ...form, materialCurrent: e.target.value })} placeholder="e.g. Composite decking" /></Field>
              <Field label="Lower-cost alternative" htmlFor="o-alt" required><input id="o-alt" className="field" value={form.materialAlternative} onChange={(e) => setForm({ ...form, materialAlternative: e.target.value })} placeholder="e.g. Pressure-treated pine" /></Field>
              <Field label="Price comparison from" htmlFor="o-basis">
                <select id="o-basis" className="field" value={form.priceBasis} onChange={(e) => setForm({ ...form, priceBasis: e.target.value as "verified" | "contractor_estimate" })}>
                  <option value="contractor_estimate">My own estimate</option><option value="verified">Verified supplier pricing</option>
                </select>
              </Field>
              <Field label="Estimated difference" htmlFor="o-sav" optional><input id="o-sav" className="field" value={form.estimatedSavings} onChange={(e) => setForm({ ...form, estimatedSavings: e.target.value })} placeholder="e.g. about 20% on materials" /></Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(form.approveComparison)} onChange={(e) => setForm({ ...form, approveComparison: e.target.checked })} /> I reviewed this comparison. It doesn&apos;t promise savings or equal performance, and customers will be told the differences before deciding.</label>
            </div>
          )}
          <Field label={form.offerType === "percent" || form.offerType === "fixed" ? "Extra line (optional)" : "Offer message"} htmlFor="o-msg"><textarea id="o-msg" className="field min-h-20" value={form.message} maxLength={600} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <Field label="Conditions" htmlFor="o-cond" optional><input id="o-cond" className="field" value={form.conditions} maxLength={600} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="e.g. New contracts signed before the end date. Not combinable." /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
          <div className="flex gap-2"><Button size="sm" disabled={busy !== null} onClick={submit} data-testid="save-offer">Save offer</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
        </div>
      )}
    </Card>
  );
}
