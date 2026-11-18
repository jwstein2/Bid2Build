"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Clock, CornerDownLeft, FlaskConical, History, LoaderCircle, Newspaper, Search, Shield, X, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { ActionResult } from "@/lib/search/actions";
import type { GroupId, SearchKind, SearchResult } from "@/lib/search/kinds";
import { GROUPS } from "@/lib/search/kinds";
import { Chip, KIND_ICON, ResultBody } from "./search-parts";
import { queryWords } from "@/lib/search/query";

/** Opens the one search dialog from anywhere (header field, phone icon, or code). */
export const OPEN_SEARCH_EVENT = "b2b:open-search";
export const openSearch = (q?: string) => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: q ?? "" }));

type Group = { id: GroupId; label: string; total: number; capped: boolean; results: SearchResult[] };
type Response = { available: boolean; groups: Group[]; actions: ActionResult[]; actionsFirst: boolean; admin: { userId: string; email: string; company: string | null }[];
  workspace: "live" | "sandbox" | null; query: { text: string; understood: string[] }; news?: { id: string; title: string; subtitle: string; href: string }[] };
type Recent = { available: boolean; historyEnabled: boolean; queries: string[]; records: { kind: SearchKind; id: string; title: string; subtitle: string | null; kindLabel: string; href: string }[]; actions: ActionResult[] };

