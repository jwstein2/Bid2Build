# Google Play listing and policy declarations

Account: organization account for **Built2Bid L.L.C.**, owned by the built2bid.org Google Workspace login.
Needs the company D-U-N-S number (free request filed with D&B 2026-11-21) and the one-time $25 fee (James pays).
New organization accounts skip the 12-tester / 14-day closed test that personal accounts must run.

## Store listing

- **App name (30):** Built2Bid Crew: GPS Time Clock
- **Short description (80):** Automatic job-site clock-in for your crew. Arrive, get clocked in. No trail.
- **Full description:**

  Built2Bid is the bidding and project app for contractors. This Android app brings the Built2Bid time clock to
  your crew's phones, with automatic clock-in at your job sites.

  • Arrive at an assigned job site and you're clocked in after a few minutes on site. Leave and you're asked if
    you're still working, or clocked out at the time you left (your company picks).
  • Works with the app closed, so nobody has to remember to open it.
  • Privacy first: only arrivals and departures at your work sites are saved, with distance and GPS accuracy.
    No trail of where you go and no live map.
  • Manual Clock in / Clock out always works, plus "Add missing time" and "Request a fix" for your manager.
  • See today's jobs, your week, and your hours waiting for approval.

  Automatic clock-in is off until your company turns it on and you agree. You need a Built2Bid account from your
  employer to sign in.

- **Category:** Business. **Tags:** time clock, construction, contractors.
- **Contact:** support@built2bid.org, https://built2bid.org. **Privacy policy:** https://built2bid.org/privacy
- **Graphics:** icon 512×512 (`public/brand/icon-512.png`), feature graphic 1024×500, at least 2 phone screenshots
  (My work, Automatic clock-in card on, permission disclosure, a "Clocked in" notification).

## App content answers

- **App access:** sign-in required. Provide a reviewer login (a demo company with automatic clock-in on and a site
  near Mountain View or "any location" instructions), via Play Console → App content → App access.
- **Ads:** no ads. **Target audience:** 18+. **Content rating:** questionnaire → no objectionable content
  (utility/productivity). **News app:** no. **Government app:** no. **Financial features:** none.

## Data safety

| Data type | Collected | Shared | Purpose | Optional |
| --- | --- | --- | --- | --- |
| Precise location | Yes (processed on device; only distance to site + accuracy sent) | No | App functionality (time tracking) | Yes (company + employee opt-in) |
| Name, email | Yes | No | Account management | No |
| Phone number | Yes, if the employer adds it | No | Account management | Yes |
| Other user content (time entries, notes, corrections) | Yes | No (employer's own account) | App functionality | No |
| App activity / diagnostics | Crash logs via Sentry if enabled | No | Analytics/diagnostics | No |

Encrypted in transit: yes (HTTPS only). Users can request deletion: yes (support@built2bid.org; account export and
deletion in Settings). Note: location is "collected" for Play's purposes even though coordinates never leave the
phone, because a derived value (distance to the site) is sent.

## Location permissions declaration (Play Console → App content → Sensitive permissions)

- **Permission:** `ACCESS_BACKGROUND_LOCATION` (plus fine/coarse).
- **Core feature that needs it:** Automatic clock-in and clock-out when an employee arrives at and leaves a job site
  their employer assigned, including when the app is closed. Workers in construction move between sites and work
  with their phone in a pocket; requiring the app to be open would make automatic time tracking miss most arrivals.
- **Why foreground-only isn't enough:** geofence transitions happen when the phone is locked and the app is not
  running; Android only delivers them to apps with background location.
- **User-facing disclosure:** shown in-app before any permission prompt (text in
  `android/app/src/main/res/values/strings.xml` → `disclosure_body`): "Built2Bid collects location data to clock
  you in and out automatically when you arrive at and leave the job sites your company assigned to you, even when
  the app is closed or not in use." It also states only arrivals/departures with distance and accuracy are saved.
- **Video (required, ≤30 s, YouTube unlisted link):**
  1. Open the app → My work → "Automatic clock-in" card → tap **Allow location**.
  2. The in-app disclosure appears (pause on it) → Continue.
  3. Android prompt → While using the app → "Choose Allow all the time" dialog → Settings → Allow all the time.
  4. Back in the app: badge "On, even when the app is closed". Close the app.
  5. Arrive at the site (screen recording or a mock-location test build) → "Clocked in — Shop" notification.
- **Is location shared with third parties?** No.

## Release steps (once the account is verified)

1. Play Console → Create app → name above, App, Free, declarations.
2. Fill App content (all sections above), Store listing, and Data safety.
3. Testing → Internal testing → create release → upload `app-release.aab` (Play App Signing on) → add James + a
   test crew phone as testers. Run the real-phone test plan in [README.md](README.md).
4. Production → create release from the same build → submit for review. Background-location reviews usually take
   several days.
