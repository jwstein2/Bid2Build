// Renders app screenshot posts. Usage: node render-shots.js <bank.js> <outDir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const posts = require(path.resolve(process.argv[2])); const outDir = path.resolve(process.argv[3]);
const shots = path.join(__dirname, '..', 'assets', 'app-screenshots');
const logo = 'file://' + path.resolve(__dirname, '../../../public/brand/built2bid-logo-reverse.svg');
const SIZES = { instagram: [1080, 1350], facebook: [1080, 1080], linkedin: [1080, 1350] };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function html(p) {
  const [w, h] = SIZES[p.platform]; const [x0, y0, x1, y1] = p.crop; const cw = x1 - x0, ch = y1 - y0;
  const maxW = 900, maxH = h - (p.platform === 'facebook' ? 540 : 580); const s = Math.min(maxW / cw, maxH / ch);
  return `<html><head><style>body{margin:0}.c{width:${w}px;height:${h}px;background:#0B2D4D;font-family:Arial,Helvetica,sans-serif;color:#fff;position:relative;box-sizing:border-box;padding:80px 90px 0}
  .k{font-size:30px;color:#00C2E0;font-weight:700;letter-spacing:2px}.h{font-size:60px;font-weight:800;line-height:1.1;margin-top:16px}
  .f{margin:44px auto 0;width:${Math.round(cw * s)}px;height:${Math.round(ch * s)}px;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45);border:3px solid #14B8A6;position:relative}
  .f img{position:absolute;left:${-x0 * s}px;top:${-y0 * s}px;width:${800 * s}px}
  .n{position:absolute;left:90px;right:90px;bottom:130px;font-size:26px;color:#9fb3c8;text-align:center}</style></head><body><div class="c">
  <div style="position:absolute;top:0;left:0;right:0;height:14px;background:linear-gradient(90deg,#0097B2,#14B8A6)"></div>
  <div class="k">${esc(p.kicker)}</div><div class="h">${esc(p.title)}</div>
  <div class="f"><img src="file://${path.join(shots, p.shot)}"></div>
  <div class="n">${esc(p.note)}</div>
  <img src="${logo}" style="position:absolute;bottom:50px;left:90px;height:50px"><div style="position:absolute;bottom:62px;right:90px;color:#00C2E0;font-size:28px">built2bid.org</div>
  </div></body></html>`;
}
(async () => {
  fs.mkdirSync(outDir, { recursive: true }); const b = await chromium.launch(); const tmp = path.join(outDir, '_r.html');
  for (const p of posts) { const [w, h] = SIZES[p.platform]; const pg = await b.newPage({ viewport: { width: w, height: h } });
    fs.writeFileSync(tmp, html(p)); await pg.goto('file://' + tmp); await pg.waitForTimeout(200);
    await pg.screenshot({ path: path.join(outDir, p.id + '.png') }); await pg.close(); }
  fs.unlinkSync(tmp); await b.close(); console.log('rendered', posts.length);
})();
