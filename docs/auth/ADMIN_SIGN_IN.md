# Admin sign-in and two-step (owner runbook)

`https://built2bid.org/admin` is the owner's command center. It is never linked from the public site or the
customer app (the Sales Portal stays staff-only as before).

## How signing in works

1. Open `https://built2bid.org/admin` on any device. Signed out, it goes to `/admin-login`.
2. Enter the email of your **regular Built2Bid account** (same account as the app, no separate admin login).
   We email a 6-digit code. Unknown emails never create a new account on this page.
3. Enter the 6-digit code from your **authenticator app** (`/auth/mfa`). The admin area opens.

Rules (code: `src/lib/auth/admin-gate.ts`, `src/lib/admin/server.ts`):

- Only accounts with a row in `public.admin_roles` (checked by user id, plus a verified email) get in. Anyone
  else who signs in sees "not an admin account" with a Sign out button.
- Every admin page and admin action needs a session that passed the authenticator step (aal2). The owner's
  finance pages under `/admin/staff` and `/admin/payouts` follow the same rule.
- An admin with **no authenticator** is sent to Account settings → Two-step sign-in to set one up, so there is
  no way to be locked out by the rule itself.

## Avoid lockout: add a backup authenticator

Account settings → Two-step sign-in → **Add a backup authenticator**. Use a second phone, or 1Password /
Bitwarden on your computer. Either one works at sign-in.

## Recovery if every authenticator is lost

Use whichever is quickest. Each one is reversible.

**A. Supabase dashboard (recommended).** Sign in to Supabase (protected by its own login), open
[Authentication → Users](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/users), find your
email, open the user, and delete the MFA factor. Then sign in at `/admin` with the email code; you'll be sent to
set up a new authenticator.

**B. SQL Editor.** Open the
[SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new) and run (replace the email if
needed):

```sql
-- Removes every authenticator from the owner account. Sign in again afterwards and set up a new one.
delete from auth.mfa_factors
where user_id = (select id from auth.users where email = 'jwstein2@gmail.com');
```

**C. Emergency switch (temporary).** In
[Netlify → Environment variables](https://app.netlify.com/projects/built2bid/configuration/env), add
`ADMIN_REQUIRE_TWO_STEP` = `false` (Production), then Deploys → Trigger deploy. The admin area then needs only
the email code. Delete the variable and redeploy as soon as you've set up a new authenticator.

Note: removing the authenticator (A or B) also means a real bank can't be connected or reconnected until you set
up a new one.

## Checking who is an admin

```sql
select u.email, r.role, r.created_at,
       (select count(*) from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as authenticators
from public.admin_roles r join auth.users u on u.id = r.user_id;
```
