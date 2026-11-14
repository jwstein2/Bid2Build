"use client";
import { useEffect, useState } from "react";

/**
 * How much of the layout viewport the on-screen keyboard covers (`inset`, px from the bottom) and
 * the visible height. iOS Safari and Chrome on Android shrink only the visual viewport when the
 * keyboard opens, so anything pinned with `bottom: 0` would otherwise sit behind the keyboard.
 * Returns null until measured, or when the browser has no visualViewport.
 */
export function useVisualViewport(active = true) {
  const [vv, setVv] = useState<{ inset: number; height: number } | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !v) return;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop));
      const height = Math.round(v.height);
      setVv((cur) => (cur && cur.inset === inset && cur.height === height ? cur : { inset, height }));
    };
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => { v.removeEventListener("resize", update); v.removeEventListener("scroll", update); };
  }, [active]);
  return vv;
}
