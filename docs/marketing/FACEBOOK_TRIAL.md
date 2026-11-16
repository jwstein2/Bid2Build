# Facebook "comment BID" → 7-day Unlimited trial

Customer flow: comment **BID** on the Built2Bid post or ad → private Messenger reply → tap **Send my invite** →
send an email → Built2Bid invite email → sign in with that email → tap **Activate my 7 days** → 7 days of
Built2Bid Unlimited. No card, no Stripe subscription, no charge.

Everything is **off** until `FB_TRIAL_ENABLED=true` is set in Netlify (Production). Keep it off until the owner
approves launch. The Meta ad campaign stays paused; nothing here creates, publishes or funds an ad.

## What was built

| Piece | Where |
| --- | --- |
| Database (tables, activation, funnel) | `supabase/migrations/20261116008000_facebook_trial_funnel.sql` |
| Trial service (one entry point for every route) | `src/lib/trial/service.ts` |
| Meta webhook | `POST/GET /api/webhooks/meta` (`src/app/api/webhooks/meta/route.ts`) |
| Messenger conversation logic | `src/lib/trial/flow.ts` |
| ManyChat External Request | `POST /api/webhooks/manychat-trial` |
| Branded claim page (no paid webhook needed) | `/trial` |
| Activation page (scanner-safe) | `/trial/activate#t=…` → `POST /api/trial/activate` |
| Emails (invite, day 2, day 6) via Resend | `src/lib/trial/emails.ts`, `src/lib/trial/delivery.ts` |
| Check-in opt-out | `/trial/unsubscribe` (+ one-click `List-Unsubscribe`) |
| Scheduled job, every 15 min | `netlify/functions/trial-campaign-cron.mts` → `POST /api/cron/trial-campaign` |
| Owner dashboard: funnel + live Meta checks | Admin → Marketing → **Facebook BID trial** (`/admin/marketing/facebook-trial`) |
| Customer dashboard banner with exact expiry + optional upgrade | `src/components/billing/trial-banner.tsx` |

### Safety rules (enforced in Postgres)

- The campaign can issue exactly one thing: a 7-day `unlimited` complimentary grant. Plan and length are
  constants inside `trial_activate()`; no function takes a plan, duration, seat count or role. Only the
  service role can call the functions.
- The grant is a normal row in `complimentary_grants`, so all existing entitlement checks honour it and stop
  at `expires_at`, and Admin → Complimentary Access can see, extend or revoke it.
- Activation requires a signed-in account whose **verified** email equals the invited address, and a POST
  from that session. Opening the link (email previews, link scanners) only loads a page with a button.
- One trial per email and per account, ever. Duplicate comments (comment id), messages (message id), email
  submissions (2-minute window, max 5 copies), clicks, webhook retries and concurrent requests are safe.
- Paid, Enterprise or any active complimentary access wins: no pass is issued, the invite stays unused.
- At expiry the account falls back to its normal plan. Bids, customers, other grants and Free credits are
  never touched.
- Invite tokens are never stored (HMAC of invite id + version) and travel only in the URL fragment, which
  is not sent to the server, logs or analytics. Logs carry ids and counts only.

### Funnel tracking

Qualifying comments → Messenger interactions → invites sent → trials activated → first bid finalized →
first paid upgrade, plus private replies sent/failed, reminders, opt-outs and per-post counts. Organic test
posts and paid ad posts are listed separately; an organic pass does not verify the ad placement.

## Environment variables (Netlify → Site configuration → Environment variables)

Link: https://app.netlify.com/projects/built2bid/configuration/env

| Name | Secret? | Value |
| --- | --- | --- |
| `FB_TRIAL_ENABLED` | no | `true` to switch the funnel on. Leave unset until launch is approved. |
| `META_APP_ID` | no | Meta app id |
| `META_APP_SECRET` | **yes** | App Dashboard → App settings → Basic → App secret |
| `META_PAGE_ID` | no | Built2Bid Page id |
| `META_PAGE_ACCESS_TOKEN` | **yes** | Long-lived Page token (system user recommended) |
| `META_VERIFY_TOKEN` | **yes** | Any long random string; type the same string into the webhook setup |
| `META_TEST_POST_IDS` | no | Organic test post id(s), format `PAGEID_POSTID`, comma separated |
| `META_AD_POST_IDS` | no | The ad's post id (`effective_object_story_id`), when the ad exists |
| `MANYCHAT_TRIAL_SECRET` | **yes** | Only if you use ManyChat's External Request |
| `EMAIL_OUTBOX_SECRET` | **yes** | Already used for founder-email retries; the scheduled job needs it |
| `TRIAL_EMAIL_FROM` | no | Optional, default `Built2Bid <hello@built2bid.org>` |

