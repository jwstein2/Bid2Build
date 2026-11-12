# Setup

## Local development
```bash
npm install
cp .env.example .env.local   # fill in values below
npm run dev                  # http://localhost:3000
```
Without Supabase variables the marketing site and the builder work fully (drafts stay in the browser);
accounts, saving, and PDF export need Supabase.

## 1. Supabase
1. Create a project (Postgres 15+). Free tier is fine for testing.
2. Apply migrations **in order** from `supabase/migrations/` (SQL editor, or `supabase db push`).
   Never apply `supabase/tests/00_stub_supabase.sql` to a real project: it is a local test stub.
3. Run `supabase/seed.sql` (trades, v1 templates, flags, disabled pricing sources). Regenerate it with `npm run db:seed:generate` after editing the trade catalog.
4. Project settings > API: copy the URL, publishable key, and secret key into env vars.
5. Auth > URL configuration: set Site URL to your domain and add `https://YOUR_DOMAIN/auth/callback` and `https://YOUR_DOMAIN/auth/confirm` (plus localhost equivalents) to Redirect URLs.
6. Auth > Email templates > Magic Link: include both the link and the code so users can sign in on another device:
   ```html
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Sign in to Bid2Build</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```
7. Configure custom SMTP (Auth > SMTP) before launch; the built-in sender is rate-limited.
8. Make yourself an admin (SQL editor): `insert into admin_roles (user_id, role) select id, 'admin' from auth.users where email = 'you@example.com';`

## 2. Stripe (test mode first)
1. Get a **test** secret key (`sk_test_...`).
2. `STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup` creates the product and both prices (idempotent) and prints the price IDs.
3. Add a webhook endpoint `https://YOUR_DOMAIN/api/stripe/webhook` with events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
4. Enable the Customer Portal (Settings > Billing > Customer portal) with cancel and plan switching.
5. Live mode is refused unless `STRIPE_ALLOW_LIVE=true`. Only set it after the owner approves launch.

## 3. Netlify
1. New site from GitHub, pick the repo. Build settings come from `netlify.toml`.
2. Add every variable from `.env.example` under Site configuration > Environment variables. Set `NEXT_PUBLIC_SITE_URL` to the deployed URL.
3. Keep `NEXT_PUBLIC_ALLOW_INDEXING=false` until public launch is approved.

## Tests
```bash
npm test               # unit + integration (DB tests skip if no database)
npm run test:db        # starts a throwaway local Postgres and runs RLS/quota/billing tests
npm run typecheck && npm run lint && npm run build
```
