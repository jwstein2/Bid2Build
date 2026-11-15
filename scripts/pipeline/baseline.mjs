// Baseline (before) screenshots for the V4 sales pipeline work. Local build against the mock Supabase
// (scripts/ux-audit/mock-supabase.mjs) with labeled fixture data: NOT production.
// Usage: node scripts/pipeline/baseline.mjs <outDir> [prefix]
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "pipeline-shots"; const prefix = process.argv[3] ?? "before";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const EST = "11111111-1111-4111-8111-111111111111";
const scenario = (n) => fetch(`http://localhost:54321/__scenario?name=${n}`);
const shots = [
  ["dashboard", "/dashboard", "monthly_credits"],
  ["bid-detail", `/estimates/${EST}`, "monthly_credits"],
  ["estimate-builder", `/estimates/${EST}?step=pricing`, "monthly_credits"],
  ["estimate-proposal-share", `/estimates/${EST}?step=proposal`, "monthly_credits"],
  ["signed-proposal", "/signed/88888888-8888-4888-8888-000000000002", "monthly_credits"],
  ["enterprise-users", "/company/users", "enterprise_owner"],
  ["enterprise-pipeline", "/company/pipeline?range=all", "enterprise_owner"],
  ["billing-upgrade", "/settings/billing", "starter_credits"],
  ["pricing", "/pricing", "starter_credits"],
];
const browser = await chromium.launch();
for (const [label, vp] of [["desktop", { width: 1440, height: 900 }], ["m390", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  await ctx.addInitScript(() => { try { localStorage.setItem("b2b-tour-done", "1"); } catch {} });
  const page = await ctx.newPage();
  for (const [id, path, sc] of shots) {
    if (label === "m390" && !["dashboard", "estimate-builder", "bid-detail"].includes(id)) continue;
    await scenario(sc).catch(() => {});
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape").catch(() => {});
    await page.screenshot({ path: `${dir}/${prefix}-${id}-${label}.png`, fullPage: true });
    console.log(`${prefix}-${id}-${label}`);
  }
  await ctx.close();
}
await browser.close();
