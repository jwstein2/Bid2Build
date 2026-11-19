# Sales Hub V8.4 P2: calendar, scheduling, time off

Migration `20270118001000_sales_v84_calendar.sql`, rollback in `supabase/rollback/`.

## Scheduling architecture (evaluation)

| Option | Cost | Fit |
|--------|------|-----|
| **Built-in on our database + Google Calendar (chosen)** | $0 | One system. Time off, hub events and bookings block slots in the same query. Works with or without Google. |
| Calendly | Paid per seat for team routing and API | A second source of truth; out-of-office in our hub wouldn't block its slots without extra syncing. |
| Cal.com / Nylas | Paid API tiers | Same duplication, plus another vendor holding customer data. |

The project scheduling calendar (PM add-on) schedules jobs, not people, so nothing there was reused beyond styling.

## Rep calendar (`/sales/calendar`)
* Day, week and month views in the rep's own time zone (default America/Chicago). Layers for events,
  client sessions, follow-ups due and time off, each one can be turned on or off. Colors by type.
* Quick add: prospect call, follow-up, onboarding session, meeting, focus time, personal (private).
* Availability: weekly hours, session length, gap between meetings, minimum notice, how far ahead, an
  optional video link, and the booking link name (`/meet/<name>`), off until the rep turns it on.
* Private: descriptions and notes are only in `sales_my_*` functions. Admins see session times and
  customer names, never reps' own events.

## Client self-scheduling (`/meet/<name>`, not indexed, not linked from the site)
* Win the Job, Run the Job, Grow the Business. Agenda items for add-ons (Project Command Center,
  Team, Financials) show only when the customer's plan includes them.
* Slots come from the database (`sales_booking_slots`): weekly hours minus notice, events, bookings,
  time off and Google busy times. Booking takes a per-rep lock and re-checks the slot, so two people
  can't get the same time. Max 3 upcoming bookings per email. Rate limited, with a honeypot.
* The confirmation page is the customer's private link (only a SHA-256 hash is stored): add to calendar
  (.ics), pick a new time (atomic: the old slot is released only if the new one is free), or cancel.
* Emails: confirmation with .ics attachment, new time, and day-before reminder, from
  noreply@built2bid.org with replies to the rep. **Off until `SALES_BOOKING_EMAILS=on`.** While off, the
  page itself is the confirmation.

## Time off and out-of-office
* Full or part days, private note, customer message (default from the spec, with the verified
  support@built2bid.org Workspace alias), backup contact.
* Blocks new slots immediately and unblocks on its own when it ends (no job needed).
* Never cancels meetings. Saving lists the sessions, events and follow-ups inside the absence; the rep
  reschedules, or a Sales Admin reassigns from Admin → Overview (attribution and commission stay with
  the original rep, and the change is audited).
* With Google connected: adds a Google out-of-office block (declines new conflicting invites only) and,
  if allowed, sets the Gmail vacation responder for those dates. Gmail replies once per sender and skips
  automated mail, so there are no loops.

## Google Calendar (off until configured)
Owner steps:
1. Google Cloud Console → APIs & Services → enable **Google Calendar API** (and **Gmail API** only for
   the vacation responder).
2. OAuth consent screen: Internal (Workspace) if reps use built2bid.org Google accounts, otherwise
   External. Scopes: `calendar.freebusy`, `calendar.events.owned` (and `gmail.settings.basic`, which
   needs Google's verification for External apps).
3. Credentials → OAuth client (Web). Redirect URI `https://built2bid.org/api/sales/google/callback`.
4. Netlify env (Production): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and
   `SALES_TOKEN_KEY` (32 random bytes, base64; falls back to `BANK_TOKEN_KEY`). Optional:
   `SALES_GMAIL_RESPONDER=on`, `SALES_BOOKING_EMAILS=on` (also lets Google send invites to customers).

What it does: reads busy times only (no titles), adds client sessions and out-of-office blocks, and
changes or removes only events it created. Expired or revoked access shows "Reconnect" to the rep.
Disconnect revokes the token at Google and deletes our copy.

## Tests
`tests/db/sales-v84-calendar.test.ts` (8) and `tests/sales-calendar.test.ts` (8): slot building, DST,
event and Google busy blocking, double booking (including concurrent), reschedule/cancel, time off
blocking and automatic return, existing meetings kept, privacy, reassignment keeping attribution, .ics,
agenda by plan, OOO text.
