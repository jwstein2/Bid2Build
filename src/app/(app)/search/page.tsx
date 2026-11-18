import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { trades } from "@/lib/trades/catalog";
import { GROUPS, type GroupId } from "@/lib/search/kinds";
import { loadCaps, paramsFromUrl, runSearch, searchableKinds, PAGE_SIZE } from "@/lib/search/server";
import { SearchFilters, SearchSettings } from "@/components/search/search-page-parts";
import { ResultBody } from "@/components/search/search-parts";
import { queryWords } from "@/lib/search/query";
import { Search } from "lucide-react";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Status choices offered for one category (only categories the account can search). */
const STATUS_CHOICES: Partial<Record<GroupId, { value: string; label: string }[]>> = {
  invoices: [{ value: "open,overdue", label: "Unpaid" }, { value: "overdue", label: "Overdue" }, { value: "open", label: "Open (not due)" }, { value: "paid", label: "Paid" }, { value: "draft", label: "Draft" }, { value: "void", label: "Void" }],
  bids: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "pending", label: "Pending" }, { value: "won", label: "Won" }, { value: "scheduled", label: "Scheduled" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "lost", label: "Lost" }],
  projects: [{ value: "won", label: "Approved — Needs Review" }, { value: "scheduled,schedule_active", label: "Scheduled" }, { value: "in_progress", label: "In Progress" }, { value: "completed", label: "Completed" }],
  tasks: [{ value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "delayed", label: "Delayed" }, { value: "on_hold", label: "On hold" }, { value: "complete", label: "Complete" }],
  proposals: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "approved", label: "Approved" }, { value: "signed", label: "Signed" }, { value: "declined", label: "Declined" }],
  accounting: [{ value: "pending_approval,pending", label: "Needs approval" }, { value: "approved", label: "Approved" }, { value: "void", label: "Void" }],
};

/** Full search results: category / status / trade / customer / project / person / date filters, sort, pages. Deep-linkable. */
export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const params = paramsFromUrl(sp, "page");
  const db = await createClient();
  const caps = await loadCaps(db).catch(() => null);
  const kinds = caps ? searchableKinds(caps) : [];
  const groups = GROUPS.filter((g) => g.kinds.some((k) => kinds.includes(k)));
  const group = groups.find((g) => params.types && g.kinds.length === params.types.length && g.kinds.every((k) => params.types!.includes(k)))?.id ?? null;
  const data = caps ? await runSearch(db, params) : null;
  const { data: people } = caps?.company ? await db.from("company_members").select("user_id, display_name").eq("company_id", caps.company.id).eq("status", "active").order("display_name") : { data: null };
  const words = queryWords(params.q);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const link = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") n.delete(k); else n.set(k, v); }
    if (!("page" in patch)) n.delete("page");
    return `/search?${n}`;
  };
  const hasFilter = Boolean(params.types || params.status || params.trade || params.customer || params.project || params.person || params.from || params.to || params.scope === "project");
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="search-page">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-extrabold"><Search className="h-7 w-7 text-cool-gray" aria-hidden />Search</h1>
        <p className="text-sm text-ink-soft">Everything you can open in Built2Bid: customers, bids, projects, tasks, invoices, people, suppliers and saved items.</p>
      </div>
      {sp.get("settings") === "1" && <SearchSettings />}
      <SearchFilters
        q={params.q} group={group} groups={groups.map((g) => ({ id: g.id, label: g.label, kinds: g.kinds.filter((k) => kinds.includes(k)) }))}
        status={params.status ?? null} statusChoices={group ? STATUS_CHOICES[group] ?? [] : []}
        trade={params.trade ?? null} trades={trades.map((t) => ({ slug: t.slug, name: t.name }))}
        person={params.person ?? null} people={((people ?? []) as { user_id: string; display_name: string | null }[]).map((p) => ({ id: p.user_id, name: p.display_name || "Team member" }))}
        from={params.from ?? null} to={params.to ?? null} sort={params.sort ?? "relevance"}
        customer={params.customer ?? null} project={params.project ?? null} scope={params.scope ?? "all"} hasContext={Boolean(params.context?.estimateId || params.context?.scheduleId)}
      />
      {!caps || (data && !data.available) ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">Search is being set up for your account.</p>
      ) : !params.q.trim() && !hasFilter ? (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-ink-soft">Type what you&apos;re looking for above: a customer, an address, a bid or invoice number, a sub, or a SKU.</p>
      ) : data && data.results.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-center" data-testid="search-page-empty">
          <p className="font-semibold">No results{params.q ? <> for “{params.q}”</> : null}</p>
          <p className="mt-1 text-sm text-ink-soft">{hasFilter ? "Try removing a filter." : "Check the spelling, or try fewer words or a number like 1042."}</p>
          {hasFilter && <Link href={`/search?q=${encodeURIComponent(params.q)}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm font-semibold">Clear filters</Link>}
        </div>
      ) : data ? (
        <section aria-labelledby="results-h">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="results-h" className="text-sm font-semibold text-ink-soft" data-testid="search-page-count">
              {data.total >= 300 && !group ? "Many" : data.total} result{data.total === 1 ? "" : "s"}{data.query.understood.length ? ` · ${data.query.understood.join(", ")}` : ""}
              {data.workspace === "sandbox" && <span className="ml-2 rounded-full bg-warn-tint px-2 py-0.5 text-[11px] font-bold text-warn">Practice book</span>}
            </h2>
            {pages > 1 && <p className="text-xs text-muted">Page {data.page} of {pages}</p>}
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {data.results.map((r) => (
              <li key={`${r.kind}:${r.id}`} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start" data-testid={`search-page-result-${r.kind}`}>
                <Link href={r.href} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg py-1 hover:bg-paper focus-visible:bg-paper" data-search-result={r.id}>
                  <ResultBody r={r} words={words} />
                </Link>
                <span className="flex shrink-0 flex-wrap gap-2 pl-12 text-xs sm:pl-2 sm:pt-2">
                  {r.customerId && !params.customer && <Link href={link({ customer: r.customerId })} className="font-semibold text-accent-ink underline">More for {r.kind === "customer" ? "this customer" : r.customerName ?? "this customer"}</Link>}
                  {r.estimateId && !params.project && r.kind !== "estimate" && <Link href={link({ project: r.estimateId })} className="font-semibold text-accent-ink underline">More in this project</Link>}
                  {r.date && <span className="text-muted">{new Date(`${r.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                </span>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav aria-label="Result pages" className="mt-3 flex items-center justify-between gap-2">
              {data.page > 1 ? <Link href={link({ page: String(data.page - 1) })} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-semibold" data-testid="search-prev">Previous</Link> : <span />}
              {data.page < pages ? <Link href={link({ page: String(data.page + 1) })} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-semibold" data-testid="search-next">Next</Link> : <span />}
            </nav>
          )}
        </section>
      ) : null}
    </div>
  );
}
