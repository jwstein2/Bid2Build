import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Per-page share images (Open Graph / Twitter cards), 1200×630.
 *
 * Left: the Built2Bid mark and the page's headline on the navy brand panel. Right: a real
 * screenshot of the estimate builder for that trade (src/assets/og/trades/<slug>.jpg, captured by
 * scripts/og/capture-trades.mjs); guides without a trade use a proposal screenshot (guide.jpg).
 * Rendered at build time for every trade page and guide, so nothing runs per request.
 */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARD_TYPE = "image/png";

const ASSETS = join(process.cwd(), "src/assets/og");
const NAVY = "#0B2D4D";
const CYAN = "#00C2E0";
const TEAL = "#14B8A6";

async function dataUri(path: string, mime: string) {
  return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
}

export function hasTradePhoto(slug: string | undefined) {
  return Boolean(slug && /^[a-z0-9-]+$/.test(slug) && existsSync(join(ASSETS, "trades", `${slug}.jpg`)));
}

export async function renderShareCard(input: { eyebrow: string; title: string; footer?: string; tradeSlug?: string }) {
  const [semi, bold, mark] = await Promise.all([
    readFile(join(ASSETS, "montserrat-latin-600.woff")),
    readFile(join(ASSETS, "montserrat-latin-800.woff")),
    dataUri(join(process.cwd(), "public/brand/built2bid-mark-reverse.svg"), "image/svg+xml"),
  ]);
  const photoPath = hasTradePhoto(input.tradeSlug) ? join(ASSETS, "trades", `${input.tradeSlug}.jpg`) : join(ASSETS, "guide.jpg");
  const photo = existsSync(photoPath) ? await dataUri(photoPath, "image/jpeg") : null;
  const titleSize = input.title.length > 60 ? 44 : input.title.length > 38 ? 52 : 62;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: NAVY, fontFamily: "Montserrat", position: "relative" }}>
        {/* Blueprint grid */}
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 52px 64px", width: photo ? 560 : 1072, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={mark} width={64} height={64} />
            <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "white" }}>
              Built<span style={{ color: CYAN }}>2</span>Bid
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: TEAL, letterSpacing: 2, textTransform: "uppercase" }}>{input.eyebrow}</div>
            <div style={{ display: "flex", fontSize: titleSize, fontWeight: 800, color: "white", lineHeight: 1.12 }}>{input.title}</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 600, color: "#C9D6E3" }}>{input.footer ?? "built2bid.org"}</div>
        </div>
        {photo && (
          <div style={{ display: "flex", position: "absolute", left: 600, top: 70, width: 640, height: 540, borderRadius: 18, overflow: "hidden", border: `4px solid ${CYAN}`, boxShadow: "0 24px 60px rgba(0,0,0,0.45)", background: "white" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={photo} width={712} height={600} style={{ objectFit: "cover", objectPosition: "left top" }} />
          </div>
        )}
      </div>
    ),
    {
      ...SHARE_CARD_SIZE,
      fonts: [
        { name: "Montserrat", data: semi, weight: 600, style: "normal" },
        { name: "Montserrat", data: bold, weight: 800, style: "normal" },
      ],
    },
  );
}
