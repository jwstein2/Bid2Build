// Browser walk for the V4 sales pipeline (Bids dashboard). Local build against the mock Supabase with
// labeled fixture data (NOT production):
//   npx tsx scripts/esign/fixture.ts > /tmp/esign-fixture.json
//   MOCK_PIPELINE=1 MOCK_ESIGN_FIXTURE=/tmp/esign-fixture.json node scripts/ux-audit/mock-supabase.mjs &
//   (build + `next start` with NEXT_PUBLIC_ESIGNATURES=on against the mock on :54321)
//   node scripts/pipeline/walk.mjs <screenshotDir>
// Restart the mock before re-running: moves persist in its memory.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "pipeline-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const calls = async () => (await fetch("http://localhost:54321/__pipeline_calls")).json();
await fetch("http://localhost:54321/__onboarding?status=completed");
const browser = await chromium.launch();
const card = (page, title) => page.getByTestId("bid-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
const inCol = async (page, col, title) => (await page.getByTestId(`column-${col}`).getByRole("link", { name: title, exact: true }).count()) === 1;
// Real mouse drag (HTML5 drag-and-drop) from a card's top-left area to a column.
async function drag(page, title, col) {
  const s = await card(page, title).boundingBox(); const t = await page.getByTestId(`column-${col}`).boundingBox();
  await page.mouse.move(s.x + 16, s.y + 10); await page.mouse.down();
  await page.mouse.move(s.x + 50, s.y + 40, { steps: 5 }); await page.mouse.move(t.x + t.width / 2, t.y + 30, { steps: 12 }); await page.mouse.up();
}
const toast = async (page) => { const t = page.getByTestId("pipeline-toast"); await t.waitFor({ timeout: 5000 }); return t.textContent(); };

// ---------------- Desktop ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1700 }, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  check("desktop: pipeline is the default view", await page.getByTestId("view-pipeline").getAttribute("aria-selected") === "true");
  check("desktop: all 14 fixture bids on the board (existing bids accessible)", (await page.getByTestId("bid-card").count()) === 14);
  check("desktop: e-signed bid sits in Won with E-signed badge", (await inCol(page, "won", "Deck rebuild – Lee")) && (await card(page, "Deck rebuild – Lee").getByTestId("esigned").count()) === 1);
  check("desktop: manual approval labeled, not shown as signed", (await card(page, "Roof replacement").getByTestId("manual-approval").count()) === 1 && (await card(page, "Roof replacement").getByTestId("esigned").count()) === 0);
  check("desktop: draft with a signing link shows as Awaiting Signature", await inCol(page, "awaiting", "Siding replacement – Johnson residence"));
  check("desktop: column totals (Sent $26,150)", (await page.getByTestId("column-sent-value").textContent()) === "$26,150");
  const sum = await page.getByTestId("pipeline-summary").textContent();
  check("desktop: summary metrics (active $53,805, won $68,195, win rate 71.4%)", sum.includes("$53,805") && sum.includes("$68,195") && sum.includes("71.4%"));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`desktop: no page-level horizontal scroll (${sw})`, sw <= 1440);
  await page.screenshot({ path: `${dir}/after-pipeline-desktop.png`, fullPage: true });

  // Drag Ready -> Sent, then Undo
  await drag(page, "Seamless gutters", "sent");
  check("desktop: drag-and-drop saves the move", (await toast(page)).includes("to Sent") && (await calls()).at(-1)?.p_stage === "sent");
  await page.waitForTimeout(800);
  check("desktop: card shows in Sent after refresh", await inCol(page, "sent", "Seamless gutters"));
  await page.getByTestId("pipeline-toast").getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(800);
  check("desktop: Undo restores Ready to Send", (await calls()).at(-1)?.p_stage === "ready_for_review" && await inCol(page, "ready", "Seamless gutters"));

  // Drag Sent -> Won asks for an approval date + note
  await drag(page, "Siding + trim", "won");
  const dlg = page.getByTestId("move-dialog");
  await dlg.waitFor();
  check("desktop: Won asks to confirm as Approved Manually with a date", (await page.getByRole("dialog").textContent()).includes("Approved Manually") && await page.getByLabel("Approval date").isVisible());
  await page.screenshot({ path: `${dir}/after-approve-manually-dialog-desktop.png` });
  await page.getByLabel(/^Note/).fill("Approved by phone");
  await page.getByRole("button", { name: "Mark approved" }).click();
  await toast(page);
  await page.waitForTimeout(800);
  const last = (await calls()).at(-1);
  check("desktop: manual approval saved with date + note, no signature", last?.p_stage === "won" && last?.p_note === "Approved by phone" && /T12:00:00/.test(last?.p_effective_at ?? "")
    && (await card(page, "Siding + trim").getByTestId("manual-approval").count()) === 1 && (await card(page, "Siding + trim").getByTestId("esigned").count()) === 0);

  // Illegal moves: signed bid can't go back; unsigned Sent bid can't be scheduled
  await card(page, "Deck rebuild – Lee").getByTestId("move-menu").click();
  const sentItem = page.getByRole("menuitem", { name: "Sent", exact: true });
  check("desktop: menu disables moving a signed bid back to Sent", (await sentItem.getAttribute("data-disabled")) !== null);
  await page.screenshot({ path: `${dir}/after-move-menu-desktop.png` });
  await page.keyboard.press("Escape");
  const before = (await calls()).length;
  await drag(page, "Primary bath remodel", "scheduled");
  await page.waitForTimeout(500);
  check("desktop: dropping an unwon bid on Scheduled is refused", (await calls()).length === before && await inCol(page, "sent", "Primary bath remodel"));

  // Next action on a Won card: Schedule Now -> Scheduled
  // With project scheduling on (NEXT_PUBLIC_PROJECT_SCHEDULING=on) Schedule Now opens the wizard instead.
  const next = card(page, "Roof replacement").getByTestId("next-action");
  const href = await next.getAttribute("href");
  if (href) {
    check("desktop: Schedule Now opens the scheduling wizard for a won bid", /^\/projects\/new\?estimate=/.test(href) && (await next.textContent()).includes("Schedule Now"));
  } else {
    await next.click();
    await toast(page); await page.waitForTimeout(800);
    check("desktop: Schedule Now moves a won bid to Scheduled", await inCol(page, "scheduled", "Roof replacement"));
  }

  // Keyboard: open the menu with the keyboard and move
  await card(page, "Primary bath remodel").getByTestId("move-menu").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Awaiting Signature" }).focus();
  await page.keyboard.press("Enter");
  await toast(page); await page.waitForTimeout(800);
  check("desktop: keyboard Move To works", await inCol(page, "awaiting", "Primary bath remodel"));

  // Lost asks why
  await card(page, "Primary bath remodel").getByTestId("move-menu").click();
  await page.getByRole("menuitem", { name: "Lost / Declined" }).click();
  check("desktop: Lost asks for a reason", await page.getByLabel(/Why was it lost/).isVisible());
  await page.getByLabel(/Why was it lost/).fill("Price");
  await page.getByRole("button", { name: "Mark lost" }).click();
  await toast(page); await page.waitForTimeout(800);
  check("desktop: lost reason shown on card", (await card(page, "Primary bath remodel").textContent()).includes("Reason: Price"));

  // Analytics + date filter
  await page.getByTestId("view-analytics").click();
  const won = await page.getByTestId("an-won").textContent();
  check("desktop: analytics counts wins by event (6 won all time: 2 e-signed, 4 manual; scheduling isn't a new win)", /Approved \/ won6/.test(won) && won.includes("2 e-signed · 4 approved manually"));
  await page.getByTestId("range").selectOption("30d");
  const won30 = await page.getByTestId("an-won").textContent();
  const lost30 = await page.getByTestId("an-lost").textContent();
  check("desktop: last 30 days counts 5 wins and 2 losses (older window job and old loss excluded)", /won5/.test(won30) && /declined2/.test(lost30));
  check("desktop: small sample hides win rate %", (await page.getByTestId("an-winrate").textContent()).includes("—") || (await page.getByTestId("an-winrate").textContent()).includes("decided"));
  await page.getByTestId("range").selectOption("all");
  await page.getByTestId("sales-pay").getByRole("button").first().click();
  await page.getByLabel("Rate (%)").fill("10");
  const total = await page.getByTestId("sales-pay-total").textContent();
  check(`desktop: sales pay estimate computed (${total})`, /^\$[\d,]+\.\d\d$/.test(total) && total !== "$0.00");
  await page.screenshot({ path: `${dir}/after-analytics-desktop.png`, fullPage: true });
  await page.getByTestId("view-table").click();
  check("desktop: Table view keeps the existing list and actions", (await page.getByRole("button", { name: "Duplicate" }).count()) > 0);
  check("desktop: no page errors", errors.length === 0);
  if (errors.length) console.log(errors);
  await ctx.close();
}

// ---------------- Mobile ----------------
for (const [label, vp] of [["m390", { width: 390, height: 844 }], ["m320", { width: 320, height: 720 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label}: no horizontal scroll (${sw})`, sw <= vp.width);
  await page.screenshot({ path: `${dir}/after-pipeline-${label}.png`, fullPage: true });
  if (label === "m390") {
    await card(page, "Seamless gutters").getByTestId("move-menu").tap();
    await page.getByRole("menuitem", { name: "Sent", exact: true }).tap();
    await toast(page); await page.waitForTimeout(800);
    check(`${label}: three-dot Move To works on mobile`, (await calls()).at(-1)?.p_stage === "sent");
    const t = await page.locator("[data-testid=bid-card] [data-testid=move-menu]").first().boundingBox();
    check(`${label}: menu target is at least 36px`, t.width >= 36 && t.height >= 36);
    await page.getByTestId("view-analytics").tap();
    await page.screenshot({ path: `${dir}/after-analytics-${label}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("✗")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);
