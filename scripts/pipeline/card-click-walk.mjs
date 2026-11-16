// Browser walk for the whole-card click on Bids -> Pipeline (and the Qty/calculator alignment in the builder).
// Same setup as scripts/pipeline/walk.mjs (mock Supabase with labeled fixtures, NOT production):
//   MOCK_PIPELINE=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` with NEXT_PUBLIC_ESIGNATURES=on against the mock on :54321)
//   node scripts/pipeline/card-click-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "card-click-shots";
fs.mkdirSync(dir, { recursive: true });
const BASE = "http://localhost:3000";
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
await fetch("http://localhost:54321/__onboarding?status=completed").catch(() => {});
const browser = await chromium.launch();
const card = (page, title) => page.getByTestId("bid-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
const path = (page) => new URL(page.url()).pathname;
const shot = async (page, loc, file) => { const b = await loc.boundingBox(); await page.screenshot({ path: file, clip: { x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 } }); };
const board = async (page, q = "") => { await page.goto(`${BASE}/dashboard${q}`, { waitUntil: "networkidle" }); await page.getByTestId("pipeline-board").waitFor(); };

// ---------------- Desktop ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await board(page);
  const c = card(page, "Seamless gutters");
  const id = await c.getAttribute("data-bid");
  await c.scrollIntoViewIfNeeded();

  // 1. Empty card space (bottom-left corner, under the price) opens the estimate.
  const box = await c.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  check("hover: pointer cursor on the card surface", await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [box.x + 12, box.y + box.height - 12]) === "pointer");
  await c.screenshot({ path: `${dir}/card-hover-light.png` });
  await page.mouse.click(box.x + 12, box.y + box.height - 12);
  await page.waitForURL(/\/estimates\//);
  check("empty card space opens that bid's estimate", path(page) === `/estimates/${id}`);

  // 2. Title opens the same destination.
  await board(page);
  await card(page, "Seamless gutters").getByTestId("card-link").click();
  await page.waitForURL(/\/estimates\//);
  check("project title opens the same estimate", path(page) === `/estimates/${id}`);

  // 3. Three-dot menu does not open the estimate.
  await board(page);
  await card(page, "Seamless gutters").getByTestId("move-menu").click();
  await page.getByRole("menu").waitFor();
  check("three-dot menu opens its menu and stays on the pipeline", path(page) === "/dashboard" && (await page.getByRole("menuitem", { name: "Sent" }).count()) === 1);
  await page.screenshot({ path: `${dir}/card-menu-open.png`, clip: { x: box.x - 20, y: box.y - 20, width: 520, height: 560 } });

  // 4. Changing a stage through the menu does not navigate.
  await page.getByRole("menuitem", { name: "Sent" }).click();
  await page.getByTestId("pipeline-toast").waitFor();
  await page.waitForTimeout(600);
  check("moving a stage from the menu stays on the pipeline", path(page) === "/dashboard" && (await page.getByTestId("column-sent").getByRole("link", { name: "Seamless gutters", exact: true }).count()) === 1);
  await page.getByTestId("pipeline-toast").getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(800);

  // Next-action buttons keep their own action (a move button does not open the estimate).
  const ready = page.getByTestId("column-ready").getByTestId("bid-card").first();
  const nextBtn = ready.getByTestId("next-action");
  if (await nextBtn.count()) {
    const tag = await nextBtn.evaluate((el) => el.tagName);
    const before = path(page);
    await nextBtn.click();
    await page.waitForTimeout(800);
    // A link goes to its own step (e.g. Send proposal); a button moves the stage and stays on the board.
    check(`next-action control keeps its own behavior (${tag})`, tag === "A" ? path(page) !== before : path(page) === "/dashboard");
    if (tag === "A") await board(page);
    else { const t = page.getByTestId("pipeline-toast"); if (await t.getByRole("button", { name: "Undo" }).count()) { await t.getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(800); } }
  }

  // 5. Each card opens its own bid (every card's link points at the card's own id).
  const all = await page.getByTestId("bid-card").evaluateAll((els) => els.map((el) => ({ id: el.getAttribute("data-bid"), href: el.querySelector("a[data-card-link]")?.getAttribute("href") })));
  check(`every card (${all.length}) opens its own bid, never another`, all.length > 0 && all.every((x) => x.href === `/estimates/${x.id}`));

  // Drag still moves a card (not a click).
  await card(page, "Seamless gutters").scrollIntoViewIfNeeded();
  const g = await card(page, "Seamless gutters").boundingBox(); const t = await page.getByTestId("column-sent").boundingBox();
  await page.mouse.move(g.x + 40, g.y + g.height - 14); await page.mouse.down();
  await page.mouse.move(g.x + 70, g.y + g.height + 10, { steps: 5 }); await page.mouse.move(t.x + t.width / 2, t.y + 30, { steps: 12 }); await page.mouse.up();
  await page.getByTestId("pipeline-toast").waitFor();
  await page.waitForTimeout(600);
  check("dragging from empty card space moves the card and does not navigate", path(page) === "/dashboard" && (await page.getByTestId("column-sent").getByRole("link", { name: "Seamless gutters", exact: true }).count()) === 1);
  await page.getByTestId("pipeline-toast").getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(800);

  // 6. Back returns to the pipeline with the filters kept.
  await board(page, "?range=90d");
  await page.getByLabel("Search bids").fill("gutters");
  await page.getByLabel("Date applies to").selectOption("created");
  await page.waitForTimeout(300);
  await page.getByTestId("card-link").first().click();
  await page.waitForURL(/\/estimates\//);
  await page.goBack({ waitUntil: "networkidle" });
  await page.getByTestId("pipeline-board").waitFor();
  // The router can restore a cached render after Back; give it time so a late URL reset would show.
  await page.waitForTimeout(1500);
  const u = new URL(page.url());
  check("Back keeps date range, search and date field", u.searchParams.get("range") === "90d" && (await page.getByLabel("Search bids").inputValue()) === "gutters" && (await page.getByLabel("Date applies to").inputValue()) === "created" && (await page.getByTestId("bid-card").count()) === 1);

  // 7a. Keyboard: Tab reaches the card, shows a focus ring on the whole card, Enter opens it.
  await board(page);
  await card(page, "Seamless gutters").getByTestId("card-link").focus();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  const ring = await card(page, "Seamless gutters").evaluate((el) => getComputedStyle(el).outlineStyle);
  const titleRing = await card(page, "Seamless gutters").getByTestId("card-link").evaluate((el) => getComputedStyle(el).outlineStyle);
  check("keyboard focus shows a ring around the whole card (not just the title)", ring === "solid" && titleRing === "none");
  await shot(page, card(page, "Seamless gutters"), `${dir}/card-keyboard-focus-light.png`);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/estimates\//);
  check("Enter on the focused card opens the estimate", path(page) === `/estimates/${id}`);

  // Dark mode: hover + focus.
  await board(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await card(page, "Seamless gutters").scrollIntoViewIfNeeded();
  const d = await card(page, "Seamless gutters").boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height - 12);
  await shot(page, card(page, "Seamless gutters"), `${dir}/card-hover-dark.png`);
  await page.screenshot({ path: `${dir}/pipeline-dark-desktop.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "black"));
  await card(page, "Seamless gutters").getByTestId("card-link").focus();
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  await shot(page, card(page, "Seamless gutters"), `${dir}/card-keyboard-focus-black.png`);

  // Builder: calculator sits left of Qty; the qty's right edge lines up with the Qty header.
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.goto(`${BASE}/estimates/11111111-1111-4111-8111-111111111111`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find((x) => x.textContent?.trim() === "Qty");
    const inputs = [...document.querySelectorAll('input[data-col="qty"]')].filter((x) => x.offsetParent);
    const rows = inputs.map((inp) => {
      const cell = inp.parentElement; const btn = cell.querySelector("button");
      return { input: inp.getBoundingClientRect().right, btnLeft: btn ? btn.getBoundingClientRect().left < inp.getBoundingClientRect().left : null };
    });
    return { th: th?.getBoundingClientRect().right, thPad: th ? parseFloat(getComputedStyle(th).paddingRight) : 0, rows };
  });
  const withCalc = info.rows.filter((r) => r.btnLeft !== null);
  check(`calculator icon is left of the qty on every row that has one (${withCalc.length})`, withCalc.length > 0 && withCalc.every((r) => r.btnLeft));
  check("qty right edges line up with the Qty header (within 6px)", info.rows.length > 0 && info.rows.every((r) => Math.abs(r.input - (info.th - info.thPad)) <= 6));
  const firstRow = page.locator('input[data-col="qty"]').first();
  await firstRow.scrollIntoViewIfNeeded();
  const tb = await page.locator("table").filter({ has: page.locator('input[data-col="qty"]') }).first().boundingBox();
  await page.screenshot({ path: `${dir}/builder-qty-calculator-light.png`, clip: { x: tb.x, y: tb.y, width: tb.width, height: Math.min(tb.height, 360) } });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "black"));
  await page.screenshot({ path: `${dir}/builder-qty-calculator-black.png`, clip: { x: tb.x, y: tb.y, width: tb.width, height: Math.min(tb.height, 360) } });
  check("desktop: no page errors", errors.length === 0);
  if (errors.length) console.log(errors);
  await ctx.close();
}

// ---------------- Phone (touch) ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await board(page);
  const c = card(page, "Seamless gutters");
  await c.scrollIntoViewIfNeeded();
  const id = await c.getAttribute("data-bid");
  await c.screenshot({ path: `${dir}/card-m390.png` });
  await page.getByTestId("move-menu").first().scrollIntoViewIfNeeded();
  await c.getByTestId("move-menu").tap();
  await page.getByRole("menu").waitFor();
  check("m390: tapping the three-dot menu opens the menu, no navigation", path(page) === "/dashboard");
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.waitForTimeout(300);
  await c.scrollIntoViewIfNeeded();
  const b = await c.boundingBox();
  await page.touchscreen.tap(b.x + 20, b.y + b.height - 14);
  await page.waitForURL(/\/estimates\//);
  check("m390: tapping the card opens its estimate", path(page) === `/estimates/${id}`);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`m390: estimate opens without horizontal scroll (${sw})`, sw <= 390);
  await ctx.close();
}

await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