/** The project the user is looking at (results from it rank first and are labelled "This project"). */
export function contextFromPath(path: string): { scheduleId?: string; estimateId?: string } | null {
  const id = "([0-9a-f-]{36})";
  let m = path.match(new RegExp(`^/projects/${id}(?:/|$)`));
  if (m) return { scheduleId: m[1] };
  m = path.match(new RegExp(`^/(?:estimates|company/bids|financials/jobs)/${id}(?:/|$)`));
  if (m) return { estimateId: m[1] };
  return null;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Desktop header field (looks like an input, opens the dialog). */
export function SearchField({ className }: { className?: string }) {
  const [mac, setMac] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- platform is only known in the browser
  useEffect(() => setMac(isMac()), []);
  return (
    <button type="button" onClick={() => openSearch()} data-testid="global-search-field" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K"
      className={cn("group flex min-h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-left text-sm text-muted shadow-sm transition-colors hover:border-line-strong hover:text-ink-soft", className)}>
      <Search className="h-4 w-4 shrink-0 text-cool-gray" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search customers, projects, invoices…</span>
      <kbd className="hidden shrink-0 rounded border border-line bg-paper px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted lg:inline">{mac ? "⌘" : "Ctrl"} K</kbd>
      <span className="sr-only">Search everything (shortcut {mac ? "Command" : "Control"} K)</span>
    </button>
  );
}

/** Phone header icon. */
export function SearchIconButton({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <button type="button" onClick={() => openSearch()} aria-label="Search everything" aria-haspopup="dialog" data-testid="global-search-icon"
      className={cn("flex min-h-11 min-w-11 items-center justify-center rounded-md", tone === "dark" ? "text-white hover:bg-white/10" : "text-ink hover:bg-black/5", className)}>
      <Search className="h-5 w-5" aria-hidden />
    </button>
  );
}

type Option = { key: string; href: string; kind: "record" | "action" | "query" | "recent" | "all" | "admin" | "news"; record?: SearchResult; action?: ActionResult; query?: string; newsSubtitle?: string };

/** The search dialog + Ctrl/Cmd+K. Mount once per layout. */
export function GlobalSearchHost() {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "project">("all");
  const [data, setData] = useState<Response | null>(null);
  const [recent, setRecent] = useState<Recent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const cache = useRef(new Map<string, Response>());
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const ctx = useMemo(() => contextFromPath(path), [path]);

  // Ctrl/Cmd+K anywhere (also while typing in a field), plus the open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = (e: Event) => { const v = (e as CustomEvent<string>).detail; if (v) setQ(v); setOpen(true); };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_SEARCH_EVENT, onOpen); };
  }, []);
  // Leaving the page closes it; results are never kept after the dialog closes (no stale or revoked records).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close after navigation
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (open) return;
    cache.current.clear(); abort.current?.abort();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when closed
    setData(null); setRecent(null); setError(null); setLoading(false); setScope("all");
  }, [open]);

  useEffect(() => {
    if (!open || recent) return;
    fetch("/api/search/recent", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRecent(d)).catch(() => {});
  }, [open, recent]);

  const run = useCallback((query: string, sc: "all" | "project") => {
    const key = `${sc}|${query.trim().toLowerCase()}`;
    const hit = cache.current.get(key);
    if (hit) { setData(hit); setLoading(false); setError(null); return; }
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    const sp = new URLSearchParams({ q: query });
    if (ctx?.scheduleId) sp.set("ctx_schedule", ctx.scheduleId);
    if (ctx?.estimateId) sp.set("ctx_estimate", ctx.estimateId);
    if (sc === "project") sp.set("scope", "project");
    setLoading(true); setError(null);
    fetch(`/api/search?${sp}`, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? "Search isn't responding."); return r.json() as Promise<Response>; })
      .then((d) => { cache.current.set(key, d); setData(d); setLoading(false); setActive(0); })
      .catch((e: Error) => { if (e.name !== "AbortError") { setError(e.message || "Search isn't responding."); setLoading(false); } });
  }, [ctx]);

  // Search as you type (debounced; one request in flight, stale ones cancelled; no AI).
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the box empties
    if (query.length < 2) { abort.current?.abort(); setData(null); setLoading(false); setError(null); setActive(0); return; }
    const t = setTimeout(() => run(query, scope), 180);
    return () => clearTimeout(t);
  }, [q, scope, open, run]);

  const words = queryWords(q);
  const hasQuery = q.trim().length >= 2;
  const allHref = useMemo(() => {
    const sp = new URLSearchParams({ q: q.trim() });
    if (ctx?.scheduleId) sp.set("ctx_schedule", ctx.scheduleId);
    if (ctx?.estimateId) sp.set("ctx_estimate", ctx.estimateId);
    if (scope === "project") sp.set("scope", "project");
    return `/search?${sp}`;
  }, [q, ctx, scope]);

  // Flatten into the keyboard order.
  const sections = useMemo(() => {
    type Section = { id: string; label: string; icon?: typeof Zap; total?: number; moreHref?: string; options: Option[] };
    const out: Section[] = [];
    if (!hasQuery) {
      if (recent?.queries.length) out.push({ id: "recent-q", label: "Recent searches", icon: History, options: recent.queries.map((x) => ({ key: `q:${x}`, href: "", kind: "query", query: x })) });
      if (recent?.records.length) out.push({ id: "recent-r", label: "Recently opened", icon: Clock, options: recent.records.map((r) => ({ key: `rr:${r.kind}:${r.id}`, href: r.href, kind: "recent", record: { ...r, group: "customers", status: null, reason: null, inContext: false, sandbox: false, amount: null, date: null, customerName: null, customerId: null, estimateId: null } as SearchResult })) });
      if (recent?.actions.length) out.push({ id: "suggested", label: "Quick actions", icon: Zap, options: recent.actions.map((a) => ({ key: `a:${a.id}`, href: a.href, kind: "action", action: a })) });
      return out;
    }
    if (!data) return out;
    const actions: Section | null = data.actions.length ? { id: "actions", label: "Settings & Actions", icon: Zap, options: data.actions.map((a) => ({ key: `a:${a.id}`, href: a.href, kind: "action", action: a })) } : null;
    if (actions && data.actionsFirst) out.push(actions);
    const here = data.groups.flatMap((g) => g.results.filter((r) => r.inContext));
    if (ctx && here.length && scope === "all") out.push({ id: "here", label: "This project", options: here.slice(0, 5).map((r) => ({ key: `h:${r.kind}:${r.id}`, href: r.href, kind: "record", record: r })) });
    for (const g of data.groups) {
      const rest = ctx && scope === "all" ? g.results.filter((r) => !r.inContext) : g.results;
      if (!rest.length) continue;
      const kinds = GROUPS.find((x) => x.id === g.id)?.kinds ?? [];
      const sp = new URLSearchParams(allHref.split("?")[1]); sp.set("type", kinds.join(","));
      out.push({ id: g.id, label: ctx && scope === "all" && here.length ? `${g.label} · All company records` : g.label, total: g.total, moreHref: g.total > g.results.length ? `/search?${sp}` : undefined,
        options: rest.map((r) => ({ key: `r:${r.kind}:${r.id}`, href: r.href, kind: "record", record: r })) });
    }
    if (data.admin.length) out.push({ id: "admin", label: "Owner admin · Accounts", icon: Shield, options: data.admin.map((a) => ({ key: `ad:${a.userId}`, href: `/admin/customers/${a.userId}`, kind: "admin", query: `${a.email}${a.company ? ` · ${a.company}` : ""}` })) });
    // Public industry articles: their own group, labelled so they can't be mistaken for company records.
    if (data.news?.length) out.push({ id: "news", label: "Industry News · public articles", icon: Newspaper, options: data.news.map((n) => ({ key: `n:${n.id}`, href: n.href, kind: "news", query: n.title, newsSubtitle: n.subtitle })) });
    if (actions && !data.actionsFirst) out.push(actions);
    out.push({ id: "all", label: "", options: [{ key: "all", href: allHref, kind: "all" }] });
    return out;
  }, [hasQuery, recent, data, ctx, scope, allHref]);
  const options = useMemo(() => sections.flatMap((s) => s.options), [sections]);
  const optId = (i: number) => `${uid}-opt-${i}`;
  const idx = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optId(idx))}`)?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optId is derived from uid
  }, [idx]);

  const remember = (body: object) => {
    fetch("/api/search/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  };
  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === "query") { setQ(o.query ?? ""); inputRef.current?.focus(); return; }
    if (o.action?.comingSoon) return;
    if (hasQuery) remember({ action: "query", query: q.trim() });
    if (o.record && (o.kind === "record" || o.kind === "recent")) remember({ action: "record", kind: o.record.kind, id: o.record.id });
    setOpen(false);
    router.push(o.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (options.length ? (Math.min(i, options.length - 1) + 1) % options.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (options.length ? (Math.min(i, options.length - 1) - 1 + options.length) % options.length : 0)); }
    else if (e.key === "Home" && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && e.ctrlKey) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (hasQuery && !data && !loading) return;
      choose(options[idx]);
    }
  };

  const total = data?.groups.reduce((n, g) => n + g.total, 0) ?? 0;
  const empty = hasQuery && data && !loading && !data.groups.length && !data.actions.length && !data.admin.length && !data.news?.length;
  let n = -1;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade fixed inset-0 z-[60] bg-ink/45 backdrop-blur-[2px]" />
        <Dialog.Content aria-describedby={`${uid}-help`} data-testid="global-search-dialog"
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }}
          className="app-theme fixed inset-0 z-[60] flex flex-col bg-surface text-ink shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-[8vh] sm:h-auto sm:max-h-[min(78vh,760px)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-line">
          <Dialog.Title className="sr-only">Search Built2Bid</Dialog.Title>
          <p id={`${uid}-help`} className="sr-only">Type to search customers, projects, bids, invoices, tasks, people and actions. Use up and down arrows to move, Enter to open, Escape to close.</p>
          <div className="flex items-center gap-2 border-b border-line px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 sm:pt-3">
            <Search className="h-5 w-5 shrink-0 text-cool-gray" aria-hidden />
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
              role="combobox" aria-expanded={options.length > 0} aria-controls={`${uid}-list`} aria-activedescendant={options.length ? optId(idx) : undefined}
              aria-autocomplete="list" aria-label="Search everything" placeholder="Search customers, projects, invoices, or type a command…" autoComplete="off" autoCorrect="off" spellCheck={false}
              enterKeyHint="search" maxLength={100} data-testid="global-search-input"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none" />
            {loading && <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-cool-gray" aria-hidden />}
            {q && <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} className="hidden min-h-11 shrink-0 rounded-md px-2 text-sm font-semibold text-muted hover:text-ink sm:block">Clear</button>}
            <Dialog.Close className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-black/5" aria-label="Close search"><X className="h-5 w-5" aria-hidden /></Dialog.Close>
          </div>
          {(ctx || data?.workspace === "sandbox" || (data?.query.understood.length ?? 0) > 0) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs sm:px-4">
              {ctx && (
                <div role="radiogroup" aria-label="Search where" className="inline-flex rounded-lg border border-line p-0.5">
                  {(["all", "project"] as const).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)} data-testid={`search-scope-${s}`}
                      className={cn("min-h-8 rounded-md px-2.5 font-semibold", scope === s ? "bg-brand text-white" : "text-ink-soft hover:bg-black/5")}>
                      {s === "all" ? "All company records" : "This project"}
                    </button>
                  ))}
                </div>
              )}
              {data?.workspace === "sandbox" && <Chip tone="warn"><FlaskConical className="h-3 w-3" aria-hidden />Practice book: Financials results are practice records</Chip>}
              {data?.query.understood.map((u) => <Chip key={u} tone="info">{u}</Chip>)}
            </div>
          )}
          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
            <p className="sr-only" aria-live="polite">{loading ? "Searching…" : error ? error : hasQuery && data ? (empty ? "No results" : `${total} results`) : ""}</p>
            {error && (
              <div className="m-2 rounded-lg border border-danger/30 bg-danger-tint p-3 text-sm text-danger" role="alert">
                {error} <button type="button" className="ml-1 font-semibold underline" onClick={() => run(q.trim(), scope)}>Try again</button>
              </div>
            )}
            {data && !data.available && <p className="m-2 rounded-lg bg-paper p-3 text-sm text-ink-soft">Search is being set up for your account. Actions still work.</p>}
            {!hasQuery && !recent && <p className="px-3 py-6 text-center text-sm text-muted">Loading…</p>}
            {!hasQuery && recent && !sections.length && <p className="px-3 py-6 text-center text-sm text-muted">Search for a customer, project, bid number, invoice, sub or SKU. Try “Johnson” or “new invoice”.</p>}
            {hasQuery && q.trim().length < 2 && null}
            {empty && (
              <div className="px-3 py-8 text-center" data-testid="search-empty">
                <p className="font-semibold text-ink">No matches for “{q.trim()}”</p>
                <p className="mt-1 text-sm text-ink-soft">Check the spelling, try a customer name, a number like 1042, or fewer words{scope === "project" ? ", or search all company records" : ""}.</p>
                {scope === "project" && <button type="button" onClick={() => setScope("all")} className="mt-3 min-h-10 rounded-lg border border-line px-3 text-sm font-semibold">Search all company records</button>}
              </div>
            )}
            {sections.map((s) => (
              <div key={s.id} role={s.id === "all" ? undefined : "group"} aria-labelledby={s.label ? `${uid}-g-${s.id}` : undefined} className="mb-1">
                {s.label && (
                  <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2">
                    <p id={`${uid}-g-${s.id}`} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                      {s.icon && <s.icon className="h-3.5 w-3.5" aria-hidden />}{s.label}{s.total ? <span className="font-semibold normal-case tracking-normal">({s.total}{s.total >= 300 ? "+" : ""})</span> : null}
                    </p>
                    {s.moreHref && <Link href={s.moreHref} onClick={() => setOpen(false)} className="shrink-0 text-xs font-semibold text-accent-ink underline" tabIndex={-1}>View all</Link>}
                  </div>
                )}
                {s.options.map((o) => {
                  n += 1;
                  const i = n; const on = i === idx;
                  const base = cn("flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left", on ? "bg-accent-tint/70 ring-1 ring-accent/40" : "hover:bg-paper");
                  if (o.kind === "all") return (
                    <div key={o.key} id={optId(i)} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} data-testid="search-view-all"
                      className={cn(base, "items-center justify-center border-t border-line font-semibold text-accent-ink")}>
                      View all results for “{q.trim()}” <ArrowRight className="h-4 w-4" aria-hidden />
                    </div>
                  );
                  if (o.kind === "query") return (
                    <div key={o.key} id={optId(i)} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className={cn(base, "items-center")}>
                      <History className="h-4 w-4 text-cool-gray" aria-hidden /><span className="text-sm">{o.query}</span>
                    </div>
                  );
                  if (o.kind === "action" && o.action) {
                    const a = o.action;
                    return (
                      <div key={o.key} id={optId(i)} role="option" aria-selected={on} aria-disabled={a.comingSoon || undefined} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} data-testid={`search-action-${a.id}`}
                        className={cn(base, "items-center", a.comingSoon && "cursor-default opacity-70")}>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-dark" aria-hidden><Zap className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 font-semibold">{a.label}{a.comingSoon && <Chip>Coming soon</Chip>}{a.sandbox && <Chip tone="warn">Practice book</Chip>}</span>
                          <span className="block text-xs text-ink-soft">Action · {a.hint}{a.reviewForm ? " · opens a form to review first" : ""}</span>
                        </span>
                      </div>
                    );
                  }
                  if (o.kind === "news") return (
                    <div key={o.key} id={optId(i)} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} data-testid="search-result-news" data-href={o.href} className={cn(base, "items-center")}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/5 text-ink-soft" aria-hidden><Newspaper className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold">{o.query}</span><span className="block text-xs text-ink-soft">Industry news · public article · {o.newsSubtitle}</span></span>
                    </div>
                  );
                  if (o.kind === "admin") return (
                    <div key={o.key} id={optId(i)} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} className={cn(base, "items-center")}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hold-tint text-hold-ink" aria-hidden><Shield className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block break-all font-semibold">{o.query}</span><span className="block text-xs text-ink-soft">Owner admin · Account</span></span>
                    </div>
                  );
                  const r = o.record!;
                  const Icon = KIND_ICON[r.kind];
                  return (
                    <div key={o.key} id={optId(i)} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => choose(o)} data-testid={`search-result-${r.kind}`} data-href={o.href} className={base}>
                      {o.kind === "recent" ? (
                        <>
                          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand" aria-hidden><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1"><span className="block font-semibold">{r.title}</span><span className="block text-xs text-ink-soft">{r.kindLabel}{r.subtitle ? ` · ${r.subtitle}` : ""}</span></span>
                        </>
                      ) : <ResultBody r={r} words={words} />}
                      {on && <CornerDownLeft className="mt-2 hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="hidden items-center justify-between gap-3 border-t border-line px-4 py-2 text-[11px] text-muted sm:flex">
            <span><kbd className="font-sans font-semibold">↑</kbd> <kbd className="font-sans font-semibold">↓</kbd> to move · <kbd className="font-sans font-semibold">Enter</kbd> to open · <kbd className="font-sans font-semibold">Esc</kbd> to close</span>
            {recent?.historyEnabled === false ? <span>Search history is off</span> : <Link href="/search?settings=1" onClick={() => setOpen(false)} className="underline">Search settings</Link>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
