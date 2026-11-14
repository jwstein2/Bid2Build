# Welcome popup + getting started tour

A one-time "Welcome to Built2Bid!" popup with the Meet Built2Bid video, followed by an optional
seven-step tour of the real New Bid workflow. It explains the flow only; it never creates or edits a bid.

## Files

| File | What it does |
| --- | --- |
| `src/components/onboarding/steps.ts` | Step configuration (titles, copy, images) and the video's paths. Edit copy here. |
| `src/components/onboarding/onboarding-tour.tsx` | The dialog (Radix Dialog, the same primitive as the app's other modals): video, progress 1/7, Back / Next / Skip Tour / X, Create My First Bid. |
| `src/components/onboarding/onboarding-host.tsx` | Mounted once in the root layout. Decides when the popup opens by itself and listens for replays. The dialog code is lazy-loaded. |
| `src/components/onboarding/replay-tour-button.tsx` | "Watch Getting Started Tour", in the new Help group of the dashboard sidebar (inside Menu on phones). |
| `src/lib/onboarding/state.ts` | Pure eligibility/decision logic (unit tested in `tests/onboarding.test.ts`). |
| `src/app/api/onboarding/route.ts` | GET/POST the signed-in account's status (`profiles.onboarding_status`). |
| `supabase/migrations/20261114002000_onboarding_status.sql` | Adds the status columns and marks every existing account `existing`. |
| `src/proxy.ts` | Skips the session-refresh proxy for `/media/*` and video files (no Supabase call per video range request). |
| `netlify.toml` | Cache headers for `/media/*`. |
| `public/media/` | `meet-built2bid-v1.mp4`, `meet-built2bid-poster.jpg`, `onboarding/*.webp` (tour stills taken from the video). |
| `scripts/onboarding/walk.mjs` | Browser walk (120 checks) against the mock Supabase; mock gained `/__onboarding` and live `profiles` PATCH. |

## Video hosting

- Source: `Meet Built2Bid.mp4`, 2560×1440, 2:56, 45.6 MB.
- Shipped: `public/media/meet-built2bid-v1.mp4`, 1280×720 H.264 High@4.0 + AAC 96 kb/s, ~620 kb/s, **13.6 MB**,
  `+faststart` (index at the front of the file). Encoded with
  `ffmpeg -vf "scale=1280:720:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 25 -maxrate 1300k -bufsize 2600k -profile:v high -level 4.0 -g 60 -c:a aac -b:a 96k -movflags +faststart`.
- Served as a static file from Netlify's CDN (byte ranges → `206 Partial Content`), never bundled into JS.
- `<video controls playsinline preload="none" poster=…>`: nothing is downloaded until Play; no autoplay; native
  play/pause, volume, seeking, fullscreen; plays inline on iPhone.
- Captions: the video already has captions burned into the picture, so no separate caption file is needed.
- To replace the video, add a new file name (e.g. `-v2.mp4`) and update `WELCOME_VIDEO` in `steps.ts` (the MP4 is cached as immutable).

## When it opens by itself

- Only on `/`, `/bids`, `/bids/*`, `/learn`, `/learn/*`, `/pricing` and `/dashboard`, 1.2 s after the page has loaded.
- Never on the builder, sign-in, auth callbacks, settings, admin, a checkout return (`?resume=`, `?checkout=`, `?code=` …),
  while a checkout is pending in this browser, or on top of another open dialog.
- Anonymous visitors: stored in `localStorage["b2b:onboarding"]`. A browser that already has Built2Bid drafts or step
  memory is treated as returning and not shown it.
- Signed-in accounts: `profiles.onboarding_status` (null = new). Existing accounts are `existing` (set by the migration).
  If the status can't be read (migration not applied yet), signed-in users never see it automatically.
- A visitor who dismissed/completed it and then signs up in the same browser: the choice is copied to the new account.
- X, Esc, Not Right Now, Skip Tour → `dismissed`; Create My First Bid → `completed`. Clicking outside does not close it.
- Replay (Help → Watch Getting Started Tour) never reads or writes any status.

## Create My First Bid

Goes to `/bids` ("What are you bidding today?"). The existing routing then applies: incomplete company → Company,
complete company → Customer & project with Company checked (`resolveStartStep`). Verified in the walk for both.

## Tests

- `tests/onboarding.test.ts`: 15 unit tests (paths, busy params, session cookie, returning browser, decisions, step order).
- `scripts/onboarding/walk.mjs`: 120 browser checks: video attributes, no download before Play, playback + 206 range
  requests, all 7 steps in order, Back/Next keep progress, each exit stores dismissed and never reopens, checkout/auth
  pages, returning browser, existing/new/unmigrated accounts, sign-up carry-over, replay (desktop + iPhone 13 menu),
  routing after Create My First Bid, layout at 320/375/390/430, 844×390 landscape, 820 tablet, 1440 desktop
  (fits viewport, no horizontal scroll, controls reachable), keyboard focus.
- Full suite: 360 passed. Typecheck clean.
