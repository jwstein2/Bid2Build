// Browser walk for V4.6 Customer Communications against the mock Supabase (test data only, NOT production; no email is sent).
//   build with NEXT_PUBLIC_PROJECT_SCHEDULING=on and NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321, `next start`,
//   node scripts/ux-audit/mock-supabase.mjs, then: node scripts/customer-comms/walk.mjs <screenshotDir>
// The /api/comms* and /api/notifications responses are fixtures (Playwright route interception), so the walk
// shows the UI states: review queue, scheduled sends, replies that paused follow-ups, opt-outs, audience review.
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.argv[2] ?? "comms-shots";
fs.mkdirSync(dir, { recursive: true });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };
const out = []; const check = (n, c) => out.push(`${c ? "✓" : "✗"} ${n}`);
const M = "http://localhost:54321", A = "http://localhost:3000";
const EST = "11111111-1111-4111-8111-111111111111";
const G = (n) => `22222222-2222-4222-8222-00000000000${n}`;
const H = 3_600_000, D = 24 * H, now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();

await fetch(`${M}/__onboarding?status=completed`);
await fetch(`${M}/__features?created=${encodeURIComponent(new Date().toISOString())}`);
await fetch(`${M}/__scenario?name=unlimited`);
await fetch(`${M}/__sched?reset=1&stage=won`);
await fetch(`${M}/__pm?state=${encodeURIComponent(JSON.stringify({ scope: "individual", companyId: null, editorLimit: 1, editorsAssigned: 1, canEdit: true, source: "subscription", editUntil: null, addon: true, addonUntil: null, extraEditors: 0 }))}`);
await fetch(`${M}/__comms?on=1`);

// ---- Fixtures ---------------------------------------------------------------------------------
const PERMS = ["view_communications", "edit_nurture_templates", "enable_customer_nurture", "approve_marketing_outreach", "configure_project_updates", "approve_customer_updates", "enable_auto_project_updates", "view_customer_replies", "manage_opt_outs"];
const settings = { nurtureEnabled: true, nurtureMonths: 6, nurtureIncludeOffers: true, nurtureMode: "review", nurtureSubject: null, nurtureBody: null, templateVersion: 2, nurtureActivatedAt: iso(-20 * D),
  updatesFrequency: "both", updatesMode: "review", updatesWeekday: 5, updatesHour: 16, timezone: "America/Chicago", postalAddress: "120 Main St, Springfield, IL 62701", senderName: "Alex at Summit Exteriors", replyTo: "office@summit.test", pausedAt: null };
