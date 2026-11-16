// Browser walk: Schedule Now review step bars can be dragged/resized/date-edited, and the company owner's
// Manage button opens a useful panel. Mock Supabase + local build only (see scripts/schedule/walk.mjs header).
//   node scripts/schedule/review-drag-walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "review-drag-shots";
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
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1360, height: 1000 }) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 4000 }); await later.click(); await page.waitForTimeout(300); } catch { /* no feature modal */ }
  return { ctx, page };
}
const toReview = async (page) => {
  await page.getByTestId("schedule-wizard").waitFor();
  await page.getByTestId("wizard-next").click(); await page.getByTestId("wizard-next").click();
  await page.getByTestId("start-date").fill("2026-12-07");
  for (let i = 0; i < 4; i++) await page.getByTestId("wizard-next").click();
};
const ranges = (page) => page.locator("[data-testid^=mini-row-] > span.flex").allTextContents();

for (const [label, vp] of [["desktop", { width: 1360, height: 1000 }], ["m390", { width: 390, height: 844 }]]) {
  const { ctx, page } = await open(`/projects/new?estimate=${EST}`, vp);
  await toReview(page);
  const bars = page.locator("[data-testid^=mini-bar-]");
  check(`${label}: review bars are draggable buttons`, (await bars.count()) === 4 && (await bars.first().getAttribute("role")) === "button");
  const before = await ranges(page);
  if (label === "desktop") {
    await page.screenshot({ path: `${dir}/review-before-desktop.png`, fullPage: true });
    // Drag the first bar right by ~2 days.
    const b = await bars.first().boundingBox();
    const track = await page.locator("[data-testid^=mini-row-] .relative.h-8").first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + track.width * 0.12, b.y + b.height / 2, { steps: 8 });
    await page.screenshot({ path: `${dir}/review-dragging-desktop.png`, fullPage: true });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterMove = await ranges(page);
    check("dragging the first bar moves it later", afterMove[0] !== before[0]);
    check("sections that wait on it move with it", afterMove[1] !== before[1]);
    // Resize the last bar's finish.
    const last = page.locator("[data-testid^=mini-end-]").last();
    const lb = await last.boundingBox();
    await page.mouse.move(lb.x + 3, lb.y + lb.height / 2); await page.mouse.down();
    await page.mouse.move(lb.x + 3 + track.width * 0.1, lb.y + lb.height / 2, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const afterResize = await ranges(page);
    check("dragging a bar's right edge extends it", afterResize[3] !== afterMove[3] && afterResize[0] === afterMove[0]);
    // Keyboard
    await bars.nth(2).focus(); await page.keyboard.press("ArrowRight");
    check("arrow key moves a bar", (await ranges(page))[2] !== afterResize[2]);
    await page.screenshot({ path: `${dir}/review-after-desktop.png`, fullPage: true });
  } else {
    await page.getByRole("button", { name: "Edit dates" }).first().click();
    const ed = page.locator("[data-testid^=mini-editor-]");
    await ed.locator("input[type=date]").fill("2026-12-09");
    await page.screenshot({ path: `${dir}/review-edit-dates-m390.png`, fullPage: true });
    await ed.getByRole("button", { name: "Apply" }).click();
    check("m390: Edit dates moves a section without dragging", (await ranges(page))[0].startsWith("Dec 9"));
    check("m390: no horizontal page scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: `${dir}/review-after-m390.png`, fullPage: true });
  }
  // Save sends offsets/durations; server rebuilds dates.
  let body = null;
  page.on("request", (r) => { if (r.url().endsWith("/api/schedules") && r.method() === "POST") body = JSON.parse(r.postData()); });
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("save-schedule").click();
  await page.waitForTimeout(1500);
  check(`${label}: save sends the dragged start as an offset or wait`, Boolean(body && (body.sections.some((s) => s.offsetDays > 0) || body.deps.some((d) => d.lagDays !== 0))));
  await fetch(`${M}/__sched?reset=1&stage=won`);
  await ctx.close();
}

// Manage button next to Company Owner.
await fetch(`${M}/__scenario?name=enterprise_owner`);
{
  const { ctx, page } = await open("/company/users");
  const me = page.getByTestId("member-row").filter({ hasText: "(you)" });
  const btn = me.getByRole("button", { name: "Manage" });
  if (await btn.count()) {
    await btn.click();
    check("owner Manage shows an explanation (not an empty box)", await me.getByTestId("owner-note").isVisible());
    await page.screenshot({ path: `${dir}/owner-manage-desktop.png`, fullPage: false });
  } else check("owner row has no dead Manage button", true);
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
