"use client";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { closeCategory, exactCategory, filterCategories, resolveCategory, tidyCategory } from "@/lib/library/categories";

/**
 * Category picker: a dropdown of existing categories that filters as you type. Typing a name that isn't in
 * the list adds it as a new category; a case-only match ("labor") snaps to the existing "Labor", and a
 * likely duplicate ("Labour") gets a one-tap "Use Labor" suggestion.
 */
export function CategoryCombobox({ id, value, options, onChange, placeholder }: {
  id: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = tidyCategory(value);
  const exact = exactCategory(typed, options);
  const close = closeCategory(typed, options);
  const shown = useMemo(() => filterCategories(typed, options), [typed, options]);
  const canAdd = Boolean(typed) && !exact;
  // Rows: the matching categories, then "Add “…”" when the text is new.
  const rows: { kind: "option" | "add"; label: string }[] = [
    ...shown.map((label) => ({ kind: "option" as const, label })),
    ...(canAdd ? [{ kind: "add" as const, label: typed }] : []),
  ];

  const choose = (label: string) => { onChange(label); setOpen(false); setActive(-1); };
  const commit = () => { if (value !== resolveCategory(value, options)) onChange(resolveCategory(value, options)); };

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(e.key === "ArrowDown" ? 0 : rows.length - 1); return; }
      if (!rows.length) return;
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % rows.length : (a <= 0 ? rows.length - 1 : a - 1)));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && rows[active]) { e.preventDefault(); choose(rows[active].label); }
      else if (open) { e.preventDefault(); commit(); setOpen(false); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); setActive(-1); }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const optionId = (k: number) => `${listId}-o${k}`;
  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          className="field pr-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          value={value}
          maxLength={120}
          placeholder={placeholder}
          autoComplete="off"
          data-testid="category-combobox"
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => { commit(); setOpen(false); setActive(-1); }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Hide categories" : "Show categories"}
          className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
          onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); inputRef.current?.focus(); }}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        </button>
      </div>
      {open && rows.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Categories" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg">
          {rows.map((r, k) => {
            const selected = r.kind === "option" && r.label === exact;
            return (
              <li
                key={`${r.kind}:${r.label}`}
                id={optionId(k)}
                role="option"
                aria-selected={k === active}
                data-testid={r.kind === "add" ? "category-add" : "category-option"}
                className={`flex min-h-10 cursor-pointer items-center gap-2 px-3 py-1.5 ${k === active ? "bg-brand-tint" : "hover:bg-paper"} ${r.kind === "add" ? "border-t border-line font-semibold text-navy" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(k)}
                onClick={() => choose(r.label)}
              >
                {r.kind === "add" ? (
                  <><Plus className="h-4 w-4 shrink-0" aria-hidden /> Add “{r.label}” as a new category</>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    {r.label === close && <span className="shrink-0 text-xs text-muted">similar</span>}
                    {selected && <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {close && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-warn" data-testid="category-similar" aria-live="polite">
          You already have “{close}”.
          <button type="button" className="font-semibold text-navy underline" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(close)}>Use {close}</button>
          <span className="text-muted">or keep “{typed}” as a new category.</span>
        </p>
      )}
    </div>
  );
}
