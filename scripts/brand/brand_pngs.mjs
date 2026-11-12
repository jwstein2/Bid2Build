// Render Built2Bid raster assets from the SVG masters in public/brand.
// Usage: node scripts/brand/brand_pngs.mjs   (run generate_svgs.py first)
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const brand = join(root, "public/brand");
const svg = (f) => readFileSync(join(brand, f));
const png = (input, size, out) => sharp(input, { density: 72 * Math.max(1, size / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);

const fav = svg("built2bid-favicon.svg");
const mark = svg("built2bid-mark.svg");

// Favicons (no ruler ticks) and app/PWA icons (full mark).
const icoSizes = [16, 32, 48];
const icoPngs = [];
for (const s of icoSizes) {
  const buf = await sharp(fav, { density: 300 }).resize(s, s).png().toBuffer();
  icoPngs.push(buf);
  writeFileSync(join(brand, `favicon-${s}.png`), buf);
}
for (const s of [192, 512]) await png(mark, s, join(brand, `icon-${s}.png`));
await png(mark, 180, join(root, "src/app/apple-icon.png"));
await png(mark, 512, join(root, "src/app/icon.png"));

// Maskable PWA icon: mark inset in the safe zone on a navy field.
const maskable = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0B2D4D"/><g transform="translate(9.6 9.6) scale(0.7)">${mark.toString().replace(/^.*?<desc>.*?<\/desc>/s, "").replace(/<\/svg>\s*$/, "")}</g></svg>`);
await png(maskable, 512, join(brand, "icon-maskable-512.png"));

// favicon.ico with embedded PNGs (supported by all current browsers).
function ico(images, sizes) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length); let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const s = sizes[i] >= 256 ? 0 : sizes[i];
    dir.writeUInt8(s, i * 16); dir.writeUInt8(s, i * 16 + 1); dir.writeUInt8(0, i * 16 + 2); dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6); dir.writeUInt32LE(img.length, i * 16 + 8); dir.writeUInt32LE(offset, i * 16 + 12);
    offset += img.length;
  });
  return Buffer.concat([header, dir, ...images]);
}
writeFileSync(join(root, "src/app/favicon.ico"), ico(icoPngs, icoSizes));

// Social preview.
await sharp(svg("og-source.svg"), { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toFile(join(root, "src/app/opengraph-image.png"));
await sharp(svg("og-source.svg"), { density: 144 }).resize(1200, 630).png({ compressionLevel: 9 }).toFile(join(root, "src/app/twitter-image.png"));
console.log("raster assets written");
