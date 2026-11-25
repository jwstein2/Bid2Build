import type { Metadata } from "next";
import Link from "next/link";
import { Lock, MessageSquare, Pin, Search, CheckCircle2, Image as ImageIcon, Link2 } from "lucide-react";
import { Container, Notice } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Flash } from "@/components/creator/flash";
import { AcademySidebar } from "@/components/academy/sidebar";
import { Avatar } from "@/components/academy/avatar";
import { ReactButton, SaveButton, Submit } from "@/components/academy/controls";
import { ROLE_LABEL, timeAgo } from "@/components/academy/format";
import { listTrades, loadMe } from "@/lib/academy/server";
import { PAGE_SIZE, PUBLIC_CATEGORIES, loadCategories, loadFeed } from "@/lib/academy/community";
import { POST_KINDS, US_STATES } from "@/lib/academy/types";
import { openGraphFor } from "@/lib/seo/open-graph";
import { site } from "@/lib/site";
import { createPost } from "./actions";
import { FileDrop } from "@/components/ui/file-drop";

const title = "Contractor Academy Community";
const description = "A professional community where contractors learn selling, estimating, project management, hiring and financials together, organized by trade.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/academy" },
  openGraph: openGraphFor({ title: `${title} | ${site.name}`, description, path: "/academy" }),
};

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";

export default async function CommunityPage({ searchParams }: PageProps<"/academy">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : undefined);
  const { me, migrated, user } = await loadMe();
  const trades = await listTrades();
  const tradeName = new Map(trades.map((t) => [t.slug, t.name]));

  return (
    <Container className="py-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Flash msg={s("msg")} err={s("err")} />
          {!migrated ? (
            <Notice title="The community is being set up">Discussions open once setup is finished. In the meantime the <Link className="font-semibold underline" href="/academy/classroom">Classroom</Link> is open to everyone.</Notice>
          ) : !me.member ? (
            <Preview signedIn={me.signed_in} banned={me.status === "banned"} />
          ) : (
            <MemberFeed s={s} me={me} userId={user?.id} trades={trades} tradeName={tradeName} />
          )}
        </div>
        <AcademySidebar />
      </div>
    </Container>
  );
}

function Preview({ signedIn, banned }: { signedIn: boolean; banned: boolean }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-6 shadow-card" data-testid="community-preview">
      <h1 className="font-display text-2xl font-extrabold">One community for every trade</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">Ask questions, share what works and learn from contractors in your trade and beyond. Every discussion can be tagged with a trade, so a roofer can see roofing conversations first and still explore everything else.</p>
      <p className="mt-2 text-sm text-muted">Discussions are visible to members only and are never shown to search engines.</p>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {PUBLIC_CATEGORIES.map(([name, desc]) => (
          <li key={name} className="rounded-lg border border-line p-3"><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted">{desc}</p></li>
        ))}
      </ul>
      <div className="mt-6">
        {banned ? null : signedIn ? (
          <Link href="/academy/join" className={buttonClass("accent", "lg")} data-cta="academy-join">Join the community (free)</Link>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Link href="/login?next=/academy/join" className={buttonClass("accent", "lg")}>Join free with your Built2Bid account</Link>
            <Link href="/academy/classroom" className={buttonClass("secondary", "lg")}>Browse the Classroom</Link>
          </div>
        )}
      </div>
    </section>
  );
}

