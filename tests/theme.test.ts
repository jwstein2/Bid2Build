/**
 * Customer app Dark Mode: token contrast (WCAG AA), scoping (marketing, admin and documents stay as
 * they are), preference resolution, the no-flash boot scripts and the account save route.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_META_KEY, THEME_STORAGE_KEY, accountThemeScript, parseThemePref, resolveThemePref } from "@/lib/theme";

const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
const block = (selector: string) => {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`${selector} not found`);
  return css.slice(i, css.indexOf("}", i));
};
const tokensIn = (src: string) => Object.fromEntries([...src.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
const LIGHT = tokensIn(css.slice(css.indexOf("@theme"), css.indexOf("}", css.indexOf("@theme"))));
const DARK = { ...LIGHT, ...tokensIn(block('html[data-theme="dark"]:has(.app-theme)')) };
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("dark theme tokens", () => {
  const text: [string, string][] = [
    ["ink", "paper"], ["ink", "surface"], ["ink-soft", "paper"], ["ink-soft", "surface"],
    ["muted", "paper"], ["muted", "surface"], ["navy", "paper"], ["navy", "surface"],
    ["brand", "paper"], ["brand", "surface"], ["brand", "brand-tint"], ["navy", "brand-tint"], ["ink", "brand-tint"],
    ["accent-ink", "surface"], ["accent-ink", "paper"], ["accent-dark", "accent-tint"],
    ["ok", "surface"], ["ok", "ok-tint"], ["warn", "surface"], ["warn", "warn-tint"],
    ["danger", "surface"], ["danger", "danger-tint"], ["hold-ink", "hold-tint"], ["ink-soft", "idle-tint"],
  ];
  it.each(text)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(ratio(DARK[fg], DARK[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("focus ring and field borders are visible (3:1 non-text)", () => {
    for (const bg of ["paper", "surface"]) expect(ratio(DARK.focus, DARK[bg])).toBeGreaterThanOrEqual(3);
    expect(ratio(DARK.cyan, LIGHT.navy)).toBeGreaterThanOrEqual(3); // sidebar ring
  });

  it("bright and navy surfaces keep their light-mode text pairing", () => {
    const resets = css.match(/:is\(\.bg-navy, \.bg-accent, \.bg-accent-hover, \.bg-cyan, \.bg-teal\) \{ --color-navy: (#[0-9a-f]{6}); \}/);
    expect(resets?.[1]).toBe(LIGHT.navy);
    expect(ratio(LIGHT.navy, DARK.accent)).toBeGreaterThanOrEqual(4.5); // CTA labels on cyan
    const brandBtn = css.match(/\.bg-brand \{ --color-brand: (#[0-9a-f]{6}); \}/)![1];
    expect(ratio("#ffffff", brandBtn)).toBeGreaterThanOrEqual(4.5); // primary buttons
    for (const [cls, tok] of [["bg-ok", "ok"], ["bg-warn", "warn"], ["bg-danger", "danger"]]) {
      const v = css.match(new RegExp(`\\.${cls} \\{ --color-${tok}: (#[0-9a-f]{6}); \\}`))![1];
      expect(ratio("#ffffff", v)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the core brand primitives and every light value unchanged", () => {
    expect(DARK.cyan).toBe("#00c2e0");
    expect(DARK.teal).toBe("#14b8a6");
    expect(LIGHT.navy).toBe("#0b2d4d");
    expect(LIGHT.paper).toBe("#f5f8fb");
  });

  it("documents (.theme-light) restate exactly the light values", () => {
    const docs = tokensIn(block(".theme-light"));
    for (const [k, v] of Object.entries(docs)) if (k !== "black") expect([k, v]).toEqual([k, LIGHT[k]]);
    for (const k of Object.keys(DARK)) if (DARK[k] !== LIGHT[k] && k !== "black") expect(docs[k], k).toBe(LIGHT[k]);
  });

  it("dark tokens are scoped to customer app screens only", () => {
    // Every dark rule is gated on a mounted .app-theme screen; nothing applies to bare html[data-theme].
    const darkRules = [...css.matchAll(/^html\[data-theme="dark"\][^{]*\{/gm)].map((m) => m[0]);
    expect(darkRules.length).toBeGreaterThan(5);
    for (const r of darkRules) expect(r.includes(":has(.app-theme)") || /theme-icon-(sun|moon)/.test(r), r).toBe(true);
  });

  it("app shells opt in; documents opt out", () => {
    const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
    expect(read("src/app/(app)/layout.tsx")).toContain('className="app-theme');
    expect(read("src/components/builder/builder.tsx")).toContain('className="app-theme');
    expect(read("src/components/proposal/proposal-view.tsx")).toContain('className="theme-light');
    expect(read("src/components/schedule/report-view.tsx")).toContain('className="theme-light');
    for (const p of ["src/app/(marketing)/layout.tsx", "src/app/admin/layout.tsx", "src/app/sign/[token]/page.tsx", "src/app/updates/[token]/page.tsx"]) expect(read(p), p).not.toContain("app-theme");
  });
});

describe("theme preference", () => {
  it("parses only valid values", () => {
    expect(parseThemePref({ mode: "dark", at: 5 })).toEqual({ mode: "dark", at: 5 });
    expect(parseThemePref({ mode: "dark" })).toEqual({ mode: "dark", at: 0 });
    expect(parseThemePref({ mode: "sepia", at: 1 })).toBeNull();
    expect(parseThemePref("dark")).toBeNull();
    expect(parseThemePref(null)).toBeNull();
  });
  it("defaults to light and lets the newest choice win", () => {
    expect(resolveThemePref(null, null)).toEqual({ mode: "light", at: 0 });
    expect(resolveThemePref({ mode: "dark", at: 2 }, null).mode).toBe("dark");
    expect(resolveThemePref(null, { mode: "dark", at: 2 }).mode).toBe("dark");
    expect(resolveThemePref({ mode: "light", at: 1 }, { mode: "dark", at: 2 }).mode).toBe("dark");
    expect(resolveThemePref({ mode: "light", at: 3 }, { mode: "dark", at: 2 }).mode).toBe("light");
  });
});

/** Runs a boot script against a fake document + localStorage. */
function run(script: string, stored: string | null, attr: string | null = null, storageThrows = false) {
  const attrs: Record<string, string> = attr ? { "data-theme": attr } : {};
  const store: Record<string, string> = stored === null ? {} : { [THEME_STORAGE_KEY]: stored };
  const ctx = {
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, removeAttribute: (k: string) => { delete attrs[k]; } } },
    localStorage: {
      getItem: (k: string) => { if (storageThrows) throw new Error("blocked"); return store[k] ?? null; },
      setItem: (k: string, v: string) => { if (storageThrows) throw new Error("blocked"); store[k] = v; },
    },
  };
  runInNewContext(script, ctx);
  return { theme: attrs["data-theme"] ?? "light", stored: (() => { try { return JSON.parse(store[THEME_STORAGE_KEY] ?? "null"); } catch { return store[THEME_STORAGE_KEY]; } })() };
}

