# V8 batch 2: measurement and mobile

Date 2026-11-18. No SQL, no new environment variables, no new dependencies.

| Item | Change | Decision source |
|---|---|---|
| ANL-1 (modified) | GA4 funnel events: `cta_clicked {cta, page_type}` from every `data-cta` element, `pricing_viewed` (once per session), `onboarding_completed/dismissed {mode}`, `page_type` on trade `landing_view`. Server-side `analytics_events` additions (offer log, `credits_low`) wait for Batch 4, which needs the event CHECK migration; time from signup to first bid is already reported in /admin/marketing | V8 plan |
| TRU-2 | Google Analytics stays on, disclosed on /privacy, with a per-browser "Turn off Google Analytics" switch (`b2b_ga_optout` cookie) and a footer "Analytics choices" link | Owner decision 2026-11-18: "Disclose it, keep it on" |
| MKT-7 | Customer follow-ups and scheduled progress emails marked live (released with COMM_EMAIL_MODE=live). Follow-up copy no longer claims replies pause it, because reply monitoring isn't verified | Registry note on `customer_communications` |
| EST-3 | Builder header under 640px: Preview and Download PDF stay visible. Email, internal report, schedule, walkthrough and theme sit behind a 44px "More" toggle. They stay mounted, so their dialogs keep working | V7 EST-3 |

## Results (mock backend, production switches)

- Builder header at 390px: 253px → 209px tall; 8 header controls → 5 (More opens the rest). axe 0 on the header at all widths. Screenshots: `/mnt/project-files/marketing-audit-v8/screenshots/batch2/{before,after}/`.
- Vitest 1656 passed. Type check, lint, build pass.
- Walks: checkout 20/20, account CTAs 236/236, onboarding 125/125, internal report 16/16 (phone path opens More first), marketing 314/315 (same mock-only Academy 404).
