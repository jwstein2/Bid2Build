# Academy monthly challenge: earn a free month

"Learn More. Build Better. Earn a Free Month." In one calendar month (UTC), a signed-in learner who completes
**4 distinct Academy courses** and passes **one 20-question challenge quiz with 16+ correct (80%)** earns **one free
month of Individual Unlimited**, once per account (and per email identity) for life.

## 1. Existing infrastructure reused
- **Trainings** = Classroom courses (`academy_courses`/`academy_lessons`/`academy_lesson_progress`). A course counts
  when every published lesson is marked complete through the existing `academy_complete_lesson`.
- **Quiz** = the Study question bank (`academy_kb_items`, 215 approved questions) and its attempt table
  (`academy_kb_attempts`, two nullable columns added). No second quiz engine.
- **Achievements** = existing `academy_badges` (new badges `trainings:1/5/10/25`, `challenge:quiz-passed`,
  `challenge:perfect`, `challenge:free-month`).
- **Free month** = a `complimentary_grants` row (plan `unlimited`, 30 days), the same mechanism the referral reward
  uses; entitlement flows through the existing `user_entitlement()`/`has_unlimited`. Unlimited grants never include
  PM Hub (pm_editors null) or seats.
- **Stripe** = the referral program's customer balance credit pattern (`pickPlanItem`/`oneMonthCents`), behind a
  new owner switch. Exclusion rules reuse `referral_excluded()`, `is_demo_account()` and `referral_email_key()`.

## 2. Files
- Migration: `supabase/migrations/20270223001000_academy_rewards.sql` (rollback: `rollback_20270223001000.sql` here)
- Server: `src/lib/academy/rewards.ts` (types/labels), `src/lib/academy/rewards-server.ts` (status + delivery)
- Pages: `/academy/challenge` (new), `/admin/academy-rewards` (new); compact card on Classroom, Academy
  "My profile" and Settings → Billing; "Free month" link in the Academy menu; Admin tools nav link.
- Changed: `academy/actions.ts` (deliver after a course completes), `classroom/page.tsx`, `academy/settings/page.tsx`,
  `academy/layout.tsx`, `settings/billing/page.tsx`, `components/admin/nav.ts`.
- Tests: `tests/db/academy-rewards.test.ts` (15, real Postgres), `tests/academy-rewards.test.ts` (10).
- Screenshots: `scripts/academy/challenge-shots.mjs` + `scripts/academy/mock-challenge.mjs` (mock Supabase).

## 3. Database
New tables: `academy_course_completions` (first completion per course, immutable), `academy_challenge_topics`
(12 topics from the Study categories), `academy_rewards` (one row per account, immutable qualification facts,
forward-only delivery status), `academy_reward_events` (append-only audit). All RLS: learners read only their own
completions/reward; events are service-only. Existing completions are backfilled with their original dates.

## 4. How completion is verified
- A trigger on `academy_lesson_progress` records the **first** completion of a course. Un-marking and re-marking a
  lesson never moves it, so a course counts once ever, and only in the month it was first finished.
- `academy_challenge_quiz_start` draws 20 random approved questions (preferring ones not in the last attempt) from a
  topic with at least 25 questions; the browser receives prompts and options only. `academy_challenge_quiz_submit`
  grades once on the server (16/20 to pass), enforces the 60-minute limit and 5 attempts per 24 hours. A trigger
  blocks creating or re-grading a challenge attempt through the ordinary study save.
- Flags: three or more lessons marked within seconds, or a quiz submitted in under 60 seconds, send the reward to
  admin review instead of automatic delivery.

## 5. Once per lifetime
Unique index on `academy_rewards.user_id` and on `email_key` (Gmail dots and +tags ignored), advisory locks around
the claim, and a guard trigger that forbids deleting a reward or changing it once applied/declined.

## 6. How the benefit is applied
| Account | Delivery |
|---|---|
| Free / complimentary Unlimited | 30-day Unlimited grant, starting now or after any open grant. No Stripe call. |
| Monthly subscriber cancelling at period end | 30-day grant starting when the paid period ends. |
| Renewing monthly subscriber | Stripe balance credit of one month (max $19.99) on the next invoice, **only when `ACADEMY_REWARD_STRIPE_CREDITS=on`**; otherwise admin review. Idempotency key + lookup of earlier credits. Live keys still require `STRIPE_ALLOW_LIVE`. |
| Annual, Enterprise, past-due, flagged | Admin review. Admin can give 30 days (after the paid period), give the credit (switch on), record a manual Stripe change, or decline. |
Internal, test, demo, practice and unverified accounts never qualify. No refunds, coupons, price or plan changes.

## 7. Tests
- DB (real Postgres): 4+pass qualifies; 3+pass no; 4+15/20 no; repeats don't count; split months no; one lifetime
  reward (and per Gmail identity); 8 concurrent claims and 6 concurrent deliveries create one reward and one grant;
  monthly credit recorded once (retry ignored, final state locked); annual/Enterprise/past-due/fast-quiz/fast-course
  go to review; cancelling gets days after period; test accounts excluded; attempt locks, rate limit, expiry;
  ordinary study sessions unchanged; re-run safe; rollback safe.
- Unit: display never shows "available" after earning; Stripe switch; credit amount skips add-ons; reuse of earlier
  credit; failures recorded, never thrown.
- Browser (mock Supabase): 55/55 checks across signed out, fresh, in progress, earned, quiz, result, Classroom card,
  Billing card, admin; desktop, dark mode and 390 px mobile, no horizontal scroll.

## 8. Still required
1. Run the migration SQL in Supabase, then the check query (expected output in the PR).
2. Optional: set `ACADEMY_REWARD_STRIPE_CREDITS=on` (Production) to credit monthly subscribers automatically.
   Until then they appear in Admin → Academy rewards.
3. Content gaps: quiz topics under 25 questions are hidden (Decks 18, Roofing 20, Plumbing 21, Electrical 16,
   HVAC 3, Licensing 16, Codebook Navigation 18). Five topics are live. Trainings: 7 published courses today, 4 more
   every Monday.
