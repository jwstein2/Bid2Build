import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Container } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Avatar } from "@/components/academy/avatar";
import { ROLE_LABEL } from "@/components/academy/format";
import { MembersOnly } from "@/components/academy/gate";
import { listTrades, loadMe } from "@/lib/academy/server";
import { PILLARS, US_STATES, levelName } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Academy Members", robots: { index: false, follow: false } };

const PAGE = 24;
const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
type Row = { user_id: string; display_name: string; headline: string | null; trades: string[]; state_code: string | null; company_name: string | null; role: string; tier: string; level: number; points: number; joined_at: string; online: boolean; total: number };

export default async function MembersPage({ searchParams }: PageProps<"/academy/members">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80).trim() : "");
  const { me, migrated } = await loadMe();
  if (!me.member) return <MembersOnly me={me} migrated={migrated} what="The member directory" />;
  const trades = await listTrades();
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));
  const page = Math.max(1, Math.min(Number(s("page")) || 1, 200));
  const filters = { q: s("q"), trade: tradeName.has(s("trade")) ? s("trade") : "", state: US_STATES.includes(s("state") as (typeof US_STATES)[number]) ? s("state") : "", role: ["admin", "moderator", "instructor"].includes(s("role")) ? s("role") : "", interest: PILLARS.some((p) => p.key === s("interest")) ? s("interest") : "" };
  const { data } = await (await createClient()).rpc("academy_directory", {
    p_q: filters.q || null, p_trade: filters.trade || null, p_state: filters.state || null, p_role: filters.role || null, p_tier: null, p_interest: filters.interest || null, p_limit: PAGE, p_offset: (page - 1) * PAGE,
  });
  const rows = (data ?? []) as Row[];
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(Number(total) / PAGE));
  const qs = (p: number) => { const u = new URLSearchParams(Object.entries({ ...filters, page: String(p) }).filter(([, v]) => v)); return `/academy/members?${u}`; };

  return (
    <Container className="py-6">
      <h1 className="font-display text-2xl font-extrabold">Members</h1>
      <p className="mt-1 text-sm text-ink-soft">{Number(total).toLocaleString("en-US")} {Number(total) === 1 ? "member" : "members"} {filters.q || filters.trade || filters.state || filters.role || filters.interest ? "match" : "in the directory"}. Members choose whether they appear here and whether their company and location are shown.</p>
      <form action="/academy/members" role="search" className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(4,10rem)_auto] sm:items-end">
        <label className="relative"><span className="sr-only">Search members</span><Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={filters.q} placeholder="Search by name or headline" className={`${input} pl-9`} /></label>
        <label className="text-xs font-semibold text-muted">Trade<select name="trade" defaultValue={filters.trade} className={`${input} mt-0.5`}><option value="">Any</option>{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">State<select name="state" defaultValue={filters.state} className={`${input} mt-0.5`}><option value="">Any</option>{US_STATES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted">Role<select name="role" defaultValue={filters.role} className={`${input} mt-0.5`}><option value="">Anyone</option><option value="admin">Admins</option><option value="moderator">Moderators</option><option value="instructor">Instructors</option></select></label>
        <label className="text-xs font-semibold text-muted">Interest<select name="interest" defaultValue={filters.interest} className={`${input} mt-0.5`}><option value="">Any</option>{PILLARS.map((p) => <option key={p.key} value={p.key}>{p.short}</option>)}</select></label>
        <button className={buttonClass("secondary", "sm", "mb-0.5")}>Filter</button>
      </form>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="directory">
        {rows.length === 0 && <li className="col-span-full rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-soft">No members match these filters.</li>}
        {rows.map((m) => (
          <li key={m.user_id}>
            <Link href={`/academy/members/${m.user_id}`} className="flex h-full items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card hover:border-line-strong" data-testid="member-card">
              <span className="relative"><Avatar id={m.user_id} name={m.display_name} level={m.level} />{m.online && <span className="absolute top-0 left-0 h-3 w-3 rounded-full border-2 border-surface bg-ok" title="Online now" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">{m.display_name}{m.role !== "member" && <span className="rounded bg-brand-tint px-1.5 text-[11px] font-semibold text-navy">{ROLE_LABEL[m.role]}</span>}</span>
                {m.headline && <span className="block text-sm text-ink-soft">{m.headline}</span>}
                <span className="mt-1 block text-xs text-muted">
                  {[m.company_name, m.state_code, m.trades.slice(0, 2).map((t) => tradeName.get(t) ?? t).join(", ")].filter(Boolean).join(" · ")}
                </span>
                <span className="mt-1 block text-xs text-muted">Level {m.level} · {levelName(m.level)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="mt-5 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 1 ? <Link href={qs(page - 1)} className="font-semibold text-accent-ink hover:underline">Previous</Link> : <span />}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={qs(page + 1)} className="font-semibold text-accent-ink hover:underline">Next</Link> : <span />}
        </nav>
      )}
    </Container>
  );
}
