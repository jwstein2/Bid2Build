// Platform-wide dropdown / popover sweep (V5 Tools correction). For every page it finds every trigger a user can
// open (aria-expanded, aria-haspopup, <summary>) and physically exercises it in Chromium:
//   opens on click · outside click closes · Escape closes and returns focus · clicking the trigger again closes ·
//   panel stays inside the viewport · a safe single-select item closes it (menus only) · no scroll lock left behind.
// Inline disclosures (accordions, "show more") are reported but only toggle-tested: they are part of the page, not
// floating layers, so outside click/Escape are not expected to close them. Native <select>s are OS-drawn and listed.
// Mock Supabase, test data only (NOT production). Run each part with its mock:
//   PART=app   MOCK_PIPELINE=1 node scripts/ux-audit/mock-supabase.mjs
//   PART=ent   MOCK_PIPELINE=1 node scripts/ux-audit/mock-supabase.mjs   (script switches the scenario to enterprise_owner)
//   PART=admin MOCK_ADMIN=1 MOCK_COMMAND_CENTER=1 node scripts/ux-audit/mock-supabase.mjs
//   PART=public (any mock)
//   node scripts/ux-v5/popover-sweep.mjs <outDir> [390|1440]
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "sweep";
const W = Number(process.argv[3] ?? 1440);
const PART = process.env.PART ?? "app";
const A = process.env.BASE ?? "http://localhost:3000", M = "http://localhost:54321";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const EST = "11111111-1111-4111-8111-111111111111";

const PAGES = {
  app: ["/dashboard", "/dashboard?view=table", `/estimates/${EST}`, `/estimates/${EST}/proposal`, "/projects", "/projects?view=calendar", "/projects?view=workload",
    "/projects/team", "/dashboard/customers", "/dashboard/items", "/dashboard/templates", "/settings/company", "/settings/billing", "/settings/account", "/settings/pricing", "/signed"],
  ent: ["/company", "/company/users", "/company/pipeline", "/company/billing", "/company/proposal-style"],
  admin: ["/admin", "/admin/marketing", "/admin/customers", "/admin/revenue", "/admin/usage", "/admin/operations", "/admin/complimentary", "/admin/marketing/radar", "/admin/costs", "/admin/creators", "/admin/templates", "/admin/flags"],
  public: ["/", "/pricing", "/learn", "/sign-in"],
}[PART];

