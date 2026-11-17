import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ContactControls } from "@/components/comms/contact-controls";
import { CustomerPhotos } from "@/components/operations/customer-photos";
import { CustomerEditor } from "@/components/customers/customer-editor";
import { MergeDuplicates } from "@/components/customers/merge-duplicates";
import { NewBidForCustomer } from "@/components/customers/new-bid-for-customer";
import { loadCustomerHub, mapCustomer } from "@/lib/customers/server";
import { PROJECT_STATUS_LABELS, RELATIONSHIP_LABELS, RELATIONSHIP_TONES, possibleDuplicates } from "@/lib/customers/hub";
import { COLUMN_LABELS, columnOf, nextAction } from "@/lib/pipeline/board";
import { STAGE_LABELS } from "@/lib/enterprise/pipeline";
import { isPmEnabled } from "@/lib/env";
import { isEsignEnabled } from "@/lib/esign/config";
import { CONTACT_STATUS_LABEL, MESSAGE_STATUS_LABEL, type ContactStatus, type MessageStatus } from "@/lib/comms/types";

export const metadata: Metadata = { title: "Customer", robots: { index: false } };
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const TABS = [["overview", "Overview"], ["bids", "Bids"], ["projects", "Projects"], ["activity", "Activity"]] as const;
type Tab = (typeof TABS)[number][0];

