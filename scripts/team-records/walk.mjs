// Team records browser walk against the REAL team-records SQL on a throwaway local database (TEST DATA ONLY):
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/team-records/setup-db.mjs)
//   PG_REST_AS_USER=00000000-0000-4000-8000-000000000001 PG_REST_PREFIXES=pm_,price_import,project_schedules,saved_items \
//     node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x NEXT_PUBLIC_PROJECT_SCHEDULING=on
//   npm run build && npx next start -p 3000 &
//   node scripts/team-records/walk.mjs <screenshotDir>
// Covers: sub compliance badges on People & subs, supplier directory + price-list detail + add, time clock with
// consented location, approvals / send back / manager fix with reason / history / payroll CSV, sub records
// (masked TIN, W-9 upload + 60-second file link), 1099 totals + CSV, supplier picker on price imports; 1440 / 390, dark.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "team-records-shots";
fs.mkdirSync(dir, { recursive: true });
const ME = "00000000-0000-4000-8000-000000000001";
const user = { id: ME, aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
const browser = await chromium.launch();
const errors = [];
async function open(path, vp = { width: 1440, height: 1000 }, theme = null) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, acceptDownloads: true, geolocation: { latitude: 44.97776, longitude: -93.26501, accuracy: 18 }, permissions: ["geolocation"] });
  await ctx.addCookies([authCookie]);
  if (theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 3500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(300);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });

// 1. People & subs: compliance badges + nav
{
  const { ctx, page } = await open("/projects/team");
  await page.getByTestId("team-directory").waitFor();
  check("Team sections nav shows 6 tabs", (await page.getByTestId("team-nav").getByRole("link").count()) === 6);
  const stone = page.getByTestId("team-card").filter({ hasText: "Stone Works" });
  check("Stone Works shows expired insurance + W-9 on file", /1 expired/.test(await stone.textContent()) && /W-9 on file/.test(await stone.textContent()));
  check("Bright Electric shows expiring within 30 days", /expiring within 30 days/.test(await page.getByTestId("team-card").filter({ hasText: "Bright Electric" }).textContent()));
  check("Ace Gutters shows No W-9", /No W-9/.test(await page.getByTestId("team-card").filter({ hasText: "Ace Gutters" }).textContent()));
  check("owner sees the records link", (await stone.getByTestId("sub-records-link").count()) === 1);
  await shot(page, "01-people-subs-badges");
  await ctx.close();
}

// 2. Suppliers
{
  const { ctx, page } = await open("/projects/team/suppliers");
  await page.getByTestId("supplier-directory").waitFor();
  check("two suppliers listed", (await page.getByTestId("supplier-card").count()) === 2);
  const abc = page.getByTestId("supplier-card").filter({ hasText: "ABC Supply" });
  check("ABC shows 1 price list and 3 priced items", /1 price list imported/.test(await abc.textContent()) && /prices 3 of your Saved Items/.test(await abc.textContent()));
  await abc.getByTestId("supplier-toggle").click();
  await abc.getByTestId("supplier-detail").getByText("abc-november.xlsx").waitFor();
  check("detail lists the import and items", /Architectural shingles/.test(await abc.getByTestId("supplier-detail").textContent()));
  await shot(page, "02-suppliers-detail");
  await page.getByTestId("supplier-add").click();
  await page.getByTestId("supplier-name").fill("Northside Paint & Coatings");
  await page.getByTestId("supplier-save").click();
  await page.getByText("Northside Paint & Coatings saved.").waitFor();
  await page.getByTestId("supplier-card").filter({ hasText: "Northside Paint" }).waitFor();
  check("added a supplier", (await page.getByTestId("supplier-card").count()) === 3);
  await page.getByTestId("supplier-add").click();
  await page.getByTestId("supplier-name").fill("lakeside lumber");
  await page.getByTestId("supplier-save").click();
  await page.getByText("You already have a supplier with that name.").waitFor();
  check("duplicate supplier name refused with a clear message", true);
  await ctx.close();
  const p2 = await open("/projects/team/suppliers", { width: 390, height: 844 });
  await p2.page.getByTestId("supplier-directory").waitFor();
  check("suppliers: no sideways scroll at 390", await noHScroll(p2.page));
  await shot(p2.page, "03-suppliers-phone");
  await p2.ctx.close();
}

