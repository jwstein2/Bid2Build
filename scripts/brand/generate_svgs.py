"""Generate Built2Bid logo SVGs (mark, lockups, mono, favicon).

The wordmark is converted to outlines from Montserrat (SIL OFL 1.1) at weight 800, so the
SVG files render identically without the font installed.

Usage: python3 -I scripts/brand/generate_svgs.py   (needs: pip install fonttools brotli)
"""
import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "brand")
FONT = os.path.join(ROOT, "node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2")

NAVY, CYAN, TEAL, WHITE = "#0B2D4D", "#00C2E0", "#14B8A6", "#FFFFFF"

# ---- Mark geometry (64x64 grid) -------------------------------------------------------
# Follows the approved "Blueprint Precision" board: a solid, heavy uppercase B whose stem is a
# ruler (tick marks cut in), a chamfered 45-degree lower corner, drafting construction lines cut
# through the bowls, and a teal check (with a knockout outline) closing the lower-right bowl.
RULER = "M10 14.8H18.6V52H10Z"
# One closed outline: top bar, upper bowl, waist, lower bowl, flat base, 45-degree chamfer up to the
# lower counter, then both counters (each open to the ruler stem), back to the start.
BOWLS = ("M19.5 11H40C47.2 11 52 15.2 52 21.2C52 24.6 50.2 27.4 47.4 28.9"
         "C50.8 30.6 52.4 33.6 52.4 37.6C52.4 45.6 47.5 52 40 52H18.6L27.1 43.5"
         "H38A3.5 3.5 0 0 0 38 36.5H19.5V28H36.5A4 4 0 0 0 36.5 20H19.5Z")
TICKS = [(10, 18 + i * 3.3, 4.6 if i % 2 == 0 else 3.2) for i in range(10)]
CONSTRUCTION = ["M19.5 16.8H36L47.4 28.2", "M44.6 29.6L39.6 35"]
CHECK = "M31.4 45.8L38.8 53L55.8 34.8"

_mid = [0]
def mark_group(fg, check, cut=True, bg=None, ticks=True, weight=5, tile_rx=14, scale=None):
    """fg: B colour; check: check colour; cut: draw ticks/construction lines as cut-outs."""
    _mid[0] += 1
    mid = f"m{_mid[0]}"
    parts = []
    if bg:
        parts.append(f'<rect width="64" height="64" rx="{tile_rx}" fill="{bg}"/>')
    inner = ""
    if scale:  # shrink the B inside a tile
        inner = f' transform="translate(32 32) scale({scale}) translate(-32 -32)"'
    holes = [f'<path d="{CHECK}" fill="none" stroke="#000" stroke-width="{weight + 3.6:g}" stroke-linecap="square" stroke-linejoin="miter"/>']
    if ticks:
        holes.append('<path d="%s" stroke="#000" stroke-width="0.95"/>' % "".join(f"M{x} {y:.1f}h{l}" for x, y, l in TICKS))
    if cut:
        holes.append('<path d="%s" fill="none" stroke="#000" stroke-width="0.9"/>' % "".join(CONSTRUCTION))
    parts.append(f'<g{inner}><mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">'
                 f'<rect width="64" height="64" fill="#fff"/>{"".join(holes)}</mask>'
                 f'<g fill="{fg}" mask="url(#{mid})"><path d="{RULER}"/><path d="{BOWLS}"/></g>'
                 f'<path d="{CHECK}" fill="none" stroke="{check}" stroke-width="{weight:g}" stroke-linecap="butt" stroke-linejoin="miter"/></g>')
    return "".join(parts)

def guides(color):
    """Blueprint construction guides drawn around the mark (large/hero use only)."""
    d = "M10 4V60M19 4V60M52.4 4V60M4 11H60M4 52H60"
    return f'<path d="{d}" stroke="{color}" stroke-width="0.35" stroke-opacity="0.55"/>'

# ---- Wordmark outlines -----------------------------------------------------------------
def load_font():
    f = TTFont(FONT)
    return instantiateVariableFont(f, {"wght": 800})

def word_paths(font, text, size, x0, baseline, tracking=-0.02):
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font["head"].unitsPerEm
    hmtx = font["hmtx"]; scale = size / upm; x = x0; out = []
    for ch in text:
        gname = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
        gs[gname].draw(tp)
        out.append((ch, pen.getCommands()))
        x += hmtx[gname][0] * scale + tracking * size
    return out, x - tracking * size

def wordmark(font, x0, baseline, size, main, two):
    glyphs, end = word_paths(font, "Built2Bid", size, x0, baseline)
    body = "".join(f'<path d="{d}"/>' for ch, d in glyphs if ch != "2")
    two_d = "".join(f'<path d="{d}"/>' for ch, d in glyphs if ch == "2")
    return f'<g fill="{main}">{body}</g><g fill="{two}">{two_d}</g>', end

def svg(w, h, title, inner, desc=None):
    d = f"<desc>{desc}</desc>" if desc else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img" aria-labelledby="t">'
            f'<title id="t">{title}</title>{d}{inner}</svg>\n')

