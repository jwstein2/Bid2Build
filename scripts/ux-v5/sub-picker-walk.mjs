// V5 UX audit: real-browser walk for the line-item subcontractor picker (search, select, inline add,
// duplicate check, unsaved-input protection, persistence after reload) against the mock Supabase
// (test data only, NOT production).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 ..., `next start`,
//   MOCK_PIPELINE=1 node scripts/ux-audit/mock-supabase.mjs, then: node scripts/ux-v5/sub-picker-walk.mjs <dir>
// Restart the mock before re-running (recorded quotes and new subcontractors persist in its memory).
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "sub-picker-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__team?reset=1&seed=1&manage=1`);
await fetch(`${M}/__ops?seed=1&styleManaged=0&allow=1&canOverride=1`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png` });

async function open(vp = DESK, theme = null) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  if (theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: 4102444800000 })); } catch { /* */ } }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|google/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
  await page.goto(`${A}/estimates/${EST}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 4000 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Expand all" }).click().catch(() => {});
  await page.waitForTimeout(400);
  return { ctx, page };
}
/** Opens the details of the n-th line item and returns its sub-quote panel. */
async function itemPanel(page, n) {
  const btn = page.getByRole("button", { name: "Show item details" }).nth(n);
  await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(500);
  return page.locator("section[aria-label^='Subcontractor quotes for']").last();
}
const listOpen = async (page) => (await page.getByTestId("sub-picker-list").count()) === 1;

// ---------------- Desktop: search, keyboard select, save, reload ----------------
let stoneId = null;
{
  const { ctx, page } = await open();
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST" && /\/api\/(team|estimates\/.*\/sub-quotes)$/.test(r.url())) posts.push({ url: r.url(), body: r.postData() ?? "" }); });
  const panel = await itemPanel(page, 0);
  await panel.scrollIntoViewIfNeeded();
  await shot(page, "estimate-subcontractor-panel-before");
  await panel.getByRole("button", { name: /Add (another )?quote/ }).click();
  const input = page.getByTestId("sub-picker-input");
  check("picker is a text combobox (typing allowed)", (await input.getAttribute("role")) === "combobox" && (await input.isEditable()));
  await input.click();
  check("clicking the field opens the list", await listOpen(page));
  const n = await page.getByTestId("sub-picker-option").count();
  check(`list shows real directory records (${n})`, n >= 6);
  check("list offers + Add new subcontractor", (await page.getByTestId("sub-picker-create").count()) === 1);
  await shot(page, "estimate-subcontractor-dropdown-open");
  await input.pressSequentially("sto", { delay: 40 });
  const names = await page.getByTestId("sub-picker-option").allTextContents();
  check(`typing filters to matches (${names.join(" | ")})`, names.length >= 1 && names.every((t) => /sto/i.test(t)));
  check("no-exact-match offers Add “sto” as new", (await page.getByTestId("sub-picker-create").textContent()).includes("“sto”"));
  await shot(page, "estimate-subcontractor-dropdown-typed");
  await page.keyboard.press("Escape");
  check("Escape closes the list", !(await listOpen(page)));
  check("Escape keeps the typed text", (await input.inputValue()) === "sto");
  check("Escape returns focus to the field", await input.evaluate((el) => document.activeElement === el));
  await page.keyboard.press("ArrowDown");
  check("ArrowDown reopens the list", await listOpen(page));
  await page.keyboard.press("Enter");
  check("Enter selects the highlighted match and closes the list", !(await listOpen(page)) && (await input.inputValue()) === "Stone Works");
  await shot(page, "estimate-subcontractor-selected");
  // Click outside: list closes, choice kept, nothing else changes.
  await input.click(); await page.waitForTimeout(150);
  check("list reopens on click", await listOpen(page));
  await page.mouse.click(1380, 120); await page.waitForTimeout(200);
  check("clicking outside closes the list", !(await listOpen(page)));
  check("clicking outside keeps the committed selection", (await input.inputValue()) === "Stone Works");
  await page.getByTestId("quote-amount").fill("1234.50");
  await page.getByTestId("quote-save").click();
  await page.waitForTimeout(1200);
  const post = posts.find((p) => p.url.includes("sub-quotes"));
  const rid = post?.body.match(/name="resourceId"\r\n\r\n([0-9a-f-]{36})/)?.[1] ?? null;
  stoneId = rid;
  const team = await (await fetch(`${M}/rest/v1/pm_resources?select=id,name`)).json().catch(() => []);
  check("save sends the real contact ID (resourceId), not just a name", !!rid && team.some?.((r) => r.id === rid && r.name === "Stone Works"));
  check("saved quote shows on the line item", (await panel.getByText("Stone Works").count()) > 0 && (await panel.getByText("$1,234.50").count()) > 0);
  await shot(page, "estimate-subcontractor-quote-saved");
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Expand all" }).click().catch(() => {});
  const again = await itemPanel(page, 0);
  await again.scrollIntoViewIfNeeded();
  check("after reload: subcontractor and quote are still on that line item", (await again.getByText("Stone Works").count()) > 0 && (await again.getByText("$1,234.50").count()) > 0);
  await shot(page, "estimate-subcontractor-after-refresh");
  await ctx.close();
}

