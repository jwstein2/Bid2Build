import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Motion system guard rails (globals.css): one set of short durations, opacity/transform only, and
// nothing that leaves a transform behind or ignores reduced motion.
const css = fs.readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");

describe("motion tokens", () => {
  it("defines three short durations (nothing over 300ms)", () => {
    for (const name of ["fast", "base", "slow"]) {
      const ms = Number(css.match(new RegExp(`--motion-${name}:\\s*(\\d+)ms`))?.[1]);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(300);
    }
  });

  it("motion utilities use the tokens and animate only opacity and transform", () => {
    const utilities = [...css.matchAll(/@utility (motion-[\w-]+) \{ animation: (b2b-[\w-]+) var\(--motion-(fast|base|slow)\) var\(--ease-brand-out\) (\w+); \}/g)];
    expect(utilities.map((u) => u[1]).sort()).toEqual(["motion-drop-in", "motion-fade", "motion-reveal"]);
    for (const [, , keyframes] of utilities) {
      const body = css.match(new RegExp(`@keyframes ${keyframes} \\{([^@]*?)\\} \\}`))?.[1] ?? "";
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) expect(["opacity", "transform"]).toContain(p);
    }
  });

  it("motion utilities don't keep a transform after they finish", () => {
    // fill-mode `both`/`forwards` would leave a transform applied, turning the panel into the
    // containing block for fixed children (calculator sheet, bottom toolbar).
    for (const m of css.matchAll(/@utility motion-[\w-]+ \{ animation: [^}]* (\w+); \}/g)) expect(m[1]).toBe("backwards");
  });

  it("keeps the global reduced-motion rule", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important; transition-duration: 0\.01ms !important/);
  });
});
