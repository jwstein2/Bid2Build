# Speed pass (2026-11-16)

Goal: faster pages with no feature removed. Measured on a local production build (mock data), Lighthouse 13 mobile, 3 runs each.

## Changes
1. **Sentry loads on demand** (`src/lib/monitoring/sentry-client.ts`). The browser SDK (~80 KB gz) was in every page's first-load JS, even with no DSN. Now it loads in its own chunk after the page is idle, or right away when an error boundary reports. Errors thrown before it arrives are buffered and sent. DSN unset = never downloaded. Same options (errors only, no tracing/replay/PII). Guard test: `tests/sentry-lazy.test.ts`.
2. **Metric-matched font fallbacks** (`globals.css`). "Inter Fallback"/"Montserrat Fallback" use size-adjust + ascent/descent overrides on Arial/Liberation/Arimo so the hero headline no longer jumps when web fonts arrive (CLS 0.06 → 0).
3. **WebP video poster** (42 KB vs 86 KB jpg; jpg kept).
4. **Dashboard profile reminder** remembers dismissal in a cookie too, so the server doesn't render a card that then disappears.
5. **Builder credits loaded on the server** (same query as `/api/credits`) plus a reserved line under Download PDF, so the header doesn't grow after hydration.

## Results
| | Before | After |
|---|---|---|
| First-load JS gz `/` | 280.3 KB | 200.9 KB |
| `/pricing` | 371.1 KB | 291.8 KB |
| `/login` | 365.2 KB | 285.9 KB |
| `/dashboard` | 373.1 KB | 294.9 KB |
| Builder | 551.3 KB | 473.4 KB |
| Lighthouse mobile `/` | 78–82, LCP 4.3–4.4 s, CLS 0.06 | 84–87, LCP 3.8–3.9 s, CLS 0 |
| Lighthouse mobile `/pricing` | 75–81, LCP 4.5–4.9 s | 85–86, LCP 3.8–4.1 s, CLS 0 |
| Dashboard CLS 768 / 1440 | 0.114 / 0.080 | 0.063 / 0.039 |
| Builder CLS 768 / 1440 | 0.314 / 0.143 | 0.001 / 0.001 |

Accessibility and best practices stay at 100. Verified with a fake DSN that a thrown error still reaches Sentry and first-load size is unchanged.

## Not done (recommendations)
- Dashboard: a block (likely What's New notice, client fetch) inserts above "Your bids" after hydration; render it on the server or reserve its space.
- Welcome video popup (1.2 s timer) is the mobile LCP element; delaying it until after LCP would help scores.