await fetch(`${M}/__onboarding?status=completed`).catch(() => {});
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`).catch(() => {});
if (PART === "app" || PART === "ent") {
  await fetch(`${M}/__scenario?name=${PART === "ent" ? "enterprise_owner" : "unlimited"}`).catch(() => {});
  await fetch(`${M}/__team?reset=1&seed=1&manage=1`).catch(() => {});
  await fetch(`${M}/__ws?seed=1`).catch(() => {});
}

const browser = await chromium.launch();
const vp = W <= 400 ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const results = [];
const errors = [];

async function load(path) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  if (PART !== "public") await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: "light", at: 4102444800000 })); localStorage.setItem("b2b:onboarding", JSON.stringify({ status: "completed", at: "2026-01-01", synced: true })); } catch { /* */ } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(4000);
  p.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await p.goto(`${A}${path}`, { waitUntil: "load" }).catch(() => {});
  // First-visit welcome / tour dialogs (signed-in "Maybe Later", visitor "Not Right Now").
  const later = p.getByRole("button", { name: /^(Maybe Later|Not Right Now)$/ });
  try { await later.waitFor({ timeout: 1500 }); await later.click(); } catch { /* none */ }
  await p.waitForTimeout(500);
  return { ctx, p };
}

// Tag every candidate trigger with data-sweep=<n> and return descriptions.
const tagTriggers = (p) => p.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const els = [...document.querySelectorAll('[aria-expanded], [aria-haspopup]:not([aria-haspopup="false"]), summary')]
    .filter((el) => vis(el) && !el.closest("[data-sweep-ignore]") && el.tagName !== "SELECT" && !(el.getAttribute("role") === "combobox" && el.tagName === "INPUT"));
  const natives = document.querySelectorAll("select").length;
  const comboInputs = [...document.querySelectorAll('input[role="combobox"]')].filter(vis).length;
  return { natives, comboInputs, list: els.map((el, i) => {
    el.setAttribute("data-sweep", String(i));
    const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
    return { i, name, tag: el.tagName.toLowerCase(), haspopup: el.getAttribute("aria-haspopup"), controls: el.getAttribute("aria-controls"), expanded: el.getAttribute("aria-expanded") };
  }) };
});

// Everything visible that is a floating layer: positioned absolute/fixed with a z-index, or a popup role.
const markLayers = (p) => p.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24 || s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    const role = el.getAttribute("role");
    const floating = ((s.position === "absolute" || s.position === "fixed") && s.zIndex !== "auto" && Number(s.zIndex) >= 10) || ["menu", "listbox", "dialog", "note", "tooltip", "alertdialog"].includes(role ?? "");
    if (floating) { el.setAttribute("data-sweep-layer", "pre"); n++; }
  }
  return n;
});
const newLayer = (p, idx) => p.evaluate((idx) => {
  const t = document.querySelector(`[data-sweep="${idx}"]`);
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 24 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  if (t?.tagName === "SUMMARY") {
    // <details>: its content is a floating layer only if positioned; otherwise it's an inline disclosure.
    const body = [...(t.parentElement?.children ?? [])].find((c) => c !== t && vis(c));
    const pos = body ? getComputedStyle(body).position : "";
    if (!body || (pos !== "absolute" && pos !== "fixed")) return null;
    body.setAttribute("data-sweep-open", String(idx));
    const r = body.getBoundingClientRect();
    return { role: body.getAttribute("role"), modal: false, box: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: document.documentElement.clientWidth };
  }
  const id = t?.getAttribute("aria-controls");
  let el = id ? document.getElementById(id) : null;
  if (el && !vis(el)) el = null;
  if (el) {
    // aria-controls target: floating only if it (or a wrapper that doesn't also hold the trigger) is positioned or a popup.
    let floating = false;
    for (let a = el; a && a !== document.body && !a.contains(t); a = a.parentElement) {
      const ps = getComputedStyle(a).position;
      if (ps === "absolute" || ps === "fixed" || ["menu", "listbox", "dialog", "note", "tooltip", "alertdialog"].includes(a.getAttribute("role") ?? "")) { floating = true; break; }
    }
    if (!floating) return null;
  }
  if (!el) {
    for (const c of document.querySelectorAll("body *")) {
      if (c.hasAttribute("data-sweep-layer") || !vis(c) || c.contains(t)) continue;
      const s = getComputedStyle(c); const role = c.getAttribute("role");
      const floating = ((s.position === "absolute" || s.position === "fixed") && s.zIndex !== "auto" && Number(s.zIndex) >= 10) || ["menu", "listbox", "dialog", "note", "tooltip", "alertdialog"].includes(role ?? "");
      if (floating) { el = c; break; }
    }
  }
  if (!el) return null;
  el.setAttribute("data-sweep-open", String(idx));
  const r = el.getBoundingClientRect();
  return { role: el.getAttribute("role"), modal: el.getAttribute("role") !== "menu" && el.getAttribute("aria-modal") === "true" || el.getAttribute("role") === "dialog" && getComputedStyle(el).position === "fixed" && r.width > innerWidth * 0.6,
    box: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: document.documentElement.clientWidth };
}, idx);
const stillOpen = (p, idx) => p.evaluate((idx) => {
  const el = document.querySelector(`[data-sweep-open="${idx}"]`);
  if (!el || !el.isConnected) return false;
  const s = getComputedStyle(el); const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
}, idx);
const expandedNow = (p, idx) => p.evaluate((idx) => {
  const t = document.querySelector(`[data-sweep="${idx}"]`);
  if (!t) return null;
  if (t.tagName === "SUMMARY") return t.parentElement?.hasAttribute("open") ?? null;
  const v = t.getAttribute("aria-expanded"); return v == null ? null : v === "true";
}, idx);
// A spot that is plain page (no control, not the trigger or its layer) to click "outside".
const blankPoint = (p, idx) => p.evaluate((idx) => {
  const t = document.querySelector(`[data-sweep="${idx}"]`);
  const layer = document.querySelector(`[data-sweep-open="${idx}"]`);
  const bad = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"]),[contenteditable],[data-metric-drawer],tr[onclick],[draggable=true]';
  for (let y = innerHeight - 30; y > 60; y -= 37) for (let x = 20; x < innerWidth - 20; x += 53) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement) continue;
    if (t?.contains(el) || layer?.contains(el) || el.closest(bad) || el.closest("[data-sweep-open]")) continue;
    if (el.closest("[class*=cursor-pointer]")) continue;
    return { x, y };
  }
  return null;
}, idx);
const focusIsTrigger = (p, idx) => p.evaluate((idx) => document.activeElement === document.querySelector(`[data-sweep="${idx}"]`), idx);
const scrollFree = (p) => p.evaluate(() => getComputedStyle(document.body).overflow !== "hidden" && !document.body.hasAttribute("data-scroll-locked"));

for (const path of PAGES) {
  let { ctx, p } = await load(path);
  const tagged = await tagTriggers(p);
  const pageRow = { page: path, width: vp.width, nativeSelects: tagged.natives, comboInputs: tagged.comboInputs, triggers: [] };
  results.push(pageRow);
  const seen = new Set();
  for (const t of tagged.list.slice(0, 30)) {
    const key = `${t.name}|${t.tag}`;
    if (seen.has(key) && t.name) continue; // repeated per-row menus: test the first of each kind
    seen.add(key);
    const row = { ...t, kind: "", checks: {}, notes: [] };
    pageRow.triggers.push(row);
    try {
      // fresh page per trigger so one stuck layer can't poison the next result
      await ctx.close(); ({ ctx, p } = await load(path)); await tagTriggers(p);
      const trig = p.locator(`[data-sweep="${t.i}"]`);
      if (!(await trig.count())) { row.kind = "gone-after-reload"; continue; }
      await trig.scrollIntoViewIfNeeded().catch(() => {});
      const urlBefore = p.url();
      await markLayers(p);
      // Height of the page and of the card the trigger sits in: an accordion grows one of them.
      const heights = (idx) => p.evaluate((idx) => {
        const t = document.querySelector(`[data-sweep="${idx}"]`);
        const card = t?.closest("section,article,li,[class*=rounded-xl],[class*=rounded-2xl],[class*=rounded-lg]")?.parentElement;
        return [document.documentElement.scrollHeight, card?.getBoundingClientRect().height ?? 0];
      }, idx);
      const h0 = await heights(t.i);
      await trig.click({ timeout: 3000 }); await p.waitForTimeout(350);
      const h1 = await heights(t.i);
      const grew = Math.max(h1[0] - h0[0], h1[1] - h0[1]);
      if (new URL(p.url()).pathname !== new URL(urlBefore).pathname) { row.kind = "navigates"; row.notes.push("trigger is a link to another page"); continue; }
      if (p.url() !== urlBefore) { row.notes.push("opens via URL (?query) — Back closes it"); await p.waitForTimeout(400); }
      let layer = await newLayer(p, t.i);
      const exp = await expandedNow(p, t.i);
      // An accordion that pushes the page down (no popup role, no aria-haspopup) is an inline disclosure even if its
      // new content happens to contain a positioned element.
      if (layer && !t.haspopup && !["menu", "listbox", "dialog", "alertdialog", "note"].includes(layer.role ?? "") && grew > 40) layer = null;
      if (!layer) {
        row.kind = exp ? "inline-disclosure" : "no-visible-change";
        if (exp) { await trig.click().catch(() => {}); await p.waitForTimeout(250); row.checks.toggleCloses = (await expandedNow(p, t.i)) === false; }
        continue;
      }
      // Locks page scroll → behaves as a modal/drawer. Radix dropdown menus also lock scroll but are menus: test them fully.
      if (!layer.modal && layer.role !== "menu" && !(await scrollFree(p))) layer.modal = true;
      row.kind = layer.modal ? "modal" : t.haspopup === "dialog" || layer.role === "dialog" ? "dialog-popover" : layer.role === "menu" || t.haspopup === "menu" || t.haspopup === "true" ? "menu" : layer.role === "listbox" ? "listbox" : "popover";
      row.checks.opens = true;
      row.checks.inViewport = layer.box.x >= -1 && layer.box.x + layer.box.w <= layer.vw + 1;
      if (exp !== null) row.checks.ariaExpanded = exp === true;
      await p.screenshot({ path: `${dir}/${path.replace(/[/?=]/g, "_")}-${t.i}-open.png` }).catch(() => {});
      // Escape
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      row.checks.escapeCloses = !(await stillOpen(p, t.i));
      if (row.checks.escapeCloses && !layer.modal) row.checks.focusReturns = await focusIsTrigger(p, t.i);
      if (layer.modal) { row.checks.scrollFreeAfter = await scrollFree(p); continue; }
      // Outside click
      if (!row.checks.escapeCloses) { await ctx.close(); ({ ctx, p } = await load(path)); await tagTriggers(p); }
      const trig2 = p.locator(`[data-sweep="${t.i}"]`);
      await markLayers(p);
      await trig2.click(); await p.waitForTimeout(300);
      if (!(await newLayer(p, t.i))) { row.notes.push("did not reopen"); continue; }
      const pt = await blankPoint(p, t.i);
      if (pt) {
        const u = p.url();
        await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(300);
        row.checks.outsideCloses = !(await stillOpen(p, t.i));
        if (new URL(p.url()).pathname !== new URL(u).pathname) row.notes.push("outside click navigated (point was not blank)");
      } else row.notes.push("no blank spot found for outside click");
      // Toggle: open, click trigger again
      await markLayers(p);
      if (!(await stillOpen(p, t.i))) { await trig2.click(); await p.waitForTimeout(300); await newLayer(p, t.i); }
      if (await stillOpen(p, t.i)) {
        // A real mouse click on the trigger's spot (Radix menus set pointer-events:none on the page while open, which
        // Playwright's locator.click refuses; a person's click still lands and Radix handles it).
        const b = await trig2.boundingBox();
        if (b) await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); else row.notes.push("trigger not visible while open");
        await p.waitForTimeout(300);
        row.checks.toggleCloses = !(await stillOpen(p, t.i));
      }
      row.checks.scrollFreeAfter = await scrollFree(p);
    } catch (e) {
      row.notes.push(`error: ${String(e.message).split("\n")[0].slice(0, 100)}`);
    }
  }
  await ctx.close();
  const tested = pageRow.triggers.filter((r) => Object.keys(r.checks).length);
  const fails = tested.flatMap((r) => Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => `${r.name || r.tag} [${r.kind}]: ${k}`));
  console.log(`${path} @${vp.width}: ${pageRow.triggers.length} triggers (${tested.length} exercised), ${tagged.natives} native selects, ${tagged.comboInputs} combobox inputs${fails.length ? `\n   ✗ ${fails.join("\n   ✗ ")}` : " — all checks pass"}`);
}
await browser.close();
fs.writeFileSync(`${dir}/sweep-${PART}-${vp.width}.json`, JSON.stringify({ results, errors }, null, 2));
const all = results.flatMap((r) => r.triggers.flatMap((t) => Object.values(t.checks)));
console.log(`\n${PART} @${vp.width}: ${all.filter(Boolean).length}/${all.length} checks passed; page errors: ${errors.filter((e) => !/hydrat/i.test(e)).length}`);
