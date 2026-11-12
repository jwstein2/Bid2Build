# Security

- **Secrets** live only in server env vars. Only `NEXT_PUBLIC_*` values reach the browser. The Supabase secret key is used only in server routes after the caller is authorized.
- **Row Level Security** on every table. Users read and write only their own rows. Versions, usage counters, subscriptions, and billing rows are read-only to users; they change only through `SECURITY DEFINER` functions callable by the service role. Admin, log, audit, and analytics tables have no user policies.
- **Storage**: `logos` and `documents` buckets are private; objects live under `<user_id>/` and are served with signed URLs.
- **Auth**: passwordless email (link or 6-digit code). Every server check uses `auth.getUser()` (verified with the Auth server), never the cookie alone. Exports require a confirmed email on the auth account.
- **Quota integrity**: row lock on the monthly counter; tested with concurrent requests. Idempotent by content hash.
- **Stripe**: webhook signature verified on the raw body; events deduplicated in `stripe_events`; live keys refused without `STRIPE_ALLOW_LIVE=true`.
- **Website import (SSRF)**: http/https only, ports 80/443, DNS resolved and every address checked against private/reserved ranges (IPv4, IPv6, mapped), redirects followed manually and re-validated, size and time limits, no cookies. Retrieved text is treated as data only and shown to the user for review; it is never used as instructions.
- **Uploads**: type sniffed from bytes (JPG, PNG, WebP, SVG), SVG rejected if it contains scripts, event handlers, external references, or foreign objects; all logos re-encoded to PNG with size caps.
- **Requests**: same-origin check on state-changing API routes, zod validation, in-memory rate limits (per instance; move to a shared store before scaling out), security headers (CSP frame-ancestors, nosniff, referrer policy, permissions policy).
- **Admin**: requires an `admin_roles` row and a verified email; non-admins get 404. Every admin write is audit-logged, and the action aborts if the audit write fails. Admin metrics are aggregates only; analytics never store bid contents.
- **Privacy**: marketing consent is a separate opt-in. Users can export or delete their data from Account settings.

Known gaps before launch: shared rate-limit store, custom SMTP, counsel-reviewed privacy policy and terms, and a penetration test.
