// Browser walk for the compact pipeline (four cards per stage, stage search, expanded stage view).
// Local build against the mock Supabase (NOT production):
//   npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
//   MOCK_PIPELINE=1 MOCK_PIPELINE_MANY=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` with NEXT_PUBLIC_ESIGNATURES=on against the mock on :54321)
//   node scripts/pipeline/compact-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "compact-pipeline-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; let fails = 0;
const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); if (!c) fails++; };
await fetch("http://localhost:54321/__onboarding?status=completed").catch(() => {});
const browser = await chromium.launch();

/** Cards whose box is fully inside the column's scrolling list. */
const fullyVisible = (page, col) => page.evaluate((col) => {
  const list = document.querySelector(`[data-testid="column-${col}-list"]`);
  if (!list) return -1;
  const r = list.getBoundingClientRect();
  return [...list.querySelectorAll('[data-testid="bid-card"]')].filter((c) => { const b = c.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }).length;
}, col);

// ---------------- Desktop ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const apiCalls = []; page.on("request", (r) => { if (r.url().includes("/api/")) apiCalls.push(r.url()); });
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  const draftCount = Number((await page.getByTestId("column-draft").locator(`#col-draft`).textContent()).match(/(\d+)\s*$/)?.[1]);
  check(`draft stage has many bids (${draftCount})`, draftCount > 4);
  check("draft list scrolls inside the column", (await page.getByTestId("column-draft-list").getAttribute("data-scrollable")) === "true");
  check(`exactly 4 draft cards fully visible (${await fullyVisible(page, "draft")})`, (await fullyVisible(page, "draft")) === 4);
  check("short stage (Ready) doesn't scroll", (await page.getByTestId("column-ready-list").getAttribute("data-scrollable")) === "false");
  check("draft shows a 'Scroll for more' hint and 'View all N'", (await page.getByTestId("column-draft-more").isVisible()) && (await page.getByTestId("column-draft-view-all").textContent()).includes(String(draftCount)));
  const ph = await page.evaluate(() => document.documentElement.scrollHeight);
  check(`page height stays reasonable (${ph}px)`, ph < 3200);
  // Every stage has its own search box inside its card.
  for (const c of ["draft", "ready", "sent", "awaiting", "won", "scheduled", "in_progress", "completed", "lost"]) {
    const inside = await page.getByTestId(`column-${c}`).getByTestId(`column-${c}-search`).count();
    if (inside !== 1) check(`search box inside ${c} card`, false);
  }
  check("every stage card has its own search box", true);
  await page.screenshot({ path: `${dir}/01-board-desktop.png`, fullPage: true });

  // Scroll one column: the page and other columns stay put.
  await page.getByTestId("column-draft-list").hover();
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ d: document.querySelector('[data-testid="column-draft-list"]').scrollTop, s: document.querySelector('[data-testid="column-sent-list"]').scrollTop, y: window.scrollY }));
  check(`wheel scrolls the draft list (${st.d}) not the page (${st.y}) or Sent (${st.s})`, st.d > 0 && st.y === y0 && st.s === 0);
  check("search box stays visible after scrolling the list", await page.getByTestId("column-draft-search").isVisible());

  // Mini search: local first, then other stages; independent per stage.
  const valueBefore = await page.getByTestId("column-draft-value").textContent();
  await page.getByTestId("column-draft-search").fill("john");
  await page.waitForTimeout(150);
  const res = page.getByTestId("column-draft-results");
  check("Draft search: no local John, says so", (await res.getByTestId("local-empty").count()) === 1);
  const awaitingHit = res.getByTestId("result-awaiting").filter({ hasText: "Deck Replacement" });
  check("Draft search finds John's bid in Awaiting Signature", (await awaitingHit.count()) === 1 && (await awaitingHit.textContent()).includes("Found in: Awaiting Signature"));
  check("John's second bid shows separately under Approved / Won", (await res.getByTestId("result-won").filter({ hasText: "Garage addition" }).count()) === 1);
  check("Ready search box untouched", (await page.getByTestId("column-ready-search").inputValue()) === "");
  check("Ready cards unchanged while Draft searches", (await page.getByTestId("column-ready-list").count()) === 1);
  check("Draft header count + total unchanged by search", (await page.getByTestId("column-draft-value").textContent()) === valueBefore && (await page.locator("#col-draft").textContent()).includes(`· ${draftCount}`));
  check("no extra network requests while typing (local data)", !apiCalls.some((u) => u.includes("/api/search")));
  await page.screenshot({ path: `${dir}/02-draft-search-john.png`, clip: await page.getByTestId("column-draft").boundingBox().then((b) => ({ x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 })) });
  // A draft far below the first four cards.
  await page.getByTestId("column-draft-search").fill("rowan");
  await page.waitForTimeout(100);
  check("search finds a draft hidden below the first four", (await res.getByTestId("bid-card").filter({ hasText: "Rowan Price" }).count()) === 1);
  // Address search.
  await page.getByTestId("column-sent-search").fill("117 elm");
  await page.waitForTimeout(100);
  check("Sent search by project address finds the draft in Draft", (await page.getByTestId("column-sent-results").getByTestId("result-draft").count()) >= 1);
  check("Draft search kept its own text", (await page.getByTestId("column-draft-search").inputValue()) === "rowan");
  // Keyboard: Escape clears; arrow keys reach the results.
  await page.getByTestId("column-sent-search").press("Escape");
  check("Escape clears the stage search", (await page.getByTestId("column-sent-search").inputValue()) === "");
  await page.getByTestId("column-draft-search").fill("john");
  await page.getByTestId("column-draft-search").press("ArrowDown");
  check("ArrowDown moves focus into the results", await page.evaluate(() => document.activeElement?.hasAttribute("data-result")));
  // Clicking a result opens the bid.
  await Promise.all([page.waitForURL(/\/estimates\//), awaitingHit.click()]);
  check("result opens the existing bid record", /\/estimates\/11111111-1111-4111-8111-222222222240/.test(page.url()));
  await page.goBack({ waitUntil: "networkidle" });
  await page.getByTestId("column-draft-search").waitFor();
  check("Back from the bid brings the Draft search back", (await page.getByTestId("column-draft-search").inputValue()) === "john");

  // Header opens the expanded stage view.
  await page.getByTestId("column-sent-open").click();
  await page.getByTestId("stage-view").waitFor();
  check("Sent header opens the Sent stage view (?stage=sent)", new URL(page.url()).searchParams.get("stage") === "sent");
  const sentCount = Number((await page.getByTestId("stage-count").textContent()).match(/\d+/)[0]);
  check(`stage view lists every Sent bid (${sentCount})`, (await page.getByTestId("stage-grid").getByTestId("bid-card").count()) === sentCount);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="stage-grid"]')).gridTemplateColumns.split(" ").length);
  check(`desktop grid has 4 columns at 1440 (${cols})`, cols === 4);
  await page.getByTestId("stage-sort").selectOption("value_desc");
  const vals = await page.getByTestId("stage-grid").getByTestId("bid-card").evaluateAll((els) => els.map((e) => Number(e.querySelector(".tabular")?.textContent.replace(/[^0-9.]/g, "") || 0)));
  check(`highest value sort (${vals.slice(0, 3).join(", ")}…)`, vals.every((v, i) => i === 0 || vals[i - 1] >= v));
  await page.getByTestId("stage-view-search").fill("john");
  await page.waitForTimeout(100);
  check("stage view search shows cross-stage matches separately", (await page.getByTestId("stage-view").getByTestId("other-stage-results").count()) === 1 && (await page.getByTestId("stage-empty").count()) === 1);
  await page.getByTestId("stage-view-search").fill("");
  await page.screenshot({ path: `${dir}/03-stage-view-sent.png`, fullPage: true });
  await page.getByTestId("stage-back").click();
  await page.getByTestId("pipeline-columns").waitFor({ state: "visible" });
  check("Back to Pipeline returns to the board (no ?stage)", !new URL(page.url()).searchParams.has("stage"));
  check("Draft search text preserved after returning", (await page.getByTestId("column-draft-search").inputValue()) === "john");
  // Draft view: pagination not needed below 24; header click from Draft with search carries the query.
  await page.getByTestId("column-draft-search").fill("");
  await page.getByTestId("column-draft-view-all").click();
  await page.getByTestId("stage-view").waitFor();
  check(`Draft view count matches the board (${draftCount})`, (await page.getByTestId("stage-count").textContent()).includes(String(draftCount)));
  await page.goBack();
  await page.getByTestId("pipeline-columns").waitFor({ state: "visible" });
  check("browser Back also leaves the stage view", (await page.getByTestId("stage-view").count()) === 0);
  check("no page errors (desktop)", errors.length === 0);
  if (errors.length) out.push(...errors.map((e) => `   ${e}`));
  await ctx.close();
}

// ---------------- Wide desktop: 5 per row ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/dashboard?view=pipeline&stage=draft", { waitUntil: "networkidle" });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="stage-grid"]')).gridTemplateColumns.split(" ").length);
  check(`shared ?stage=draft link opens the Draft view with 5 per row at 1920 (${cols})`, cols === 5);
  await page.screenshot({ path: `${dir}/04-stage-view-draft-1920.png` });
  await page.getByTestId("stage-back").click();
  check("Back from a shared stage link shows the board", (await page.getByTestId("pipeline-columns").isVisible()) && !new URL(page.url()).searchParams.has("stage"));
  await ctx.close();
}

