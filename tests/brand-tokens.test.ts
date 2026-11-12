import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** WCAG 2.2 contrast checks for every text/background pair the design system uses. */
const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1];
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("brand tokens", () => {
  it("keeps the approved core palette", () => {
    expect(token("navy").toLowerCase()).toBe("#0b2d4d");
    expect(token("cyan").toLowerCase()).toBe("#00c2e0");
    expect(token("teal").toLowerCase()).toBe("#14b8a6");
    expect(token("cool-gray").toLowerCase()).toBe("#6b7a89");
  });

  // [foreground, background, minimum]
  const normalText: [string, string][] = [
    ["ink", "paper"], ["ink", "surface"], ["ink-soft", "paper"], ["ink-soft", "surface"],
    ["muted", "paper"], ["muted", "surface"], ["navy", "surface"], ["navy", "paper"],
    ["navy", "accent"], ["navy", "accent-hover"], // CTA labels on cyan
    ["accent-ink", "surface"], ["accent-ink", "paper"], ["accent-dark", "accent-tint"],
    ["ok", "surface"], ["ok", "ok-tint"], ["warn", "surface"], ["warn", "warn-tint"],
    ["danger", "surface"], ["danger", "danger-tint"], ["brand", "brand-tint"],
    ["surface", "navy"], ["cyan", "navy"], ["teal", "navy"],
  ];
  it.each(normalText)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("focus ring meets 3:1 non-text contrast on light and dark surfaces", () => {
    expect(ratio(token("focus"), token("surface"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("focus"), token("paper"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("cyan"), token("navy"))).toBeGreaterThanOrEqual(3);
  });

  it("never pairs white text with cyan (fails AA)", () => {
    expect(ratio(token("surface"), token("accent"))).toBeLessThan(4.5);
    const button = readFileSync(join(__dirname, "../src/components/ui/button.tsx"), "utf8");
    expect(button).toMatch(/accent: "bg-accent text-navy/);
  });
});