async function MemberFeed({ s, me, userId, trades, tradeName }: { s: (k: string) => string | undefined; userId?: string; me: Awaited<ReturnType<typeof loadMe>>["me"]; trades: { slug: string; name: string }[]; tradeName: Map<string, string> }) {
  const categories = await loadCategories();
  const category = categories.some((c) => c.slug === s("category")) ? s("category") : undefined;
  // Default trade filter: the member's own trade, unless they chose "all" (?trade=all) or another trade.
  const tradeParam = s("trade");
  const trade = tradeParam === "all" ? undefined : tradeParam && tradeName.has(tradeParam) ? tradeParam : undefined;
  const q = s("q");
  const page = Number(s("page") ?? 1) || 1;
  const feed = await loadFeed({ category, trade, q, sort: s("sort"), kind: s("kind") === "question" ? "question" : undefined, page });
  const pages = Math.max(1, Math.ceil(feed.total / PAGE_SIZE));
  const qs = (patch: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = { category, trade: tradeParam, q, sort: s("sort"), kind: s("kind"), ...patch };
    const p = new URLSearchParams(Object.entries(base).filter(([, v]) => v) as [string, string][]);
    const str = p.toString();
    return str ? `/academy?${str}` : "/academy";
  };
  const canPostIn = categories.filter((c) => !c.staff_only_posting || ["admin", "moderator"].includes(me.role ?? "")).filter((c) => c.access === "members" || me.premium);
  const myTrades = (me.trades ?? []).filter((t) => tradeName.has(t));

  return (
    <>
      <h1 className="sr-only">Community</h1>
      {me.status === "suspended" ? (
        <Notice tone="warn" title="Posting is paused on your account">You can keep reading. Contact the Academy team if you think this is a mistake.</Notice>
      ) : (
        <details className="group rounded-xl border border-line bg-surface shadow-card" data-testid="composer" open={Boolean(s("compose"))}>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-navy text-sm font-bold text-cyan" aria-hidden>{(me.display_name ?? "?").slice(0, 1).toUpperCase()}</span>
            <span className="flex-1 rounded-full border border-line px-4 py-2 text-sm text-muted">Write something or ask a question…</span>
          </summary>
          <form action={createPost} className="grid gap-3 border-t border-line p-4" encType="multipart/form-data">
            <input type="hidden" name="return_to" value="/academy?compose=1" />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Category
                <select name="category" required className={`${input} mt-1`} defaultValue={category ?? "general"}>
                  {canPostIn.map((c) => <option key={c.slug} value={c.slug}>{c.name}{c.access === "premium" ? " (Premium)" : ""}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Type
                <select name="kind" className={`${input} mt-1`} defaultValue="discussion">
                  {POST_KINDS.filter((k) => k.key !== "announcement" || ["admin", "moderator"].includes(me.role ?? "")).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </label>
            </div>
            <label className="text-sm font-semibold">Title<input name="title" required minLength={3} maxLength={160} className={`${input} mt-1`} placeholder="What's on your mind?" /></label>
            <label className="text-sm font-semibold">Details<textarea name="body" required maxLength={10000} rows={5} className={`${input} mt-1`} placeholder="Share the situation. Leave out customer names and addresses." /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-semibold">Trade
                <select name="trade" className={`${input} mt-1`} defaultValue={trade ?? me.primary_trade ?? ""}>
                  <option value="">All trades</option>
                  {trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">State (optional)
                <select name="state_code" className={`${input} mt-1`} defaultValue=""><option value="">—</option>{US_STATES.map((st) => <option key={st}>{st}</option>)}</select>
              </label>
              <label className="text-sm font-semibold">Link (optional)<input name="link_url" type="url" maxLength={500} placeholder="https://" className={`${input} mt-1`} /></label>
            </div>
            <FileDrop className="rounded-lg"><label className="text-sm font-semibold">Image (optional, JPG/PNG/WebP up to 5 MB)
              <input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />
            </label></FileDrop>
            <div className="flex justify-end"><Submit pending="Posting…">Post</Submit></div>
          </form>
        </details>
      )}

      {/* Filters */}
      <div className="mt-4 grid gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Categories">
          <Link role="listitem" href={qs({ category: undefined, page: undefined })} aria-current={!category ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${!category ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft hover:border-line-strong"}`}>All</Link>
          {categories.filter((c) => c.access === "members" || me.premium).map((c) => (
            <Link role="listitem" key={c.slug} href={qs({ category: c.slug, page: undefined })} aria-current={category === c.slug ? "page" : undefined}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${category === c.slug ? "border-navy bg-navy text-white" : "border-line bg-surface text-ink-soft hover:border-line-strong"}`}>{c.name}</Link>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2" action="/academy" role="search">
          {category && <input type="hidden" name="category" value={category} />}
          <label className="relative min-w-48 flex-1">
            <span className="sr-only">Search discussions</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search discussions" className={`${input} pl-9`} />
          </label>
          <label className="text-xs font-semibold text-muted">Trade
            <select name="trade" defaultValue={tradeParam ?? ""} className={`${input} mt-0.5 w-44`}>
              <option value="">All trades</option>
              {myTrades.length > 0 && <optgroup label="My trades">{myTrades.map((t) => <option key={`m-${t}`} value={t}>{tradeName.get(t)}</option>)}</optgroup>}
              <optgroup label="Every trade">{trades.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</optgroup>
            </select>
          </label>
          <label className="text-xs font-semibold text-muted">Sort
            <select name="sort" defaultValue={feed.sort} className={`${input} mt-0.5 w-36`}>
              <option value="activity">Latest activity</option><option value="new">Newest</option><option value="top">Top</option>{q && <option value="relevance">Best match</option>}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-muted"><input type="checkbox" name="kind" value="question" defaultChecked={s("kind") === "question"} /> Questions only</label>
          <button className={buttonClass("secondary", "sm", "mb-0.5")}>Apply</button>
        </form>
        {myTrades.length > 0 && !trade && (
          <p className="text-xs text-muted">Showing every trade. <Link className="font-semibold text-accent-ink underline" href={qs({ trade: myTrades[0], page: undefined })}>Only {tradeName.get(myTrades[0])}</Link></p>
        )}
      </div>

      {/* Feed */}
      <ul className="mt-4 grid gap-3" data-testid="feed">
        {feed.rows.length === 0 && (
          <li className="rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-soft">
            {q || category || trade ? "No discussions match these filters yet." : "No discussions yet. Start the first one."}
          </li>
        )}
        {feed.rows.map((p) => (
          <li key={p.id} className={`rounded-xl border bg-surface p-4 shadow-card ${p.pinned ? "border-accent-ink/40" : "border-line"}`} data-testid="feed-item">
            <div className="flex items-start gap-3">
              <Avatar id={p.author_id} name={p.author_name} level={p.author_level} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                  <Link href={`/academy/members/${p.author_id}`} className="font-semibold text-ink hover:underline">{p.author_name}</Link>
                  {p.author_role !== "member" && <span className="rounded bg-brand-tint px-1.5 font-semibold text-navy">{ROLE_LABEL[p.author_role]}</span>}
                  <span>· {timeAgo(p.created_at)} · {p.category_name}</span>
                  {p.trade_slug && <span className="rounded bg-accent-tint px-1.5 font-semibold text-accent-dark">{tradeName.get(p.trade_slug) ?? p.trade_slug}</span>}
                  {p.state_code && <span>· {p.state_code}</span>}
                </p>
                <Link href={`/academy/post/${p.id}`} className="mt-1 block">
                  <h2 className="flex items-center gap-1.5 font-display text-base font-bold hover:underline">
                    {p.pinned && <Pin className="h-4 w-4 text-accent-ink" aria-label="Pinned" />}
                    {p.kind === "announcement" && <span className="rounded bg-navy px-1.5 text-[11px] font-semibold text-white">Announcement</span>}
                    {p.kind === "question" && <span className={`rounded px-1.5 text-[11px] font-semibold ${p.answered ? "bg-ok-tint text-ok" : "bg-warn-tint text-warn"}`}>{p.answered ? "Answered" : "Question"}</span>}
                    <span className="min-w-0 break-words">{p.title}</span>
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{p.excerpt}</p>
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                  <ReactButton type="post" id={p.id} count={p.reaction_count} reacted={p.reacted} disabled={p.author_id === userId} />
                  <Link href={`/academy/post/${p.id}#comments`} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 font-semibold text-muted hover:bg-black/5 hover:text-ink"><MessageSquare className="h-4 w-4" aria-hidden /> {p.comment_count}</Link>
                  <SaveButton type="post" id={p.id} saved={p.saved} />
                  {p.image_path && <ImageIcon className="h-4 w-4 text-muted" aria-label="Has an image" />}
                  {p.link_url && <Link2 className="h-4 w-4 text-muted" aria-label="Has a link" />}
                  {p.locked && <Lock className="h-4 w-4 text-muted" aria-label="Locked" />}
                  {p.answered && <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />}
                  <span className="ml-auto text-xs text-muted">Active {timeAgo(p.last_activity_at)}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          {feed.page > 1 ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(feed.page - 1) })}>Previous</Link> : <span />}
          <span className="text-muted">Page {feed.page} of {pages} · {feed.total.toLocaleString("en-US")} discussions</span>
          {feed.page < pages ? <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(feed.page + 1) })}>Next</Link> : <span />}
        </nav>
      )}
    </>
  );
}
