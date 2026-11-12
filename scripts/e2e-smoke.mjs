// Browser smoke test of the anonymous bid flow (no account, no network calls to Supabase/Stripe).
// Usage: npm run build && npx next start -p 3100 &  then  node scripts/e2e-smoke.mjs [baseUrl]
// Requires the `playwright` package (pre-installed in Claude Code cloud sessions; otherwise `npm i -D playwright`).
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:3100";
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch();
for (const [name, viewport] of Object.entries(viewports)) {
  console.log(`\n# ${name}`);
  const page = await (await browser.newContext({ viewport })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/");
  check(await page.getByRole("heading", { level: 1, name: /Win More Bids\. Look More Professional\. Get Back to Building\./ }).isVisible(), "home hero headline");
  await page.getByRole("link", { name: "Create a free bid" }).first().click();
  await page.waitForURL(/\/bids$/);
  check(true, "primary CTA opens trade selection");

  await page.goto(base + "/start/decks");
  await page.waitForURL(/\/builder\?draft=/);
  const steps = page.getByRole("navigation", { name: "Builder steps" });
  check(await steps.getByRole("button", { name: /Company/ }).getAttribute("aria-current") === "step", "first visit opens Company step");

  await page.fill("#b-name", "Smoke Test Builders");
  await page.getByRole("button", { name: /Next: customer & project/ }).click();
  check(await steps.getByRole("button", { name: /Company.*\(done\)/ }).count() === 1, "Company step marked done");
  await page.fill("#c-name", "Example Customer");
  await page.getByRole("button", { name: /Next: build the estimate/ }).click();

  await page.getByRole("button", { name: "Add line item" }).first().click();
  await page.keyboard.type("Composite deck boards");
  await page.getByLabel("Quantity").first().fill("10");
  await page.getByLabel("Internal unit cost").first().fill("40");
  await page.waitForTimeout(300);
  // 10 x 40 = 400 cost; 25% default markup -> 500 price (no tax by default).
  check(await page.getByText("$500.00").first().isVisible(), "line item price computes 10 x $40 at 25% markup = $500.00");

  await page.getByRole("button", { name: /Next: scope & exclusions/ }).click();
  check(await steps.getByRole("button", { name: /Scope/ }).getAttribute("aria-current") === "step", "Next reaches Scope & exclusions step");
  await page.getByRole("button", { name: /Next: proposal & terms/ }).click();
  check(await steps.getByRole("button", { name: /Proposal/ }).getAttribute("aria-current") === "step", "Next reaches Proposal step");
  await page.getByRole("button", { name: /Back/ }).click();
  check(await steps.getByRole("button", { name: /Scope/ }).getAttribute("aria-current") === "step", "Back returns to Scope & exclusions");
  await page.getByRole("button", { name: /Back/ }).click();
  check(await steps.getByRole("button", { name: /Estimate/ }).getAttribute("aria-current") === "step", "Back returns to Estimate");

  await page.reload();
  await page.waitForTimeout(800);
  check(await page.getByText("$500.00").first().isVisible(), "draft survives a page refresh (local autosave)");

  await page.getByRole("button", { name: /Next: scope & exclusions/ }).click();
  await page.getByRole("button", { name: /Next: proposal & terms/ }).click();
  await page.getByRole("button", { name: /Preview & download/ }).click();
  const dialog = page.getByRole("dialog");
  check(await dialog.getByText("Smoke Test Builders").first().isVisible(), "preview shows the contractor's company");
  check(await dialog.getByText("Example Customer").first().isVisible(), "preview shows the customer");
  await dialog.getByRole("button", { name: /Download PDF/ }).click();
  await page.waitForTimeout(400);
  check(await page.getByRole("dialog").getByText(/Create your free account to download/).isVisible(), "anonymous download asks for a free account (no credit used)");
  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
