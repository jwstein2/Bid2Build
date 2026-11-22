# Built2Bid Contractor Academy

The Academy is a free classroom and community for contractors at `/academy`. It borrows the way Skool organizes a community (tabs, a feed with categories, a classroom of courses, a members directory, a points leaderboard). Its styling, code, copy, level names and assets are all original, and nothing was copied from Skool or from any creator.

## Where things live

| Area | Path |
|---|---|
| Schema, RLS, RPCs, storage bucket | `supabase/migrations/20261230001000_contractor_academy.sql` |
| Content seed (generated, do not hand-edit) | `supabase/migrations/20261230002000_academy_content_seed.sql`, produced by `npx tsx scripts/academy/gen-seed.ts` |
| Rollback | `docs/academy/rollback_20261230001000.sql` (tested in `tests/db/academy-rollback.test.ts`) |
| Content source | `src/lib/academy/content/` (`sales-academy.ts`, `resources.ts`, `trade-courses.json`, `catalog.ts`) |
| Read layer | `src/lib/academy/server.ts`, `src/lib/academy/community.ts` |
| Member actions | `src/app/(marketing)/academy/actions.ts` |
| Staff actions | `src/app/(marketing)/academy/manage/actions.ts` |
| Pages | `src/app/(marketing)/academy/**` |
| Components | `src/components/academy/**`, `src/components/marketing/academy-promo.tsx` |
| Tests | `tests/academy.test.ts`, `tests/db/academy.test.ts`, `tests/db/academy-rollback.test.ts` |
| Code library (knowledge engine, code search) | See `docs/academy/expansion/README.md` |

## Pages

- **Community** (`/academy`, the default tab). Feed with category chips, search, a trade filter, sort (latest activity, newest, top, best match) and a questions-only filter. The composer takes a category, type, trade, optional state, an optional link and an optional image. Posts support pinning, announcements, comments with one level of replies, likes, saves, reports, marking an answer helpful, edit and delete. Discussions are for members only and are `noindex`.
- **Classroom** (`/academy/classroom`). "For every trade" (the Contractor Sales Academy), your trades, and all 37 trades grouped by family, plus search. Each trade classroom (`/academy/classroom/[trade]`) shows its 8 course cards in pillar order, the trade's sales situation, discussion and Built2Bid links, and credited resources.
- **Course** (`/academy/courses/[slug]`) and **lesson** (`/academy/courses/[slug]/[lesson]`) pages. A lesson has its body, takeaways, a checklist, notes for each trade (your trade first), a "Put it into practice in Built2Bid" action, resource embeds, an optional quiz, a completion button and previous/next links. Locked lessons show a join or premium prompt and never send the lesson body.
- **Members** (`/academy/members`, `/academy/members/[id]`), **Leaderboard** (`/academy/leaderboard`), **Saved**, **My profile** (`/academy/settings`), **About**.
- **Manage** (`/academy/manage`): courses, lessons, resources, creator licences, reports, members, settings and the audit log. It is also linked from Admin › Tools.

## Roles and access

| Role | Can |
|---|---|
| Platform super-admin (`admin_roles`) | Is always an Academy admin |
| Academy admin | Everything, including publishing, bans, role and tier changes, licences and settings |
| Moderator | Handle reports; hide, lock or pin posts; suspend and restore ordinary members |
| Instructor | Draft courses, lessons and resources, and send a course to "In review" |
| Member | Post, comment, react, save and report; manage their own profile and privacy |

Enterprise company admins get no Academy role automatically. This is tested.

Access levels are `public` (anyone), `members` (free, requires joining) and `premium`. Premium comes from a manual tier an admin grants, or from the owner-set "Built2Bid Unlimited subscribers get Academy premium" switch. That switch reads `has_unlimited()`. No Stripe products, prices or charges are involved, and nobody's subscription is changed.

## Security model

- Every community write goes through `SECURITY DEFINER` RPCs that check membership, status, role, rate limits and ownership. `insert`, `update` and `delete` are revoked from `anon` and `authenticated` on every Academy table. This is tested.
- Raw community tables are readable only for your own rows, or by staff. Other members read through masked functions:
  - `academy_feed` and `academy_post` return the author's display name and level only.
  - `academy_directory` and `academy_profile` apply `show_company` (off by default), `show_location`, `show_trades` and `directory_visible`.
  - `academy_leaderboard` respects `leaderboard_visible`.
