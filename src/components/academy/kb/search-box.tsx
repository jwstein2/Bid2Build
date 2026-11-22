"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { BookOpen, Loader2, Search, X } from "lucide-react";
import { suggest, type Suggestion } from "@/lib/academy/kb/autocomplete";
import { TOPIC_SHORTCUTS } from "@/lib/academy/kb/examples";

const input = "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm";
let sectionsCache: Promise<[string, string][]> | null = null;
/** Federal section headings for the autocomplete (static file, fetched once on first focus; empty on failure). */
const loadSections = () => (sectionsCache ??= fetch("/academy-codes/federal-sections.json")
  .then((r) => (r.ok ? r.json() : { sections: [] }))
  .then((d: { sections?: [string, string][] }) => (Array.isArray(d.sections) ? d.sections : []))
  .catch(() => { sectionsCache = null; return []; }));

/**
 * The main code search box. It stays in step with the URL (the page remounts it per query, so a stale question never
 * lingers and the back button restores the last search), shows a quiet "Searching…" state while results load, has a
 * clear button, and suggests topics and federal section numbers as you type (citation-aware).
 */
export function SearchBox({ q, hidden, children }: { q: string; hidden: Record<string, string | null>; children?: ReactNode }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [pending, start] = useTransition();
  const [sections, setSections] = useState<[string, string][]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const list = open ? suggest(value, TOPIC_SHORTCUTS, sections) : [];
  const go = (params: URLSearchParams) => start(() => router.push(`/academy/codes${params.size ? `?${params}` : ""}`));
  const submitWith = (v: string) => {
    const params = new URLSearchParams();
    if (formRef.current) new FormData(formRef.current).forEach((x, k) => { if (typeof x === "string" && x.trim()) params.set(k, x.trim()); });
    if (v.trim()) params.set("q", v.trim()); else params.delete("q");
    setOpen(false);
    go(params);
  };
  const pick = (s: Suggestion) => { setValue(s.value); submitWith(s.value); };

  return (
    <form
      ref={formRef}
      action="/academy/codes"
      role="search"
      className="mt-4"
      onSubmit={(e) => { e.preventDefault(); submitWith(value); }}
    >
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <label htmlFor="kb-q" className="sr-only">Ask a construction code question or enter a code section</label>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
          <input id="kb-q" name="q" value={value} maxLength={300} autoComplete="off" enterKeyHint="search"
            role="combobox" aria-expanded={list.length > 0} aria-controls={`${uid}-list`} aria-autocomplete="list"
            aria-activedescendant={active >= 0 && list[active] ? `${uid}-o${active}` : undefined}
            onChange={(e) => { setValue(e.target.value); setOpen(true); setActive(-1); }}
            onFocus={() => { loadSections().then(setSections); }}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (!list.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % list.length); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? list.length - 1 : i - 1)); }
              else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(list[active]); }
              else if (e.key === "Escape") { setOpen(false); setActive(-1); }
            }}
            placeholder="Ask a construction code question or enter a code section..." className={`${input} min-h-12 py-3 pr-10 pl-10 text-base`} data-testid="kb-q" />
          {value && (
            <button type="button" aria-label="Clear search" data-testid="kb-clear"
              onClick={() => {
                setValue("");
                setOpen(false);
                if (q) { const p = new URLSearchParams(); Object.entries(hidden).forEach(([k, v]) => { if (v) p.set(k, v); }); go(p); }
              }}
              className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-paper hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
          {list.length > 0 && (
            <ul id={`${uid}-list`} role="listbox" aria-label="Suggestions" data-testid="kb-suggest"
              className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-auto rounded-md border border-line bg-surface py-1 text-sm shadow-card">
              {list.map((s, i) => (
                <li key={s.value} id={`${uid}-o${i}`} role="option" aria-selected={i === active} data-testid="kb-suggest-option"
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 ${i === active ? "bg-paper" : ""}`}>
                  {s.kind === "section" ? <BookOpen className="h-4 w-4 shrink-0 text-muted" aria-hidden /> : <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
                  <span className="min-w-0 truncate">{s.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" disabled={pending} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-navy px-6 text-sm font-semibold text-white disabled:opacity-80" data-testid="kb-search">
          {pending ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Searching…</> : "Search"}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">{pending ? "Searching" : list.length ? `${list.length} suggestions` : ""}</p>
      {children}
    </form>
  );
}
