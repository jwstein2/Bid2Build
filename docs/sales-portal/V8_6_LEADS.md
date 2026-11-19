# Sales Hub V8.6: master CRM, lead allocation and rep lifecycle

Migration: `supabase/migrations/20270121001000_sales_v86_leads.sql` (rollback in `supabase/rollback/`).
Until it is applied, the admin screens fall back to the V8.3 lead list and nothing new runs.

## Leads

- **One master CRM.** Every import (weekly Claude run, admin CSV/paste, a rep's own list) goes through
  `sales_lead_ingest`. Exact matches (website domain, email, phone) are merged into the existing lead and
  counted as "seen again". Name + ZIP or name + city/state matches are held as **possible duplicates** for
  review (Merge / Skip / Create new). Matches to a paying customer are held as `existing_customer`.
- **Round-robin allocation.** Company leads go to the eligible rep who was assigned least recently
  (`rr-lra-1`, under an advisory lock so concurrent imports stay fair). Eligible = active, signed in,
  sells, allocation not paused, auto leads on (by default: reps yes, managers/admins no), no open
  offboarding, no active time off, and matching territory (states) and trades when those are set.
  Leads with nobody eligible wait in the queue (`no_eligible_rep`); the daily close job shares them out.
- **Rep-sourced leads** (a rep imports their own list) stay with that rep and are never round-robined.
- **Owner vs actor vs beneficiary.** The lead owner is `assigned_rep`. Who did something is on each
  activity (`actor_label`, e.g. "Jane Smith (admin)"). Who earns commission comes only from attribution;
  reassigning a lead never moves commission or customers.
- **Assignment history** is written by a trigger on every owner change, with method, reason and actor.
  Open follow-ups move with the lead.
- **Reassignment warnings**: recent activity, a booked session, a trial, a customer, or rep-sourced.
  The admin must confirm before the move goes through.
- Activities carry a disposition (outcome) and evidence (manual / provider / system). Do-not-call,
  text consent and calling-window checks apply to admin-logged activity too.

## Reps

Rep page → **Manage** (`/sales/admin/reps/<id>/manage`):

- **Invitation**: resend (makes a new link, at most once per 10 minutes), turn off, delivery status.
  Invitation emails are sent only when `SALES_INVITE_EMAILS=on` **and** founder email is enabled.
  Otherwise the new link is shown once for the admin to copy. "Accepted" means the provider took it;
  delivered/bounced come from the Resend webhook.
- **Lead allocation**: pause, auto leads (default/on/off), states, trades, note.
- **Access**: suspend or restore, optionally signing them out of every session.
- **Offboarding**: effective date, reason category, notes, when access ends, and a plan for open leads.
  Checklist: leads (reassignment wizard: equal / by trade / by territory / to one rep / unassign),
  meetings, commission review, reward review, agreement, final payout review, tax records. Finishing
  requires the reviews, sets status Removed (so only sales paid before that date pay out, as before),
  revokes invites, turns booking off and ends the calendar connection. Earned pay and history are kept.
- **Reactivate**: requires confirming a current agreement; history comes back, allocation starts paused,
  and leads they had before stay with their new owners.

The old "Removed" option in the rep form is hidden; removal goes through offboarding. Administrators
can only be changed by the owner, and nobody but the owner can change their own record.

## Nothing here sends, pays or moves money

No emails unless `SALES_INVITE_EMAILS=on`. No payouts. No change to earned commission.
