"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pageType, track } from "@/lib/analytics/track";
import { cleanFrom } from "@/lib/analytics/from";

/**
 * V8 funnel signals for GA4 (owner decision 2026-11-18: GA on, disclosed, opt-out on /privacy):
 * - cta_clicked {cta, page_type} for any element marked data-cta (hero, plan band, pillars, pricing).
 * - pricing_viewed once per browser session.
 * Sends only the CTA's own label key, a coarse page family and any ?from= label. Never text the person typed.
 */
export function FunnelTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-cta]");
      const cta = el?.getAttribute("data-cta");
      if (cta && /^[\w-]{1,40}$/.test(cta)) track("cta_clicked", { cta, page_type: pageType(location.pathname), from: cleanFrom(new URLSearchParams(location.search).get("from")) });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  useEffect(() => {
    if (pageType(pathname) !== "pricing") return;
    try { if (sessionStorage.getItem("b2b:pv")) return; sessionStorage.setItem("b2b:pv", "1"); } catch { /* storage blocked: still send */ }
    const t = setTimeout(() => track("pricing_viewed", { page_type: "pricing" }), 1500);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}
