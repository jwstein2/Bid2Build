"use client";
import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { familyTint, TradeIcon } from "../trade-icon";

export interface PickerTrade { slug: string; name: string; icon: string; family: string; featured?: boolean; blurb: string }

/** `guides={false}` (the in-app Create New Bid page) hides the links to the public trade guide pages. */
export function TradePicker({ trades, guides = true }: { trades: PickerTrade[]; guides?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const searchId = useId();
  const featured = useMemo(() => {
    const f = trades.filter((t) => t.featured && t.slug !== "other").slice(0, 11);
    const other = trades.find((t) => t.slug === "other");
    return other ? [...f, other] : f;
  }, [trades]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return trades.filter((t) => !s || t.name.toLowerCase().includes(s) || t.family.toLowerCase().includes(s) || t.blurb.toLowerCase().includes(s));
  }, [q, trades]);
  const families = Array.from(new Set(filtered.map((t) => t.family)));

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {featured.map((t) => (
          <li key={t.slug}>
            <Link
              href={`/start/${t.slug}`}
              className="group flex h-full min-h-14 items-center gap-2 rounded-xl sm:gap-3 border border-line bg-surface p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md sm:p-4"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg sm:h-11 sm:w-11 ${familyTint[t.family]}`}>
                <TradeIcon name={t.icon} className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block hyphens-auto font-display font-bold leading-tight text-ink [overflow-wrap:anywhere] group-hover:text-brand">{t.name}</span>
                <span className="mt-0.5 hidden text-xs text-muted sm:block">{t.slug === "other" ? "Start a custom bid" : `Start a bid for ${tradePhrase(t.name)}`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-5 text-center">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="trade-directory"
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-soft hover:text-ink"
        >
          Browse all {trades.length} trades <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div id="trade-directory" className="mt-5 rounded-2xl border border-line bg-surface p-4 text-left sm:p-6">
          <label htmlFor={searchId} className="sr-only">Search trades</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input id={searchId} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trades: fencing, tile, HVAC…" className="field pl-9" />
          </div>
          {filtered.length === 0 && (
            <p className="mt-4 text-sm text-muted">
              No match. <Link href="/start/other" className="font-semibold text-brand underline">Start a custom project</Link> instead.
            </p>
          )}
          <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {families.map((f) => (
              <div key={f}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{f}</h3>
                <ul className="mt-2 space-y-1">
                  {filtered.filter((t) => t.family === f).map((t) => (
                    <li key={t.slug} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-paper">
                      <Link href={`/start/${t.slug}`} className="flex items-center gap-2 text-sm font-medium text-ink hover:text-brand">
                        <TradeIcon name={t.icon} className="h-4 w-4 text-muted" /> {t.name}
                      </Link>
                      {guides && <Link href={`/bids/${t.slug}`} className="text-xs text-muted hover:text-brand">Guide</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Decks & Porches" → "decks & porches", but acronyms stay as written ("HVAC"). Reads correctly after "a bid for". */
export function tradePhrase(name: string): string {
  return name.split(" ").map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(" ");
}
