// Browser walk for "Generate My Price Library" (V8.6): entry on the Saved Items page, Step 1 form, progress,
// review by category, cost entry, past-cost suggestion, duplicate resolution, stacks, approval preview,
// double-click safety and the "use in bids" step. Desktop + phone.
// The /api/library/drafts endpoints are answered in the browser by a small in-memory stand-in (the real
// routes and SQL are covered by tests/library-generator.test.ts and tests/db/library-generator.test.ts).
// Needs scripts/ux-audit/mock-supabase.mjs on :54321 and `next start` on :3000 built against it.
// Usage: node scripts/library-generator/walk.mjs <outDir>
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const out = process.argv[2] ?? "library-generator-shots";
fs.mkdirSync(out, { recursive: true });

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "ux-test@built2bid.test", email_confirmed_at: new Date().toISOString() };
const b64u = (s) => Buffer.from(s).toString("base64url");
const jwt = `${b64u('{"alg":"HS256","typ":"JWT"}')}.${b64u(JSON.stringify({ sub: user.id, exp: 4102444800, role: "authenticated", aud: "authenticated" }))}.sig`;
const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 3600 * 24 * 365 * 50, expires_at: 4102444800, user };
const authCookie = { name: "sb-localhost-auth-token", value: `base64-${b64u(JSON.stringify(session))}`, domain: "localhost", path: "/" };

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const shot = (page, name, full = false) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ── In-memory stand-in for the generator API ─────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const CATALOG = [
  ["Site preparation", [["Clear and grade site", "labor", "square foot"], ["Erosion control silt fence", "material", "linear foot"]]],
  ["Demolition and disposal", [["Break out existing concrete", "labor", "square foot"], ["Concrete disposal", "other", "load"], ["Dumpster rental", "equipment", "each"]]],
  ["Excavation", [["Excavate for slab", "labor", "cubic yard"], ["Mini excavator rental", "equipment", "day"]]],
  ["Subgrade preparation", [["Crushed gravel base", "material", "ton"], ["Compact subgrade", "labor", "square foot"], ["Plate compactor rental", "equipment", "day"]]],
  ["Formwork", [["2x4 form boards", "material", "linear foot"], ["Form stakes", "material", "each"], ["Set and strip forms", "labor", "linear foot"]]],
  ["Reinforcement", [["#4 rebar, 20 ft", "material", "piece"], ["Wire mesh 6x6", "material", "sheet"], ["Rebar chairs", "material", "bag"]]],
  ["Concrete supply", [["Ready-mix concrete 4000 psi", "material", "cubic yard"], ["Fiber additive", "material", "cubic yard"], ["Pump truck", "subcontractor", "day"]]],
  ["Placement and finishing", [["Place and finish slab", "labor", "square foot"], ["Broom finish", "labor", "square foot"], ["Stamped finish", "labor", "square foot"]]],
  ["Control joints", [["Saw-cut control joints", "labor", "linear foot"], ["Expansion joint filler", "material", "linear foot"]]],
  ["Curing and sealing", [["Curing compound", "material", "gallon"], ["Concrete sealer", "material", "gallon"]]],
];
const state = { drafts: new Map(), approveCalls: 0, keys: new Map(), lastGenerate: null };
function newDraft(prompt, trades) {
  const id = uid();
  const items = [];
  let k = 0;
  for (const [cat, list] of CATALOG) for (const [name, costType, unit] of list) items.push({
    id: uid(), name, description: "", trade: "concrete", category: cat, costType, unit, unitCost: "", costSource: "none", costSourceNote: "", suggestedCost: "", suggestedNote: "",
    supplierSku: "", notes: "", conditions: cat === "Concrete supply" ? ["Slab thickness"] : [], optional: /Stamped|Fiber|Pump/.test(name), confidence: /Stamped/.test(name) ? "low" : "high",
    verifyNote: "", taxable: costType !== "labor", status: "candidate", duplicateOf: null, duplicateLevel: null, duplicateReason: "", duplicateAction: null, savedItemId: null, batch: 1, sortOrder: ++k,
  });
  const by = (n) => items.find((i) => i.name === n);
  Object.assign(by("Wire mesh 6x6"), { duplicateOf: "saved-mesh", duplicateLevel: "exact", duplicateReason: "Same name and unit", duplicateAction: "keep_existing", unitCost: "9.5", costSource: "saved_item", costSourceNote: "Your Saved Item “Wire mesh 6x6”" });
  Object.assign(by("Crushed gravel base"), { duplicateOf: "saved-gravel", duplicateLevel: "possible", duplicateReason: "Same name, different unit (yours is cubic yard)" });
  Object.assign(by("Ready-mix concrete 4000 psi"), { suggestedCost: "165.00", suggestedNote: "Median of 3 of your estimates, last Oct 2026. Check it's still current." });
  const stack = { id: uid(), name: "4-inch slab per square foot", trade: "concrete", scaleUnit: "square foot", scaleLabel: "Slab area", scaleCalc: "area", assumptions: ["4 in thick", "5% concrete waste"], status: "candidate", assemblyId: null, sortOrder: 1,
    components: [["Ready-mix concrete 4000 psi", "0.012346", "5"], ["Compact subgrade", "1", ""], ["Wire mesh 6x6", "0.02", "10"], ["Place and finish slab", "1", ""], ["Curing compound", "0.005", ""]].map(([n, per, w]) => ({ itemId: by(n).id, per, quantity: "1", wastePct: w, roundUp: n === "Wire mesh 6x6" || n === "Curing compound", optional: false, note: n.startsWith("Ready") ? "4 in / 12 / 27 = 0.0123 CY per SF" : "" })) };
  const now = new Date().toISOString();
  const d = { draft: { id, title: prompt || "Concrete", prompt, trades, mode: "catalog", status: "draft", notes: ["Ratios in the slab stack assume 4 inches; change them per job."], lastError: null, generationCount: 1, approvedItems: 0, approvedStacks: 0, createdAt: now, updatedAt: now }, items, stacks: [stack] };
  state.drafts.set(id, d);
  return d;
}
const matches = [
  { id: "saved-mesh", name: "Wire mesh 6x6", unit: "sheet", unitCost: "9.5", priceSource: "manual", supplierName: null, category: "Reinforcement" },
  { id: "saved-gravel", name: "Crushed gravel base", unit: "cubic yard", unitCost: "38", priceSource: "supplier_import", supplierName: "Valley Aggregates", category: "Base" },
];
const priced = (i) => i.unitCost !== "";
function preview(d, ids, templates, stackIds) {
  const p = { selected: 0, created: 0, templates: 0, matched: 0, updated: 0, merged: 0, awaitingPrice: 0, skipped: 0, stacks: stackIds.length, conflicts: [], priceChanges: [] };
  for (const i of d.items) {
    if (!ids.includes(i.id) || i.status !== "candidate") continue;
    p.selected++;
    if (i.duplicateOf && !i.duplicateAction) { p.conflicts.push({ itemId: i.id, name: i.name, reason: i.duplicateReason }); continue; }
    if (i.duplicateAction === "keep_existing") { p.matched++; continue; }
    if (i.duplicateAction === "merge") { p.merged++; continue; }
    if (i.duplicateAction === "update_existing") { if (!priced(i)) p.awaitingPrice++; else p.updated++; continue; }
    if (priced(i)) p.created++; else if (templates) p.templates++; else p.awaitingPrice++;
  }
  return p;
}
async function api(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postDataJSON?.() ?? null;
  const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  const m = url.pathname.match(/^\/api\/library\/drafts(?:\/([^/]+))?$/);
  if (!m) return route.continue();
  const id = m[1];
  if (!id && req.method() === "GET") return json({ ready: true, aiReady: true, drafts: [...state.drafts.values()].map((d) => ({ ...d.draft, itemCount: d.items.length, candidateCount: d.items.filter((i) => i.status === "candidate").length })) });
  if (!id && req.method() === "POST") {
    state.lastGenerate = body;
    await new Promise((r) => setTimeout(r, 2500));
    if (body.draftId) {
      const d = state.drafts.get(body.draftId);
      const add = ["Concrete laborer", "Concrete finisher", "Pump operator"].map((name, k) => ({ ...d.items[0], id: uid(), name, category: "Labor", costType: "labor", unit: "hour", duplicateOf: null, duplicateAction: null, duplicateLevel: null, suggestedCost: "", batch: 2, sortOrder: 100 + k, optional: false, conditions: [] }));
      d.items.push(...add);
      return json({ ...d, matches, stacksAccess: true, canShare: false, added: { items: add.length, stacks: 0 } });
    }
    const d = newDraft(body.prompt, body.trades);
    return json({ ...d, matches, stacksAccess: true, canShare: false });
  }
  const d = state.drafts.get(id);
  if (!d) return json({ error: { code: "not_found", message: "That draft no longer exists." } }, 404);
  if (req.method() === "GET") return json({ ...d, matches, stacksAccess: true, canShare: false });
  if (req.method() === "PATCH") {
    if (body.op === "draft") { if (body.status) d.draft.status = body.status; return json({ ok: true }); }
    if (body.op === "items") {
      for (const i of d.items.filter((x) => body.ids.includes(x.id))) {
        const p = body.patch;
        if (p.name !== undefined) i.name = p.name;
        if (p.unit !== undefined) { i.unit = p.unit; if (i.costSource !== "contractor") { i.unitCost = ""; i.costSource = "none"; } }
        if (p.unitCost !== undefined) { i.unitCost = p.unitCost; i.costSource = p.unitCost ? "contractor" : "none"; i.costSourceNote = ""; }
        if (p.costAction === "accept_suggestion") { i.unitCost = i.suggestedCost; i.costSource = "history"; i.costSourceNote = i.suggestedNote; }
        if (p.duplicateAction !== undefined) i.duplicateAction = p.duplicateAction;
        if (p.removed !== undefined) i.status = p.removed ? "removed" : "candidate";
        if (p.costType !== undefined) i.costType = p.costType;
      }
      if (d.draft.status === "draft") d.draft.status = "under_review";
      return json({ items: d.items.filter((x) => body.ids.includes(x.id)) });
    }
    if (body.op === "stack") { const s = d.stacks.find((x) => x.id === body.id); Object.assign(s, body.patch.components ? { components: body.patch.components } : {}, body.patch.removed ? { status: "removed" } : {}); return json({ ok: true }); }
  }
  if (req.method() === "POST" && body.op === "preview") return json(preview(d, body.itemIds, body.templates, body.stackIds));
  if (req.method() === "POST" && body.op === "approve") {
    state.approveCalls++;
    if (state.keys.has(body.requestKey)) return json({ result: { ...state.keys.get(body.requestKey), replayed: true } });
    const p = preview(d, body.itemIds, body.templates, body.stackIds);
    for (const i of d.items) {
      if (!body.itemIds.includes(i.id) || i.status !== "candidate") continue;
      if (i.duplicateAction === "keep_existing") i.status = "matched";
      else if (i.duplicateAction === "merge") i.status = "merged";
      else if (priced(i)) i.status = "approved";
      else if (body.templates) i.status = "template";
    }
    for (const s of d.stacks) if (body.stackIds.includes(s.id)) s.status = "approved";
    const remaining = d.items.filter((i) => i.status === "candidate").length;
    d.draft.status = remaining ? "partially_approved" : "approved";
    const result = { created: p.created, templates: p.templates, matched: p.matched, updated: p.updated, merged: p.merged, awaitingPrice: p.awaitingPrice, skipped: 0, stacks: p.stacks, remaining };
    state.keys.set(body.requestKey, result);
    await new Promise((r) => setTimeout(r, 400));
    return json({ result });
  }
  return json({ error: { code: "invalid", message: "?" } }, 400);
}

