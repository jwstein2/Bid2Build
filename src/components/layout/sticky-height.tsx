"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Keeps a CSS variable on <html> equal to an element's rendered height, so other sticky pieces can sit
 * just below it. Only writes while `media` matches, so the phone bar and the desktop bar can share one
 * variable name. Cleared on unmount.
 */
export function useCssHeightVar(ref: RefObject<HTMLElement | null>, cssVar: string, media?: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement.style;
    const mq = media ? window.matchMedia(media) : null;
    const write = () => { if (!mq || mq.matches) root.setProperty(cssVar, `${Math.round(el.getBoundingClientRect().height)}px`); };
    const ro = new ResizeObserver(write);
    ro.observe(el);
    mq?.addEventListener("change", write);
    write();
    return () => { ro.disconnect(); mq?.removeEventListener("change", write); if (!mq || mq.matches) root.removeProperty(cssVar); };
  }, [ref, cssVar, media]);
}

/** A sticky bar (div or aside) that publishes its height as `cssVar` (see useCssHeightVar). */
export function StickyBar({ as = "div", cssVar, media, className, children, "data-testid": testId }: { as?: "div" | "aside"; cssVar: string; media?: string; className?: string; children: ReactNode; "data-testid"?: string }) {
  const ref = useRef<HTMLElement>(null);
  useCssHeightVar(ref, cssVar, media);
  const Tag = as;
  return <Tag ref={ref as RefObject<HTMLDivElement>} className={className} data-testid={testId}>{children}</Tag>;
}