/** Customer profile: contact, relationship, linked bids and projects, activity and communications. */
export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  if (!user) redirect(`/login?next=/dashboard/customers/${id}`);
  const tab: Tab = (TABS.map((t) => t[0]) as string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  const supabase = await createClient();
  const hub = await loadCustomerHub(supabase, user.id, { customerId: id });
  const s = hub.summaries[0];
  if (!s) notFound();
  const c = s.customer;
  const email = c.email?.trim().toLowerCase() ?? null;
  const esign = isEsignEnabled();

  // Edit rights come from the database (owner, or a company member allowed to edit team bids).
  const { data: canEditRpc, error: canEditErr } = await supabase.rpc("can_edit_customer", { p_customer: id });
  const canEdit = canEditErr ? c.userId === user.id && !c.companyId : Boolean(canEditRpc);

  // Possible duplicates in the same scope (reviewed by a person, never merged automatically).
  let dupes: { id: string; name: string; detail: string; bids: number }[] = [];
  if (canEdit) {
    let q = supabase.from("customers").select("*").neq("id", id).limit(200);
    q = c.companyId ? q.eq("company_id", c.companyId) : q.eq("user_id", c.userId).is("company_id", null);
    const { data } = await q;
    const scope = ((data ?? []) as Record<string, unknown>[]).map(mapCustomer);
    const ids = possibleDuplicates([c, ...scope]).get(c.id) ?? [];
    if (ids.length) {
      const { data: counts } = await supabase.from("estimates").select("customer_id").in("customer_id", ids);
      dupes = scope.filter((x) => ids.includes(x.id)).map((x) => ({
        id: x.id, name: x.name, detail: [x.email, x.phone, x.address].filter(Boolean).join(" · ") || "No contact details",
        bids: (counts ?? []).filter((r) => r.customer_id === x.id).length,
      }));
    }
  }

  // Communications (Project Command Center + permission; read under RLS).
  const access = hub.access;
  const pm = hub.pm;
  type ContactRow = { id: string; status: ContactStatus; status_reason: string | null; last_nurture_at: string | null; last_reply_at: string | null };
  let contact = null as ContactRow | null;
  let messages: { id: string; kind: string; subject: string; status: MessageStatus; scheduled_for: string | null; sent_at: string | null; replied_at: string | null; created_at: string }[] = [];
  let suppressed = false;
  if (pm && access?.accountId) {
    const or = email ? `customer_id.eq.${id},to_email.eq.${email.replace(/[,()]/g, "")}` : `customer_id.eq.${id}`;
    const [{ data: ct }, { data: ms }, { data: spr }] = await Promise.all([
      email ? supabase.from("comm_contacts").select("id, status, status_reason, last_nurture_at, last_reply_at").eq("account_id", access.accountId).eq("email", email).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("comm_messages").select("id, kind, subject, status, scheduled_for, sent_at, replied_at, created_at").eq("account_id", access.accountId).or(or).order("created_at", { ascending: false }).limit(20),
      email ? supabase.from("comm_suppressions").select("id").eq("account_id", access.accountId).eq("email", email).limit(1) : Promise.resolve({ data: [] }),
    ]);
    contact = ct as ContactRow | null; messages = (ms ?? []) as typeof messages; suppressed = Boolean(spr?.length);
  }
  const nextMsg = messages.find((m) => ["awaiting_review", "scheduled", "approved"].includes(m.status));
  const lastMsg = messages.find((m) => m.sent_at);

  // Activity: recorded events only.
  type Ev = { at: string; text: string; href?: string };
  const events: Ev[] = [{ at: c.createdAt, text: c.source === "manual" ? "Customer added" : "Customer added from a bid" }];
  const estIds = s.bids.map((b) => b.id);
  if (tab === "activity" && estIds.length) {
    const { data: hist } = await supabase.from("estimate_stage_history").select("estimate_id, from_stage, to_stage, note, created_at").in("estimate_id", estIds).order("created_at", { ascending: false }).limit(100);
    const title = new Map(s.bids.map((b) => [b.id, b]));
    for (const h of (hist ?? []) as { estimate_id: string; from_stage: string; to_stage: string; note: string | null; created_at: string }[]) {
      const b = title.get(h.estimate_id);
      events.push({ at: h.created_at, text: `${b?.title ?? "Bid"} moved to ${STAGE_LABELS[h.to_stage as keyof typeof STAGE_LABELS] ?? h.to_stage}${h.note ? ` — ${h.note}` : ""}`, href: b?.href });
    }
  }
  for (const b of s.bids) {
    events.push({ at: b.createdAt, text: `Bid created: ${b.title}`, href: b.href });
    if (b.signing?.signed) events.push({ at: b.signing.signed.at, text: `Proposal signed: ${b.title} (v${b.signing.signed.versionNumber}, ${money(b.signing.signed.total)})`, href: `/signed/${b.signing.signed.id}` });
  }
  for (const p of s.projects) events.push({ at: p.updatedAt, text: `Project ${p.name}: ${PROJECT_STATUS_LABELS[p.status]}`, href: `/projects/${p.id}` });
  for (const m of messages) {
    if (m.sent_at) events.push({ at: m.sent_at, text: `${m.kind === "nurture" ? "Follow-up" : "Project update"} sent: ${m.subject}` });
    if (m.replied_at) events.push({ at: m.replied_at, text: `Customer replied: ${m.subject}` });
  }
  if (contact?.last_reply_at && !messages.some((m) => m.replied_at)) events.push({ at: contact.last_reply_at, text: "Customer replied to an email" });
  events.sort((a, b) => b.at.localeCompare(a.at));

  const tabHref = (t: Tab) => `/dashboard/customers/${id}${t === "overview" ? "" : `?tab=${t}`}`;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers", href: "/dashboard/customers" }, { label: c.name }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-extrabold" data-testid="customer-name">{c.name}</h1>
            <Badge tone={RELATIONSHIP_TONES[s.relationship]}>{RELATIONSHIP_LABELS[s.relationship]}</Badge>
            {c.customerType === "business" && <Badge tone="brand">Business</Badge>}
          </div>
          {c.companyName && <p className="font-semibold text-ink-soft">{c.companyName}</p>}
          <p className="text-ink-soft">{[c.email, c.phone, c.address].filter(Boolean).join(" · ") || "No contact details yet"}</p>
        </div>
        <NewBidForCustomer customer={{ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.address }} />
      </div>

      <nav aria-label="Customer sections" className="flex gap-1 overflow-x-auto border-b border-line" data-testid="customer-detail-tabs">
        {TABS.map(([t, label]) => {
          const count = t === "bids" ? s.bids.length : t === "projects" ? s.projects.length : null;
          return (
            <Link key={t} href={tabHref(t)} scroll={false} aria-current={tab === t ? "page" : undefined}
              className={cn("-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-semibold", tab === t ? "border-cyan text-ink" : "border-transparent text-ink-soft hover:text-ink")}>
              {label}{count != null && <span className="rounded-full bg-black/5 px-1.5 text-xs">{count}</span>}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="space-y-3 p-4">
            <h2 className="font-bold">Contact</h2>
            <CustomerEditor canEdit={canEdit} canDelete={canEdit && s.bids.length === 0} customer={{ id: c.id, name: c.name, email: c.email ?? "", phone: c.phone ?? "", projectAddress: c.address ?? "", notes: c.notes ?? "", customerType: c.customerType, companyName: c.companyName ?? "" }} />
            {!canEdit && <p className="text-xs text-muted">You can view this customer. Ask your company owner if you need to edit it.</p>}
          </Card>
          <div className="space-y-4">
            <Card className="space-y-2 p-4" data-testid="customer-next">
              <h2 className="font-bold">Next action</h2>
              {s.next ? <Link className="font-semibold text-accent-ink hover:underline" href={s.next.href}>{s.next.label}</Link> : <p className="text-sm text-muted">Nothing to do right now.</p>}
              {s.attention.length > 0 && (
                <ul className="space-y-1 text-sm" aria-label="Needs attention">
                  {s.attention.map((a) => <li key={a.key}><Link href={a.href} className="text-warn hover:underline">{a.label}</Link></li>)}
                </ul>
              )}
              <dl className="grid grid-cols-3 gap-2 pt-2 text-center text-sm">
                <div><dt className="text-muted">Bids</dt><dd className="text-lg font-bold">{s.bids.length}</dd></div>
                <div><dt className="text-muted">Open</dt><dd className="text-lg font-bold">{s.openBids}</dd></div>
                <div><dt className="text-muted">Active projects</dt><dd className="text-lg font-bold">{s.activeProjects}</dd></div>
              </dl>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Recent activity</h2><Link className="text-sm font-semibold text-accent-ink hover:underline" href={tabHref("activity")}>All activity</Link></div>
              <ul className="mt-2 space-y-1.5 text-sm">{events.slice(0, 5).map((e, i) => <li key={i} className="flex justify-between gap-3"><span className="min-w-0 truncate">{e.href ? <Link className="hover:underline" href={e.href}>{e.text}</Link> : e.text}</span><span className="shrink-0 text-muted">{day(e.at)}</span></li>)}</ul>
            </Card>
          </div>
          {dupes.length > 0 && <div className="lg:col-span-2"><MergeDuplicates keepId={c.id} keepName={c.name} candidates={dupes} /></div>}
          <Card className="space-y-3 p-4 lg:col-span-2" data-testid="customer-comms-summary">
            <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Communications</h2>{pm && <Link className="text-sm font-semibold text-accent-ink hover:underline" href="/dashboard/customers/communications">All communications</Link>}</div>
            {!pm ? <p className="text-sm text-ink-soft">Follow-ups and project update emails are part of Project Command Center.</p> : !email ? <p className="text-sm text-muted">Add an email address to this customer to include them in communications.</p> : (
              <>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted">Follow-ups</dt><dd>{suppressed ? <Badge tone="danger">Opted out / suppressed</Badge> : contact ? <Badge tone={contact.status === "eligible" ? "ok" : "warn"}>{CONTACT_STATUS_LABEL[contact.status]}</Badge> : "Not enrolled"}{contact?.status_reason ? <span className="ml-2 text-xs text-muted">{contact.status_reason}</span> : null}</dd></div>
                  <div><dt className="text-muted">Last email</dt><dd>{lastMsg ? `${day(lastMsg.sent_at)} · ${lastMsg.subject}` : "—"}</dd></div>
                  <div><dt className="text-muted">Next email</dt><dd>{nextMsg ? `${MESSAGE_STATUS_LABEL[nextMsg.status]} · ${day(nextMsg.scheduled_for)}` : "—"}</dd></div>
                  <div><dt className="text-muted">Last reply</dt><dd>{day(contact?.last_reply_at ?? null)}</dd></div>
                </dl>
                {contact && !suppressed && access!.perms.includes("manage_opt_outs") && <ContactControls id={contact.id} status={contact.status} />}
              </>
            )}
          </Card>
          <Card className="p-4 lg:col-span-2"><h2 className="font-bold">Photos</h2><CustomerPhotos customerId={c.id} name={c.name} /></Card>
        </div>
      )}

      {tab === "bids" && (
        <Card data-testid="customer-bids">
          {!s.bids.length ? (
            <div className="p-8 text-center text-sm text-muted"><p>No bids for this customer yet.</p></div>
          ) : (
            <ul className="divide-y divide-line">
              {s.bids.map((b) => {
                const col = columnOf(b);
                const act = b.own ? nextAction(b, esign, isPmEnabled()) : null;
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="customer-bid">
                    <div className="min-w-0">
                      <Link className="font-semibold hover:underline" href={b.href} data-testid="customer-bid-link">{b.title}</Link>
                      <p className="text-sm text-muted">{[b.number && `#${b.number}`, `Updated ${day(b.updatedAt)}`, b.latestVersion && `v${b.latestVersion.number} · ${money(b.latestVersion.total)}`, !b.own && "Teammate's bid"].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={col === "lost" ? "danger" : ["won", "scheduled", "in_progress", "completed"].includes(col) ? "ok" : "neutral"}>{COLUMN_LABELS[col]}</Badge>
                      {b.signing?.signed && <Link className="font-semibold text-accent-ink hover:underline" href={`/signed/${b.signing.signed.id}`}>Signed proposal</Link>}
                      {act?.href && <Link className="font-semibold text-accent-ink hover:underline" href={act.href}>{act.label}</Link>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "projects" && (
        <Card data-testid="customer-projects">
          {!s.projects.length ? (
            <div className="p-8 text-center text-sm text-muted">
              <p>No projects for this customer yet.</p>
              <p className="mt-1">A project is created when you schedule a won bid.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {s.projects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="customer-project">
                  <div className="min-w-0"><Link className="font-semibold hover:underline" href={`/projects/${p.id}`} data-testid="customer-project-link">{p.name}</Link><p className="text-sm text-muted">Starts {day(p.startDate)} · Updated {day(p.updatedAt)}</p></div>
                  <Badge tone={p.status === "active" ? "ok" : "neutral"}>{PROJECT_STATUS_LABELS[p.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "activity" && (
        <Card data-testid="customer-activity">
          <ol className="divide-y divide-line">
            {events.map((e, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">{e.href ? <Link className="hover:underline" href={e.href}>{e.text}</Link> : e.text}</span>
                <time className="shrink-0 text-muted" dateTime={e.at}>{day(e.at)}</time>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