// 3. Employees & time
{
  const { ctx, page } = await open("/projects/team/time");
  await page.getByTestId("time-workspace").waitFor();
  await page.getByTestId("time-table").waitFor();
  check("employee directory lists 4 staff", (await page.getByTestId("employee-card").count()) === 4);
  check("manager sees cost rate", /cost \$42\.50\/h/.test(await page.getByTestId("employee-card").filter({ hasText: "Cris Carpenter" }).textContent()));
  check("timesheet lists this week's 6 entries", (await page.getByTestId("time-row").count()) === 6);
  check("punch location shows accuracy", (await page.getByTestId("time-table").getByText("within 14 m").count()) === 1);
  check("labor by project shows deck cost", /Backyard deck/.test(await page.getByTestId("labor-by-project").textContent()));
  await shot(page, "04-time-overview");
  // Clock in with location
  await page.getByTestId("clock-location").check();
  await page.getByTestId("clock-in").click();
  await page.getByText(/^Clocked in\./).waitFor();
  await page.getByTestId("clock-out").waitFor();
  check("clocked in (status shows Clocked in)", /Clocked in/.test(await page.getByTestId("clock-status").textContent()));
  await page.getByTestId("time-table").getByText("within 18 m").first().waitFor({ timeout: 5000 }).catch(() => {});
  check("own punch saved with location", (await page.getByTestId("time-table").getByText("within 18 m").count()) >= 1);
  await shot(page, "05-time-clocked-in");
  await page.getByTestId("clock-break").fill("0");
  await page.getByTestId("clock-out").click();
  await page.getByText(/Clocked out:/).waitFor();
  check("clocked out, waiting for approval", true);
  // Approve Cris's pending entry
  const crisPending = page.getByTestId("time-row").filter({ hasText: "Cris Carpenter" }).filter({ hasText: "Waiting for approval" });
  await crisPending.getByRole("checkbox").check();
  await page.getByTestId("time-approve").click();
  await page.getByText(/1 entry approved/).waitFor();
  check("approved an entry", true);
  // Manager fix with reason (Pam's pending entry)
  const pamRow = page.getByTestId("time-row").filter({ hasText: "Pam Manager" });
  await pamRow.getByTestId("time-edit").click();
  await page.getByTestId("entry-form").waitFor();
  check("fix needs a reason (Save disabled)", await page.getByTestId("entry-save").isDisabled());
  await page.getByTestId("entry-reason").fill("Forgot to clock out at lunch");
  await page.getByTestId("entry-save").click();
  await page.getByText(/Entry fixed/).waitFor();
  await page.getByTestId("time-row").filter({ hasText: "Pam Manager" }).getByRole("button", { name: "History" }).click();
  await page.getByText(/Forgot to clock out at lunch/).waitFor();
  check("history shows the edit and reason", true);
  // Add time for Jose
  await page.getByTestId("time-add").click();
  await page.getByTestId("entry-who").selectOption({ label: "Jose Martinez" });
  const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  await page.getByTestId("entry-in").fill(`${day}T05:00`); await page.getByTestId("entry-out").fill(`${day}T06:30`);
  await page.getByTestId("entry-reason").fill("Paper timesheet");
  await page.getByTestId("entry-save").click();
  await page.getByText("Time added.").waitFor();
  check("manager added time", true);
  await shot(page, "06-time-after-actions");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("time-export-payroll").click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  check("payroll prep CSV has hours-over-40 column and names", /Hours over 40/.test(csv) && /Cris Carpenter/.test(csv));
  fs.writeFileSync(`${dir}/payroll-prep-sample.csv`, csv);
  await ctx.close();
  const p2 = await open("/projects/team/time", { width: 390, height: 844 });
  await p2.page.getByTestId("time-table").waitFor();
  check("time: no page sideways scroll at 390 (table scrolls in its box)", await noHScroll(p2.page));
  await shot(p2.page, "07-time-phone");
  await p2.ctx.close();
  const p3 = await open("/projects/team/time", { width: 1440, height: 1000 }, "dark");
  await p3.page.getByTestId("time-table").waitFor();
  await shot(p3.page, "08-time-dark");
  await p3.ctx.close();
}

