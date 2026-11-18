# G. Visual comparison

Captured 2026-11-18 on the repository's mock backend with production feature switches (`NEXT_PUBLIC_PROJECT_SCHEDULING=on`, `NEXT_PUBLIC_ESIGNATURES=on`). Before = `main` e638a80, after = this branch. Files: `/mnt/project-files/marketing-audit-v8/screenshots/{before,after}/<page>__<width>.png`, with `report.json` in each folder.

| Page | 390 / 768 / 1440 | What to look at |
|---|---|---|
| `home-first-visit` | all three | Before: welcome popup covers the hero for a first-time visitor. After: no popup, one-job headline, trade picker under the headline on phones |
| `home-full` | all three | Pillars without coming-soon items; "See every feature by plan" link; new trust block above the FAQ; footer tagline |
| `pricing` | all three | Unchanged layout; title now includes the price |
| `learn` | all three | Descriptive H1 |
| `about` | all three | Before: 404. After: About page |
| `dashboard-3-credits` | all three | Before: "Upgrade to Unlimited" in the header. After: none |
| `dashboard-0-credits` | all three | Upgrade link still shown (unchanged) |
| `whats-new-free` | all three | Before: "Unlimited" badge + Upgrade button on add-on features (5 buttons). After: correct plan badges, one plan note per release |

Measured from `report.json`: welcome popup on first visit 3/3 → 0/3 widths; header upgrade links at 3 credits 1 → 0; What's New upgrade buttons 5 → 0; horizontal scroll none before or after; axe WCAG 2 A/AA violations 0 on every captured page after.