const msg = (o) => ({ contact_id: null, schedule_id: null, to_email: "pat@example.test", to_name: "Pat Johnson", body_text: "", status_reason: null, scheduled_for: null, sent_at: null, delivered_at: null, replied_at: null, approved_at: null, automation: true, created_at: iso(-H), trigger: "six_month", ...o });
const updateBody = `Hi Sam,

Here's this week's update on your Kitchen remodel.

Demolition: complete (verified by your project manager).
Framing was scheduled through Nov 20. Our latest recorded progress is 60%. We'll confirm completion once it's finished and checked.
Next up: Electrical rough-in, planned to start Nov 23.

See the full schedule: (secure link added when sent)

Questions? Just reply to this email.

Thank you,
Alex Rivera
Summit Exteriors LLC

--
Summit Exteriors LLC · 120 Main St, Springfield, IL 62701
Don't want project emails? Unsubscribe: (link)`;
const nurtureBody = `Hi Morgan,

It's been a while since we talked about your Deck rebuild. If you're still thinking about it, I'd be glad to take a fresh look. Prices and availability have changed since our last quote, so we'd put together an updated one.

This season: 10% off labor on deck projects booked by Dec 31 (minimum $5,000; can't be combined).

Just reply to this email if you'd like to talk.

Alex at Summit Exteriors

--
Sent for Summit Exteriors LLC using Built2Bid · 120 Main St, Springfield, IL 62701
Don't want these emails? Unsubscribe: (link)`;
const messages = [
  msg({ id: "m1", kind: "project_update", trigger: "weekly", schedule_id: "s1", to_email: "sam@example.test", to_name: "Sam Ortiz", subject: "Kitchen remodel: weekly update", body_text: updateBody, status: "awaiting_review", scheduled_for: iso(22 * H) }),
  msg({ id: "m2", kind: "nurture", to_email: "morgan@example.test", to_name: "Morgan Lee", subject: "Checking in on your deck project", body_text: nurtureBody, status: "awaiting_review", scheduled_for: iso(0), status_reason: "Reply monitoring isn't active, so each follow-up waits for approval." }),
  msg({ id: "m3", kind: "project_update", trigger: "milestone", schedule_id: "s2", to_email: "riley@example.test", to_name: "Riley Chen", subject: "Siding project: Tear-off is complete", body_text: updateBody, status: "approved", approved_at: iso(-2 * H), scheduled_for: iso(3 * D) }),
  msg({ id: "m4", kind: "project_update", trigger: "weekly", schedule_id: "s3", to_email: "jordan@example.test", to_name: "Jordan Patel", subject: "Roof replacement: weekly update", body_text: updateBody, status: "scheduled", scheduled_for: iso(2 * D), status_reason: null }),
  msg({ id: "m5", kind: "nurture", to_email: "casey@example.test", to_name: "Casey Brooks", subject: "Checking in on your window project", body_text: nurtureBody, status: "replied", sent_at: iso(-4 * D), replied_at: iso(-3 * D) }),
  msg({ id: "m6", kind: "project_update", trigger: "weekly", schedule_id: "s1", to_email: "sam@example.test", to_name: "Sam Ortiz", subject: "Kitchen remodel: weekly update", body_text: updateBody, status: "sent", sent_at: iso(-7 * D), approved_at: iso(-7 * D) }),
  msg({ id: "m7", kind: "nurture", to_email: "drew@example.test", to_name: "Drew Alvarez", subject: "Checking in on your fence project", body_text: nurtureBody, status: "sent", sent_at: iso(-9 * D) }),
  msg({ id: "m8", kind: "nurture", to_email: "taylor@example.test", to_name: "Taylor Kim", subject: "Checking in on your patio project", body_text: nurtureBody, status: "canceled", status_reason: "Customer replied", created_at: iso(-3 * D) }),
];
const events = [
  { id: "e1", kind: "reply", message_id: "m5", from_email: "casey@example.test", subject: "Re: Checking in on your window project", excerpt: "Hi Alex, yes we're still interested. Could you come by next Tuesday afternoon to measure the back windows?", details: { label: "Customer reply", classification: "human" }, needs_attention: true, handled_at: null, created_at: iso(-3 * D) },
  { id: "e2", kind: "opt_out_request", message_id: "m7", from_email: "drew@example.test", subject: "Re: Checking in on your fence project", excerpt: "Please stop emailing me.", details: { label: "Asked to stop", classification: "opt_out" }, needs_attention: true, handled_at: null, created_at: iso(-8 * D) },
  { id: "e3", kind: "ambiguous_reply", message_id: "m7", from_email: "lee@example.test", subject: "Re: hello", excerpt: "Not now, maybe take me off for a while", details: { label: "Possible opt-out (kept off to be safe)", classification: "possible_opt_out" }, needs_attention: true, handled_at: null, created_at: iso(-6 * D) },
  { id: "e4", kind: "auto_reply", message_id: "m6", from_email: "sam@example.test", subject: "Out of office", excerpt: "I'm away until Monday.", details: { label: "Automatic reply", classification: "auto_reply" }, needs_attention: false, handled_at: null, created_at: iso(-7 * D) },
];
const contacts = [
  { id: "c1", email: "morgan@example.test", name: "Morgan Lee", status: "eligible", status_reason: null, basis: "inquiry", last_nurture_at: null, last_reply_at: null },
  { id: "c2", email: "casey@example.test", name: "Casey Brooks", status: "replied", status_reason: "Customer replied", basis: "inquiry", last_nurture_at: iso(-4 * D), last_reply_at: iso(-3 * D) },
  { id: "c3", email: "drew@example.test", name: "Drew Alvarez", status: "unsubscribed", status_reason: "Asked not to be contacted", basis: "customer", last_nurture_at: iso(-9 * D), last_reply_at: iso(-8 * D) },
  { id: "c4", email: "jamie@example.test", name: "Jamie Fox", status: "paused", status_reason: "Paused by your team", basis: "customer", last_nurture_at: null, last_reply_at: null },
  { id: "c5", email: "bad@example.test", name: "Robin Hart", status: "bounced", status_reason: "Email address bounced", basis: "inquiry", last_nurture_at: iso(-30 * D), last_reply_at: null },
];
const offers = [{ id: "o1", name: "Fall deck special", offerType: "seasonal", trades: ["decks"], audience: ["lost", "unconverted"], startsOn: iso(-10 * D).slice(0, 10), endsOn: iso(40 * D).slice(0, 10), conditions: "Minimum $5,000; can't be combined.", discountValue: 10, message: "10% off labor on deck projects booked by Dec 31", materialCurrent: null, materialAlternative: null, priceBasis: null, estimatedSavings: null, comparisonApprovedAt: null, active: true }];
const projects = [
  { schedule_id: "s1", name: "Kitchen remodel – Ortiz", frequency: "weekly", mode: "review", paused_at: null, scheduleStatus: "active" },
  { schedule_id: "s2", name: "Siding – Chen", frequency: "milestone", mode: "review", paused_at: null, scheduleStatus: "active" },
  { schedule_id: "s3", name: "Roof – Patel", frequency: "both", mode: "automatic", paused_at: null, scheduleStatus: "active" },
];
const overview = (o = {}) => ({ available: true, locked: false, access: { accountId: user.id, kind: "user", pm: true, perms: PERMS }, settings, offers, messages, events, contacts, projects,
  platform: { sending: "off", sendingReason: "Customer email sending is switched off (COMM_EMAIL_MODE).", paused: false, monitoring: { configured: false, active: false, reason: "Replies aren't routed to Built2Bid yet (no receiving domain).", verifiedAt: null } }, ...o });
