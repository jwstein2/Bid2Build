// Builds the navigable evidence index (index.html + per-role CSV matrices) from crawl results.
//   node scripts/platform-audit/report.mjs <auditDir>
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve(process.argv[2] ?? "audit");
const roles = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "results.json")));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
const NOISE = /ERR_TUNNEL_CONNECTION_FAILED|status of 404 \(Not Found\)/;
let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Built2Bid audit evidence</title>
<style>
:root{--bg:#fff;--fg:#14202e;--mut:#5b6876;--line:#dfe4ea;--ok:#0a7a45;--bad:#b42318;--warn:#a15c00;--chip:#f2f5f8}
@media (prefers-color-scheme:dark){:root{--bg:#0e141b;--fg:#e6edf3;--mut:#9aa7b4;--line:#26313d;--ok:#3fb67a;--bad:#ff7b72;--warn:#e3b341;--chip:#18212b}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1280px;margin:0 auto;padding:16px}
h1{font-size:22px}h2{margin-top:36px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{margin-top:24px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:var(--bg)}.wrap{overflow-x:auto}
.pass{color:var(--ok);font-weight:600}.fail,.error{color:var(--bad);font-weight:700}.skipped,.not-reachable,.no-visible-effect{color:var(--warn);font-weight:600}
.chip{display:inline-block;background:var(--chip);border-radius:6px;padding:1px 6px;margin:1px;font-size:12px}a{color:inherit}
nav a{margin-right:12px}.mut{color:var(--mut)}
</style></head><body><main><h1>Built2Bid platform audit: evidence index</h1>
<p class="mut">Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from Playwright runs against a local build with a mock backend (fixture data, not production), plus a read-only pass over production public pages. Read <a href="AUDIT_REPORT.md">AUDIT_REPORT.md</a> for findings and priorities.</p>
<nav>${roles.map((r) => `<a href="#${r}">${r}</a>`).join("")}</nav>`;
for (const role of roles) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, role, "results.json"), "utf8"));
  const tally = d.clicks.reduce((m, c) => ({ ...m, [c.result]: (m[c.result] ?? 0) + 1 }), {});
  html += `<h2 id="${role}">${role}</h2><p>${d.pages.length} pages · ${d.links.length} internal link targets checked (${d.links.filter((l) => l.status >= 400 || l.status < 0).length} broken) · controls clicked: ${Object.entries(tally).map(([k, v]) => `<span class="chip ${k}">${k} ${v}</span>`).join(" ") || "none"}</p>`;
  html += `<h3>Pages</h3><div class="wrap"><table><tr><th>Page</th><th>Status / lands on</th><th>Screenshots</th><th>Findings</th></tr>`;
  for (const p of d.pages) {
    const v = p.views["1440-light"] ?? Object.values(p.views)[0];
    const issues = [];
    for (const [tag, x] of Object.entries(p.views)) {
      if (x.overflow) issues.push(`${tag}: horizontal overflow ${x.sw}px > ${x.vw}px ${esc((x.offenders ?? []).slice(0, 2).join("; "))}`);
      const con = (x.console ?? []).filter((c) => !NOISE.test(c)); if (con.length) issues.push(`${tag}: console ${esc(con.slice(0, 2).join(" | "))}`);
      const fl = (x.failed ?? []).filter((f) => !/→ 404$/.test(f) || !f.includes(p.path)); if (fl.length) issues.push(`${tag}: failed requests ${esc(fl.slice(0, 3).join(" | "))}`);
      if (x.axe?.length) issues.push(`${tag}: axe ${x.axe.map((a) => `${a.id} (${a.impact}, ${a.n})`).join(", ")}`);
    }
    if (v.smallCount) issues.push(`touch targets under 24px at 1440: ${v.smallCount}`);
    const sm = p.views["390-light"]?.smallCount; if (sm) issues.push(`touch targets under 24px at 390: ${sm}`);
    html += `<tr><td><b>${esc(p.path)}</b><br><span class="mut">${esc(v.h1 ?? v.title ?? "")}</span></td><td>${v.status}${v.finalUrl !== p.path ? ` → ${esc(v.finalUrl)}` : ""}</td><td>${Object.entries(p.views).map(([t, x]) => `<a class="chip" href="${role}/${x.file}">${t}</a>`).join("")}</td><td>${issues.length ? issues.map((i) => `<div>${i}</div>`).join("") : '<span class="pass">no automated findings</span>'}</td></tr>`;
  }
  html += `</table></div>`;
  if (d.clicks.length) {
    html += `<h3>Interaction matrix (${d.clicks.length})</h3><div class="wrap"><table><tr><th>Page</th><th>Control</th><th>Result</th><th>What happened</th><th>Evidence</th></tr>`;
    for (const c of d.clicks) html += `<tr><td>${esc(c.page)}</td><td>${esc(c.element)}</td><td class="${c.result}">${c.result}</td><td>${esc([...(c.effects ?? []), c.error, c.note, ...(c.console ?? []).filter((x) => !NOISE.test(x)).map((x) => `console: ${x}`), ...(c.failed ?? []).map((x) => `request: ${x}`)].filter(Boolean).join(" · "))}</td><td>${c.before ? `<a class="chip" href="${role}/${c.before}">before</a><a class="chip" href="${role}/${c.after}">after</a>` : ""}</td></tr>`;
    html += `</table></div>`;
    fs.writeFileSync(path.join(dir, role, "interaction-matrix.csv"), csv([["page", "control", "tag", "result", "effects", "error/note", "console", "failed requests", "before", "after"], ...d.clicks.map((c) => [c.page, c.element, c.tag, c.result, (c.effects ?? []).join(" · "), c.error ?? c.note ?? "", (c.console ?? []).join(" | "), (c.failed ?? []).join(" | "), c.before ?? "", c.after ?? ""])]));
  }
  const bad = d.links.filter((l) => l.status >= 400 || l.status < 0);
  html += `<h3>Link targets</h3><p>${d.links.length} checked as this role. ${bad.length ? "" : '<span class="pass">None broken.</span>'}</p>`;
  if (bad.length) html += `<table><tr><th>Link</th><th>Status</th><th>Found on</th><th>Text</th></tr>${bad.map((l) => `<tr><td>${esc(l.href)}</td><td class="fail">${l.status}</td><td>${esc(l.from)}</td><td>${esc(l.text)}</td></tr>`).join("")}</table>`;
  fs.writeFileSync(path.join(dir, role, "links.csv"), csv([["href", "status", "redirect", "found on", "text"], ...d.links.map((l) => [l.href, l.status, l.location, l.from, l.text])]));
}
html += `</main></body></html>`;
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log(`wrote ${path.join(dir, "index.html")} for ${roles.join(", ")}`);
