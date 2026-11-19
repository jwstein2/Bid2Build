// Aggregates crawl-*.json and results-*.jsonl into inventory.json + a summary of failures.
import fs from "node:fs";
import path from "node:path";
const OUT = process.env.QA_OUT ?? "qa-audit-out";
const files = fs.readdirSync(OUT);
const inventory = new Map(); // key -> {role, route, kind, name, href, status, note}
const pageLoads = [];
// Crawl runs oldest first, so a later run of the same page (a retest after a fix) replaces the earlier result.
const runs = files.filter((f) => /^crawl-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"))).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
for (const r of runs) {
  const tag = `${r.role}${r.mobile ? "-mobile" : ""}`;
  for (const pg of r.pages) {
    // Not-found by design: staff/admin pages for people without access, a deliberate 404 probe, flag-off pages,
    // and the index-less /company/bids (only /company/bids/<id> exists).
    const expected404 = pg.is404 && (/^\/(admin|academy\/manage)(\/|$)/.test(pg.route) && tag !== "owner" || pg.route === "/nope-404" || pg.route === "/trial"
      || pg.route === "/sales/admin" && /^rep/.test(tag) || pg.route === "/company/bids");
    pageLoads.push({ tag, route: pg.route, expected404, finalUrl: pg.finalUrl, status: pg.status, loadFail: !!pg.loadFail, is404: pg.is404, errors: pg.loadErrors, loadOnly: !!pg.loadOnly });
    const res = new Map(pg.results.map((x) => [x.idx, x]));
    for (const el of pg.elements) {
      const x = res.get(el.idx) ?? { status: "UNTESTED", note: "no result" };
      // A function is identified by role + page template + kind + name (+ link target). Shared header/footer
      // controls are counted once per role.
      const where = el.shared ? "(shared nav)" : pg.route;
      const key = `${tag}|${where}|${el.kind}|${el.name}|${el.kind === "link" ? el.href : ""}`;
      const prev = inventory.get(key);
      // Within one run the most telling result wins; a later run replaces an earlier one unless it only says
      // "covered elsewhere" (DUP/CLICK) or "not reached" (UNTESTED).
      const rank = { FAIL: 6, NOEFFECT: 5, PASS: 4, EXTERNAL: 3, DISABLED: 2, SKIP: 2, UNTESTED: 1, CLICK: 0, DUP: 0 };
      const weak = (st) => rank[st] <= 1;
      const replace = !prev || (prev.run === r.startedAt ? rank[x.status] > rank[prev.status] : !weak(x.status) || weak(prev.status) && rank[x.status] >= rank[prev.status]);
      if (replace) inventory.set(key, { run: r.startedAt, tag, route: where, kind: el.kind, name: el.name, href: el.href, status: x.status, note: x.note });
    }
  }
}
const inv = [...inventory.values()];
const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
// Flow tests: the latest run of each test id counts (earlier attempts stay in the jsonl files as history).
const flowMap = new Map();
for (const f of files.filter((f) => /^results-.*\.jsonl$/.test(f))) for (const line of fs.readFileSync(path.join(OUT, f), "utf8").split("\n").filter(Boolean)) {
  const t = JSON.parse(line); const prev = flowMap.get(t.id); if (!prev || String(t.at) >= String(prev.at)) flowMap.set(t.id, t);
}
const flows = [...flowMap.values()];
fs.writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify({ generatedAt: new Date().toISOString(), crawl: inv, pageLoads, flows }, null, 1));
console.log("crawl functions:", inv.length, by(inv, "status"));
console.log("by role:", by(inv, "tag"));
console.log("page loads:", pageLoads.length, "load failures:", pageLoads.filter((p) => p.loadFail && !p.expected404).length, "refused/not found by design:", pageLoads.filter((p) => p.expected404).length);
console.log("flow tests:", flows.length, by(flows, "status"));
if (process.argv.includes("--fails")) {
  for (const p of pageLoads.filter((p) => p.loadFail && !p.expected404)) console.log("LOADFAIL", p.tag, p.route, p.status, (p.errors.pageErrors[0] ?? "").slice(0, 120));
  for (const x of inv.filter((x) => ["FAIL", "NOEFFECT"].includes(x.status))) console.log(x.status, x.tag, x.route, x.kind, JSON.stringify(x.name), "|", (x.note ?? "").slice(0, 200));
}