const audience = { entries: [
  { email: "morgan@example.test", name: "Morgan Lee", groups: ["lost"], basis: "inquiry", estimate: { title: "Deck rebuild", estimateDate: iso(-220 * D).slice(0, 10) }, estimateCount: 2, nextDueAt: iso(-5 * D), due: true, contactId: "c1", contactStatus: "eligible", excluded: null },
  { email: "quinn@example.test", name: "Quinn Rivers", groups: ["completed"], basis: "customer", estimate: { title: "Bathroom refresh", estimateDate: iso(-300 * D).slice(0, 10) }, estimateCount: 1, nextDueAt: iso(-20 * D), due: true, contactId: null, contactStatus: null, excluded: null },
  { email: "avery@example.test", name: "Avery Stone", groups: ["unconverted"], basis: "inquiry", estimate: { title: "Gutter replacement", estimateDate: iso(-90 * D).slice(0, 10) }, estimateCount: 1, nextDueAt: iso(90 * D), due: false, contactId: null, contactStatus: null, excluded: null },
  { email: "blake@example.test", name: "Blake Young", groups: ["old_draft"], basis: null, estimate: { title: "Basement finish", estimateDate: iso(-200 * D).slice(0, 10) }, estimateCount: 1, nextDueAt: iso(-10 * D), due: true, contactId: null, contactStatus: null, excluded: "Draft only: confirm you have a relationship with this person first" },
  { email: "sam@example.test", name: "Sam Ortiz", groups: ["unconverted"], basis: "inquiry", estimate: { title: "Kitchen remodel", estimateDate: iso(-40 * D).slice(0, 10) }, estimateCount: 1, nextDueAt: iso(140 * D), due: false, contactId: null, contactStatus: null, excluded: "Has a project in progress (gets project updates instead)" },
  { email: "drew@example.test", name: "Drew Alvarez", groups: ["past_customer"], basis: "customer", estimate: { title: "Fence", estimateDate: iso(-900 * D).slice(0, 10) }, estimateCount: 1, nextDueAt: iso(-1 * D), due: true, contactId: "c3", contactStatus: "unsubscribed", excluded: "Asked not to be contacted" },
] };
const notices = [
  { id: "n1", kind: "customer_update", scheduleId: "s1", taskId: null, reason: "end_date", title: "Customer update scheduled for tomorrow", status: "open", canConfirm: false, readAt: null, createdAt: iso(-H),
    data: { projectName: "Kitchen remodel – Ortiz", customerName: "Sam Ortiz", scheduledFor: iso(22 * H), timezone: "America/Chicago", mode: "review", sections: [{ name: "Framing", status: "In progress", progress: 60, plannedEnd: iso(2 * D).slice(0, 10) }, { name: "Electrical rough-in", status: "Up next", progress: null, plannedEnd: iso(6 * D).slice(0, 10) }] } },
  { id: "n2", kind: "customer_reply", scheduleId: "", taskId: null, reason: "end_date", title: "Casey Brooks replied", status: "open", canConfirm: false, readAt: null, createdAt: iso(-3 * D), data: { projectName: "Window replacement", customerName: "Casey Brooks", subject: "Checking in on your window project" } },
  { id: "n3", kind: "task_review", scheduleId: "s2", taskId: "t1", reason: "both", title: "Tear-off", status: "open", canConfirm: true, readAt: iso(-H), createdAt: iso(-2 * H), data: { projectName: "Siding – Chen", taskName: "Tear-off", plannedEnd: iso(-D).slice(0, 10), percentComplete: 100, customerName: "Riley Chen" } },
];
const projState = { settings: { frequency: "weekly", mode: "review", recipientEmail: "pat@example.test", recipientName: "Pat Johnson", pausedAt: null, autoConfirmedAt: null }, defaults: { frequency: "both", mode: "review", timezone: "America/Chicago" },
  next: { id: "m1", status: "awaiting_review", scheduled_for: iso(22 * H), status_reason: null, trigger: "weekly" }, nextWeeklyAt: iso(22 * H), last: { sent_at: iso(-7 * D), subject: "Siding replacement: weekly update" }, scheduleStatus: "active", preview: null };

