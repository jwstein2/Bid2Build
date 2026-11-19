# Sales Hub V8.7: lead recycling ("use it or lose it")

Migration: `supabase/migrations/20270122001000_sales_v87_recycling.sql` (requires V8.6, `20270121001000`).
Rollback: `supabase/rollback/20270122001000_sales_v87_recycling_down.sql`. Until it is applied the new
screens stay hidden and the daily job skips recycling.

## Rules (all configurable in Admin Sales Hub → Lead recycling → settings)

| Setting | Default |
| --- | --- |
| First-contact window from assignment | 7 days |
| Overdue follow-up grace | 3 days |
| Warning before a lead moves | 24 hours |
| Cycles before admin review | 3 |

- **Counts as working a lead:** a call with an outcome (connected, voicemail, no answer, busy, wrong number),
  an email or text marked sent, a reply from the prospect, or a meeting scheduled or held. Admin activity on the
  lead counts too.
- **Doesn't count:** notes, stage or tag changes, viewing, system entries, and failed or bounced emails.
- **Contact levels** shown on the admin lead page: not contacted, attempted, delivered (provider-confirmed
  email), two-way (reply, connected call, held meeting), active opportunity (demo, trial, paying).
- **Never recycled:** customers, trials, paying and lost leads; do-not-contact and DNC-listed leads; leads on an
  admin recycling hold; leads with an upcoming appointment on the Sales Hub calendar; leads under review; leads
  of reps on time off (and for two days after); leads of reps being offboarded (the offboarding wizard handles
  them); rep-sourced, referral, customer and historical leads.
- **Warning first.** The daily run warns the owner (in-app notice listing the businesses) once a deadline is
  within the warning window. A lead moves only if a warning was recorded for that exact deadline and the warning
  window has passed. An extension or a new deadline needs a new warning. A suspended or removed owner's leads move
  without a warning.
- **Fair redistribution.** The lead keeps its record, history, source and attribution, and goes to the next
  eligible rep by the V8.6 round robin, never the previous owner. With no alternative it waits in an exception
  queue ("Recycled, waiting for another rep") and is retried daily. After the cycle limit it goes to admin
  review (reassign or park as dormant).
- **Commission and attribution never move.** Recycling changes the lead owner only.
- **Leads assigned before V8.7** started their clock when the migration ran.

## Screens

- **Admin Sales Hub → Lead recycling:** metrics (assigned, contacted, untouched, approaching, recycled, contacted
  after recycling, converted after reassignment, reps with overdue leads, repeat recycled, average time to first
  attempt), filters (rep, trade, source, period), leads on the clock with bulk extend / hold / recycle now,
  per-rep view for coaching, coverage for reps on time off, review queue, review requests, history, CSV export
  (needs the export reports permission), settings (manage reps permission). Pause recycling with one checkbox.
- **Admin lead page:** recycling card with clock, contact level, extend, hold, recycle now and history.
- **Rep:** "My leads requiring attention" on the Sales Hub home and Leads page (replies, about to move, overdue,
  due today, waiting for first contact). On a lead: ask for a review (once per assignment; the lead doesn't move
  while it's open) or hand the lead back.

## Schedule

Runs daily inside the existing month-end close job (`/api/cron/sales-close`), after the queue allocation.
Runs are serialized with an advisory lock, so overlapping runs never double-assign.
