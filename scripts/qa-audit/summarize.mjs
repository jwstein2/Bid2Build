// Aggregates crawl-*.json and results-*.jsonl into inventory.json + a summary of failures.
import fs from "node:fs";
import path from "node:path";
const OUT = process.env.QA_OUT ?? "qa-audit-out";
const files = fs.readdirSync(OUT);
const inventory = new Map(); // key -> {role, route, kind, name, href, status, note}
const pageLoads = [];
for (const f of files.filter((f) => /^crawl-.*\.json$/.test(f))) {
  const r = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  const tag = f.replace(/^crawl-|\.json$/g, "");
  for (const pg of r.pages) {
    pageLoads.push({ tag, route: pg.route, finalUrl: pg.finalUrl, status: pg.status, loadFail: !!pg.loadFail, is404: pg.is404, errors: pg.loadErrors, loadOnly: !!pg.loadOnly });
    const res = new Map(pg.results.map((x) => [x.idx, x]));
    for (const el of pg.elements) {
      const x = res.get(el.idx) ?? { status: "UNTESTED", note: "no result" };
      // A function is identified by role + page template + kind + name (+ link target). Shared header/footer
      // controls are counted once per role.
      const where = el.shared ? "(shared nav)" : pg.route;
      const key = `${tag}|${where}|${el.kind}|${el.name}|${el.kind === "link" ? el.href : ""}`;
      const prev = inventory.get(key);
      const rank = { FAIL: 6, NOEFFECT: 5, PASS: 4, EXTERNAL: 3, DISABLED: 2, SKIP: 2, UNTESTED: 1, CLICK: 0, DUP: 0 };
      if (!prev || rank[x.status] > rank[prev.status]) inventory.set(key, { tag, route: where, kind: el.kind, name: el.name, href: el.href, status: x.status, note: x.note });
    }
  }
}
const inv = [...inventory.values()];
const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
const flows = [];
for (const f of files.filter((f) => /^results-.*\.jsonl$/.test(f))) for (const line of fs.readFileSync(path.join(OUT, f), "utf8").split("\n").filter(Boolean)) flows.push(JSON.parse(line));
fs.writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify({ generatedAt: new Date().toISOString(), crawl: inv, pageLoads, flows }, null, 1));
console.log("crawl functions:", inv.length, by(inv, "status"));
console.log("by role:", by(inv, "tag"));
console.log("page loads:", pageLoads.length, "load failures:", pageLoads.filter((p) => p.loadFail).length);
console.log("flow tests:", flows.length, by(flows, "status"));
if (process.argv.includes("--fails")) {
  for (const p of pageLoads.filter((p) => p.loadFail)) console.log("LOADFAIL", p.tag, p.route, p.status, (p.errors.pageErrors[0] ?? "").slice(0, 120));
  for (const x of inv.filter((x) => ["FAIL", "NOEFFECT"].includes(x.status))) console.log(x.status, x.tag, x.route, x.kind, JSON.stringify(x.name), "|", (x.note ?? "").slice(0, 200));
}
