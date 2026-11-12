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

NAVY, CYAN, CYAN_ON_LIGHT, TEAL, WHITE = "#0B2D4D", "#00C2E0", "#0097B2", "#14B8A6", "#FFFFFF"

# ---- Mark geometry (64x64 grid) -------------------------------------------------------
# Uppercase B drawn as a drafting construction: a straight stem and two bowls with constant
# 7-unit strokes, a ruler scale (ticks) beside the stem, and a teal check closing the lower bowl.
B_PATHS = [
    "M19 13V51",                                   # stem (stroke centre)
    "M19 15.75H32a7.5 7.5 0 0 1 0 15H19",          # upper bowl
    "M19 30.75H34a8.75 8.75 0 0 1 8.75 8.75",      # lower bowl, opens into the check
    "M19 48.25H31",                                # base
]
CHECK = "M32 45.5l5.5 5.5L52.5 36"
TICKS = [(10, y) for y in (16, 22, 28, 34, 40, 46)]

def mark_group(fg, check, tick, bg=None, ticks=True, knockout=None, weight=5.5):
    parts = []
    if bg:
        parts.append(f'<rect width="64" height="64" rx="14" fill="{bg}"/>')
    if ticks:
        t = "".join(f"M{x} {y}h{4 if i % 3 == 0 else 2.5}" for i, (x, y) in enumerate(TICKS))
        parts.append(f'<path d="{t}" stroke="{tick}" stroke-width="1.8" stroke-linecap="round"/>')
    parts.append('<g fill="none" stroke="%s" stroke-width="%g" stroke-linejoin="round">%s</g>'
                 % (fg, weight, "".join(f'<path d="{d}"/>' for d in B_PATHS)))
    if knockout:
        parts.append(f'<path d="{CHECK}" fill="none" stroke="{knockout}" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round"/>' % (weight + 4.5) + '')
    parts.append(f'<path d="{CHECK}" fill="none" stroke="{check}" stroke-width="%g" stroke-linecap="round" stroke-linejoin="round"/>' % weight)
    return "".join(parts)

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

def main():
    os.makedirs(OUT, exist_ok=True)
    font = load_font()
    # Icon-only marks
    write("built2bid-mark.svg", svg(64, 64, "Built2Bid", mark_group(WHITE, TEAL, CYAN, bg=NAVY, knockout=NAVY),
          "Built2Bid mark: drafted letter B with a teal check on navy"))
    write("built2bid-mark-transparent.svg", svg(64, 64, "Built2Bid", mark_group(NAVY, TEAL, CYAN_ON_LIGHT, knockout=WHITE)))
    write("built2bid-mark-mono.svg", svg(64, 64, "Built2Bid", mark_group("#000000", "#000000", "#000000", knockout="#FFFFFF")))
    # Favicon: no ruler ticks (illegible below 24px), heavier check.
    write("built2bid-favicon.svg", svg(64, 64, "Built2Bid", mark_group(WHITE, TEAL, CYAN, bg=NAVY, ticks=False, knockout=NAVY, weight=6.5)))
    # Horizontal lockups: 64-unit mark + wordmark, cap-aligned.
    gap, size = 16, 40
    for name, mark_kwargs, main, two, title in [
        ("built2bid-logo.svg", dict(fg=WHITE, check=TEAL, tick=CYAN, bg=NAVY, knockout=NAVY), NAVY, CYAN_ON_LIGHT, "Built2Bid"),
        ("built2bid-logo-reverse.svg", dict(fg=WHITE, check=TEAL, tick=CYAN, bg=None, knockout=NAVY), WHITE, CYAN, "Built2Bid"),
        ("built2bid-logo-mono.svg", dict(fg="#000000", check="#000000", tick="#000000", knockout="#FFFFFF"), "#000000", "#000000", "Built2Bid"),
    ]:
        words, end = wordmark(font, 64 + gap, 46, size, main, two)
        width = end + 2
        inner = f"<g>{mark_group(**mark_kwargs)}</g>{words}"
        if name == "built2bid-logo-reverse.svg":
            inner = f'<rect x="-12" y="-12" width="{width + 24:g}" height="88" rx="16" fill="{NAVY}"/>' + inner
            write(name, svg(width + 24, 88, title, f'<g transform="translate(12 12)">{inner}</g>'))
            continue
        write(name, svg(width, 64, title, inner))
    # Social preview (1200x630), rendered to PNG by brand_pngs.mjs.
    words, end = wordmark(font, 0, 0, 84, WHITE, CYAN)
    tag, tag_end = word_paths(font, "Build estimates. Create bids. Win more work.", 34, 0, 0, tracking=0)
    tag_svg = "".join(f'<path d="{d}"/>' for _, d in tag)
    og = (f'<rect width="1200" height="630" fill="{NAVY}"/>'
          f'<g stroke="#FFFFFF" stroke-opacity="0.06">' + "".join(f'<path d="M{x} 0V630"/>' for x in range(0, 1201, 40))
          + "".join(f'<path d="M0 {y}H1200"/>' for y in range(0, 631, 40)) + '</g>'
          f'<path d="M96 520h1008" stroke="{CYAN}" stroke-opacity="0.5"/>'
          + "".join(f'<path d="M{96 + i * 63} 520v{12 if i % 4 == 0 else 6}" stroke="{CYAN}" stroke-opacity="0.5"/>' for i in range(17))
          + f'<g transform="translate(96 150) scale(2.6)">{mark_group(WHITE, TEAL, CYAN, knockout=NAVY)}</g>'
          f'<g transform="translate(300 268)">{words}</g>'
          f'<g transform="translate(96 410)" fill="#C9D6E3">{tag_svg}</g>')
    write("og-source.svg", svg(1200, 630, "Built2Bid: Build estimates. Create bids. Win more work.", og))

if __name__ == "__main__":
    sys.exit(main())
