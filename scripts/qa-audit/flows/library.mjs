// Batch: Saved Stacks (assemblies). Save a starter assembly, check its rows in the database, rename, delete.
import { chromium, contextFor, watch, recorder, BASE, USERS, q, closeDb, dismissPopups } from "../lib.mjs";
const rec = recorder("library");
const b = await chromium.launch();
const ctx = await contextFor(b, "pro");
const [{ id: uid }] = await q("select id from auth.users where email=$1", [USERS.pro]);
const T = (id, name, exp, fn) => rec.test(`LIB-${id}`, "Saved Stacks", name, exp, fn);
const open = async (path) => { const p = await ctx.newPage(); const w = watch(p); await p.goto(BASE + path); await p.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {}); await dismissPopups(p); return { p, w }; };
// Setup: remove earlier runs' copies of the starter so its button is offered again.
await q("delete from public.assemblies where user_id=$1 and starter_key='roofing-reroof'", [uid]);
let asmId;

await T("01", "Save a starter assembly to my stacks", "200 from /api/library; stack and its rows saved", async () => {
  const { p, w } = await open("/dashboard/items");
  const resp = p.waitForResponse((r) => r.url().includes("/api/library") && r.request().method() === "POST");
  await p.getByTestId("starter-save").first().click(); const r = await resp;
  if (r.status() !== 200) return { fail: `${r.status()} ${(await r.text()).slice(0, 160)}` };
  const a = await q("select a.id, count(i.id)::int as rows from public.assemblies a left join public.assembly_items i on i.assembly_id=a.id where a.user_id=$1 and a.starter_key='roofing-reroof' group by a.id", [uid]);
  asmId = a[0]?.id;
  if (w.pageErrors.length) return { fail: w.pageErrors[0] };
  return a[0]?.rows > 0 ? `stack saved with ${a[0].rows} rows` : { fail: JSON.stringify(a) };
});
await T("02", "Saved stack shows under Saved Stacks after reload, and the starter says In your stacks", "Listed; button disabled", async () => {
  if (!asmId) return { blocked: "no stack from LIB-01" };
  const { p } = await open("/dashboard/items"); const t = await p.locator("#saved-stacks-h").locator("..").innerText();
  const btn = p.getByTestId("starter-save").first();
  return /Re-roof per square/.test(t) && (await btn.isDisabled()) ? "listed + In your stacks" : { fail: t.slice(0, 200) };
});
await T("02b", "Rename the stack", "New name saved", async () => {
  if (!asmId) return { blocked: "no stack from LIB-01" };
  const { p } = await open("/dashboard/items");
  await p.getByRole("button", { name: "Rename Re-roof per square" }).click();
  await p.getByLabel("Stack name").fill("Re-roof per square QA"); await p.locator("form").filter({ has: p.getByLabel("Stack name") }).getByRole("button", { name: "Save", exact: true }).click(); await p.waitForTimeout(1500);
  const r = await q("select name from public.assemblies where id=$1", [asmId]);
  return r[0]?.name === "Re-roof per square QA" ? "renamed" : { fail: r[0]?.name };
});
await T("03", "Delete the stack", "Stack and rows removed", async () => {
  if (!asmId) return { blocked: "no stack from LIB-01" };
  const { p } = await open("/dashboard/items");
  await p.getByRole("button", { name: /^Delete .*Re-roof per square/ }).first().click(); await p.waitForTimeout(500);
  const confirm = p.getByRole("group", { name: /Confirm deleting/ }).getByRole("button", { name: /Delete/ }).or(p.getByRole("dialog").getByRole("button", { name: /Delete/ }));
  if (await confirm.first().isVisible().catch(() => false)) await confirm.first().click();
  await p.waitForTimeout(2000);
  const left = await q("select count(*)::int as n from public.assemblies where id=$1", [asmId]);
  return left[0].n === 0 ? "deleted" : { fail: "stack still present" };
});
console.log(rec.counts); await b.close(); await closeDb();
