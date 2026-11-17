// V6.0 Stage A: Trade scope "Unassigned" assignee picker, real browser against the mock Supabase
// (fictitious test data only, NOT production).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 ..., `next start`,
//   node scripts/ux-audit/mock-supabase.mjs, then: node scripts/v6/scope-assign-walk.mjs <dir>
// Against the OLD build (native <select>) it records the reproduction of the bug instead (MODE=before).
// Restart the mock before re-running (assignments and new contacts persist in its memory).
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "scope-assign-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => { out.push(`${c ? "✓" : "✗"} ${n}`); };
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const S2 = "77777777-7777-4777-8777-000000000002";
await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__team?reset=1&seed=1&manage=1&foreign=1`);
await fetch(`${M}/__ops?seed=1&styleManaged=0&allow=1&canOverride=1`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(path, vp = DESK) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: "light", at: 4102444800000 })); } catch { /* */ } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 2500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(400);
  return { ctx, page };
}
const scopeState = async () => (await (await fetch(`${M}/rest/v1/project_scope_sections?select=*`)).json());

// A draft schedule turns the estimate into a project page.
let sid;
{
  const { ctx, page } = await open("/dashboard");
  const r = await page.evaluate(async ([est, g1, g2]) => {
    const res = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      estimateId: est, calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, startDate: new Date().toISOString().slice(0, 10),
      sections: [{ sourceGroupId: g1, durationDays: 2, sortOrder: 0 }, { sourceGroupId: g2, durationDays: 4, sortOrder: 1 }], deps: [] }) });
    return { status: res.status, body: await res.json() };
  }, [EST, G(1), G(2)]);
  sid = r.body.id;
  check("project created for the walk", r.status === 201 && !!sid);
  await ctx.close();
}

async function scopeTab(vp = DESK) {
  const o = await open(`/projects/${sid}?tab=scope`, vp);
  await o.page.getByTestId("scope-panel").waitFor({ timeout: 15000 });
  await o.page.waitForTimeout(300);
  return o;
}

const { ctx, page } = await scopeTab();
const legacy = (await page.locator("select[aria-label^='Assign']").count()) > 0;
const MODE = legacy ? "before" : "after";
out.push(`MODE=${MODE}`);
const sec = page.getByTestId("scope-section").nth(1);

if (legacy) {
  // Reproduce the reported "Unassigned does nothing".
  const sel = sec.locator("select[aria-label^='Assign']");
  const opts = await sel.locator("option").allTextContents();
  check("BEFORE: dropdown offers an entry from another directory", opts.some((t) => t.includes("other directory")));
  check("BEFORE: no way to add a new person from the dropdown", !opts.some((t) => /add|new/i.test(t)));
  await page.screenshot({ path: `${dir}/before-01-scope-desktop.png` });
  await sel.selectOption({ label: "Northside Gutters (other directory) (sub)" });
  await page.waitForTimeout(1500);
  const after = await sel.inputValue();
  check("BEFORE: picking it snaps back to Unassigned (save refused by the server)", after === "");
  check("BEFORE: and no error is visible while the section is collapsed", (await sec.getByRole("alert").count()) === 0);
  await page.screenshot({ path: `${dir}/before-02-snapped-back.png` });
  // Unsaved notes are wiped by an assignment.
  const s3 = page.getByTestId("scope-section").nth(2);
  await s3.locator("button[aria-expanded]").first().click();
  await s3.getByLabel("Work description").fill("Typed but not saved yet");
  await s3.locator("select[aria-label^='Assign']").selectOption({ label: "Jose Martinez" });
  await page.waitForTimeout(1500);
  check("BEFORE: assigning saves half-typed notes without asking", ((await scopeState()).find((x) => x.id === "77777777-7777-4777-8777-000000000003")?.work_description ?? "") === "Typed but not saved yet");
  await ctx.close();
} else {
  const trig = sec.getByTestId("scope-assign-trigger");
  check("picker shows Unassigned", (await trig.innerText()).includes("Unassigned"));
  await page.screenshot({ path: `${dir}/after-01-scope-desktop.png` });
  await trig.click();
  const list = page.getByRole("listbox", { name: /^Assign Siding: Siding installation/ });
  await list.waitFor();
  check("list opens with Employees / Crews / Subcontractors groups", (await list.innerText()).includes("EMPLOYEES") || (await list.getByText("Employees").count()) > 0);
  check("entry from another directory is NOT offered", (await list.getByText("Northside Gutters").count()) === 0);
  check("inline Add new is offered", (await page.getByTestId("scope-assign-create").count()) > 0);
  await page.screenshot({ path: `${dir}/after-02-picker-open.png` });
  await page.getByTestId("scope-assign-search").fill("jose");
  check("search filters to Jose", (await list.getByRole("option").filter({ hasText: "Jose Martinez" }).count()) === 1 && (await list.getByRole("option").filter({ hasText: "Stone Works" }).count()) === 0);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  check("keyboard Enter assigns and shows confirmation", (await sec.getByTestId("scope-assign-status").innerText()).includes("Assigned to Jose Martinez"));
  check("assignment persisted in the database", (await scopeState()).find((x) => x.id === S2)?.resource_id !== null);
  check("assigning kept the section's saved text", (await scopeState()).find((x) => x.id === S2)?.work_description === "Install Dutch lap vinyl, color Sandstone.");
  await page.screenshot({ path: `${dir}/after-03-assigned.png` });

  // Escape and outside click close without changing anything.
  await trig.click(); await list.waitFor();
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check("Escape closes the list", (await list.count()) === 0);
  await trig.click(); await list.waitFor();
  await page.getByText("Built from the approved proposal.").click(); await page.waitForTimeout(200);
  check("outside click closes the list", (await list.count()) === 0);

  // Reassign + unassign.
  await trig.click(); await list.waitFor();
  await list.getByRole("option").filter({ hasText: "Crew A" }).click(); await page.waitForTimeout(800);
  check("reassign to a crew", (await trig.innerText()).includes("Crew A"));
  await trig.click(); await list.waitFor();
  await page.getByTestId("scope-assign-unassign").click(); await page.waitForTimeout(800);
  check("unassign", (await trig.innerText()).includes("Unassigned") && (await scopeState()).find((x) => x.id === S2)?.resource_id === null);

  // Unsaved notes survive an assignment.
  const s3 = page.getByTestId("scope-section").nth(2);
  await s3.locator("button[aria-expanded]").first().click();
  await s3.getByLabel("Work description").fill("Typed but not saved yet");
  await s3.getByTestId("scope-assign-trigger").click();
  await page.getByRole("listbox").getByRole("option").filter({ hasText: "Alex Rivera" }).click();
  await page.waitForTimeout(1000);
  check("assigning doesn't save half-typed notes", ((await scopeState()).find((x) => x.id === "77777777-7777-4777-8777-000000000003")?.work_description ?? null) === null);
  check("…and doesn't wipe them from the form", (await s3.getByLabel("Work description").inputValue()) === "Typed but not saved yet");

  // Inline create + assign.
  await trig.click(); await list.waitFor();
  await page.getByTestId("scope-assign-search").fill("Riverbend Electric");
  await page.getByTestId("scope-assign-create").click();
  await page.getByTestId("new-contact-form").waitFor();
  check("new contact form says it isn't a paid seat", (await page.getByText("doesn't use a paid seat").count()) > 0);
  await page.screenshot({ path: `${dir}/after-04-add-new.png` });
  await page.getByTestId("new-contact-save").click(); await page.waitForTimeout(1200);
  check("new subcontractor created and assigned", (await trig.innerText()).includes("Riverbend Electric"));
  const team = await (await fetch(`${M}/rest/v1/pm_resources?select=*`)).json();
  check("new contact saved to Team & Subcontractors", team.some((r) => r.name === "Riverbend Electric" && r.kind === "subcontractor"));

  // A save that loses a race is reported next to the picker, not hidden.
  await fetch(`${M}/rest/v1/rpc/project_scope_save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_section_id: S2, p_base_revision: (await scopeState()).find((x) => x.id === S2).revision, p: { resourceId: "", workDescription: "Install Dutch lap vinyl, color Sandstone." } }) });
  await trig.click(); await list.waitFor();
  await list.getByRole("option").filter({ hasText: "Stone Works" }).click(); await page.waitForTimeout(900);
  check("conflict error is visible beside the collapsed section's picker", /changed this section first/.test(await sec.getByTestId("scope-assign-status").innerText()));
  await page.screenshot({ path: `${dir}/after-05-conflict-visible.png` });
  await ctx.close();

  // Bulk assign.
  {
    const o = await scopeTab();
    const bulk = o.page.getByTestId("bulk-assign");
    check("bulk assign offered when sections are unassigned", (await bulk.count()) === 1);
    await bulk.getByTestId("bulk-picker-trigger").click();
    await o.page.getByRole("listbox", { name: "Assign all unassigned sections" }).getByRole("option").filter({ hasText: "Peak Roofing" }).click();
    await o.page.waitForTimeout(1500);
    const st = await scopeState();
    check("bulk assign assigned every unassigned section", st.every((x) => x.resource_id));
    await o.page.screenshot({ path: `${dir}/after-06-bulk.png` });
    await o.ctx.close();
  }

  // Phone.
  {
    const o = await scopeTab(PHONE);
    await o.page.getByTestId("scope-section").nth(0).getByTestId("scope-assign-trigger").click();
    await o.page.waitForTimeout(300);
    const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - 390);
    check(`phone 390: picker open, no sideways scroll (overflow ${overflow}px)`, overflow <= 0);
    const tgt = await o.page.getByTestId("scope-section").nth(0).getByTestId("scope-assign-trigger").boundingBox();
    check("phone 390: picker trigger is a 44px touch target", (tgt?.height ?? 0) >= 44);
    await o.page.screenshot({ path: `${dir}/after-07-phone-open.png` });
    await o.ctx.close();
  }
}

await browser.close();
check("no page errors", errors.length === 0);
if (errors.length) out.push(...errors.map((e) => `  ${e}`));
console.log(out.join("\n"));
fs.writeFileSync(`${dir}/results-${MODE}.txt`, out.join("\n") + "\n");