// ---------------- Desktop: inline add, duplicate check, unsaved protection, reuse ----------------
{
  const { ctx, page } = await open();
  const panel = await itemPanel(page, 1);
  await panel.getByRole("button", { name: /Add (another )?quote/ }).click();
  const input = page.getByTestId("sub-picker-input");
  await input.click(); await input.fill("Bob's Framing");
  await page.getByTestId("sub-picker-create").click();
  const form = page.getByTestId("new-sub-form");
  check("Add new opens a compact inline form (no page change)", (await form.count()) === 1 && page.url().includes(`/estimates/${EST}`));
  check("typed name carries into the new form", (await page.getByTestId("new-sub-name").inputValue()) === "Bob's Framing");
  await shot(page, "estimate-subcontractor-new-form");
  await form.getByLabel(/Phone/).fill("555-0199");
  await form.getByRole("button", { name: "Cancel" }).click();
  check("Cancel with unsaved details asks before discarding", (await page.getByTestId("new-sub-discard").count()) === 1);
  await shot(page, "estimate-subcontractor-new-form-discard-prompt");
  await page.getByRole("button", { name: "Keep editing" }).click();
  check("Keep editing keeps the typed details", (await form.getByLabel(/Phone/).inputValue()) === "555-0199");
  const before = (await (await fetch(`${M}/__team`)).json()).count;
  let teamPosts = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/team")) teamPosts++; });
  await page.getByTestId("new-sub-save").dblclick();
  await page.waitForTimeout(1200);
  const after = (await (await fetch(`${M}/__team`)).json()).count;
  check(`new subcontractor saved to the directory once (double-click → ${teamPosts} request)`, after === before + 1 && teamPosts === 1);
  check("new subcontractor is assigned right away", (await input.inputValue()) === "Bob's Framing" && (await form.count()) === 0);
  await shot(page, "estimate-subcontractor-new-assigned");
  await page.getByTestId("quote-amount").fill("800");
  await page.getByTestId("quote-save").click(); await page.waitForTimeout(1200);
  check("quote for the new subcontractor saved on line 2", (await panel.getByText("Bob's Framing").count()) > 0);
  // Reuse + duplicate check on another line.
  const p3 = await itemPanel(page, 2);
  await p3.getByRole("button", { name: /Add (another )?quote/ }).click();
  const in3 = page.getByTestId("sub-picker-input");
  await in3.click(); await in3.fill("bob");
  check("new subcontractor is reusable on other lines", (await page.getByTestId("sub-picker-option").filter({ hasText: "Bob's Framing" }).count()) === 1);
  await in3.fill("Stone Works LLC");
  check("an exact duplicate name (ignoring LLC) doesn't offer Add new", (await page.getByTestId("sub-picker-create").count()) === 0);
  await in3.fill("Stone");
  await page.getByTestId("sub-picker-create").click();
  check("look-alike names are suggested before creating", (await page.getByTestId("new-sub-dupes").count()) === 1);
  await shot(page, "estimate-subcontractor-duplicate-suggestion");
  await page.getByTestId("new-sub-name").fill("stone works");
  check("exact duplicate blocks Add & assign", await page.getByTestId("new-sub-save").isDisabled());
  await page.getByTestId("new-sub-use-existing").first().click();
  check("Use existing assigns the saved contact", (await in3.inputValue()) === "Stone Works");
  // Escape inside the new-sub form with unsaved input asks first.
  await in3.fill("Zed Electric"); await page.getByTestId("sub-picker-create").click();
  await page.getByTestId("new-sub-trade").fill("Electrical");
  await page.keyboard.press("Escape");
  check("Escape in the new form with edits asks before discarding", (await page.getByTestId("new-sub-discard").count()) === 1);
  await page.getByTestId("new-sub-discard-yes").click();
  check("Discard returns to the picker", (await page.getByTestId("sub-picker-input").count()) === 1);
  // Line items keep their saved quotes throughout.
  check("earlier line items still show their saved quotes", (await page.getByText("Stone Works").count()) > 0 && (await page.getByText("Bob's Framing").count()) > 0);
  // Typed one-off names still work, and say so.
  await page.getByTestId("sub-picker-input").fill("Neighbor Dave"); await page.mouse.click(1380, 120); await page.waitForTimeout(150);
  check("an unlisted name is kept and explained (quote only, with Add to list)", (await page.getByTestId("sub-picker-freetext").count()) === 1);
  // Quote form Cancel protects typed input.
  await page.getByTestId("quote-form").getByRole("button", { name: "Cancel" }).click();
  check("Cancel on a filled quote form asks before discarding", (await page.getByTestId("quote-discard").count()) === 1);
  await ctx.close();
}

