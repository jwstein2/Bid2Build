// QA audit crawler: for one role, opens every route, inventories every interactive element and exercises it in a
// real browser (click buttons/tabs/toggles, follow links, fill fields, pick options). Local stack only.
// Usage: ROLE=free ROUTES=/dashboard,/estimates/<id> node scripts/qa-audit/crawl.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, contextFor, statePath, watch, BASE, OUT, closeDb } from "./lib.mjs";

const ROLE = process.env.ROLE ?? "anon";
const MOBILE = process.env.MOBILE === "1";
const ROUTES = (process.env.ROUTES ?? "/").split(",").filter(Boolean);
const MAX_CLICKS = Number(process.env.MAX_CLICKS ?? 45);
const CLICK = process.env.CLICK !== "0";
const LOADONLY = new Set((process.env.LOADONLY ?? "").split(",").filter(Boolean));
const seenFinal = new Set();
const tag = `${ROLE}${MOBILE ? "-mobile" : ""}${process.env.QA_CRAWL_PART ? `-${process.env.QA_CRAWL_PART}` : ""}`;
const outFile = path.join(OUT, `crawl-${tag}.json`);
// Never clicked by the generic pass (session-ending); covered by dedicated workflow tests instead.
const SKIP = /^(sign out|log out|exit demo|delete (my|your) account|reset demo)/i;

const browser = await chromium.launch();
const ctx = await contextFor(browser, ROLE, { mobile: MOBILE });
const report = { role: ROLE, mobile: MOBILE, base: BASE, startedAt: new Date().toISOString(), pages: [] };
const sharedDone = new Set();

const ENUM = `(() => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=checkbox], [role=combobox], [role=menuitem], [role=radio], summary, [contenteditable=true]';
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const nameOf = (el) => (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const out = []; let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-qa-ignore], nextjs-portal')) continue;
    if (!vis(el)) continue;
    const tagN = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const kind = tagN === 'a' ? 'link' : tagN === 'select' ? 'select' : tagN === 'textarea' ? 'textarea' : tagN === 'input' ? 'input:' + (el.type || 'text') : role ? role : tagN === 'summary' ? 'disclosure' : 'button';
    el.setAttribute('data-qa-idx', String(i));
    out.push({ idx: i++, kind, name: nameOf(el), href: tagN === 'a' ? el.getAttribute('href') : null, target: el.getAttribute('target'), disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'), shared: !!el.closest('header, footer, nav, [data-shared-nav]'), inDialog: !!el.closest('[role=dialog]'), type: el.getAttribute('type') });
  }
  return out;
})()`;

async function settle(page) { await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(400); }

async function openRoute(page, route) {
  const resp = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => ({ err: e.message }));
  await settle(page);
  return resp;
}

