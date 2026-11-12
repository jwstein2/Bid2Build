# Domain migration plan: built2bid.netlify.app → built2bid.org

**This is a configuration change, not a rebuild.** The app, database, hosting and user data stay
exactly where they are. The site keeps running on Netlify; Supabase, Stripe and Google Workspace keep
their accounts. Only URLs and a few dashboard settings change.

Domain status (owner, 2026-11-12): **built2bid.org purchased through Netlify**, Google Workspace email
configured on it. Spelling to confirm in Netlify → Domains before anything is pointed at it: `built2bid.org`
(digit 2, `.org`). **No DNS record is changed by Claude; every DNS step below needs the owner's go-ahead.**

## Decisions (recommended defaults)

| Decision | Recommendation | Why |
|---|---|---|
| Canonical host | `https://built2bid.org` (apex) | Short, matches brand; Netlify serves apex natively when it hosts DNS |
| www | `www.built2bid.org` → 301 → apex | Netlify does this automatically for the primary domain |
| Old URL | `built2bid.netlify.app` → 301 → apex | Netlify redirects the netlify.app subdomain to the primary domain automatically once one is set |
| Previews | stay on `deploy-preview-N--built2bid.netlify.app`, always noindex | Implemented on this branch |
| Hosting | stay on Netlify | No technical reason to move; domain already lives there |
| App vs marketing split | one origin for both | No subdomain cookies, CORS or second deploy needed |
| Outreach email domain | **separate** domains (e.g. a `.com` variant), never `built2bid.org` | Protects the domain that sends sign-in and billing email; see INSTANTLY_INTEGRATION_PLAN.md |

## What the code already does (this branch)

* Every absolute URL comes from `site.url` (`src/lib/site.ts`), resolved per Netlify context in `src/lib/config/deploy.ts`:
  * production: `NEXT_PUBLIC_SITE_URL`, else Netlify `URL`
  * deploy previews and branch deploys: always their own `DEPLOY_PRIME_URL`
  * local: `http://localhost:3000`
* Stripe success/cancel/portal URLs, canonical tags, sitemap and robots follow `site.url`.
* Sign-in links use the browser's current origin, so they work on any domain listed in Supabase.
* Search indexing is only possible on a production deploy with `NEXT_PUBLIC_ALLOW_INDEXING=true`.
* Previews send `X-Robots-Tag: noindex, nofollow`, a noindex meta tag and `Disallow: /`.
* HSTS (`max-age=31536000`, no preload) on every Netlify deploy.

## Order of operations

1. **Prepare (no visible change):** merge this branch; set `NEXT_PUBLIC_SUPPORT_EMAIL`; add the
   built2bid.org URLs to Supabase Redirect URLs (additive; old URLs keep working).
2. **Email first:** verify Workspace MX, add SPF, DKIM, DMARC (DNS: owner approval). Switch Supabase
   SMTP to a Workspace sender. Test sign-in email.
3. **Attach the domain (owner approval):** in Netlify set built2bid.org as the primary domain; wait for
   the Let's Encrypt certificate; check HTTPS on apex and www.
4. **Point the app at it:** set `NEXT_PUBLIC_SITE_URL=https://built2bid.org` (Production context) and
   redeploy; change Supabase Site URL; update Stripe webhook endpoint/portal links when Stripe exists.
5. **Verify** (DOMAIN_MIGRATION_CHECKLIST.md §Verify), then submit the sitemap to Search Console.
6. **Indexing:** only after the release gates pass, set `NEXT_PUBLIC_ALLOW_INDEXING=true` and redeploy.

Exact settings and locations: **DOMAIN_MIGRATION_CHECKLIST.md**. Rollback: **ROLLBACK_AND_RECOVERY_PLAN.md §3**.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sign-in links break after the switch | Keep both netlify.app and built2bid.org redirect URLs in Supabase during and after the switch |
| Users signed in on netlify.app appear signed out on built2bid.org | Expected (cookies are per domain); users sign in once more. Only 1 account exists today |
| Stripe webhooks go to the old URL | The old URL 301-redirects, and Stripe does **not** follow redirects for webhooks: update the endpoint the same day |
| Certificate not issued | DNS must resolve to Netlify; Netlify DNS does this automatically. Do not announce until HTTPS is green |
| Email marked as spam | SPF + DKIM + DMARC before switching the sender; separate domains for cold outreach |
| Previews indexed | Enforced in code regardless of env vars (tested) |
