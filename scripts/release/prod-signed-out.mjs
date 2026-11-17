// Release checklist, signed-out half, against the LIVE site (read-only: the bid stays a draft on this
// device; nothing is sent, no account is created, no email code is requested).
//   node scripts/release/prod-signed-out.mjs [baseUrl] [outDir]      MOBILE=1 for an iPhone 13
// Steps: homepage → start free bid (siding) → company → customer → estimate (20 sq × $85) → proposal →
// "Download PDF" asks for an account (email code) → reload keeps the draft.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const BASE = process.argv[2] ?? "https://built2bid.org";
const OUT = process.argv[3] ?? "release-shots";
const MOBILE = process.env.MOBILE === "1";
fs.mkdirSync(OUT, { recursive: true });
const out = []; const check = (n, ok, extra = "") => out.push(`${ok ? "✓" : "✗"} ${n}${extra ? ` (${extra})` : ""}`);
const b = await chromium.launch();
const ctx = await b.newContext(MOBILE ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage(); const tag = MOBILE ? "m390" : "d1440";
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => p.screenshot({ path: `${OUT}/${tag}-${n}.png` });
const t0 = Date.now(); const home = await p.goto(BASE, { waitUntil: "load" });
check("Homepage loads", home.status() === 200, `${Date.now() - t0} ms`); await shot("01-home");
await p.goto(`${BASE}/start/siding`, { waitUntil: "load" }); await p.waitForURL(/builder/);
check("Start free bid opens the builder with a local draft", /draft=/.test(p.url()));
await p.getByRole("button", { name: "No, I'll enter it" }).click().catch(() => {});
const fill = (label, v) => p.getByLabel(label, { exact: false }).first().fill(v);
await fill("Company name", "QA Test Siding Co"); await fill("Contact name", "QA Tester"); await fill("Business email", "qa@example.test");
await fill("Phone number", "5555550100"); await fill("Business address", "100 Test St, Minneapolis, MN"); await p.keyboard.press("Escape");
await p.getByRole("button", { name: /Next: customer/ }).click(); await p.waitForTimeout(500);
await fill("Customer name", "Pat QA"); await fill("Project address", "48 Oak Lane, Springfield, IL"); await p.keyboard.press("Escape");
await fill("Project title", "QA siding replacement"); await shot("02-customer");
check("Customer entered", (await p.getByLabel("Customer name", { exact: false }).first().inputValue()) === "Pat QA");
await p.getByRole("button", { name: /Next: build the estimate/ }).click(); await p.waitForTimeout(800);
await p.getByRole("button", { name: /Add Remove existing siding/ }).click(); await p.waitForTimeout(400);
await p.locator('input[aria-label="Quantity"]').first().fill("20");
await p.locator('input[aria-label="Internal unit cost"]').first().fill("85"); await p.keyboard.press("Tab"); await p.waitForTimeout(400);
const total = (await p.locator("main").innerText()).match(/Proposal total\s*\$([\d,.]+)/)?.[1];
check("Estimate math (20 × $85 + 25% markup = $2,125.00)", total === "2,125.00", total); await shot("03-estimate");
await p.getByRole("button", { name: /Next: scope/ }).click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /^Next:/ }).last().click(); await p.waitForTimeout(1200);
check("Proposal live preview shows the company", (await p.locator("main").innerText()).includes("QA Test Siding Co")); await shot("04-proposal");
await p.getByRole("button", { name: "Download PDF" }).first().click(); await p.waitForTimeout(1200);
const dlg = (await p.getByRole("dialog").innerText().catch(() => "")) ?? "";
check("Saving/downloading asks for a free account by email code", /Create your free account/.test(dlg) && /6-digit code/.test(dlg));
check("Marketing consent is a separate, unticked opt-in", !(await p.getByRole("dialog").getByRole("checkbox").first().isChecked().catch(() => true))); await shot("05-account-prompt");
await p.keyboard.press("Escape"); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1200);
check("Draft survives a reload", (await p.locator("body").innerText()).includes("2,125.00")); await shot("06-after-reload");
check("No page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
console.log(out.join("\n")); fs.writeFileSync(`${OUT}/${tag}-results.txt`, out.join("\n") + "\n");
await b.close();
process.exit(out.some((l) => l.startsWith("✗")) ? 1 : 0);