// 4. Sub records
{
  const { ctx, page } = await open("/projects/team/subs");
  await page.getByTestId("renewals").waitFor();
  check("renewals list Stone (expired) and Bright (expiring)", /Stone Works/.test(await page.getByTestId("renewals").textContent()) && /Bright Electric/.test(await page.getByTestId("renewals").textContent()));
  await shot(page, "09-sub-records-list");
  await page.getByTestId("sub-row").filter({ hasText: "Stone Works" }).getByRole("link", { name: "Open records" }).click();
  await page.getByTestId("sub-record").waitFor();
  check("TIN masked to last 4", (await page.getByTestId("tin-masked").textContent()).includes("EIN ••-•••6789"));
  check("expired certificate flagged", (await page.getByTestId("doc-card").filter({ hasText: "General liability" }).getByText(/Expired/).count()) === 1);
  check("last-4 field accepts only 4 digits", (await page.getByTestId("tax-last4").getAttribute("maxlength")) === "4");
  await page.getByTestId("doc-add-type").selectOption("w9");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  await page.getByTestId("doc-file").setInputFiles({ name: "stone-w9.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByTestId("doc-save").click();
  await page.getByText("W-9 recorded.").waitFor();
  const w9 = page.getByTestId("doc-card").filter({ hasText: "W-9" });
  check("W-9 on file with its file", (await w9.getByTestId("doc-open").count()) === 1);
  const href = await w9.getByTestId("doc-open").getAttribute("href");
  const res = await page.request.get(`${A}${href}`, { maxRedirects: 0 });
  check("file opens through a short-lived redirect", res.status() === 302 && /sub-records-file/.test(res.headers().location ?? ""));
  await page.getByTestId("doc-add-type").selectOption("txt" === "x" ? "" : "workers_comp");
  await page.getByTestId("doc-file").setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") });
  await page.getByTestId("doc-save").click();
  await page.getByText("Upload a PDF, JPG, PNG or WebP.").waitFor();
  check("non-PDF content refused even when named .pdf", true);
  await shot(page, "10-sub-record");
  await ctx.close();
  const p2 = await open(page.url().replace(A, ""), { width: 390, height: 844 });
  await p2.page.getByTestId("sub-record").waitFor();
  check("sub record: no sideways scroll at 390", await noHScroll(p2.page));
  await shot(p2.page, "11-sub-record-phone");
  await p2.ctx.close();
}

// 5. 1099 totals
{
  const { ctx, page } = await open("/projects/team/1099");
  await page.getByTestId("totals-1099").waitFor();
  await page.getByTestId("row-1099").first().waitFor();
  const rows = await page.getByTestId("row-1099").allTextContents();
  check("1099: Stone counts check+ACH ($12,200), not card", /Stone Works/.test(rows[0]) && /\$12,200\.00/.test(rows[0]) && /\$2,000\.00/.test(rows[0]) && /Needed/.test(rows[0]));
  check("1099: $2,000 threshold for 2026, Mike's $1,500 below it", /\$2,000\.00/.test(await page.getByTestId("totals-1099").textContent()) && rows.some((r) => /Mike/.test(r) && /Below threshold/.test(r)));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-1099").click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  check("1099 CSV masks the tax ID", /EIN ••-•••6789/.test(csv) && !/\d{9}/.test(csv));
  await shot(page, "12-1099-totals");
  await ctx.close();
}

// 6. Price import: supplier picker
{
  const { ctx, page } = await open("/dashboard/items/import");
  await page.getByTestId("price-import-supplier").waitFor();
  await page.waitForTimeout(800);
  await page.getByTestId("price-import-supplier").fill("ABC Supply – Springfield");
  check("import recognizes a directory supplier", /From your supplier list/.test(await page.getByTestId("price-import-supplier-hint").textContent()));
  await page.getByTestId("price-import-supplier").fill("Brand New Supply");
  check("import says a new supplier will be added", /New supplier/.test(await page.getByTestId("price-import-supplier-hint").textContent()));
  await shot(page, "13-import-supplier-picker");
  await ctx.close();
}

await browser.close();
const bad = out.filter((l) => l.startsWith("✗"));
console.log(out.join("\n"));
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
console.log(`${out.length - bad.length}/${out.length} checks passed`);
process.exit(bad.length || errors.length ? 1 : 0);
