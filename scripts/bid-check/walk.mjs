// Browser walk for the bid check questionnaire (/bid-check): seven distinct paths on phone and desktop,
// trade switching, job-type skips, link preselection, the pass invite (real SQL through the mock's
// PostgREST stand-in, no email is sent because RESEND_API_KEY is unset), activation, duplicates, themes.
//   scripts/test-db.sh start
//   export RADAR_PG_URL=$(node scripts/bid-check/setup-db.mjs)
//   PG_REST_PREFIXES=bid_check_,trial_ node scripts/ux-audit/mock-supabase.mjs &
//   export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=x
//   npm run build && FB_TRIAL_ENABLED=true npx next start -p 3000 &
//   node scripts/bid-check/walk.mjs <screenshotDir>
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { Client } = require("pg");

const out = process.argv[2] ?? "bid-check-shots";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const db = new Client({ connectionString: process.env.RADAR_PG_URL }); await db.connect();
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: Boolean(ok), d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch();
const errors = [];
const PHONE = { ...devices["iPhone 13"] };
const DESKTOP = { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 };

async function newPage(kind, opts = {}) {
  const ctx = await browser.newContext(kind === "phone" ? PHONE : DESKTOP);
  if (opts.signedIn) {
    const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
    const b64u = (s) => Buffer.from(s).toString("base64url");
    const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
    const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
    await ctx.addCookies([{ name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" }]);
  }
  if (opts.theme) await ctx.addInitScript((m) => localStorage.setItem("b2b-theme", JSON.stringify({ mode: m, at: Date.now() })), opts.theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

const qid = (page) => page.getByTestId("bc-question").getAttribute("data-qid");
const prompt = (page) => page.getByTestId("bc-question").innerText();
const progress = (page) => page.getByTestId("bc-progress").innerText();
async function pick(page, value) {
  await page.locator(`[data-testid=bc-option][data-value="${value}"]`).click();
}
async function cont(page) { await page.getByTestId("bc-continue").click(); }
/** Answer a list of [expectedQuestionId, value]; value "=" taps Continue on a preselected answer. */
async function answerAll(page, steps, label) {
  const asked = [];
  for (const [id, value] of steps) {
    await page.getByTestId("bc-question").waitFor();
    const got = await qid(page);
    asked.push(got);
    if (got !== id) { check(`${label}: expected ${id}`, false, `got ${got}`); return asked; }
    if (value === "=") await cont(page);
    else if (value.startsWith("text:")) { await page.getByTestId("bc-text").fill(value.slice(5)); await cont(page); }
    else await pick(page, value);
  }
  return asked;
}
const shot = (page, name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const resultText = async (page) => (await page.getByTestId("bc-result").innerText());

// ------------------------------------------------------------------ Path 1: solo deck builder, spreadsheets (phone)
let page = await newPage("phone");
await page.goto(`${BASE}/bid-check?trade=decks&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_decks&utm_content=deck_group_v1`);
check("P1 opens with the slowdown question", (await prompt(page)) === "What's slowing down your bids?");
check("P1 honest progress", (await progress(page)) === "Question 1 of 6");
await shot(page, "01-phone-question-1", false);
await pick(page, "speed");
check("P1 trade preselected from the deck post", await page.locator('[data-testid=bc-option][data-value="decks"][aria-pressed=true]').isVisible() && await page.getByTestId("bc-preselected").isVisible());
await shot(page, "02-phone-trade-preselected", false);
let asked = await answerAll(page, [["trade", "="], ["decks.job", "new"], ["decks.pain", "stairs"]], "P1");
check("P1 Q5 is the generic speed follow-up", (await prompt(page)) === "Where do you lose the most time?");
// Back keeps answers.
await page.getByRole("button", { name: "Back" }).click();
check("P1 back keeps the stairs answer", await page.locator('[data-testid=bc-option][data-value="stairs"][aria-pressed=true]').isVisible());
await cont(page);
asked = asked.concat(await answerAll(page, [["follow.speed", "takeoffs"], ["tools", "excel"]], "P1"));
await page.getByTestId("bc-result").waitFor();
const p1 = await page.getByTestId("bc-result").getAttribute("data-result");
check("P1 result: speed / decks / stairs", p1 === "speed:decks:stairs", p1);
check("P1 headline uses workflow", (await page.getByTestId("bc-headline").innerText()) === "Turn your deck spreadsheet into a bid you can send.");
check("P1 stairs broken out in the example estimate", (await page.getByTestId("bc-focus-group").innerText()).includes("Stair framing and install labor"));
check("P1 no email asked before the result", (await page.getByTestId("bc-email").count()) === 1 && (await page.getByTestId("bc-headline").isVisible()));
check("P1 pass is the primary CTA (volume unknown)", (await page.getByTestId("bc-result").getAttribute("data-primary")) === "pass");
await shot(page, "03-phone-result-deck-speed");
// Bonus path: occasional bidder, solo.
await page.getByTestId("bc-bonus").click();
check("Bonus progress label", (await progress(page)).startsWith("Bonus question 1 of"));
await answerAll(page, [["volume", "2-4"], ["who", "solo"], ["tools.reentry", "notes_sheet"], ["decks.deep", "composite"], ["feedback", "text:Stair pricing takes me forever"]], "P1 bonus");
await page.getByTestId("bc-result").waitFor();
check("P1 occasional bidder: free bid becomes primary", (await page.getByTestId("bc-result").getAttribute("data-primary")) === "free_bid" && await page.getByTestId("bc-free-card").isVisible());
check("P1 pass still available", await page.getByTestId("bc-pass").isVisible());
await shot(page, "04-phone-result-deck-after-bonus");
// Pass invite + duplicate tap.
await page.getByTestId("bc-email").fill("Solo.Deck@Example.com");
await page.getByTestId("bc-pass-submit").click();
await page.getByTestId("bc-pass-sent").waitFor();
const sid1 = (await page.evaluate(() => JSON.parse(sessionStorage.getItem("b2b_bid_check")).sid));
let inv = (await db.query("select i.source, i.send_count, i.status, i.checkins_opt_in from public.bid_check_sessions s join public.trial_campaign_invites i on i.id = s.invite_id where s.id = $1", [sid1])).rows[0];
check("P1 invite queued from the questionnaire, linked to the session, no check-ins", inv?.source === "questionnaire" && inv.send_count === 1 && inv.checkins_opt_in === false, JSON.stringify(inv));
await shot(page, "05-phone-pass-sent", false);
const r2 = await page.evaluate(() => fetch("/api/bid-check/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "solo.deck@example.com", sid: JSON.parse(sessionStorage.getItem("b2b_bid_check")).sid }) }).then((r) => r.json()));
inv = (await db.query("select count(*)::int n, max(send_count) c from public.trial_campaign_invites where email = 'solo.deck@example.com'")).rows[0];
check("P1 duplicate request: same answer, still one invite and one send", r2.ok === true && inv.n === 1 && inv.c === 1, JSON.stringify(inv));
const sess = (await db.query("select campaign, source, content, trade_hint, device, completed_at is not null c, result_shown_at is not null r, deep_completed_at is not null d, answers from public.bid_check_sessions where id = $1", [sid1])).rows[0];
check("P1 session row: campaign + hint + device, no email anywhere", sess.campaign === "bid_check_decks" && sess.source === "fb_group" && sess.trade_hint === "decks" && sess.device === "mobile" && sess.c && sess.r && sess.d && !JSON.stringify(sess).includes("example.com"), JSON.stringify({ ...sess, answers: undefined }));
// Open the example in the real builder.
await page.getByTestId("bc-action").click();
await page.waitForURL(/\/builder\?draft=/);
await page.waitForTimeout(3000);
const draftId = new URL(page.url()).searchParams.get("draft");
const draft = await page.evaluate((id) => JSON.parse(localStorage.getItem(`byb:draft:${id}`) ?? "null"), draftId);
const builderText = await page.evaluate(() => document.body.innerText);
check("P1 example opens in the real builder (estimate step) with stair lines broken out", draft?.estimate.title.startsWith("Example: New 16") && builderText.includes("Step 3 of 5: Estimate") && draft?.estimate.items.some((i) => i.name === "Stair framing and install labor" && i.costType === "labor"));
await shot(page, "06-phone-builder-example", false);
await page.context().close();

// ------------------------------------------------------------------ Path 2: painter who wants clearer proposals (desktop)
page = await newPage("desktop");
await page.goto(`${BASE}/bid-check?trade=painting&utm_source=facebook&utm_medium=social&utm_campaign=bid_check_painters`);
await pick(page, "proposals");
asked = await answerAll(page, [["trade", "="], ["painting.job", "interior"], ["painting.pain", "materials"], ["painting.follow.proposals.materials", "coats"], ["tools", "notes"]], "P2");
check("P2 asked the paint-specific proposal follow-up", asked.includes("painting.follow.proposals.materials"));
await page.getByTestId("bc-result").waitFor();
check("P2 result: proposals / painting / materials", (await page.getByTestId("bc-result").getAttribute("data-result")) === "proposals:painting:materials");
check("P2 shows the real proposal renderer", (await page.getByTestId("bc-example").getAttribute("data-kind")) === "proposal");
check("P2 coats tip", (await page.getByTestId("bc-try").innerText()).includes("coat count"));
await shot(page, "07-desktop-result-painter-proposals");
await page.getByTestId("bc-action").click();
await page.waitForURL(/\/builder\?draft=/);
await page.waitForTimeout(1500);
await shot(page, "08-desktop-builder-proposal-step", false);
await page.context().close();

// ------------------------------------------------------------------ Path 3: remodeling crew that needs follow-up (phone, signed in)
page = await newPage("phone", { signedIn: true });
await page.goto(`${BASE}/bid-check?trade=kitchens&utm_source=facebook&utm_medium=messenger&utm_campaign=fb_bid_remodelers`);
await pick(page, "followup");
asked = await answerAll(page, [["trade", "="], ["remodeling.job", "="], ["remodeling.pain", "subs"], ["follow.followup", "sheet"], ["tools", "excel"]], "P3");
await page.getByTestId("bc-result").waitFor();
check("P3 result: follow-up / kitchens", (await page.getByTestId("bc-result").getAttribute("data-result")) === "followup:kitchens:subs");
check("P3 real Pipeline board shown", (await page.getByTestId("bc-example").getAttribute("data-kind")) === "pipeline" && (await page.getByTestId("bc-example").innerText()).includes("Awaiting Signature"));
check("P3 says what's live vs. still in development", (await page.getByTestId("bc-followup-note").innerText()).includes("aren't built yet"));
await page.getByTestId("bc-bonus").click();
await answerAll(page, [["volume", "11-25"], ["who", "pair"], ["team.problem", "handoffs"], ["tools.reentry", "customer"], ["remodeling.deep", "allowance"], ["followup.track", "next"], ["feedback", "text:"]], "P3 bonus");
await page.getByTestId("bc-result").waitFor();
check("P3 crew gets the team tip", (await page.getByTestId("bc-team").innerText()).includes("same bid"));
check("P3 regular bidder: pass primary", (await page.getByTestId("bc-result").getAttribute("data-primary")) === "pass");
await shot(page, "09-phone-result-remodel-followup");
await page.getByTestId("bc-email").fill("ux-test@built2bid.test");
await page.getByTestId("bc-checkins").check();
await page.getByTestId("bc-pass-submit").click();
await page.getByTestId("bc-pass-sent").waitFor();
const invite = (await db.query("select id, token_version, checkins_opt_in from public.trial_campaign_invites where email = 'ux-test@built2bid.test'")).rows[0];
check("P3 invite with separate check-in consent", invite?.checkins_opt_in === true);
// Activation (the link the email would carry), signed in as the invited address.
const svc = createHmac("sha256", "x").update("built2bid/trial-invite/v1").digest();
const token = `${Buffer.from(invite.id.replace(/-/g, ""), "hex").toString("base64url")}.${invite.token_version}.${createHmac("sha256", svc).update(`invite:${invite.id}:${invite.token_version}`).digest("base64url")}`;
await page.goto(`${BASE}/trial/activate#t=${token}`);
await page.getByRole("button", { name: "Activate my 7 days" }).click();
await page.getByText("Your free week is on").waitFor();
const grant = (await db.query("select plan, status, round(extract(epoch from expires_at - starts_at) / 86400) days from public.complimentary_grants where email = 'ux-test@built2bid.test'")).rows;
check("Activation: one 7-day Unlimited grant", grant.length === 1 && grant[0].plan === "unlimited" && Number(grant[0].days) === 7, JSON.stringify(grant));
await shot(page, "10-phone-pass-activated", false);
const again = await page.evaluate((t) => fetch("/api/trial/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t }) }).then((r) => r.json()), token);
check("Activation retry is idempotent", again.ok === true && again.repeat === true && (await db.query("select count(*)::int n from public.complimentary_grants where email = 'ux-test@built2bid.test'")).rows[0].n === 1);
await page.context().close();

// ------------------------------------------------------------------ Path 4: deck builder, same trade, profit + stairs (desktop)
page = await newPage("desktop");
await page.goto(`${BASE}/bid-check`);
await pick(page, "profit");
asked = await answerAll(page, [["trade", "decks"], ["decks.job", "replacement"], ["decks.pain", "stairs"]], "P4");
check("P4 different follow-up for the same trade", (await prompt(page)) === "How do you price stairs today?");
await answerAll(page, [["decks.follow.profit.stairs", "package"], ["tools", "notes"]], "P4");
await page.getByTestId("bc-result").waitFor();
check("P4 result: profit / decks / stairs", (await page.getByTestId("bc-result").getAttribute("data-result")) === "profit:decks:stairs");
check("P4 profit example with margin and gross profit", (await page.getByTestId("bc-profit-summary").innerText()).includes("Gross profit"));
check("P4 demolition included for a replacement", (await page.getByTestId("bc-example").innerText()).includes("Demolition"));
check("P4 recommendation differs from P1", (await page.getByTestId("bc-headline").innerText()) !== "Turn your deck spreadsheet into a bid you can send." && (await page.getByTestId("bc-try").innerText()).includes("stringers"));
await shot(page, "11-desktop-result-deck-profit");
await page.context().close();

// ------------------------------------------------------------------ Path 5: painter, same trade, faster estimates + prep (phone, dark)
page = await newPage("phone", { theme: "dark" });
await page.goto(`${BASE}/bid-check?trade=painting`);
await pick(page, "speed");
await answerAll(page, [["trade", "="], ["painting.job", "exterior"], ["painting.pain", "prep"]], "P5");
check("P5 prep branch question", (await prompt(page)) === "When you price prep, where does the time go?");
await shot(page, "12-phone-dark-prep-branch", false);
await answerAll(page, [["painting.follow.speed.prep", "repairs"], ["tools", "notes"]], "P5");
await page.getByTestId("bc-result").waitFor();
check("P5 result: speed / painting / prep with prep broken out", (await page.getByTestId("bc-result").getAttribute("data-result")) === "speed:painting:prep" && (await page.getByTestId("bc-focus-group").innerText()).includes("Scraping and sanding"));
await shot(page, "13-phone-dark-result-painter-prep");
await page.context().close();

// ------------------------------------------------------------------ Path 6: trade switch mid-flow (desktop, black)
page = await newPage("desktop", { theme: "black" });
await page.goto(`${BASE}/bid-check`);
await pick(page, "speed");
await answerAll(page, [["trade", "decks"], ["decks.job", "new"], ["decks.pain", "stairs"]], "P6");
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Back" }).click();
await page.getByRole("button", { name: "Back" }).click();
check("P6 back at the trade question", (await qid(page)) === "trade");
await pick(page, "painting");
check("P6 now asks the painting job question", (await qid(page)) === "painting.job");
await answerAll(page, [["painting.job", "interior"], ["painting.pain", "labor"], ["follow.speed", "prices"], ["tools", "software"]], "P6");
await page.getByTestId("bc-result").waitFor();
const t6 = await resultText(page);
check("P6 result has no leftover deck answers", (await page.getByTestId("bc-result").getAttribute("data-result")) === "speed:painting:labor" && !/deck|stair/i.test(t6));
const st6 = await page.evaluate(() => JSON.parse(sessionStorage.getItem("b2b_bid_check")).answers);
check("P6 deck answers cleared from state", !Object.keys(st6).some((k) => k.startsWith("decks.")), JSON.stringify(st6));
await shot(page, "14-desktop-black-result-after-switch");
await page.context().close();

// ------------------------------------------------------------------ Path 7: roofing new construction skips tear-off (phone)
page = await newPage("phone");
await page.goto(`${BASE}/bid-check?trade=roofing`);
await pick(page, "profit");
await answerAll(page, [["trade", "="], ["roofing.job", "new"]], "P7");
const opts = await page.locator("[data-testid=bc-option]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value")));
check("P7 no tear-off or decking on new construction", JSON.stringify(opts) === JSON.stringify(["pitch", "materials"]), JSON.stringify(opts));
await shot(page, "15-phone-roof-new-construction", false);
await page.context().close();

// ------------------------------------------------------------------ Path 8: multiple trades and "other"
page = await newPage("phone");
await page.goto(`${BASE}/bid-check`);
await pick(page, "proposals");
await answerAll(page, [["trade", "multiple"], ["multi.first", "concrete"], ["concrete.job", "flatwork"], ["concrete.pain", "finishing"], ["follow.proposals", "included"]], "P8");
await page.getByTestId("bc-result").waitFor();
check("P8 multiple trades: six questions, concrete result", (await page.getByTestId("bc-result").getAttribute("data-result")) === "proposals:concrete:finishing");
await page.context().close();
page = await newPage("desktop");
await page.goto(`${BASE}/bid-check`);
await pick(page, "speed");
await answerAll(page, [["trade", "other"], ["other.what", "custom"], ["custom.describe", "text:Sunrooms"], ["custom.pain", "materials"], ["follow.speed", "prices"]], "P9");
await page.getByTestId("bc-result").waitFor();
check("P9 other: template example and start-a-bid action", (await page.getByTestId("bc-example").getAttribute("data-kind")) === "template" && (await page.getByTestId("bc-action").innerText()).includes("Start a Sunrooms bid"));
await shot(page, "16-desktop-result-other-trade");
await page.context().close();

// ------------------------------------------------------------------ Path 10: remodeler, proposals + allowances (phone)
page = await newPage("phone");
await page.goto(`${BASE}/bid-check?trade=remodeling&utm_source=facebook&utm_medium=group&utm_campaign=bid_check_remodelers`);
await pick(page, "proposals");
asked = await answerAll(page, [["trade", "="], ["remodeling.job", "kitchens"], ["remodeling.pain", "allowances"]], "P10");
check("P10 asks which selection customers misunderstand", (await prompt(page)) === "Which selection do customers most often misunderstand?");
await answerAll(page, [["remodeling.follow.proposals.allowances", "countertops"], ["tools", "notes"]], "P10");
await page.getByTestId("bc-result").waitFor();
check("P10 result: proposals / kitchens / allowances", (await page.getByTestId("bc-result").getAttribute("data-result")) === "proposals:kitchens:allowances");
check("P10 countertop tip + real proposal", (await page.getByTestId("bc-try").innerText()).includes("countertop allowance") && (await page.getByTestId("bc-example").getAttribute("data-kind")) === "proposal");
await shot(page, "17-phone-result-remodel-allowances");
await page.context().close();

check("No page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
fs.writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
await browser.close(); await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