// ---------------- Permission: role that can't add to the directory ----------------
{
  await fetch(`${M}/__team?manage=0`);
  const { ctx, page } = await open();
  const panel = await itemPanel(page, 3);
  await panel.getByRole("button", { name: /Add (another )?quote/ }).click();
  const input = page.getByTestId("sub-picker-input");
  await input.click(); await input.fill("New Guy Painting");
  await page.getByTestId("sub-picker-create").click();
  await page.getByTestId("new-sub-save").click(); await page.waitForTimeout(800);
  check("no-permission add shows a plain explanation", (await page.getByTestId("new-sub-form").getByRole("alert").textContent())?.includes("can't add") ?? false);
  await shot(page, "estimate-subcontractor-no-permission");
  await fetch(`${M}/__team?manage=1`);
  await ctx.close();
}

// ---------------- Phone 390 (light + dark) and tablet 768 ----------------
for (const [vp, label, theme] of [[PHONE, "m390", "light"], [PHONE, "m390-dark", "dark"], [{ width: 768, height: 1024 }, "t768", "light"]]) {
  const { ctx, page } = await open(vp, theme);
  const panel = await itemPanel(page, 0);
  await panel.getByRole("button", { name: /Add (another )?quote/ }).click();
  const input = page.getByTestId("sub-picker-input");
  await input.tap?.().catch(() => input.click()); await input.click();
  await input.pressSequentially("a", { delay: 30 });
  const fs16 = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const box = await page.getByTestId("sub-picker-list").boundingBox();
  check(`${label}: list opens and stays inside the screen`, !!box && box.x >= 0 && box.x + box.width <= vp.width + 1);
  if (vp === PHONE) check(`${label}: 16px field (no iOS zoom)`, fs16 >= 16);
  check(`${label}: no sideways page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.getByTestId("sub-picker-list").scrollIntoViewIfNeeded();
  await shot(page, `estimate-subcontractor-dropdown-${label}`);
  await page.getByTestId("sub-picker-option").first().click();
  check(`${label}: tap selects and closes`, !(await listOpen(page)) && (await input.inputValue()).length > 0);
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/hydrat|Download the React DevTools/i.test(e));
check(`no page errors (${real.length})`, real.length === 0);
if (real.length) console.log(real.slice(0, 10).join("\n"));
console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("✓")).length}/${out.length} passed`);