const browser = await chromium.launch();
const errors = [];
const DESK = { width: 1440, height: 1000 }, PHONE = { width: 390, height: 844 };
async function open(path, vp = DESK, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([authCookie]);
  if (opts.theme) await ctx.addInitScript((m) => { try { localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })); } catch { /* ignore */ } }, opts.theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  await page.route("**/api/comms", (r) => r.fulfill({ json: overview(opts.overview) }));
  await page.route("**/api/comms/audience", (r) => r.fulfill({ json: audience }));
  await page.route("**/api/comms/preview", (r) => r.fulfill({ json: { preview: { subject: "Checking in on your deck project", body: nurtureBody }, errors: [] } }));
  await page.route("**/api/comms/projects/**", (r) => r.fulfill({ json: r.request().url().includes("preview=1") ? { ...projState, preview: { subject: "Siding replacement: weekly update", body: updateBody, recipient: { email: "pat@example.test", name: "Pat Johnson" } } } : projState }));
  await page.route("**/api/notifications", (r) => r.fulfill({ json: { available: true, items: notices } }));
  await page.goto(`${A}${path}`, { waitUntil: "load" });
  const later = page.getByRole("button", { name: "Maybe Later" });
  try { await later.waitFor({ timeout: 2500 }); await later.click(); } catch { /* none */ }
  await page.waitForTimeout(600);
  return { ctx, page };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const C = "/dashboard/customers/communications";