def write(name, content):
    with open(os.path.join(OUT, name), "w") as fh:
        fh.write(content)
    print("wrote", name)

def grad_defs(gid, light=True):
    a, b = ("#0097B2", "#00C2E0") if light else ("#00C2E0", "#33D1EA")
    return f'<defs><linearGradient id="{gid}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>'

def main():
    os.makedirs(OUT, exist_ok=True)
    font = load_font()
    desc = "Built2Bid mark: a drafted uppercase B with a ruler stem and a teal check"
    # Icon-only marks
    write("built2bid-mark.svg", svg(64, 64, "Built2Bid", mark_group(NAVY, TEAL), desc))
    write("built2bid-mark-tile.svg", svg(64, 64, "Built2Bid", mark_group(WHITE, TEAL, bg=NAVY, scale=0.8), desc))
    write("built2bid-mark-tile-light.svg", svg(64, 64, "Built2Bid", '<rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="#F5F8FB" stroke="#C3CFDB"/>' + mark_group(NAVY, TEAL, scale=0.8), desc))
    write("built2bid-mark-reverse.svg", svg(64, 64, "Built2Bid", mark_group(WHITE, TEAL), desc))
    write("built2bid-mark-mono.svg", svg(64, 64, "Built2Bid", mark_group("#000000", "#000000")))
    write("built2bid-mark-construction.svg", svg(64, 64, "Built2Bid construction", guides(NAVY) + mark_group(NAVY, TEAL)))
    # Favicon: tile, no ticks or construction lines (illegible below 24px), heavier check.
    write("built2bid-favicon.svg", svg(64, 64, "Built2Bid", mark_group(WHITE, TEAL, bg=NAVY, ticks=False, cut=False, weight=6.4, scale=0.84)))
    # Horizontal lockups: mark + wordmark (+ optional tagline), baseline-aligned to the B.
    gap, size = 12, 44
    for name, fg, main_c, light, bg, tagline in [
        ("built2bid-logo.svg", NAVY, NAVY, True, None, False),
        ("built2bid-logo-tagline.svg", NAVY, NAVY, True, None, True),
        ("built2bid-logo-reverse.svg", WHITE, WHITE, False, NAVY, False),
        ("built2bid-logo-mono.svg", "#000000", "#000000", None, None, False),
    ]:
        two = "#000000" if light is None else "url(#g2)"
        words, end = wordmark(font, 56 + gap, 51.6, size, main_c, two)
        width = end + 2
        height = 64
        extra = ""
        if tagline:
            tag, tag_end = word_paths(font, "Build estimates. Create bids. Win more work.", 13.2, 0, 0, tracking=0)
            # Scale tagline to the wordmark width.
            k = (end - (56 + gap)) / tag_end
            extra = f'<g transform="translate({56 + gap} 70) scale({k:.4f})" fill="#6B7A89">' + "".join(f'<path d="{d}"/>' for _, d in tag) + "</g>"
            height = 76
        defs = grad_defs("g2", light) if light is not None else ""
        inner = f'{defs}<g transform="translate(-8 0)">{mark_group(fg, TEAL if light is not None else "#000000")}</g>{words}{extra}'
        if bg:
            write(name, svg(width + 28, 88, "Built2Bid", f'<rect width="{width + 28:g}" height="88" rx="16" fill="{bg}"/><g transform="translate(14 12)">{inner}</g>'))
        else:
            write(name, svg(width, height, "Built2Bid", inner))
    # Social preview (1200x630), rendered to PNG by brand_pngs.mjs.
    words, end = wordmark(font, 0, 0, 96, WHITE, "url(#g2)")
    tag, tag_end = word_paths(font, "Build estimates. Create bids. Win more work.", 30, 0, 0, tracking=0)
    tag_svg = "".join(f'<path d="{d}"/>' for _, d in tag)
    og = (grad_defs("g2", False) + f'<rect width="1200" height="630" fill="{NAVY}"/>'
          f'<g stroke="#FFFFFF" stroke-opacity="0.06">' + "".join(f'<path d="M{x} 0V630"/>' for x in range(0, 1201, 40))
          + "".join(f'<path d="M0 {y}H1200"/>' for y in range(0, 631, 40)) + '</g>'
          f'<path d="M96 520h1008" stroke="{CYAN}" stroke-opacity="0.5"/>'
          + "".join(f'<path d="M{96 + i * 63} 520v{12 if i % 4 == 0 else 6}" stroke="{CYAN}" stroke-opacity="0.5"/>' for i in range(17))
          + f'<g transform="translate(70 110) scale(4.2)">{guides("#FFFFFF")}{mark_group(WHITE, TEAL)}</g>'
          f'<g transform="translate(370 300)">{words}</g>'
          f'<g transform="translate(374 372)" fill="#C9D6E3">{tag_svg}</g>')
    write("og-source.svg", svg(1200, 630, "Built2Bid: Build estimates. Create bids. Win more work.", og))

if __name__ == "__main__":
    sys.exit(main())
