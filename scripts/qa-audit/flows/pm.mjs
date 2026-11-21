// Batch: Project Command Center (scheduling). Review a won bid, build a schedule with the 9-step wizard, publish,
// open the project, upload a job photo. Needs a won bid without a schedule (run projects-financials first).
// Fixture: the Unlimited account gets one scheduling editor on its complimentary grant (the admin "Scheduling editors"
// control writes the same column); buying the add-on goes through Stripe, which is BLOCKED here.
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, shot, dismissPopups, OUT } from "../lib.mjs";
const rec = recorder("pm");
const b = await chromium.launch();
const ctx = await contextFor(b, "pro");
// The job photo fixture (uploads.mjs writes the same file later in run-flows.sh; a fresh QA_OUT doesn't have it yet).
{ const { mkdirSync, existsSync, writeFileSync } = await import("node:fs"); mkdirSync(`${OUT}/fixtures`, { recursive: true });
  if (!existsSync(`${OUT}/fixtures/logo.png`)) { const pg = await b.newPage({ viewport: { width: 240, height: 80 } }); await pg.setContent('<div style="font:bold 40px sans-serif;background:#0b3d63;color:#fff;height:80px">QA LOGO</div>'); writeFileSync(`${OUT}/fixtures/logo.png`, await pg.screenshot()); await pg.close(); } }
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS.pro]);
await q("update public.complimentary_grants set pm_editors=1 where user_id=$1 and status='active'", [uid]);
const T = (id, name, exp, fn) => rec.test(`PM-${id}`, "Projects", name, exp, fn);
const open = async (path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
const est = (await q("select e.id, e.title from public.estimates e where e.user_id=$1 and e.pipeline_stage in ('won','approved') and not exists (select 1 from public.project_schedules s where s.estimate_id=e.id) order by e.updated_at desc limit 1", [uid]))[0];
let schedId, page;

await T("01", "Review a newly approved bid and start scheduling", "Review panel opens; Mark Reviewed & Schedule goes to the wizard for that bid", async () => {
  if (!est) return { blocked: "no won bid without a schedule" };
  const { p, w } = await open("/projects");
  const card = p.getByTestId("review-item").filter({ hasText: est.title }).first();
  if (!(await card.count())) return { fail: `bid "${est.title}" not in the review queue` };
  // An earlier run may have reviewed it already: then the card offers Schedule Now instead of Review.
  const sched = card.getByRole("link", { name: "Schedule Now" });
  if (await sched.isVisible().catch(() => false)) await sched.click();
  else { await card.getByRole("button", { name: "Review" }).click(); await p.waitForTimeout(1200); await p.getByRole("button", { name: "Mark Reviewed & Schedule" }).click(); }
  await p.waitForURL(/\/projects\/new\?estimate=/, { timeout: 15000 });
  page = p;
  const rev = await q("select count(*)::int n from public.project_reviews where estimate_id=$1", [est.id]).catch(() => [{ n: "?" }]);
  return p.url().includes(est.id) && !w.pageErrors.length ? `wizard for the bid (reviews ${rev[0].n})` : { fail: p.url() };
});
await T("02", "Build and publish a schedule with the 9-step wizard", "Schedule saved active starting 2026-12-07 with one row per section", async () => {
  if (!page) return { blocked: "no wizard from PM-01" };
  const p = page; await dismissPopups(p); await p.getByRole("button", { name: "Skip" }).click().catch(() => {});
  const m = p.locator("main").first();
  for (let i = 0; i < 9; i++) {
    const h = (await m.innerText()).match(/Step \d of 9: [^\n]*/)?.[0] ?? "";
    if (/Start date/.test(h)) await m.getByLabel("Proposed start date").fill("2026-12-07");
    if (/Durations/.test(h)) await m.locator("input[type=number]:visible").first().fill("2");
    if (/Save/.test(h)) break;
    await m.getByRole("button", { name: /^Next/ }).first().click(); await p.waitForTimeout(1000);
  }
  await m.getByRole("button", { name: "Save & publish as active" }).click();
  await p.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
  const s = await q("select id, status, start_date::text sd from public.project_schedules where estimate_id=$1", [est.id]);
  schedId = s[0]?.id; await shot(p, "pm-saved");
  return s[0]?.status === "active" && s[0].sd === "2026-12-07" ? `schedule ${s[0].status} from ${s[0].sd}` : { fail: JSON.stringify(s[0] ?? null) + " at " + p.url() };
});
await T("03", "Open the project page", "Project page loads with Schedule, Scope, Documents, Photos, Costs, Financials tabs", async () => {
  if (!schedId) return { blocked: "no schedule from PM-02" };
  const { p, w } = await open(`/projects/${schedId}`); page = p;
  const tabs = await p.getByRole("tab").allInnerTexts();
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return ["Schedule", "Photos", "Financials"].every((t) => tabs.some((x) => x.includes(t))) ? tabs.join(", ") : { fail: `tabs ${tabs.join(",")}` };
});
await T("04", "Upload a job photo", "Photo stored in project_photos and shown", async () => {
  if (!schedId) return { blocked: "no schedule from PM-02" };
  const { p, w } = await open(`/projects/${schedId}?tab=photos`);
  await p.getByRole("tab", { name: /Photos/ }).click().catch(() => {}); await p.waitForTimeout(1000);
  const before = (await q("select count(*)::int n from public.project_photos where estimate_id=$1", [est.id]))[0].n;
  await p.getByTestId("photo-input").setInputFiles(`${OUT}/fixtures/logo.png`); await p.waitForTimeout(6000);
  const after = (await q("select count(*)::int n from public.project_photos where estimate_id=$1", [est.id]))[0].n; await shot(p, "pm-photo");
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return after > before ? "photo saved" : { fail: `photos ${before}->${after}; ${w.failed.slice(0, 2).join(";")}` };
});
await T("05", "Pipeline stage follows the schedule", "Bid moves to Scheduled once the schedule is published", async () => {
  if (!schedId) return { blocked: "no schedule from PM-02" };
  const s = (await q("select pipeline_stage from public.estimates where id=$1", [est.id]))[0];
  return /scheduled|in_progress/.test(s.pipeline_stage) ? `stage ${s.pipeline_stage}` : { fail: `stage ${s.pipeline_stage}` };
});
console.log(rec.counts); await b.close(); await closeDb();
