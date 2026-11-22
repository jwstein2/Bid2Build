import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, FileUp, UserPlus } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { Badge, Card } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CustomerTabs } from "@/components/comms/customer-tabs";
import { DirectoryControls } from "@/components/customers/directory-controls";
import { loadCustomerHub } from "@/lib/customers/server";
import {
  FOCUS, RELATIONSHIP_LABELS, RELATIONSHIP_TONES, SORTS, hubMetrics, isFocus, isSort, matchesFocus, matchesSearch, possibleDuplicates, sortSummaries,
} from "@/lib/customers/hub";
import { CONTACT_STATUS_LABEL, type ContactStatus } from "@/lib/comms/types";

export const metadata: Metadata = { title: "Customers", robots: { index: false } };

const when = (iso: string) => {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Customer Hub: every customer from the account's bids, projects and saved contacts, in one place. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getUser();
  // The layout redirects too, but pages render in parallel with it: never assume a session here.
  if (!user) redirect("/login?next=/dashboard/customers");
  const sp = await searchParams;
  const focus = isFocus(sp.focus) ? sp.focus : "all";
  const sort = isSort(sp.sort) ? sp.sort : "activity";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const supabase = await createClient();
  const { summaries, customers, pm, unlinkedBids } = await loadCustomerHub(supabase, user.id);
  const dupes = possibleDuplicates(customers);
  const dupeIds = new Set(dupes.keys());
  const m = hubMetrics(summaries);
  const shown = sortSummaries(summaries.filter((s) => matchesFocus(s, focus, dupeIds) && matchesSearch(s, q)), sort);
  const filtered = focus !== "all" || Boolean(q);
  const href = (f: string) => `/dashboard/customers${f === "all" ? "" : `?focus=${f}`}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-guide-page="customers.directory">
      <Breadcrumbs items={[{ label: "Customers" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-3">
          <h1 className="text-3xl font-extrabold">Customers</h1>
          <CustomerTabs active="directory" pm={pm} />
          <p className="text-ink-soft">Manage your customers, estimates, projects, and communication history in one place.</p>
        </div>
        {summaries.length > 0 && (
          <div className="flex flex-wrap gap-2" data-guide="customers.new">
            <ButtonLink href="/dashboard/customers/new" variant="secondary"><UserPlus className="h-4 w-4" aria-hidden /> New customer</ButtonLink>
            <ButtonLink href="/dashboard/customers/import" variant="secondary" data-testid="customers-import-link"><FileUp className="h-4 w-4" aria-hidden /> Import from QuickBooks / CSV</ButtonLink>
            <ButtonLink href="/bids" variant="accent">Create New Bid</ButtonLink>
          </div>
        )}
      </div>

      {unlinkedBids > 0 && (
        <Card className="border-warn/40 bg-warn-tint p-4 text-sm" data-testid="customers-unlinked" role="status">
          <p className="font-semibold">{unlinkedBids} bid{unlinkedBids === 1 ? " has a customer" : "s have customers"} that {unlinkedBids === 1 ? "isn't" : "aren't"} in this directory yet.</p>
          <p className="mt-1 text-ink-soft">They&apos;ll appear here automatically once the customer update finishes. Your bids are unchanged; you can open them from <Link href="/dashboard" className="font-semibold underline">Bids</Link>.</p>
        </Card>
      )}

      {summaries.length === 0 ? (
        unlinkedBids > 0 ? null : (
          <Card className="p-10 text-center" data-testid="customers-empty">
            <h2 className="text-xl font-bold">No customers yet</h2>
            <p className="mx-auto mt-2 max-w-md text-ink-soft">Customers appear here automatically when you name them on a bid. You can also add one now and pick them on your next bid.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/dashboard/customers/new" variant="secondary"><UserPlus className="h-4 w-4" aria-hidden /> Create Your First Customer</ButtonLink>
              <ButtonLink href="/dashboard/customers/import" variant="secondary" data-testid="customers-import-empty"><FileUp className="h-4 w-4" aria-hidden /> Import from QuickBooks / CSV</ButtonLink>
              <ButtonLink href="/bids" variant="accent">Create a New Bid</ButtonLink>
            </div>
          </Card>
        )
      ) : (
        <>
          <section aria-label="Customer metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="customer-metrics" data-guide="customers.metrics">
            <MetricCard title="Total customers" value={m.total} href={href("all")} action="View all customers" testId="metric-total" />
            <MetricCard title="Customers with open bids" value={m.open} empty={!m.open} href={href("open")} action="View customers with open bids" testId="metric-open" hint="At least one bid in Draft, Ready to Send, Sent or Awaiting Signature." />
            <MetricCard title="Customers with active projects" value={m.projects} empty={!m.projects} href={href("projects")} action="View active projects" testId="metric-projects" hint="An active project schedule, or a job marked Scheduled or In Progress." />
            <MetricCard title="Customers needing attention" value={m.attention} empty={!m.attention} tone={m.attention ? "warn" : "default"} href={href("attention")} action="View what needs attention" testId="metric-attention" hint="A won job not scheduled yet, a proposal ready to send, an expired signing link, or a customer reply / email waiting for review." />
          </section>

          {dupeIds.size > 0 && focus !== "duplicates" && (
            <p className="text-sm text-ink-soft" data-testid="customers-dupes-note">
              {dupeIds.size} customer records share a name, email or phone with another record. <Link className="font-semibold text-accent-ink underline" href={href("duplicates")}>Review possible duplicates</Link> — nothing is merged unless you choose to.
            </p>
          )}

          <DirectoryControls q={q} focus={focus} sort={sort} focusOptions={Object.entries(FOCUS).map(([k, v]) => ({ value: k, label: v.label }))} sortOptions={Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v }))} />

          <Card>
            <p className="border-b border-line px-4 py-2 text-sm text-muted" aria-live="polite" data-testid="customers-count">
              {filtered ? `${shown.length} of ${summaries.length} customers · ${FOCUS[focus].label}${q ? ` matching “${q}”` : ""}` : `${summaries.length} customer${summaries.length === 1 ? "" : "s"}`}
            </p>
            {shown.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted" data-testid="customers-filter-empty">
                <p>{q ? `No customers match “${q}”.` : FOCUS[focus].empty}</p>
                <Link href="/dashboard/customers" className="mt-2 inline-block font-semibold text-accent-ink underline">Show all customers</Link>
              </div>
            ) : (
              <ul className="divide-y divide-line" data-testid="customer-list">
                {shown.map((s) => {
                  const c = s.customer;
                  const contact = [c.email, c.phone].filter(Boolean).join(" · ");
                  return (
                    <li key={c.id}>
                      <Link href={`/dashboard/customers/${c.id}`} className="group grid gap-x-4 gap-y-1 px-4 py-3 hover:bg-black/[0.03] focus-visible:bg-black/[0.03] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center" data-testid="customer-row" data-guide="customers.row" data-customer-id={c.id}>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold group-hover:underline" data-testid="customer-row-name">{c.name}</span>
                            {c.customerType === "business" && c.companyName && <span className="text-sm text-muted">{c.companyName}</span>}
                            {dupeIds.has(c.id) && <Badge tone="warn">Possible duplicate</Badge>}
                          </span>
                          <span className="block truncate text-sm text-muted">{contact || c.address || "No contact details yet"}</span>
                        </span>
                        <span className="min-w-0 text-sm">
                          <Badge tone={RELATIONSHIP_TONES[s.relationship]}>{RELATIONSHIP_LABELS[s.relationship]}</Badge>
                          {pm && s.comm?.status && <span className="ml-2 text-xs text-muted">Follow-ups: {CONTACT_STATUS_LABEL[s.comm.status as ContactStatus] ?? s.comm.status}</span>}
                          <span className="mt-1 block truncate text-muted">{s.latest ? `${s.latest.label} · ${s.latest.detail}` : "No bids yet"}{s.bids.length > 1 ? ` · ${s.bids.length} bids` : ""}</span>
                        </span>
                        <span className="min-w-0 text-sm">
                          <span className="block text-muted">Last activity {when(s.lastActivity)}</span>
                          {s.next && <span className={s.attention.length ? "block truncate font-semibold text-warn" : "block truncate text-ink-soft"}>Next: {s.next.label}</span>}
                        </span>
                        <ChevronRight className="hidden h-5 w-5 text-muted md:block" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