// 1. Customers directory with the new tabs
{
  const { ctx, page } = await open("/dashboard/customers");
  check("nav says Customers", (await page.getByRole("link", { name: "Customers" }).count()) > 0);
  check("Customers page has Directory / Communications tabs", (await page.getByRole("link", { name: /Communications/ }).count()) > 0);
  await page.screenshot({ path: `${dir}/01-customers-directory-desktop.png` });
  await ctx.close();
}
// 2. Communications: Needs attention (review queue), KPI cards, preview
{
  const { ctx, page } = await open(`${C}?tab=attention`);
  check("KPI cards render", (await page.locator("[data-testid^=metric-card], [data-metric]").count()) > 0 || (await page.getByText("Needs attention").count()) > 0);
  check("reply monitoring shows NOT active (no integration)", (await page.getByTestId("reply-monitoring").innerText()).includes("Not active"));
  check("never claims Reply Monitoring Active", (await page.getByText("Reply Monitoring Active").count()) === 0);
  await page.screenshot({ path: `${dir}/02-communications-needs-attention-desktop.png`, fullPage: true });
  const prev = page.getByRole("button", { name: /Preview/ }).first();
  if (await prev.count()) { await prev.click(); await page.waitForTimeout(400); await page.screenshot({ path: `${dir}/03-review-update-preview-desktop.png`, fullPage: true }); }
  check("update preview uses accurate wording", (await page.getByText(/Our latest recorded progress is 60%/).count()) > 0);
  await ctx.close();
}
// 3. Scheduled sends, sent history, replies (reply-based pause + opt-outs), contacts
for (const [tab, file, test] of [
  ["scheduled", "04-scheduled-sends-desktop.png", async (p) => check("scheduled tab lists queued sends", (await p.getByText("Roof replacement: weekly update").count()) > 0)],
  ["sent", "05-sent-history-desktop.png", async (p) => check("sent history says delivery isn't confirmed without a provider event", (await p.getByText(/Delivery not confirmed yet/).count()) > 0)],
  ["replies", "06-replies-paused-and-opt-outs-desktop.png", async (p) => check("replies tab shows the customer reply and the opt-out", (await p.getByText(/come by next Tuesday/).count()) > 0 && (await p.getByText(/stop emailing/).count()) > 0)],
  ["contacts", "07-contacts-statuses-desktop.png", async (p) => check("contacts show replied / unsubscribed / bounced", (await p.getByText("Unsubscribed").count()) > 0 && (await p.getByText(/Bounced/).count()) > 0)],
]) {
  const { ctx, page } = await open(`${C}?tab=${tab}`);
  await test(page);
  await page.screenshot({ path: `${dir}/${file}`, fullPage: true });
  await ctx.close();
}
// 4. Settings: audience review, template preview, automatic mode guarded
{
  const { ctx, page } = await open(`${C}?tab=settings`);
  check("V6.1: follow-up sending mode is a fixed Review first setting (no dead dropdown)", (await page.locator("#n-mode").count()) === 0 && (await page.getByTestId("nurture-mode-fixed").innerText()).includes("Review first"));
  check("V6.1: explains when automatic becomes available", (await page.getByTestId("nurture-mode-fixed").innerText()).includes("reply monitoring"));
  check("V6.1: project update default is fixed Review first (automatic is per project)", (await page.locator("#u-mode").count()) === 0 && (await page.getByTestId("updates-mode-fixed").count()) === 1);
  // Saving a setting shows feedback that stays visible near the control.
  await page.route("**/api/comms/settings", (r) => r.fulfill({ json: { settings } }));
  await page.locator("#n-freq").selectOption("12"); await page.waitForTimeout(500);
  const fb = page.getByTestId("comms-feedback");
  check("V6.1: saving shows a visible confirmation", (await fb.count()) > 0 && (await fb.isVisible()));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
  const box = await fb.boundingBox();
  check("V6.1: confirmation stays in view after scrolling down the settings", Boolean(box) && box.y >= 0 && box.y < 120);
  await page.screenshot({ path: `${dir}/08b-settings-saved-feedback-scrolled-desktop.png` });
  await page.screenshot({ path: `${dir}/08-automation-settings-desktop.png`, fullPage: true });
  await ctx.close();
}
{
  // Before activation: the contractor reviews and confirms the audience first (nurture is off by default).
  const { ctx, page } = await open(`${C}?tab=settings`, DESK, { overview: { settings: { ...settings, nurtureEnabled: false, nurtureActivatedAt: null } } });
  await page.getByTestId("nurture-review").click(); await page.waitForTimeout(700);
  check("audience review lists excluded people with reasons", (await page.getByText(/confirm you have a relationship/).count()) > 0);
  await page.screenshot({ path: `${dir}/09-audience-review-desktop.png`, fullPage: true });
  const tp = page.getByRole("button", { name: /Preview/ }).first();
  if (await tp.count()) { await tp.click(); await page.waitForTimeout(500); await page.screenshot({ path: `${dir}/10-template-preview-desktop.png`, fullPage: true }); }
  await ctx.close();
}
// 5. Notification bell: day-before reminder + reply notice
{
  const { ctx, page } = await open("/dashboard");
  const bell = page.getByTestId("notification-bell").first();
  if (await bell.count()) {
    await bell.click(); await page.waitForTimeout(400);
    check("PM reminder asks to review before sending", (await page.getByText(/review the schedule before this update is sent/).count()) > 0);
    check("reply notice links to the conversation", (await page.getByRole("link", { name: "Open conversation" }).count()) > 0);
    await page.screenshot({ path: `${dir}/11-pm-reminder-and-reply-notices-desktop.png` });
  } else check("notification bell present", false);
  await ctx.close();
}
// 6. Project detail: Customer updates panel (+ automatic opt-in disclaimer)
let sid = null;
{
  const { ctx, page } = await open("/dashboard");
  const r = await page.evaluate(async ([est, g1, g2]) => {
    const res = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      estimateId: est, calendar: { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" }, startDate: new Date().toISOString().slice(0, 10),
      sections: [{ sourceGroupId: g1, durationDays: 2, sortOrder: 0 }, { sourceGroupId: g2, durationDays: 4, sortOrder: 1 }], deps: [{ from: g1, to: g2, lagDays: 0, maxOverlap: 0 }] }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, [EST, G(1), G(2)]);
  sid = r.body?.id ?? null;
  await ctx.close();
}
if (sid) {
  const { ctx, page } = await open(`/projects/${sid}`);
  const panel = page.getByText("Customer updates").first();
  check("project page shows the Customer updates panel", (await panel.count()) > 0);
  if (await panel.count()) { await panel.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }
  await page.screenshot({ path: `${dir}/12-project-customer-updates-desktop.png` });
  const auto = page.getByRole("button", { name: /Automatic|Turn on automatic/ }).first();
  const sel = page.locator("select").filter({ has: page.locator("option[value=automatic]") }).first();
  if (await sel.count()) { await sel.selectOption("automatic").catch(() => {}); await page.waitForTimeout(400); }
  else if (await auto.count()) { await auto.click(); await page.waitForTimeout(400); }
  check("automatic mode shows the exact disclaimer", (await page.getByText(/without manual review/i).count()) > 0);
  await page.screenshot({ path: `${dir}/13-automatic-updates-disclaimer-desktop.png` });
  await ctx.close();
} else check("schedule created for project page", false);
// 7. Mobile + dark mode
{
  const { ctx, page } = await open(`${C}?tab=attention`, PHONE);
  check("communications (phone): no horizontal scroll", await noHScroll(page));
  await page.screenshot({ path: `${dir}/14-communications-phone.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open(`${C}?tab=replies`, PHONE);
  check("replies (phone): no horizontal scroll", await noHScroll(page));
  await page.screenshot({ path: `${dir}/15-replies-phone.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open(`${C}?tab=attention`, DESK, { theme: "dark" });
  check("dark mode applied", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  await page.screenshot({ path: `${dir}/16-communications-dark-desktop.png`, fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await open(`${C}?tab=settings`, PHONE, { theme: "dark" });
  await page.screenshot({ path: `${dir}/17-settings-dark-phone.png`, fullPage: true });
  await ctx.close();
}
// 8. Emergency stop banner
{
  const { ctx, page } = await open(`${C}?tab=attention`, DESK, { overview: { settings: { ...settings, pausedAt: iso(-H) } } });
  check("Pause All state shows Resume", (await page.getByTestId("resume-all").count()) > 0);
  await page.screenshot({ path: `${dir}/18-all-customer-email-paused-desktop.png` });
  await ctx.close();
}
await browser.close();
console.log(out.join("\n"));
if (errors.length) console.log("Page errors:\n" + errors.join("\n"));