// ---------------- Mobile ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`mobile: no page-level horizontal scroll (${sw})`, sw <= 390);
  const row = await page.getByTestId("column-draft").evaluate((el) => { const p = el.parentElement.parentElement; return { sw: p.scrollWidth, cw: p.clientWidth, w: el.getBoundingClientRect().width }; });
  check(`mobile: stages scroll sideways (${row.sw} > ${row.cw}), column ${Math.round(row.w)}px wide`, row.sw > row.cw && row.w >= 300);
  check(`mobile: 4 draft cards fully visible (${await fullyVisible(page, "draft")})`, (await fullyVisible(page, "draft")) === 4);
  const fs16 = await page.getByTestId("column-draft-search").evaluate((el) => getComputedStyle(el).fontSize);
  check(`mobile: search text 16px (no iOS zoom) (${fs16})`, fs16 === "16px");
  const overflow = await page.getByTestId("bid-card").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  check("mobile: no horizontal overflow inside bid cards", overflow === 0);
  await page.screenshot({ path: `${dir}/05-board-mobile.png` });
  await page.getByTestId("column-draft-search").fill("john");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/06-search-mobile.png` });
  await page.getByTestId("column-draft-search").fill("");
  await page.getByTestId("column-draft-open").tap();
  await page.getByTestId("stage-view").waitFor();
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="stage-grid"]')).gridTemplateColumns.split(" ").length);
  check(`mobile: stage view is one card per row (${cols})`, cols === 1);
  await page.screenshot({ path: `${dir}/07-stage-view-mobile.png` });
  check("no page errors (mobile)", errors.length === 0);
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
console.log(fails ? `\n${fails} check(s) failed` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
