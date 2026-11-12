# Domain migration checklist (built2bid.org)

Tick in order. 🔐 = needs the owner's login. ⚠️ = DNS or production change: **owner approval required**.
Nothing here contains secret values.

## 0. Confirm

- [ ] 🔐 Netlify → **Domains**: the purchased domain is exactly `built2bid.org`, auto-renew on, registrant contact correct.
- [ ] 🔐 Netlify → Domains → built2bid.org → **DNS records**: list what exists today (Workspace MX/TXT were likely added during Workspace setup). Paste the list (no secrets in it) into the project chat so it can be checked.

## 1. Code (no visible change)

- [ ] Merge the PR from branch `claude/project-thread-6xa3uh` (domain-portable URLs, preview noindex).
- [ ] 🔐 Netlify → Site configuration → Environment variables:
  - [ ] `NEXT_PUBLIC_SUPPORT_EMAIL` = a Workspace address, e.g. `support@built2bid.org` (All contexts)
  - [ ] `NEXT_PUBLIC_SITE_URL`: **scope to Production only** (if it exists today with "All" contexts, change its scope). Leave it at the current value until step 4.
  - [ ] `NEXT_PUBLIC_ALLOW_INDEXING` absent or `false`.

## 2. Supabase Auth URLs (additive) 🔐

Supabase → project `asiiqmegvajtuspeumio` → Authentication → **URL Configuration** → Redirect URLs. Keep the existing entries and add:

- [ ] `https://built2bid.org/auth/callback`
- [ ] `https://built2bid.org/auth/confirm`
- [ ] `https://www.built2bid.org/auth/callback` (harmless; covers users who land on www before the redirect)
- [ ] `https://deploy-preview-*--built2bid.netlify.app/**` (previews; Supabase supports `*` and `**` globs)
- [ ] keep `https://built2bid.netlify.app/auth/callback` and `/auth/confirm` for at least 30 days
- [ ] keep `http://localhost:3000/**` for development

## 3. Email authentication on built2bid.org ⚠️ (DNS)

In Netlify DNS for built2bid.org (values come from the Google Admin console, not from here):

| Type | Host | Value | Source |
|---|---|---|---|
| MX | `@` | `smtp.google.com` priority 1 (current Google single-MX setup), or the 5 legacy `aspmx` records if that is what Workspace showed | Google Admin → Apps → Gmail → Setup |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` (merge into one SPF record if another exists) | Google SPF guide |
| TXT | `google._domainkey` | the DKIM key Google generates | Google Admin → Apps → Google Workspace → Gmail → **Authenticate email** → Generate, then **Start authentication** after publishing |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@built2bid.org` (move to `p=quarantine` after 2–4 clean weeks) | — |
| TXT | `@` | `google-site-verification=…` | Search Console (step 7) |

- [ ] 🔐 Create a sending mailbox or alias in Workspace, e.g. `no-reply@built2bid.org` (or `hello@`). A group/alias works if sending "as" it is allowed.
- [ ] 🔐 Supabase → Authentication → **SMTP Settings**: host `smtp.gmail.com`, port 465 (SSL) or 587 (STARTTLS), username = the Workspace mailbox, password = an **app password of that Workspace mailbox** (requires 2-Step Verification on it), sender name `Built2Bid`, sender email = that address. Replace the personal Gmail app password, then **revoke the old app password** in the personal Google account (it was pasted in chat).
  - Workspace SMTP sending limits apply (about 2,000 messages/day per user). If sign-ups grow, switch to a transactional provider (Resend, Postmark, Amazon SES) using a subdomain such as `mail.built2bid.org`.
- [ ] Send a test sign-in email to a Gmail and an Outlook address; check "mailed-by/signed-by built2bid.org" and that it is not in spam.

## 4. Attach the domain ⚠️ (production change)

- [ ] 🔐 Netlify → site `built2bid` → **Domain management** → Add a domain → `built2bid.org` → set as **Primary domain**. Netlify DNS creates the apex and `www` records automatically.
- [ ] Wait for **HTTPS → Certificate** to show `built2bid.org, www.built2bid.org` (usually minutes).
- [ ] Netlify → Environment variables → `NEXT_PUBLIC_SITE_URL` = `https://built2bid.org` (**Production** context only).
- [ ] 🔐 Deploys → **Trigger deploy → Clear cache and deploy site** (NEXT_PUBLIC values are inlined at build time).
- [ ] 🔐 Supabase → Authentication → URL Configuration → **Site URL** = `https://built2bid.org`.

## 5. Stripe (when the account exists) 🔐

- [ ] Developers → Webhooks → endpoint `https://built2bid.org/api/stripe/webhook` with the 8 events in `docs/SETUP.md`. Copy its signing secret into Netlify `STRIPE_WEBHOOK_SECRET` (secret, Production). Stripe does not follow redirects, so do not leave the endpoint on netlify.app.
- [ ] Settings → Business → public details: website `https://built2bid.org`, support email, privacy and terms URLs `https://built2bid.org/privacy`, `/terms`.
- [ ] Settings → Billing → Customer portal: same links; allow cancel and monthly↔annual switch.
- [ ] Settings → Branding: logo/colors.

## 6. Other integrations

- [ ] Instantly (later): webhook URL `https://built2bid.org/api/webhooks/instantly`; links in campaigns point to `https://built2bid.org/...?utm_source=instantly&utm_medium=email&utm_campaign=<id>`.
- [ ] Update `README.md` / `docs/SETUP.md` examples if desired (they use `YOUR_DOMAIN`).

## 7. Search ⚠️ (DNS TXT)

- [ ] 🔐 Google Search Console → Add property → **Domain** → `built2bid.org` → add the TXT record in Netlify DNS → Verify.
- [ ] Only when launch is approved: Netlify `NEXT_PUBLIC_ALLOW_INDEXING=true` (Production), redeploy, then submit `https://built2bid.org/sitemap.xml`.

## Verify

- [ ] `https://built2bid.org` loads with a valid certificate; `http://` → `https://`.
- [ ] `https://www.built2bid.org` → 301 → `https://built2bid.org`.
- [ ] `https://built2bid.netlify.app/pricing` → 301 → `https://built2bid.org/pricing`.
- [ ] View source on `/pricing`: canonical `https://built2bid.org/pricing`.
- [ ] `https://built2bid.org/robots.txt`: `Disallow: /` until indexing is approved, then `Allow: /` with sitemap line.
- [ ] A deploy preview's `/robots.txt` says `Disallow: /` and responses carry `X-Robots-Tag: noindex`.
- [ ] Sign in with a new email on built2bid.org; the email comes from the built2bid.org sender; the link lands on built2bid.org signed in.
- [ ] Footer "Contact support" shows the Workspace address, not `support@example.com`.
- [ ] (Stripe) Test checkout returns to `https://built2bid.org/settings/billing?checkout=success`; webhook deliveries show 200.
