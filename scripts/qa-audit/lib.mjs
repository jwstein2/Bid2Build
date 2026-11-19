// Shared helpers for the QA audit (local stack only). Real browser, real auth (email code read from the local
// Mailpit inbox), real Postgres. Never point this at production.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
export const { chromium, devices } = require("playwright");
export const pg = require("pg");

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
export const DB_URL = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const OUT = process.env.QA_OUT ?? "qa-audit-out";
// Safety: every target must be local. These scripts create users, write rows and sign documents.
const isLocal = (u) => /^(https?|postgresql):\/\/([^@/]*@)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
for (const u of [BASE, MAILPIT, DB_URL, process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"]) if (!isLocal(u)) throw new Error(`QA audit runs against a local stack only (refused ${u.replace(/\/\/[^@]*@/, "//")})`);
fs.mkdirSync(path.join(OUT, "state"), { recursive: true });
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

export const USERS = {
  owner: "qa-owner@audit.test", free: "qa-free@audit.test", pro: "qa-pro@audit.test",
  entOwner: "qa-ent-owner@audit.test", entEstimator: "qa-ent-estimator@audit.test",
  rep1: "qa-rep1@audit.test", rep2: "qa-rep2@audit.test", salesAdmin: "qa-sales-admin@audit.test", outsider: "qa-outsider@audit.test",
};

let _db;
export async function db() { if (!_db) { _db = new pg.Client({ connectionString: DB_URL }); await _db.connect(); } return _db; }
export async function q(sql, params = []) { return (await (await db()).query(sql, params)).rows; }
export async function closeDb() { if (_db) await _db.end(); _db = null; }

export async function latestCode(email, after = 0) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`)).json();
    const m = (r.messages ?? []).find((x) => Date.parse(x.Created) > after);
    if (m) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const code = (full.Text ?? full.HTML ?? "").match(/\b(\d{6})\b/);
      if (code) return code[1];
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`no sign-in code for ${email}`);
}

/** Signs in through the real login page with a 6-digit email code. Returns the page. */
export async function uiLogin(page, email, { loginPath = "/login" } = {}) {
  const after = Date.now() - 1000;
  if (loginPath) await page.goto(BASE + loginPath); // null: sign in on the page already open (a redirect to /login?next=…)
  const field = page.locator("#auth-email").first();
  await page.waitForTimeout(800);
  if (!(await field.isVisible().catch(() => false))) {
    const cont = page.getByRole("button", { name: /Continue with email|Sign in with email/i }).first();
    if (await cont.isVisible().catch(() => false)) await cont.click();
    else { await page.getByRole("link", { name: /Sign in or create|Sign in to (join|accept)/i }).or(page.getByRole("button", { name: /Sign in or create/i })).first().click(); await page.waitForTimeout(1200); }
    if (!(await field.isVisible().catch(() => false))) { const c2 = page.getByRole("button", { name: /Continue with email/i }).first(); if (await c2.isVisible().catch(() => false)) await c2.click(); }
  }
  await field.fill(email);
  await field.press("Enter");
  const code = await latestCode(email, after);
  const codeField = page.locator("input[autocomplete=one-time-code], input[inputmode=numeric]").first();
  await codeField.waitFor({ timeout: 15000 });
  await codeField.fill(code);
  await codeField.press("Enter");
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => {});
  return page;
}

// Each concurrently running script should set QA_STATE_TAG: two processes refreshing the same saved session trip
// Supabase's refresh-token reuse detection, which revokes that session for both.
export function statePath(role) { const t = process.env.QA_STATE_TAG; return path.join(OUT, "state", `${role}${t ? `-${t}` : ""}.json`); }

/** Browser context for a role, logging in once via the real UI and caching the session. */
export async function contextFor(browser, role, opts = {}) {
  const viewport = opts.mobile ? undefined : { width: 1440, height: 900 };
  const base = { ...(opts.mobile ? { ...devices["iPhone 13"] } : { viewport }), permissions: ["clipboard-read", "clipboard-write"] };
  if (role === "anon") return browser.newContext(base);
  const sp = statePath(role);
  if (fs.existsSync(sp) && !opts.fresh) {
    const c = await browser.newContext({ ...base, storageState: sp });
    // A saved session can expire or be revoked; check it once and sign in again if so.
    const r = await c.request.get(`${BASE}/dashboard`, { maxRedirects: 0 }).catch(() => null);
    const loc = r?.headers()["location"] ?? "";
    if (!(r && r.status() >= 300 && r.status() < 400 && /\/login/.test(loc))) return c;
    await c.close();
  }
  const ctx = await browser.newContext(base);
  const page = await ctx.newPage();
  await uiLogin(page, USERS[role], opts);
  await ctx.storageState({ path: sp });
  await page.close();
  return ctx;
}

/** Collects console errors, page errors and failed requests for a page. */
export function watch(page) {
  const w = { console: [], pageErrors: [], failed: [] };
  page.on("console", (m) => { if (m.type() === "error") w.console.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => w.pageErrors.push(String(e.message).slice(0, 300)));
  page.on("response", (r) => { const s = r.status(); const u = r.url(); if (s >= 400 && !/_next\/static|favicon|google|sentry|\.png|\.jpg|\.webp/.test(u)) w.failed.push(`${s} ${r.request().method()} ${u.replace(BASE, "")}`.slice(0, 250)); });
  page.on("requestfailed", (r) => { const u = r.url(); if (!/google|sentry|facebook|_rsc|stripe\.com|youtube|ytimg/.test(u)) w.failed.push(`ERR ${r.failure()?.errorText} ${u.replace(BASE, "")}`.slice(0, 250)); });
  w.reset = () => { w.console.length = 0; w.pageErrors.length = 0; w.failed.length = 0; };
  return w;
}

/** Result recorder: every test lands in results.jsonl with status PASS | FAIL | BLOCKED and evidence. */
export function recorder(batch) {
  const file = path.join(OUT, `results-${batch}.jsonl`);
  fs.writeFileSync(file, "");
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  const rec = (id, area, fn, expected, status, actual, evidence = {}) => {
    counts[status]++;
    fs.appendFileSync(file, JSON.stringify({ batch, id, area, function: fn, expected, status, actual, evidence, at: new Date().toISOString() }) + "\n");
    console.log(`${status.padEnd(7)} ${id} ${fn}${status !== "PASS" ? `  -> ${actual}` : ""}`);
  };
  rec.counts = counts;
  /** Runs fn(); PASS if it returns truthy/string, FAIL on false or throw. */
  rec.test = async (id, area, name, expected, fn) => {
    try {
      const r = await fn();
      if (r && typeof r === "object" && r.blocked) return rec(id, area, name, expected, "BLOCKED", r.blocked, r.evidence);
      if (r === false || (r && typeof r === "object" && r.fail)) return rec(id, area, name, expected, "FAIL", r?.fail ?? "assertion failed", r?.evidence);
      rec(id, area, name, expected, "PASS", typeof r === "string" ? r : "as expected");
    } catch (e) { rec(id, area, name, expected, "FAIL", String(e.message).split("\n")[0].slice(0, 300)); }
  };
  return rec;
}

export const shot = (page, name) => page.screenshot({ path: path.join(OUT, "shots", `${name}.png`), fullPage: false }).catch(() => {});

// The two keys below are the public demo keys every `supabase start` prints; they only work on a local stack.
export const SB_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_KEY = process.env.SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
/** A user access token for direct PostgREST checks (RLS / grant tests), minted through the local Auth admin API. */
export async function apiToken(email) {
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" };
  const link = await (await fetch(`${SB_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", email }) })).json();
  const otp = link.email_otp ?? link.properties?.email_otp;
  const s = await (await fetch(`${SB_URL}/auth/v1/verify`, { method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ type: "email", email, token: otp }) })).json();
  if (!s.access_token) throw new Error(`no token for ${email}: ${JSON.stringify(s).slice(0, 200)}`);
  return s.access_token;
}
/** PostgREST call as a user. */
export async function rest(token, pathAndQuery, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, { ...init, headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

/** Closes first-run popups (welcome video, new-features, guide offers) the way a person would. Returns what it closed. */
export async function dismissPopups(page, rounds = 4) {
  const closed = [];
  for (let i = 0; i < rounds; i++) {
    const d = page.locator("[role=dialog]:visible").first();
    await d.waitFor({ state: "visible", timeout: i === 0 ? 3000 : 1500 }).catch(() => {});
    if (!(await d.isVisible().catch(() => false))) break;
    const title = (await d.locator("h2").first().innerText().catch(() => "")).trim();
    const btn = d.getByRole("button", { name: /^(Not Right Now|Maybe Later|Skip|No thanks|Close|Dismiss|Got it)$/i }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click(); else await page.keyboard.press("Escape");
    closed.push(title);
  }
  return closed;
}
