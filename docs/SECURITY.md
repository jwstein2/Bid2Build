# Security

- **Secrets** live only in server env vars. Only `NEXT_PUBLIC_*` values reach the browser. The Supabase secret key is used only in server routes after the caller is authorized.
- **Row Level Security** on every table. Users read and write only their own rows. Versions, usage counters, subscriptions, and billing rows are read-only to users; they change only through `SECURITY DEFINER` functions callable by the service role. Admin, log, audit, and analytics tables have no user policies.
- **Storage**: `logos` and `documents` buckets are private; objects live under `<user_id>/` and are served with signed URLs.
- **Auth**: passwordless email (link or 6-digit code). Every server check uses `auth.getUser()` (verified with the Auth server), never the cookie alone. Exports require a confirmed email on the auth account.
- **Credit integrity**: `finalize_bid()` locks the user's `credit_accounts` row, spends at most one credit per bid (unique ledger index), and creates the version in the same transaction; tested with concurrent requests. Idempotent by content hash. Starter bonus is once per account and per email hash.
- **Stripe**: webhook signature verified on the raw body; events deduplicated in `stripe_events`; live keys refused without `STRIPE_ALLOW_LIVE=true`.
- **Website import (SSRF)**: http/https only, ports 80/443, DNS resolved and every address checked against private/reserved ranges (IPv4, IPv6, mapped), redirects followed manually and re-validated, size and time limits, no cookies. Retrieved text is treated as data only and shown to the user for review; it is never used as instructions.
- **Uploads**: type sniffed from bytes (JPG, PNG, WebP, SVG), SVG rejected if it contains scripts, event handlers, external references, or foreign objects; all logos re-encoded to PNG with size caps.
- **Requests**: same-origin check on state-changing API routes, zod validation, rate limits (in-memory fast path plus a shared Postgres counter, `20261120001000_durable_rate_limits.sql`), security headers (baseline CSP: frame-ancestors/object-src/base-uri/upgrade-insecure-requests, HSTS, nosniff, referrer policy, permissions policy).
- **Admin**: signed-out visits to `/admin` go to `/admin-login` (the owner's regular account and email code, existing accounts only). Requires an `admin_roles` row and a verified email; other accounts see "not an admin account". Every admin page, action and owner finance page requires an authenticator-verified (aal2) session; an owner without an authenticator is sent to set one up. `ADMIN_REQUIRE_TWO_STEP=false` is the emergency off switch (see `docs/auth/ADMIN_SIGN_IN.md`). Every admin write is audit-logged, and the action aborts if the audit write fails. Admin metrics are aggregates only; analytics never store bid contents.
- **Privacy**: marketing consent is a separate opt-in. Users can export or delete their data from Account settings.

- **Two-step sign-in**: optional TOTP for everyone; required (aal2) to connect a bank and for financial administration.
- **Supply chain**: CodeQL (weekly + every PR), npm audit on production dependencies and dependency review on PRs (`.github/workflows/security-checks.yml`), Dependabot weekly, GitHub secret scanning with push protection.
- **Monitoring**: Sentry (no default PII), Better Stack uptime + daily backup heartbeat; Supabase daily backups.
- **Vulnerability reports**: `.github/SECURITY.md` and `/.well-known/security.txt`.

Open items (tracked in the due-diligence readiness doc): counsel-reviewed legal documents, full nonce-based CSP (report-only first), branch protection on `main`, a restore drill, and an external penetration test.