- Lesson bodies are filtered by RLS. `academy_course_outline` returns titles with a `locked` flag and no bodies.
- Staff content writes use the service role only after `requireAcademyStaff()` succeeds on the server, and every write adds an `academy_audit_log` row. Moderation and member changes go through the role-checked RPCs as the signed-in user.
- Uploads are re-encoded with sharp to WebP. This strips EXIF and GPS data, rejects SVG and caps uploads at 5 MB. Images are stored in the private `academy-media` bucket and served through 1-hour signed URLs.
- Post links render with `rel="noopener noreferrer nofollow ugc"`. Lesson Markdown is rendered as React text, so no raw HTML is ever injected.
- `robots.txt` disallows `/academy/post/`, members, leaderboard, saved, settings, join and manage. These pages also carry `noindex`.
- Anti-abuse rules:
  - Posting is limited to 5 posts an hour and 15 a day, with a duplicate-title check.
  - Comments are limited to 30 an hour, and reports to 20 a day.
  - Liking your own content earns no points.
  - Accounts under 24 hours old can like posts, but their likes award no points.
  - A member earns at most 3 points a day from any one other member, and at most 25 points a day in total.
  - Removing a like takes its point back.
  - Deleted or hidden posts lose their points.
- Online presence comes from `last_seen_at`, which is touched at most once a minute after a page view (`after()`). "Online" means active within `online_window_minutes`, which defaults to 5 and is shown in the sidebar.

## Content rules (creator attribution)

There are three content classes:
- **Built2Bid Original**: our own lessons.
- **External Curated**: link-only, with credit to the creator.
- **Licensed**: the creator's written permission is on record.

`academy_resources.permission_status = 'licensed'` is refused by a trigger unless it points to an active, unexpired `academy_creator_licenses` row. That row records the creator, permission date, authorized content, permitted uses, whether commercial use is allowed, attribution requirements, expiry and where the written permission is kept.

Every seeded resource was opened and checked on 2026-11-18:
- **YouTube:** the title, channel and view count were read from the public watch page. Whether embedding is allowed came from YouTube's oEmbed endpoint and the `playableInEmbed` flag.
- **Skool:** the community name, owner and price were read from public `/about` pages and the discovery page. No logins were used, and nothing behind `/-/` (disallowed in robots.txt) was opened.

Four Alex Hormozi videos don't allow embedding, so they link out instead. Summaries are written in Built2Bid's own words from each item's public title and description, not from transcripts or course content. The import rules are shown on the Manage › Resources page.

## AI

Staff can click "Draft summary" on a lesson. It sends only the saved lesson body to `claude-haiku-5-5` (the app's `DEFAULT_MODEL`) and fills in a summary and takeaways for a person to review. Nothing is saved until they click Save.

- **Cost:** about 3k input and 200 output tokens per click, roughly $0.0004 at $0.10/$0.50 per million tokens.
- **Logging:** each use is written to `ai_generations` with kind `academy_summary` (the migration widens that check and keeps the existing values) and to the Academy audit log, including model, tokens and cost.
- **Escalation:** nothing escalates to a larger model.

During the build, a Haiku subagent drafted the 296 trade course cards (`trade-courses.json`). They were then reviewed by hand. The rest of the work ran on the thread's own model.

## Cost and scaling

- **No new paid services.** It uses Supabase (already Pro), Netlify functions, Supabase Storage for images (typically 100–300 KB WebP each) and YouTube's privacy-enhanced embeds, which load only after a click.
- **Database:** 24 indexes cover the feed sort orders, category, trade, author, a GIN full-text index on posts, reactions, bookmarks, point events by user and time, and lesson progress. Feeds and directories are paginated (20 or 24 rows) and capped at 250 pages. The leaderboard aggregates `academy_point_events` over 7 days, 30 days or all time, limited to 100 rows.
- **Estimated load:** at 1,000 active members (about 50 posts and 500 reactions a day), Postgres load is negligible on the current plan. At around 50k members the all-time leaderboard aggregate should move to a nightly materialized table; the function signature can stay the same. Presence writes are throttled to one per member per minute.
- **No realtime:** there are no websocket subscriptions. Pages refresh after actions, so Supabase Realtime quotas are untouched.
- **Static fallback:** classroom pages fall back to the static catalog until the migration is applied, so a preview deploy renders without the database. The sitemap is built from the static catalog: published courses, trade classrooms and public lessons.

## Known limits and follow-ups

- Courses that admins add later appear on pages straight away, but they reach the sitemap only after the catalog file is updated.
- There are no email notifications for replies or mentions yet, and no in-app notifications. This is deliberate: no automated outreach without owner approval.
- 290 course cards are "Coming soon" with planned lessons. Each needs written lessons before it is published.
