import Link from "next/link";
import { Chip, Kpi, PageHead, Panel, Table, ago, day, fmt } from "@/components/admin/cc";
import { ReportUnavailable, ScopeNote } from "@/components/admin/report";
import { CLASS_LABEL, type AccountClass } from "@/lib/admin/classify";
import { PAGE_SIZE, PLAN_LABEL, filterCustomers, parseCustomerFilters, planText } from "@/lib/admin/customers";
import { tip } from "@/lib/admin/definitions";
import { SEGMENTS, SEGMENT_LABEL, grantState } from "@/lib/admin/model";
import { loadReport } from "@/lib/admin/load";
import { href } from "@/lib/admin/view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

const CLS_TONE: Record<AccountClass, "green" | "amber" | "violet" | "muted"> = { genuine: "green", internal: "violet", test: "amber", demo: "muted" };

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { r, error, view } = await loadReport(sp);
  if (!r) return <ReportUnavailable error={error} />;
  const { facts, sc, now } = r;
  const f = parseCustomerFilters(sp);
  const rows = filterCustomers(facts, f);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const nowMs = now.getTime();
  const seg = new Map<string, number>(); for (const x of facts) seg.set(x.segment, (seg.get(x.segment) ?? 0) + 1);
  const grants = sc.d.grants;
  const activeGrants = grants.filter((g) => grantState(g, nowMs) === "active").length;
  const expiring = grants.filter((g) => grantState(g, nowMs) === "active" && g.expires_at && Date.parse(g.expires_at) <= nowMs + 7 * 86_400_000).length;
  const pending = grants.filter((g) => g.status === "pending").length;
  const unverified = facts.filter((x) => !x.confirmed && Date.parse(x.createdAt) < nowMs - 86_400_000).length;
  const filtered = Boolean(f.q || f.segment || f.plan || f.activated || (f.cls && f.cls !== "all"));
  const qs = (patch: Record<string, string | undefined>) => href("/admin/customers", view, { page: undefined, ...patch });
  const exportHref = href("/admin/export/customers", view, {});

  return (
    <div className="space-y-6">
      <PageHead kicker="Customers" title="Accounts and access"
        intro="Every account with its plan, activation and last meaningful activity (bid actions, not page views). Open an account for support details. Bid contents and prices are never shown here."
        right={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/complimentary#grant" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-2 text-sm font-bold text-[#03140c] hover:brightness-110">+ Grant complimentary access</Link>
            <Link href="/admin/complimentary" className="cc-mono rounded-md border border-[var(--cc-line-strong)] px-3 py-2 text-sm text-ink-soft hover:text-white">Manage grants</Link>
          </div>
        } />
      <ScopeNote sc={sc} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Accounts" value={facts.length} def={tip("registered")} sub={unverified ? `${unverified} never verified their email` : "All verified"} />
        <Kpi label="Paying" value={facts.filter((x) => x.paying).length} tone="blue" def={tip("paying")} href={qs({ plan: "paying" })} sub={`${facts.filter((x) => x.pastDue).length} past due`} />
        <Kpi label="Complimentary (active)" value={activeGrants} tone="violet" def={tip("complimentary")} href="/admin/complimentary" sub={`${expiring} expiring in 7 days · ${pending} pending invite${pending === 1 ? "" : "s"}`} />
        <Kpi label="Never started a bid" value={seg.get("never_bid") ?? 0} tone="amber" href={qs({ segment: "never_bid" })} sub="Registered, no bid yet: an onboarding gap, not churn" />
      </div>

      <Panel kicker="Lifecycle" title="Where accounts are">
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map((s) => (
            <Link key={s.key} href={qs({ segment: f.segment === s.key ? undefined : s.key })} title={s.def} aria-current={f.segment === s.key ? "true" : undefined}
              className={`cc-mono rounded-md border px-2.5 py-1.5 text-xs ${f.segment === s.key ? "border-[var(--cc-green)] text-[var(--cc-green)]" : "border-[var(--cc-line)] text-ink-soft hover:text-white"}`}>
              {s.label} <span className="text-white">{fmt(seg.get(s.key) ?? 0)}</span>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Hover a segment for its definition. Free accounts going quiet is not churn; churn only applies to paid subscriptions (see Revenue).</p>
      </Panel>

      <Panel>
        <form method="get" action="/admin/customers" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))_auto]">
          {view.range.key !== "30d" && <input type="hidden" name="range" value={view.range.key} />}
          {view.includeTest && <input type="hidden" name="data" value="all" />}
          {f.segment && <input type="hidden" name="segment" value={f.segment} />}
          <label className="text-xs"><span className="cc-kicker mb-1 block">Search</span><input name="q" defaultValue={f.q} placeholder="Email or business name" className="field field-sm" /></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Plan</span><select name="plan" defaultValue={f.plan} className="field field-sm"><option value="">All</option>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">First finalized bid</span><select name="activated" defaultValue={f.activated} className="field field-sm"><option value="">Any</option><option value="yes">Activated</option><option value="no">Not yet</option></select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Sort</span><select name="sort" defaultValue={f.sort} className="field field-sm"><option value="signup">Newest signup</option><option value="activity">Last activity</option><option value="bids">Most bids</option><option value="name">Name A–Z</option></select></label>
          <label className="text-xs"><span className="cc-kicker mb-1 block">Account type</span>
            <select name="cls" defaultValue={f.cls} className="field field-sm" disabled={!view.includeTest} title={view.includeTest ? undefined : "Turn on “Include test data” to see internal, test and demo accounts"}>
              <option value="">{view.includeTest ? "All types" : "Genuine only"}</option>{view.includeTest && (["genuine", "internal", "test", "demo"] as const).map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
            </select></label>
          <div className="flex items-end gap-2"><button type="submit" className="cc-mono rounded-md bg-[var(--cc-green)] px-3 py-1.5 text-sm font-bold text-[#03140c]">Apply</button>{filtered && <Link href={href("/admin/customers", view, {})} className="cc-mono px-1 py-1.5 text-xs text-ink-soft underline">Reset</Link>}</div>
        </form>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="cc-mono">{fmt(rows.length)} account{rows.length === 1 ? "" : "s"}{f.segment ? ` · ${SEGMENT_LABEL[f.segment]}` : ""}</span>
          <a href={exportHref} className="cc-mono text-[var(--cc-blue)] underline">Export CSV (account summary, no bid contents)</a>
        </div>
        {shown.length === 0 ? <p className="py-6 text-center text-sm text-ink-soft">No accounts match.</p> : (
          <Table head={["Business", "Owner email", "Plan", "Signed up", "Last activity", "Bids", "Final.", "Signed", "Activated", ...(view.includeTest ? ["Type"] : [])]} align={["l", "l", "l", "l", "l", "r", "r", "r", "l", "l"]} minWidth={980}>
            {shown.map((x) => (
              <tr key={x.id}>
                <td className="max-w-[12rem] truncate font-sans"><Link href={`/admin/customers/${x.id}${view.includeTest ? "?data=all" : ""}`} className="font-semibold text-white hover:underline">{x.business ?? <span className="font-normal text-muted">No business name</span>}</Link></td>
                <td className="max-w-[14rem] truncate font-sans text-ink-soft">{x.email ?? "–"}{!x.confirmed && <span className="ml-1 text-[10px] text-[var(--cc-amber)]">unverified</span>}</td>
                <td className="whitespace-nowrap font-sans"><span className={x.paying ? (x.pastDue ? "text-[var(--cc-red)]" : "text-[var(--cc-green)]") : x.comp ? "text-[var(--cc-violet)]" : "text-ink-soft"}>{planText(x)}</span></td>
                <td className="whitespace-nowrap text-ink-soft">{day(x.createdAt)}</td>
                <td className="whitespace-nowrap text-ink-soft">{x.lastActivityAt ? ago(x.lastActivityAt, nowMs) : "–"}</td>
                <td className="text-right text-white">{fmt(x.estimates)}</td><td className="text-right">{fmt(x.finalized)}</td><td className="text-right">{fmt(x.signed)}</td>
                <td>{x.firstFinalizedAt ? <span className="text-[var(--cc-green)]">✓ <span className="text-muted">{day(x.firstFinalizedAt)}</span></span> : <span className="text-muted">–</span>}</td>
                {view.includeTest && <td><Chip tone={CLS_TONE[x.cls]}>{x.cls}</Chip></td>}
              </tr>
            ))}
          </Table>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="cc-mono mt-4 flex items-center justify-between text-xs">
            {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="text-[var(--cc-blue)] underline">← Previous</Link> : <span />}
            <span className="text-muted">Page {page} of {pages}</span>
            {page < pages ? <Link href={qs({ page: String(page + 1) })} className="text-[var(--cc-blue)] underline">Next →</Link> : <span />}
          </nav>
        )}
      </Panel>
    </div>
  );
}
