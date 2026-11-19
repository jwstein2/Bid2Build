// Batch: two-step sign-in (authenticator app, TOTP). Turn it on from Account settings, sign in again (email code,
// then authenticator code), keep the deep link, refuse a wrong code, turn it off. Uses its own synthetic account.
// Local Supabase needs [auth.mfa.totp] enroll_enabled/verify_enabled = true (production has it on).
import crypto from "node:crypto";
import { chromium, uiLogin, watch, recorder, BASE, q, closeDb, shot, dismissPopups } from "../lib.mjs";
const rec = recorder("two-step");
const b = await chromium.launch();
const vp = { viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] };
const T = (id, name, exp, fn) => rec.test(`MFA-${id}`, "Auth", name, exp, fn);
const email = "qa-2fa@audit.test";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), what an authenticator app computes from the setup key. */
function totp(secretB32, at = Date.now()) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of secretB32.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac("sha1", key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
// Setup: start from no factors so each run enrolls fresh.
await q("delete from auth.mfa_factors where user_id in (select id from auth.users where email=$1)", [email]);
let secret;

await T("01", "Turn on two-step sign-in with an authenticator app", "Setup key shown; correct code turns it on (factor verified)", async () => {
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); const w = watch(p);
  await uiLogin(p, email); await p.goto(BASE + "/settings/account#two-step"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p);
  await p.getByTestId("two-step-start").click(); await p.waitForTimeout(2000);
  secret = (await p.getByTestId("two-step").locator("code").innerText().catch(() => "")).trim();
  if (!secret) { await ctx.close(); return { fail: `no setup key; ${w.failed.slice(0, 2).join(";")}` }; }
  await p.getByTestId("two-step-code").fill("000000".slice(0, 6) === totp(secret) ? "111111" : "000000");
  await p.getByRole("button", { name: "Turn on" }).click(); await p.waitForTimeout(1500);
  const wrongRefused = !(await p.getByTestId("two-step-on").isVisible().catch(() => false));
  await p.getByTestId("two-step-code").fill(totp(secret)); await p.getByRole("button", { name: "Turn on" }).click(); await p.waitForTimeout(2500);
  const on = await p.getByTestId("two-step-on").isVisible().catch(() => false); await shot(p, "mfa-on"); await ctx.close();
  const f = await q("select status from auth.mfa_factors f join auth.users u on u.id=f.user_id where u.email=$1", [email]);
  return on && wrongRefused && f.some((x) => x.status === "verified") ? "wrong code refused; right code turned it on" : { fail: `on ${on}, wrongRefused ${wrongRefused}, factors ${JSON.stringify(f)}` };
});
await T("02", "Next sign-in asks for the authenticator code after the email code, and keeps the deep link", "Email code -> /auth/mfa -> wrong code refused -> right code lands on /financials/reports", async () => {
  if (!secret) return { blocked: "not enrolled (MFA-01)" };
  const ctx = await b.newContext(vp); const p = await ctx.newPage(); const w = watch(p);
  await p.goto(BASE + "/financials/reports"); await uiLogin(p, email, { loginPath: null }).catch(() => {});
  await p.waitForURL(/\/auth\/mfa/, { timeout: 15000 }).catch(() => {});
  if (!/\/auth\/mfa/.test(p.url())) { await ctx.close(); return { fail: `not asked for the second step (at ${p.url()})` }; }
  const box = p.getByLabel(/6-digit code/i).first();
  await box.fill(totp(secret) === "123456" ? "654321" : "123456"); await p.getByRole("button", { name: "Continue" }).click(); await p.waitForTimeout(1500);
  const stillThere = /\/auth\/mfa/.test(p.url());
  await box.fill(totp(secret)); await p.getByRole("button", { name: "Continue" }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/auth/mfa"), { timeout: 15000 }).catch(() => {});
  const landed = new URL(p.url()).pathname; await ctx.close();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return stillThere && landed === "/financials/reports" ? "wrong code refused; landed on /financials/reports" : { fail: `wrong refused ${stillThere}; landed ${landed}` };
});
await T("03", "Turn two-step sign-in off", "Factor removed", async () => {
  if (!secret) return { blocked: "not enrolled (MFA-01)" };
  const ctx = await b.newContext(vp); const p = await ctx.newPage();
  await p.goto(BASE + "/settings/account"); await uiLogin(p, email, { loginPath: null }).catch(() => {});
  if (/\/auth\/mfa/.test(p.url()) || await p.waitForURL(/\/auth\/mfa/, { timeout: 5000 }).then(() => true).catch(() => false)) {
    await p.getByLabel(/6-digit code/i).first().fill(totp(secret)); await p.getByRole("button", { name: "Continue" }).click(); await p.waitForTimeout(2500);
  }
  await p.goto(BASE + "/settings/account#two-step"); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p);
  // The page asks with the browser's own confirm box ("Turn off two-step sign-in?"); accept it like a person would.
  let asked = ""; p.once("dialog", (d) => { asked = d.message(); void d.accept(); });
  await p.getByTestId("two-step").getByRole("button", { name: "Turn off" }).click(); await p.waitForTimeout(800);
  if (!/Turn off two-step/.test(asked)) { await ctx.close(); return { fail: `no confirmation asked (${asked})` }; }
  await p.waitForTimeout(2500); await ctx.close();
  const f = await q("select count(*)::int n from auth.mfa_factors f join auth.users u on u.id=f.user_id where u.email=$1 and f.status='verified'", [email]);
  return f[0].n === 0 ? "turned off" : { fail: `${f[0].n} verified factor(s) remain` };
});
console.log(rec.counts); await b.close(); await closeDb();