`RESEND_API_KEY` is already set. Resend's free plan allows 100 emails/day shared with sign-in codes and the
founder email; a large campaign would need Resend Pro ($20/mo). Ask before upgrading.

Never paste any secret in chat. Add it in Netlify yourself, then redeploy.

## Route A: direct Meta (preferred)

1. **Meta app.** https://developers.facebook.com/apps → Create app → type **Business**, owned by the Built2Bid
   business portfolio. Add products **Messenger** and **Webhooks**.
2. **Connect the Page.** Messenger → Messenger API Settings → add the Built2Bid Page.
3. **Permissions.** The funnel needs `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`,
   `pages_show_list`. In **Development** mode these work only for people with a role on the app (admins,
   developers, testers), which is enough for the organic test.
4. **Page token.** Business Settings → Users → System users → add a system user with access to the Page and
   the app → Generate token with the four permissions (no expiry). Put it in `META_PAGE_ACCESS_TOKEN`.
5. **Webhook.** Messenger → Webhooks → Callback URL `https://built2bid.org/api/webhooks/meta`, Verify token =
   `META_VERIFY_TOKEN`. Subscribe the Page to fields **feed**, **messages**, **messaging_postbacks**.
   (Deploy with `META_VERIFY_TOKEN` set first, or Meta's check fails.)
6. **Test post.** Publish an organic test post on the Page; copy its id into `META_TEST_POST_IDS`.
7. **Switch on for the test.** Set `FB_TRIAL_ENABLED=true` in Production (the webhook URL is production) and
   redeploy. The ad stays paused, and in Development mode only app-role accounts can trigger anything.
8. **Check readiness.** Admin → Marketing → Facebook BID trial. Every row should say OK (token valid, right
   Page and app, permissions, webhook fields, post readable).
9. **Organic test.** From an account with a role on the app, comment `BID` on the test post. Expect the
   private reply within seconds, tap Send my invite, send an email, get the invite, activate. The admin page
   shows the comment, the reply and "Verified end to end: Yes" for that post.
10. **Going public (needs owner approval).** Before anyone without an app role can trigger it: complete
    **Business Verification**, submit **App Review** for Advanced Access to the four permissions (screencast
    of the flow), and switch the app to **Live**.
11. **Paid ad (needs owner approval, separate check).** Create the ad from the approved post (or note the
    ad's own post id), add it to `META_AD_POST_IDS`, and confirm on the admin page that its comments arrive
    and get private replies. Ad comments only count as verified after this step.

Private replies: Meta allows one per comment within 7 days of it. The reply uses a quick-reply button; if
Meta rejects that format the code falls back to "Reply INVITE" text automatically (the admin page shows which
format Meta accepted). The 4-hour reminder is a standard reply sent only while the 24-hour window from the
person's last message is open.

## Route B: ManyChat (if Meta access is blocked)

Use only if Route A is blocked (for example App Review is refused or Business Verification stalls). Explain
the blocker before paying for anything.

1. Connect the Built2Bid Page to ManyChat.
2. Automation → New → trigger **Facebook Comments** (comment growth tool) → "Specific post" = the eligible
   post (for ads: choose the ad's post, using **Promotable posts** if the ad uses an unpublished post) →
   keyword `BID`. Turn off public comment replies unless wanted.
3. Opening DM: "Thanks for commenting BID! Want 7 free days of Built2Bid Unlimited? Tap below and I'll email
   you a link. No card needed." with a button **Send my invite**.
4. Then either:
   - **Free option (no External Request):** button opens URL `https://built2bid.org/trial` (the branded
     claim page collects the email and sends the same invite), or
   - **Pro option:** User Input block (type Email, save to the system Email field) → **External Request**
     `POST https://built2bid.org/api/webhooks/manychat-trial`, header
     `Authorization: Bearer <MANYCHAT_TRIAL_SECRET>`, JSON body
     `{"email":"{{email}}","checkins":false,"subscriber_id":"{{user_id}}"}`; map response `$.message` to a
     custom field and send it as the next message.
5. External Request is a paid ManyChat feature (check the current plan in ManyChat → Settings → Billing).
   The claim-page option works on the free plan.

## Database

Paste `supabase/migrations/20261116008000_facebook_trial_funnel.sql` into the SQL Editor:
https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new — it is additive and safe to run twice.

## Tests

- `tests/db/facebook-trial.test.ts`: activation rules, duplicates, concurrency, paid precedence, expiry, one
  pass per account, permissions, funnel.
- `tests/db/facebook-trial-flow.test.ts`: end to end through the real migration (Meta and Resend faked at the
  HTTP edge): comment → private reply → tap → email → invite → activation; reminders; retries; check-ins.
- `tests/facebook-trial.test.ts`: matching, tokens, signature, webhook verify, copy.
