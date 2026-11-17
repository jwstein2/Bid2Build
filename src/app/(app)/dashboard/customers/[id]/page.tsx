import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Badge, Card } from "@/components/ui/misc";
import { ContactControls } from "@/components/comms/contact-controls";
import { loadCommAccess } from "@/lib/comms/server";
import { CONTACT_STATUS_LABEL, MESSAGE_STATUS_LABEL, type ContactStatus, type MessageStatus } from "@/lib/comms/types";

export const metadata: Metadata = { title: "Customer", robots: { index: false } };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/** Customer detail: contact info, their bids, and (Project Command Center) a communications summary. */
export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser();
  if (!user) redirect(`/login?next=/dashboard/customers/${id}`);
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("id, name, email, phone, project_address, notes").eq("id", id).maybeSingle();
  if (!c) notFound();
  const email = c.email?.toLowerCase() ?? null;
  const [{ data: bids }, access] = await Promise.all([
    supabase.from("estimates").select("id, title, pipeline_stage, estimate_date").or(email ? `customer_id.eq.${id},customer_email.ilike.${email.replace(/[,()]/g, "")}` : `customer_id.eq.${id}`).order("updated_at", { ascending: false }).limit(20),
    loadCommAccess(supabase),
  ]);
  const pm = Boolean(access?.pm && access.perms.includes("view_communications") && access.accountId);
  type ContactRow = { id: string; status: ContactStatus; status_reason: string | null; last_nurture_at: string | null; last_reply_at: string | null };
  let contact = null as ContactRow | null;
  let messages: { id: string; kind: string; subject: string; status: MessageStatus; scheduled_for: string | null; sent_at: string | null }[] = [];
  let suppressed = false;
  if (pm && email) {
    const [{ data: ct }, { data: ms }, { data: sp }] = await Promise.all([
      supabase.from("comm_contacts").select("id, status, status_reason, last_nurture_at, last_reply_at").eq("account_id", access!.accountId!).eq("email", email).maybeSingle(),
      supabase.from("comm_messages").select("id, kind, subject, status, scheduled_for, sent_at").eq("account_id", access!.accountId!).eq("to_email", email).order("created_at", { ascending: false }).limit(10),
      supabase.from("comm_suppressions").select("id").eq("account_id", access!.accountId!).eq("email", email).limit(1),
    ]);
    contact = ct as ContactRow | null; messages = (ms ?? []) as typeof messages; suppressed = Boolean(sp?.length);
  }
  const next = messages.find((m) => ["awaiting_review", "scheduled", "approved"].includes(m.status));
  const last = messages.find((m) => m.sent_at);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Breadcrumbs items={[{ label: "Customers", href: "/dashboard/customers" }, { label: c.name }]} />
      <div>
        <h1 className="text-3xl font-extrabold">{c.name}</h1>
        <p className="text-ink-soft">{[c.email, c.phone, c.project_address].filter(Boolean).join(" · ")}</p>
      </div>
      <Card className="p-4">
        <h2 className="font-bold">Bids</h2>
        {!bids?.length ? <p className="mt-2 text-sm text-muted">No bids for this customer yet.</p> : (
          <ul className="mt-2 divide-y divide-line text-sm">{bids.map((b) => <li key={b.id} className="flex justify-between gap-2 py-2"><Link className="font-medium hover:underline" href={`/estimates/${b.id}`}>{b.title || "Untitled bid"}</Link><span className="text-muted">{b.pipeline_stage} · {day(b.estimate_date)}</span></li>)}</ul>
        )}
      </Card>
      <Card className="space-y-3 p-4" data-testid="customer-comms-summary">
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Communications</h2>{pm && <Link className="text-sm font-semibold text-accent-ink hover:underline" href="/dashboard/customers/communications">All communications</Link>}</div>
        {!pm ? <p className="text-sm text-ink-soft">Follow-ups and project update emails are part of Project Command Center.</p> : !email ? <p className="text-sm text-muted">Add an email address to this customer to include them in communications.</p> : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Follow-ups</dt><dd>{suppressed ? <Badge tone="danger">Opted out / suppressed</Badge> : contact ? <Badge tone={contact.status === "eligible" ? "ok" : "warn"}>{CONTACT_STATUS_LABEL[contact.status]}</Badge> : "Not enrolled"}{contact?.status_reason ? <span className="ml-2 text-xs text-muted">{contact.status_reason}</span> : null}</dd></div>
              <div><dt className="text-muted">Last email</dt><dd>{last ? `${day(last.sent_at)} · ${last.subject}` : "—"}</dd></div>
              <div><dt className="text-muted">Next email</dt><dd>{next ? `${MESSAGE_STATUS_LABEL[next.status]} · ${day(next.scheduled_for)}` : "—"}</dd></div>
              <div><dt className="text-muted">Last reply</dt><dd>{day(contact?.last_reply_at ?? null)}</dd></div>
            </dl>
            {contact && !suppressed && access!.perms.includes("manage_opt_outs") && <ContactControls id={contact.id} status={contact.status} />}
            {messages.length > 0 && <ul className="divide-y divide-line text-sm">{messages.map((m) => <li key={m.id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{m.kind === "nurture" ? "Follow-up" : "Project update"}: {m.subject}</span><span className="shrink-0 text-muted">{MESSAGE_STATUS_LABEL[m.status]}</span></li>)}</ul>}
          </>
        )}
      </Card>
    </div>
  );
}