describe("no-flash boot scripts", () => {
  it("head script applies this device's dark choice; anything else stays light", () => {
    expect(run(THEME_BOOT_SCRIPT, JSON.stringify({ mode: "dark", at: 1 })).theme).toBe("dark");
    expect(run(THEME_BOOT_SCRIPT, JSON.stringify({ mode: "light", at: 1 })).theme).toBe("light");
    expect(run(THEME_BOOT_SCRIPT, null).theme).toBe("light");
    expect(run(THEME_BOOT_SCRIPT, "{not json").theme).toBe("light");
    expect(run(THEME_BOOT_SCRIPT, null, null, true).theme).toBe("light");
  });
  it("account script adopts a newer choice from another device and stores it here", () => {
    const r = run(accountThemeScript({ mode: "dark", at: 10 }), JSON.stringify({ mode: "light", at: 5 }));
    expect(r).toEqual({ theme: "dark", stored: { mode: "dark", at: 10 } });
    expect(run(accountThemeScript({ mode: "dark", at: 10 }), null).theme).toBe("dark");
    expect(run(accountThemeScript({ mode: "light", at: 10 }), JSON.stringify({ mode: "dark", at: 5 }), "dark").theme).toBe("light");
    expect(run(accountThemeScript({ mode: "dark", at: 10 }), null, null, true).theme).toBe("dark"); // storage blocked
  });
  it("account script keeps a newer choice made on this device", () => {
    expect(run(accountThemeScript({ mode: "dark", at: 5 }), JSON.stringify({ mode: "light", at: 9 })).theme).toBe("light");
  });
  it("account script can't be broken out of by stored values", () => {
    expect(accountThemeScript({ mode: "dark", at: 1 })).not.toContain("</script");
  });
});

// ---- /api/theme ----
const S = { user: null as null | { id: string; user_metadata: Record<string, unknown> }, updates: [] as Record<string, unknown>[], updateError: null as null | { message: string } };
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: S.user }, error: null }),
    updateUser: async ({ data }: { data: Record<string, unknown> }) => {
      S.updates.push(data);
      if (!S.updateError && S.user) S.user.user_metadata = { ...S.user.user_metadata, ...data };
      return { error: S.updateError };
    },
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));
vi.mock("@/lib/env", async (orig) => ({ ...(await orig<typeof import("@/lib/env")>()), isSupabaseConfigured: () => true }));
vi.mock("@/lib/http/api", async (orig) => ({ ...(await orig<typeof import("@/lib/http/api")>()), sameOrigin: async () => true }));
const { POST } = await import("@/app/api/theme/route");
const post = (body: unknown) => POST(new Request("http://localhost/api/theme", { method: "POST", body: JSON.stringify(body) }));

describe("/api/theme", () => {
  beforeEach(() => { S.user = { id: "u1", user_metadata: { full_name: "Pat" } }; S.updates = []; S.updateError = null; });
  it("requires sign-in", async () => {
    S.user = null;
    expect((await post({ mode: "dark", at: 1 })).status).toBe(401);
  });
  it("saves to the account profile without touching other metadata", async () => {
    const res = await post({ mode: "dark", at: 100 });
    expect(res.status).toBe(200);
    expect(S.user!.user_metadata[THEME_META_KEY]).toEqual({ mode: "dark", at: 100 });
    expect(S.user!.user_metadata.full_name).toBe("Pat");
  });
  it("ignores an older save so a slow device can't undo a newer choice", async () => {
    S.user!.user_metadata[THEME_META_KEY] = { mode: "dark", at: 200 };
    const j = await (await post({ mode: "light", at: 100 })).json();
    expect(j).toMatchObject({ stale: true, theme: { mode: "dark", at: 200 } });
    expect(S.updates).toHaveLength(0);
  });
  it("rejects anything else", async () => {
    for (const b of [{ mode: "sepia", at: 1 }, { mode: "dark" }, { mode: "dark", at: -1 }, "dark"]) expect((await post(b)).status).toBe(400);
  });
  it("reports a failed save", async () => {
    S.updateError = { message: "down" };
    expect((await post({ mode: "dark", at: 1 })).status).toBe(500);
  });
});
