# Turning on tax rates and Plaid (owner steps)

Tax rates use Built2Bid's own engine (James, 2026-11-18): official state files, no TaxJar, no sign-up, no monthly cost. Plaid was approved on 2026-11-18. Each step below is something only the account owner can do. **Never paste a key or secret into chat.** Put keys only into Netlify's environment variables.

Before any of this, run the V6.9 SQL (`run-tax-banking.sql`) in the [Supabase SQL editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new).

All variables go in [Netlify → built2bid → Environment variables](https://app.netlify.com/projects/built2bid/configuration/env). For each one:
1. Click **Add a variable**.
2. Tick **Contains secret values** for keys.
3. Choose the **Production** context only.

After adding variables, click **Trigger deploy** in [Netlify Deploys](https://app.netlify.com/projects/built2bid/deploys) so the site picks them up.

## A. Scheduled jobs (do this once)

| Variable | Value |
|---|---|
| `TAX_BANKING_CRON_SECRET` | Any long random text. It switches on the hourly official tax-rate import and the nightly job. On a Mac, open Terminal, run `openssl rand -hex 32`, and paste the result into Netlify. |

## B. Tax rates (built in, nothing to buy)

1. After the SQL is run and the secret above is set, the hourly job starts importing each state's official rate file. It works through all states in about a day.
2. Open [Admin → Tax & banking health](https://built2bid.org/admin/tax-banking). The **Official rate files** table shows each state:
   - **ok**: official rates loaded. Bids there show state + county + city + district rates.
   - **needs link**: Built2Bid couldn't find the file. Click **Edit**, paste the state's official page that lists the rate files (or a direct file link), **Save links**, then **Import now**.
   - **format changed / failed**: the state changed its file. The last good rates stay in use; tell Claude in the project chat and it will update the reader.
   - **not needed**: states with no local taxes or no sales tax.
3. States without official local rates yet still work: bids use the statewide rate and say "check the local rate".

To turn the engine off, set `TAX_PROVIDER` = `none` in Netlify. Bids go back to the rate you type, clearly labelled.

## C. Plaid (read-only bank connections)

1. Create the account at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup).
2. Open **Developers → Keys** ([dashboard.plaid.com/developers/keys](https://dashboard.plaid.com/developers/keys)). There is one `client_id` and a separate secret for each environment. The **Sandbox** secret is available immediately.
3. Create the encryption key for bank tokens. In Terminal, run `openssl rand -base64 32`. **Set it once and never change it**: changing it disconnects every bank already linked.
4. Test with Plaid's fake banks. Add these Netlify variables (Production):

| Variable | Value |
|---|---|
| `BANK_PROVIDER` | `plaid` |
| `PLAID_CLIENT_ID` | your client_id (secret) |
| `PLAID_SECRET` | the **Sandbox** secret (secret) |
| `PLAID_ENV` | `sandbox` |
| `BANK_TOKEN_KEY` | the value from step 3 (secret) |
| `BANK_PROVIDER_LIVE` | `true` |

   Trigger a deploy. Then turn on **Practice mode** in Financials and open **Connected banks**. Test keys only work inside Practice mode, so no fake bank can appear in your real books. Click **Connect Business Bank Account**, pick any bank, and sign in with `user_good` / `pass_good`.

5. Request production access. On the Keys page, click **Request access** on the Production secret (some dashboards call it "Get Production access"). Answer Plaid's questions:
   - **Product:** Transactions (balances come with it).
   - **Use case:** read-only balances and transactions for contractors' bookkeeping and cash forecasts.
   - **Money movement:** none.
   - **Account and routing numbers:** not used.

   Ask Plaid for pay-as-you-go pricing and a monthly spend alert. Review usually takes several business days.
6. When Plaid approves, change two variables and redeploy:

| Variable | New value |
|---|---|
| `PLAID_SECRET` | the **Production** secret |
| `PLAID_ENV` | `production` |

   Real customers can then connect their banks from **Financials → Connected banks**, or from the setup prompt on the Financials home page.

7. Optional, for the admin cost estimate: in Plaid Dashboard → Billing, read your pay-as-you-go prices and add them as plain (not secret) variables: `PLAID_PRICE_TRANSACTIONS_USD` (per connected bank per month, for example `0.30`) and `PLAID_PRICE_BALANCE_USD` (per balance refresh). The Plaid panel on Admin → Tax & banking health and Admin → Tech Stack & Costs then shows cost so far and projected for the month. Without them it shows usage counts and "Unknown" cost.

To turn it off, delete `BANK_PROVIDER_LIVE`. Existing bank lines and reconciliations stay, and updates stop.

Sources: [Census Geocoder API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html), [Streamlined rate and boundary files](https://streamlinedsalestax.org/quick-links/r-b-files), [Plaid API docs](https://plaid.com/docs/api/), [Plaid glossary](https://plaid.com/docs/quickstart/glossary/).
