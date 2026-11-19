// Batch: signed-out plan choice on /pricing. Choosing a plan asks to verify the email; closing that dialog keeps the
// plan saved (banner) and does not reopen the dialog by itself on later visits (F3). No Stripe call is made.
import { chromium, watch, recorder, BASE } from "../lib.mjs";
const rec = recorder("checkout");
const b = await chromium.launch();
const T = (id, name, exp, fn) => rec.test(`CO-${id}`, "Billing", name, exp, fn);
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); const w = watch(p);
const dialog = () => p.getByRole("dialog").filter({ hasText: "You're almost there!" });
await T("01", "Signed-out visitor chooses a plan", "Verify-your-email dialog opens with the plan", async () => {
  await p.goto(BASE + "/pricing"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await p.getByRole("button", { name: /^Choose (Monthly|Annual)$/ }).first().click();
  await dialog().waitFor({ timeout: 8000 }).catch(() => {});
  return (await dialog().isVisible()) || { fail: "dialog did not open" };
});
await T("02", "Closing the dialog keeps the plan as a banner", "Dialog closes; banner with Continue shows", async () => {
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  const banner = await p.getByText("Your", { exact: false }).filter({ hasText: "selection is saved" }).first().isVisible().catch(() => false);
  return !(await dialog().isVisible()) && banner ? "banner shown" : { fail: `dialog ${await dialog().isVisible()}, banner ${banner}` };
});
await T("03", "Coming back later doesn't pop the dialog open again", "Reload: no dialog, banner still offers to continue", async () => {
  await p.reload(); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(1200);
  const open = await dialog().isVisible(); const cont = await p.getByRole("button", { name: /Continue to secure checkout/ }).first().isVisible().catch(() => false);
  return !open && cont ? "no dialog; banner offers Continue" : { fail: `dialog ${open}, continue ${cont}` };
});
await T("04", "Continue from the banner reopens verification", "Dialog opens again", async () => {
  await p.getByRole("button", { name: /Continue to secure checkout/ }).first().click(); await dialog().waitFor({ timeout: 8000 }).catch(() => {});
  const ok = await dialog().isVisible(); if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return ok || { fail: "dialog did not reopen" };
});
console.log(rec.counts); await ctx.close(); await b.close();
