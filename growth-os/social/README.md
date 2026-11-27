# Built2Bid static social posts

Deterministic image posts for the Built2Bid Facebook Page, Instagram and LinkedIn page (2 a day each, unique per platform).
Rules: Growth OS posting policy (approved 2026-11-27), brand claims register, no engagement bait.

- `static-engine/week-YYYY-MM-DD.js`: the week's posts (copy, caption, platform, date, time in US Central).
- `static-engine/render.js`: renders each post to PNG with Playwright:
  `node growth-os/social/static-engine/render.js growth-os/social/static-engine/week-2026-11-30.js growth-os/social/assets/2026-11-30`
- `assets/<week>/`: rendered images. Buffer imports them by their raw GitHub URL when posts are scheduled.

Nothing here runs in the production app or touches customer data.
