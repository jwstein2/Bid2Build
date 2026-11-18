"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Deep links from search end in "#r-<record id>". Pages render their rows on their own schedule (many load in the
 * browser), so this waits up to 6 seconds for the row, scrolls it into view and highlights it briefly. A row is
 * found by id="r-<id>", data-search-id="<id>", or an existing test id ending in the record id (e.g. Gantt rows).
 */
export function SearchFocus() {
  const path = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const m = window.location.hash.match(/^#r-([0-9a-f-]{36})$/i);
    if (!m) return;
    const id = m[1];
    const find = () => document.getElementById(`r-${id}`) ?? document.querySelector<HTMLElement>(`[data-search-id="${id}"], [data-testid$="${id}"]`);
    let done = false;
    const show = (el: HTMLElement) => {
      done = true;
      // Rows inside collapsed sections (e.g. a Saved Items category) are revealed first.
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el.classList.add("search-target");
      if (!el.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      window.setTimeout(() => el.classList.remove("search-target"), 4000);
    };
    const first = find();
    if (first) { show(first); return; }
    const obs = new MutationObserver(() => { const el = find(); if (el && !done) { obs.disconnect(); show(el); } });
    obs.observe(document.body, { childList: true, subtree: true });
    const t = window.setTimeout(() => obs.disconnect(), 6000);
    return () => { obs.disconnect(); window.clearTimeout(t); };
  }, [path, sp]);
  return null;
}
