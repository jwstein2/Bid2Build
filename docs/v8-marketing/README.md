# Built2Bid V8: marketing, conversion and UX optimization

Date: 2026-11-18 · Branch `claude/project-thread-59tvi8` · Base `main` e638a80 · Not merged, not deployed.

V8 independently re-checks the V7 audit (`/mnt/project-files/marketing-audit-v7/`), adds competitor and statistics research, and ships Batch 1: the highest-confidence, lowest-risk changes. Nothing was removed from the product. Stripe prices, plan ids and entitlements are unchanged. No email was sent and no production data was touched.

| Deliverable | File |
|---|---|
| A. Scorecard (V7 → V8, with what 9/10 would take) | [A-scorecard.md](A-scorecard.md) |
| B. Competitor research | [B-competitor-research.md](B-competitor-research.md) |
| C. Decisions on every V7 recommendation | [C-v7-decisions.md](C-v7-decisions.md) |
| D. Feature preservation audit | [D-feature-preservation.md](D-feature-preservation.md) |
| E. Implementation report (Batch 1) | [E-implementation-report.md](E-implementation-report.md) |
| F. Measurement plan | [F-measurement-plan.md](F-measurement-plan.md) |
| G. Visual comparison (before/after at 390, 768, 1440) | [G-visual-comparison.md](G-visual-comparison.md) |
| H. Tests, performance and regression results | [H-test-results.md](H-test-results.md) |
| I. Roadmap (Batches 2–5) | [I-roadmap.md](I-roadmap.md) |
| Claims register (accepted and rejected statistics) | [claims-register.md](claims-register.md) |
| Customer results framework | [customer-results-framework.md](customer-results-framework.md) |

Screenshots and walk logs: `/mnt/project-files/marketing-audit-v8/` (`screenshots/before`, `screenshots/after`, `evidence/`).

## What the owner needs to do before merging

1. Review the new headline and tagline: "Professional estimates for your trade, ready to send."
2. Send the founder story (a few short paragraphs, your name and role, optional photo). Until then `/about` shows no founder section, and nothing is invented. Fill in `FOUNDER` in `src/lib/marketing/about.ts`.
3. Confirm "a Minnesota company" (taken from the Stripe Tax head office) and the legal name "Built2Bid L.L.C." (taken from `/security`).