const browser = await chromium.launch();
await fetch("http://localhost:54321/__scenario?name=unlimited").catch(() => {});
for (const vp of [{ id: "desktop", width: 1440, height: 900 }, { id: "m390", width: 390, height: 844 }]) {
  const T = (n) => `[${vp.id}] ${n}`;
  state.drafts.clear(); state.keys.clear(); state.approveCalls = 0;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.width < 768, isMobile: vp.width < 768 });
  await ctx.addCookies([authCookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/library/drafts**", api);

  // Entry on the existing library page
  await page.goto(`${BASE}/dashboard/items`, { waitUntil: "networkidle" });
  const entry = page.getByTestId("generate-entry");
  await entry.waitFor({ timeout: 15000 });
  check(T("Generate My Price Library shows near the top of the Saved Items page"), await entry.isVisible());
  const order = await page.evaluate(() => { const e = document.querySelector('[data-testid="generate-entry"]'); const h = document.getElementById("saved-items-h"); return Boolean(e && h && (e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)); });
  check(T("entry sits above the existing Saved Items list"), order);
  check(T("existing library still renders"), await page.getByRole("heading", { name: "Saved Items", exact: true }).isVisible());
  await shot(page, `01-library-entry__${vp.id}`);

  // Step 1
  await page.getByTestId("generate-start").click();
  await page.getByTestId("gen-prompt").waitFor();
  await page.getByRole("button", { name: "Residential concrete work" }).click();
  await page.getByTestId("gen-trade").filter({ hasText: /^Concrete$/ }).click();
  check(T("Step 1 page has no horizontal scroll"), await noHScroll(page));
  await shot(page, `02-describe__${vp.id}`, true);

  // Step 2: progress
  await page.getByTestId("gen-submit").click();
  await page.getByTestId("gen-progress").waitFor();
  check(T("progress and cancel show while generating"), await page.getByRole("button", { name: "Cancel" }).isVisible());
  await shot(page, `03-generating__${vp.id}`);
  check(T("request carries the prompt and trade only"), state.lastGenerate?.prompt === "Residential concrete work" && state.lastGenerate?.trades?.includes("concrete"), JSON.stringify(state.lastGenerate));

  // Step 3: review
  await page.waitForURL(/\/dashboard\/items\/generate\/[0-9a-f-]{36}/, { timeout: 15000 });
  await page.getByTestId("draft-item").first().waitFor();
  const text = await page.locator("main").innerText();
  check(T("catalog grouped by concrete categories"), ["Site preparation", "Formwork", "Reinforcement", "Concrete supply", "Control joints", "Curing and sealing"].every((c) => text.includes(c)));
  check(T("no invented prices: unpriced items say Cost not set"), (await page.getByPlaceholder("Cost not set").count()) >= 20 && /Cost not set/.test(text));
  check(T("saved price is attributed"), /From your Saved Items/.test(text));
  check(T("past cost is a suggestion, not filled in"), /Use \$165\.00/.test(text));
  check(T("review page has no horizontal scroll"), await noHScroll(page));
  await shot(page, `04-review__${vp.id}`);
  await shot(page, `04-review-full__${vp.id}`, true);

  // Step 4: costs
  const rows = page.getByTestId("draft-item");
  const rebar = rows.filter({ has: page.locator('input[value="#4 rebar, 20 ft"]') });
  await rebar.getByPlaceholder("Cost not set").fill("12.40");
  await rebar.getByPlaceholder("Cost not set").blur();
  await page.getByRole("button", { name: "Use $165.00 / CY" }).click();
  await page.waitForTimeout(300);
  check(T("typed cost marks the item ready"), (await rebar.innerText()).includes("Ready"));
  check(T("accepted past cost keeps its attribution"), /From your past estimates/.test(await page.locator("main").innerText()));

  // Step 5: duplicates
  const dupBox = page.getByTestId("duplicate-box").filter({ hasText: "Might already be" });
  check(T("possible duplicate shows the contractor's existing item and price"), /Crushed gravel base · \$38\.00/.test(await dupBox.innerText()));
  await page.getByRole("tab", { name: /Duplicates/ }).click();
  await shot(page, `05-duplicates__${vp.id}`);
  await dupBox.locator("select").selectOption("keep_existing");
  await page.waitForTimeout(300);
  await page.getByRole("tab", { name: /To review/ }).click();

  // Step 6: approve
  await page.getByTestId("approve-ready").click();
  const dlg = page.getByTestId("approve-dialog");
  await dlg.waitFor();
  const dt = await dlg.innerText();
  check(T("approval preview shows new / matched counts"), /New Saved Items\s*2/.test(dt) && /Matched to items you already have[^\n]*\s*2/.test(dt), dt.replace(/\n/g, " | "));
  await shot(page, `06-approve-preview__${vp.id}`);
  const confirm = page.getByTestId("approve-confirm");
  await confirm.dblclick();
  await page.getByTestId("approve-done").waitFor();
  check(T("double-click saves once (one request key)"), state.keys.size === 1, `calls=${state.approveCalls} keys=${state.keys.size}`);
  const done = await page.getByTestId("approve-done").innerText();
  check(T("Step 7 says where the items are used"), /Suggested & Saved Items/.test(done) && /never changes a bid you already sent/.test(done));
  await shot(page, `07-done__${vp.id}`);

  // Unpriced template path + stack review
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  await page.getByTestId("select-all").click();
  await page.getByTestId("approve-selected").click();
  await dlg.waitFor();
  check(T("unpriced items stay in the draft unless templates are chosen"), /Still awaiting a cost[^\n]*\s*\d+/.test(await dlg.innerText()));
  await page.getByTestId("approve-templates").check();
  await page.waitForFunction(() => /Unpriced templates\s*[1-9]/.test(document.querySelector('[data-testid="approve-dialog"]')?.textContent ?? ""));
  check(T("Unpriced Template path is explicit"), /Unpriced templates/.test(await dlg.innerText()));
  await shot(page, `08-templates__${vp.id}`);
  await page.getByRole("button", { name: "Cancel" }).last().click();

  const stack = page.getByTestId("draft-stack").first();
  await stack.scrollIntoViewIfNeeded();
  const st = await stack.innerText();
  check(T("stack shows assumptions and per-unit amounts"), /4 in thick/.test(st) && /Per 1 SF/.test(st));
  check(T("stack thickness note is shown for review"), /inches thick/.test(st));
  await shot(page, `09-stack__${vp.id}`);
  await stack.getByTestId("stack-approve").click();
  await dlg.waitFor();
  check(T("stack saves only through its own confirmation"), /Stacks to save\s*1/.test(await dlg.innerText()));
  await page.getByTestId("approve-confirm").click();
  await page.getByTestId("approve-done").waitFor();
  check(T("stack saved"), /1 stack/.test(await page.getByTestId("approve-done").innerText()));

  // More by category batch
  await page.getByRole("button", { name: "Keep reviewing" }).click();
  await page.getByRole("button", { name: "Add labor" }).click();
  await page.getByText(/Added 3 items/).waitFor({ timeout: 10000 });
  check(T("Add labor adds a small batch to the same draft"), state.lastGenerate?.focus === "labor" && Boolean(state.lastGenerate?.draftId));

  // Draft survives a refresh
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("draft-item").first().waitFor();
  check(T("draft survives a refresh"), (await page.locator('input[value="Concrete laborer"]').count()) === 1);
  check(T("no page errors"), errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
