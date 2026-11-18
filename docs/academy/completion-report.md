# Contractor Academy: completion report (2026-11-18)

Nothing has been deployed and no production data has been changed. The database setup is the two migrations in this PR. Paste them into the Supabase SQL Editor (one file is in project files as `academy/run-academy.sql`). Until they run, the Classroom shows the static catalog and the Community shows "being set up".

## Fully implemented and tested

- **Schema, RLS, grants and RPCs.** Covered by 13 database tests in `tests/db/academy.test.ts`:
  - anonymous visitors and non-members are kept out
  - clients can't write the tables directly
  - joining requires accepting the rules
  - directory privacy masking and opt-outs
  - leaderboard opt-out
  - point rules: no self-likes, no points from new accounts, un-liking withdraws the point, a per-pair cap
  - helpful answers
  - premium and staff-only categories
  - lesson access, and the outline's lock flags
  - moderation roles: moderators suspend, admins ban, nobody can change themselves, and every change is audited
  - Enterprise company admins get no Academy role
  - the licence guard
  - lesson completion, progress and the course badge
- **Reversible migrations.** The rollback removes every Academy object and the migrations re-apply cleanly. They are also idempotent (`tests/db/academy-rollback.test.ts`).
- **Catalog integrity** (`tests/academy.test.ts`):
  - all 37 real trades have 8 cards each, one per pillar
  - slugs are unique
  - only courses with written lessons are published
  - all 12 Sales Academy topics have takeaways, checklists and trade notes
  - every resource is a credited https link to YouTube or Skool with a verification date
  - every reference resolves
  - levels match the database
- Typecheck, lint on the changed files, `npm run build`, and the full suite: 1,976 unit and database tests. One existing test was a parallel-run flake and passes when run alone.
- Public pages render from the static catalog, checked on a local production build: homepage promo, Classroom, trade classroom, course, public lesson, locked lesson, Coming soon course, About, sitemap and robots. Screenshots are in project files under `academy/screenshots/`.

## Implemented, needs validation on a deploy after the SQL runs

- **Community UI against a real Supabase.** Posting, uploading images to the private bucket, comments and replies, likes, saves, reports, moderation buttons, search and pagination. The RPCs behind them are tested; the pages haven't been clicked through with a live session.
- **Members directory, profiles, leaderboard, saved, profile settings and leaving.**
- **Manage area.** Course, lesson and resource editors, cover upload, licences, the reports queue, member changes, settings and the audit log.
- **Project Command Center deep link.** A member without access sees a preview and a link to `/pricing#project-command-center`; a member with access gets a link to `/projects`. This uses the existing `my_pm_access`.
- **"Draft summary" with claude-haiku-5-5.** Needs the production AI key, which is already set. It costs about $0.0004 per click and is logged to `ai_generations` and the audit log.

## Partial

- 7 courses are published: the 12-lesson Contractor Sales Academy, plus one-lesson sales playbooks for roofing, concrete, landscaping, painting, interior remodeling and general contracting. The other 290 cards are honest "Coming soon" listings with planned lessons and credited resources.
- The sitemap is built from the seeded catalog. Courses added later in Manage appear on the site immediately but aren't in the sitemap until the catalog file is updated.

## Planned (not built)

- Reply, mention and digest notifications. Nothing sends automatically without owner approval.
- Realtime feed updates. Pages refresh after each action instead.
- Writing the remaining course lessons.

## Blocked

- Nothing is blocked. The only owner step is running the SQL.

## AI model use and cost

- **In-app:** `claude-haiku-5-5`, the app default, with no escalation.
- **During the build:**
  - One Haiku subagent drafted the trade course cards, which were reviewed afterwards. Its token cost wasn't metered from inside the thread.
  - All other work, including research, code and review, ran on the thread's own model.
  - Nothing was escalated silently.

## Research method

Only public pages were opened, in a browser, with no logins:
- YouTube watch pages, plus oEmbed to check whether each video can be embedded.
- Skool discovery and `/about` pages, which `robots.txt` allows.

No content was downloaded or copied. No accounts were created, nothing was bought and no outreach was sent.
