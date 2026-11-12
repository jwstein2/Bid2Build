# Built2Bid brand guidelines: Blueprint Precision

Credible construction know-how, delivered with clean, modern SaaS usability.

**Name:** Built2Bid (always this spelling and capitalisation). **Tagline:** Build estimates. Create bids. Win more work.

## Logo
| Asset | File | Use |
|---|---|---|
| Horizontal lockup | `public/brand/built2bid-logo.svg` | Default on white / light surfaces |
| Reverse lockup | `public/brand/built2bid-logo-reverse.svg` | Navy panels, dark slides |
| Mark (navy tile) | `public/brand/built2bid-mark.svg` | App icon, avatars, social |
| Mark (transparent) | `public/brand/built2bid-mark-transparent.svg` | On white where a tile is too heavy |
| Monochrome | `public/brand/built2bid-mark-mono.svg`, `built2bid-logo-mono.svg` | Fax, stamps, single-colour print |
| Favicon | `public/brand/built2bid-favicon.svg`, `src/app/favicon.ico` (16/32/48) | Browser tabs |
| App / PWA | `public/brand/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `src/app/apple-icon.png` | Home screen |
| Social preview | `src/app/opengraph-image.png` (1200×630) | Link previews |

**Construction.** An uppercase B drawn like a drafting exercise: one straight stem, two bowls, constant stroke on a 64-unit grid, a ruler scale (cyan ticks) beside the stem, and a teal check that closes the lower bowl. The check stands for an approved, finished bid. The wordmark is Montserrat ExtraBold, outlined in the SVG files, with the numeral 2 in cyan.

**Small sizes.** Below 24 px use the favicon variant (no ruler ticks, heavier strokes). Tested at 16, 24, 32, 64 and 128 px.

**Clear space.** Keep at least the width of the B's stem (≈ 1/10 of the mark) clear on all sides; minimum lockup width 120 px on screen.

**Don't:** recolour the check, stretch or rotate, put the light lockup on photos or mid-tone backgrounds, add effects, or use the concept board raster as a logo.

**Regenerate:** `npm run brand:assets` (needs `pip install fonttools brotli`).

## Colour
| Token | Hex | Role |
|---|---|---|
| `navy` / `brand` | #0B2D4D | Identity, headings, sidebar, primary buttons |
| `cyan` / `accent` | #00C2E0 | Main call to action **surface** (always with navy text, 6.5:1) |
| `teal` | #14B8A6 | Success, progress, completion (decorative) |
| `cool-gray` | #6B7A89 | Icons, rules, ticks (not small text) |
| `paper` | #F5F8FB | App background |
| `ink` / `ink-soft` / `muted` | #0E2238 / #33465A / #56677A | Text |
| `accent-ink` | #007C91 | Cyan-family text and links, focus ring (4.9:1 on white) |
| `ok` / `warn` / `danger` | #0F766E / #B45309 / #B91C1C | Semantic text, always paired with an icon or word |

Rules: never white text on cyan (2.1:1). Teal and cyan text on white fail AA, so use `ok` or `accent-ink` for text. Don't turn cards cyan or teal; keep surfaces white or paper. Every pair above is checked in `tests/brand-tokens.test.ts`.

## Type
- **Montserrat** (variable): H1–H3, short headings, large buttons, the wordmark. 700–800.
- **Inter** (variable): body, navigation, forms, tables, estimates. 400–600. Use `.tabular` for money.
- Scale (px): 12, 14, 16, 18, 24, 32, 40, 56.

## Shape, space, motion
8 px spacing rhythm; radius 8 px (controls) to 12 px (cards); subdued shadows (`shadow-card`, `shadow-raised`); 44 px targets for primary controls; blueprint grid (`.blueprint-grid`) only as a faint backdrop in heroes and bands, never behind form fields; motion is limited to hover colour changes and respects `prefers-reduced-motion`.

## Voice
Plain contractor language: "Create a free bid", "Your costs stay private". No "AI-powered", "guaranteed accurate", invented stats or testimonials. Only promise what ships.

## Platform brand vs contractor brand
Built2Bid's colours style the website and app only. Proposals and PDFs use each contractor's own company name, logo and colours (Company step); the platform brand never appears on a customer-facing proposal.
