// Built2Bid static post renderer. Usage: node render.js <bank.js> <outDir>
// Renders each post in the bank to PNG at its platform size. Deterministic, no AI calls.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const bankFile = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const posts = require(bankFile);
const logo = 'file://' + path.join(__dirname, '../../../public/brand/built2bid-logo-reverse.svg');
const SIZES = { instagram: [1080, 1350], facebook: [1080, 1080], linkedin: [1080, 1350] };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function body(p) {
  const kicker = p.kicker ? `<div class="k">${esc(p.kicker)}</div>` : '';
  switch (p.type) {
    case 'quote':
      return `<div style="font-size:150px;color:#14B8A6;line-height:.6">&ldquo;</div><div class="h" style="font-size:66px">${esc(p.quote)}</div><div class="s" style="color:#9fb3c8">${esc(p.by)}</div>${p.note ? `<div class="n">${esc(p.note)}</div>` : ''}`;
    case 'tip':
      return `${kicker}<div class="h">${esc(p.title)}</div><div class="b">${esc(p.text)}</div>`;
    case 'meme':
      return `${kicker}<div class="s" style="color:#9fb3c8">${esc(p.setupLabel)}</div><div class="h" style="font-size:58px;margin:10px 0 44px">${esc(p.setup)}</div><div class="s" style="color:#9fb3c8">${esc(p.punchLabel)}</div><div style="font-size:${p.emoji ? 120 : 58}px;font-weight:700;margin-top:10px">${p.emoji ? p.emoji : esc(p.punch)}</div>${p.note ? `<div class="n">${esc(p.note)}</div>` : ''}`;
    case 'quiz':
      return `${kicker}<div class="h" style="font-size:64px">${esc(p.title)}</div><div class="b" style="line-height:1.7">${p.items.map((i) => '&#9744; ' + esc(i)).join('<br>')}</div><div class="n" style="color:#dbe6f0">${esc(p.footer)}</div>`;
    case 'list':
      return `${kicker}<div class="h" style="font-size:62px">${esc(p.title)}</div><div class="b" style="line-height:1.6">${p.items.map((i, n) => `<span style="color:#14B8A6;font-weight:800">${n + 1}.</span> ${esc(i)}`).join('<br>')}</div>${p.footer ? `<div class="n">${esc(p.footer)}</div>` : ''}`;
    default:
      throw new Error('unknown type ' + p.type);
  }
}

function html(p) {
  const [w, h] = SIZES[p.platform];
  return `<html><head><style>
  body{margin:0} .c{width:${w}px;height:${h}px;background:#0B2D4D;font-family:Arial,Helvetica,sans-serif;color:#fff;position:relative;display:flex;flex-direction:column;justify-content:center;padding:90px 90px 150px;box-sizing:border-box}
  .k{font-size:34px;color:#00C2E0;font-weight:700;letter-spacing:2px} .h{font-size:72px;font-weight:800;line-height:1.12;margin-top:20px}
  .b{font-size:40px;line-height:1.4;margin-top:40px;color:#dbe6f0} .s{font-size:38px;margin-top:30px} .n{font-size:34px;color:#00C2E0;margin-top:44px;line-height:1.35}
  </style></head><body><div class="c">${body(p)}<img src="${logo}" style="position:absolute;bottom:60px;left:90px;height:56px"><div style="position:absolute;bottom:72px;right:90px;color:#00C2E0;font-size:30px">built2bid.org</div><div style="position:absolute;top:0;left:0;right:0;height:14px;background:linear-gradient(90deg,#0097B2,#14B8A6)"></div></div></body></html>`;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  const tmp = path.join(outDir, '_render.html');
  for (const p of posts) {
    const [w, h] = SIZES[p.platform];
    const page = await b.newPage({ viewport: { width: w, height: h } });
    fs.writeFileSync(tmp, html(p));
    await page.goto('file://' + tmp);
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => { const c = document.querySelector('.c'); return c.scrollHeight > c.clientHeight; });
    if (over) console.warn('OVERFLOW', p.id);
    await page.screenshot({ path: path.join(outDir, p.id + '.png') });
    await page.close();
  }
  fs.unlinkSync(tmp);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(posts.map(({ id, platform, date, time, caption }) => ({ id, platform, date, time, caption, image: id + '.png' })), null, 2));
  await b.close();
  console.log('rendered', posts.length);
})();