for (const route of ROUTES) {
  const page = await ctx.newPage();
  const w = watch(page);
  const resp = await openRoute(page, route);
  const status = resp?.status?.() ?? resp?.err ?? null;
  const finalUrl = page.url().replace(BASE, "");
  const h1 = await page.locator("h1").first().innerText({ timeout: 1500 }).catch(() => "");
  const is404 = /could not be found|page not found|404/i.test(h1) || status === 404;
  const pageRec = { route, status, finalUrl, h1, is404, loadErrors: { pageErrors: [...w.pageErrors], console: [...w.console], failed: [...w.failed] }, elements: [], results: [] };
  report.pages.push(pageRec);
  const fname = `${tag}${route.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 120);
  await page.screenshot({ path: path.join(OUT, "shots", `${fname}.png`) }).catch(() => {});
  if (is404 || typeof status !== "number" || status >= 500 || pageRec.loadErrors.pageErrors.length) pageRec.loadFail = true;
  if (is404 || typeof status !== "number" || status >= 500) { await page.close(); flush(); console.log(`${route} -> LOAD FAIL ${status} ${h1}`); continue; }
  const finalPath = finalUrl.split("?")[0];
  if (LOADONLY.has(route) || seenFinal.has(finalPath)) { pageRec.loadOnly = true; seenFinal.add(finalPath); await page.close(); flush(); console.log(`${route} -> ${finalUrl} [${status}] load-only`); continue; }
  seenFinal.add(finalPath);
  const elements = await page.evaluate(ENUM);
  pageRec.elements = elements;
  // Links: verify every internal destination answers (no 404/500), following redirects.
  for (const el of elements.filter((e) => e.kind === "link")) {
    const href = el.href ?? "";
    if (/^(mailto:|tel:|sms:)/.test(href)) { pageRec.results.push({ idx: el.idx, status: "PASS", note: "contact link" }); continue; }
    if (/^https?:/.test(href) && !href.startsWith(BASE)) { pageRec.results.push({ idx: el.idx, status: "EXTERNAL", note: href.slice(0, 120) }); continue; }
    if (href.startsWith("#") || href === "") { pageRec.results.push({ idx: el.idx, status: "PASS", note: "in-page anchor" }); continue; }
    const key = `link ${href}`;
    if (sharedDone.has(key)) { pageRec.results.push({ idx: el.idx, status: "DUP", note: "same destination checked earlier" }); continue; }
    sharedDone.add(key);
    try {
      const r = await ctx.request.get(new URL(href, BASE + route).toString(), { maxRedirects: 5, timeout: 30000 });
      const body = r.status() === 200 && /text\/html/.test(r.headers()["content-type"] ?? "") ? await r.text() : "";
      const nf = r.status() === 404 || /<title>[^<]*(404|not found)/i.test(body);
      pageRec.results.push({ idx: el.idx, status: nf || r.status() >= 500 ? "FAIL" : "PASS", note: `${r.status()} ${r.url().replace(BASE, "")}`.slice(0, 160) });
    } catch (e) { pageRec.results.push({ idx: el.idx, status: "FAIL", note: String(e.message).slice(0, 160) }); }
  }
  // Fields: type into text fields and pick a different option in selects.
  for (const el of elements.filter((e) => /^(input|textarea|select)/.test(e.kind) && !e.disabled)) {
    const loc = page.locator(`[data-qa-idx="${el.idx}"]`);
    await loc.evaluate((n) => { const d = n.closest("details"); if (d && !d.open) d.open = true; }).catch(() => {});
    try {
      if (el.kind === "select") {
        const opts = await loc.locator("option").evaluateAll((os) => os.map((o) => o.value));
        if (opts.length < 2) { pageRec.results.push({ idx: el.idx, status: "PASS", note: "single option" }); continue; }
        const before = await loc.inputValue(); const pick = opts.find((v) => v !== before) ?? opts[0];
        await loc.selectOption(pick, { timeout: 3000 }); await page.waitForTimeout(250);
        pageRec.results.push({ idx: el.idx, status: "PASS", note: `selected ${pick}` });
      } else if (/input:(text|search|email|tel|url|number|date|password)|textarea/.test(el.kind) || el.kind === "input:") {
        const v = el.kind === "input:number" ? "12" : el.kind === "input:date" ? "2026-12-01" : el.kind === "input:email" ? "qa.field@example.test" : "QA test 123";
        // Read-only fields (copy-a-link boxes) can't be typed into by design; fields in a closed <details> get it opened first.
        if (await loc.evaluate((n) => n.readOnly === true).catch(() => false)) { pageRec.results.push({ idx: el.idx, status: "PASS", note: "read-only field (copy box)" }); continue; }
        await loc.evaluate((n) => { const d = n.closest("details"); if (d && !d.open) d.open = true; }).catch(() => {});
        const prev = await loc.inputValue().catch(() => "");
        await loc.fill(v, { timeout: 3000 });
        const got = await loc.inputValue();
        pageRec.results.push({ idx: el.idx, status: got !== "" ? "PASS" : "FAIL", note: `typed -> "${got.slice(0, 30)}"` });
        await loc.fill(prev, { timeout: 2000 }).catch(() => {});
      } else if (/input:(checkbox|radio)/.test(el.kind)) {
        pageRec.results.push({ idx: el.idx, status: "CLICK", note: "exercised in click pass" });
      } else pageRec.results.push({ idx: el.idx, status: "PASS", note: "present" });
    } catch (e) { pageRec.results.push({ idx: el.idx, status: "FAIL", note: String(e.message).split("\n")[0].slice(0, 160) }); }
  }
  // Clicks: each clickable from a fresh load of the page.
  const clickables = elements.filter((e) => !["link", "select", "textarea"].includes(e.kind) && !/^input:(text|search|email|tel|url|number|date|password|)$/.test(e.kind));
  let n = 0;
  for (const el of clickables) {
    const key = `${el.kind}|${el.name}`;
    if (el.disabled) { pageRec.results.push({ idx: el.idx, status: "DISABLED", note: "disabled in this state" }); continue; }
    if (SKIP.test(el.name)) { pageRec.results.push({ idx: el.idx, status: "SKIP", note: "session-ending; dedicated test" }); continue; }
    if (el.shared && sharedDone.has(key)) { pageRec.results.push({ idx: el.idx, status: "DUP", note: "shared control clicked earlier" }); continue; }
    if (!CLICK || n >= MAX_CLICKS) { pageRec.results.push({ idx: el.idx, status: "UNTESTED", note: "click cap" }); continue; }
    if (el.shared) sharedDone.add(key);
    n++;
    pageRec.results.push({ idx: el.idx, ...(await clickOne(route, el)) });
  }
  await page.close();
  flush();
  console.log(`${route} -> ${finalUrl} [${status}] elements=${elements.length} fails=${pageRec.results.filter((r) => r.status === "FAIL").length}`);
}

async function clickOne(route, el) {
  // Fresh context from the role's saved session so one click's leftovers (local storage, open dialogs) never leak.
  const cctx = await browser.newContext({ ...(ROLE === "anon" ? (MOBILE ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } }) : { ...(MOBILE ? devices["iPhone 13"] : { viewport: { width: 1440, height: 900 } }), storageState: statePath(ROLE) }), permissions: ["clipboard-read", "clipboard-write"] });
  const page = await cctx.newPage();
  const w = watch(page);
  try {
    await openRoute(page, route);
    await page.evaluate(ENUM);
    const loc = page.locator(`[data-qa-idx="${el.idx}"]`);
    const sameName = await loc.evaluate((x) => (x.getAttribute("aria-label") || x.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80)).catch(() => null);
    if (sameName === null) return { status: "FAIL", note: "element not found after reload (page not deterministic)" };
    w.reset();
    const mutations = [];
    page.on("request", (r) => { if (r.method() !== "GET" && !/_next|sentry|google|facebook/.test(r.url())) mutations.push(r); });
    // A dialog that opens by itself on load (e.g. the sign-in dialog on /login) is closed first, as a person would.
    if (!el.inDialog && (await page.locator("[role=dialog]:visible").count())) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
    const probe = () => page.evaluate((i) => { const x = document.querySelector(`[data-qa-idx="${i}"]`); const d = x?.closest("details"); let ls = ""; try { ls = JSON.stringify(localStorage); } catch {} return { root: document.documentElement.className + "|" + (document.documentElement.getAttribute("data-theme") ?? "") + "|" + document.documentElement.style.cssText, details: d ? d.open : null, ls, cookie: document.cookie }; }, el.idx).catch(() => ({}));
    const pb = await probe();
    const before = { url: page.url(), dialogs: await page.locator("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]").count(), html: (await page.content()).length, expanded: await loc.getAttribute("aria-expanded").catch(() => null), pressed: await loc.getAttribute("aria-pressed").catch(() => null), selected: await loc.getAttribute("aria-selected").catch(() => null), checked: await loc.isChecked().catch(() => null) };
    let download = null; page.once("download", (d) => { download = d.suggestedFilename(); });
    let chooser = false; page.once("filechooser", () => { chooser = true; });
    let popup = null; page.context().once("page", (p) => { popup = p; });
    try { await loc.click({ timeout: 5000 }); }
    catch (e) {
      const lines = String(e.message).replace(/\x1b\[[0-9;]*m/g, "").split("\n"); const li = lines.findIndex((l) => /intercepts pointer events|not visible|outside of the viewport|not stable|detached/.test(l)); const why = li >= 0 ? lines.slice(Math.max(0, li - 1), li + 1).join(" ").trim().slice(0, 220) : "";
      // Visually hidden inputs styled through their label: click the label as a person would.
      const viaLabel = await loc.evaluate((x) => { const l = x.labels?.[0] ?? x.closest("label"); if (l) { l.click(); return true; } return false; }).catch(() => false);
      if (!viaLabel) return { status: "FAIL", note: `not clickable: ${why || String(e.message).split("\n")[0].slice(0, 120)}` };
    }
    await page.waitForTimeout(1500);
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    const after = { url: page.url(), dialogs: await page.locator("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]").count(), html: (await page.content()).length, expanded: await loc.getAttribute("aria-expanded").catch(() => null), pressed: await loc.getAttribute("aria-pressed").catch(() => null), selected: await loc.getAttribute("aria-selected").catch(() => null), checked: await loc.isChecked().catch(() => null) };
    const pa = await probe();
    const effects = [];
    if (pa.details !== pb.details) effects.push(`disclosure ${pa.details ? "opened" : "closed"}`);
    if (pa.root !== pb.root) effects.push("page theme/class changed");
    if (pa.ls !== pb.ls) effects.push("saved preference (local storage)");
    if (pa.cookie !== pb.cookie) effects.push("cookie set");
    if (after.url !== before.url) effects.push(`navigated ${after.url.replace(BASE, "")}`);
    if (after.dialogs !== before.dialogs) effects.push(`overlay ${before.dialogs}->${after.dialogs}`);
    if (after.expanded !== before.expanded) effects.push(`expanded ${after.expanded}`);
    if (after.pressed !== before.pressed) effects.push(`pressed ${after.pressed}`);
    if (after.selected !== before.selected) effects.push(`selected ${after.selected}`);
    // An already-pressed toggle or selected tab staying put is its expected result.
    if (!effects.length && (before.pressed === "true" || before.selected === "true")) effects.push("already active");
    if (after.checked !== before.checked) effects.push(`checked ${after.checked}`);
    if (download) effects.push(`download ${download}`);
    if (chooser) effects.push("file picker opened");
    if (!effects.length && (await loc.evaluate((x) => x.type === "color").catch(() => false))) effects.push("native color picker");
    if (popup) { effects.push(`new tab ${popup.url().slice(0, 80)}`); await popup.close().catch(() => {}); }
    const muts = [];
    for (const r of mutations) { const resp = await r.response().catch(() => null); muts.push(`${resp?.status() ?? "ERR"} ${r.method()} ${r.url().replace(BASE, "").slice(0, 90)}`); }
    if (muts.length) effects.push(`requests ${muts.join("; ")}`);
    if (Math.abs(after.html - before.html) > 40 && !effects.length) effects.push(`dom changed ${after.html - before.html}`);
    const nav404 = after.url !== before.url && /could not be found|page not found/i.test(await page.locator("h1").first().innerText({ timeout: 1000 }).catch(() => ""));
    const badMut = muts.filter((m) => /^(5\d\d|ERR)/.test(m) || (/^4\d\d/.test(m) && !/^40[13] /.test(m)));
    const serverErr = w.failed.filter((f) => /^5\d\d/.test(f));
    const errors = [...w.pageErrors.map((e) => `pageerror: ${e}`), ...serverErr, ...badMut.map((m) => `request: ${m}`), ...(nav404 ? ["navigated to 404"] : [])];
    if (errors.length) return { status: "FAIL", note: errors.join(" | ").slice(0, 400), effects };
    if (!effects.length && before.checked === true && /radio/.test(el.kind)) return { status: "PASS", note: "already the selected option" };
    if (!effects.length) {
      // A submit button whose form has empty required fields is stopped by the browser's own validation: expected.
      const invalid = await loc.evaluate((x) => { const f = x.form ?? x.closest("form"); if (!f || (x.type && x.type !== "submit")) return null; const bad = [...f.elements].filter((e) => e.willValidate && !e.checkValidity()); return bad.length ? bad.map((e) => e.name || e.id || e.type).slice(0, 3).join(",") : null; }).catch(() => null);
      if (invalid) return { status: "PASS", note: `blocked by required-field validation (${invalid})` };
      // A file input opens the OS picker, which a headless browser can't show: covered by upload flows instead.
      if (await loc.evaluate((x) => x.type === "file").catch(() => false)) return { status: "PASS", note: "file picker (opens OS dialog; uploads tested in flows)" };
      return { status: "NOEFFECT", note: "no observable result", console: w.console.slice(0, 3) };
    }
    return { status: "PASS", note: effects.join(" | ").slice(0, 300), console: w.console.slice(0, 3) };
  } catch (e) {
    return { status: "FAIL", note: `click: ${String(e.message).split("\n")[0].slice(0, 200)}`, pageErrors: w.pageErrors.slice(0, 3) };
  } finally { await cctx.close().catch(() => {}); }
}

function flush() { fs.writeFileSync(outFile, JSON.stringify(report, null, 1)); }
report.finishedAt = new Date().toISOString(); flush();
await browser.close(); await closeDb();
