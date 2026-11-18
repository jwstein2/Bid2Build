# Turning on TaxJar and Plaid (owner steps)

Approved by James on 2026-11-18. Each step is something only the account owner can do. **Never paste a key or secret into chat.** Put keys only into Netlify's environment variables.

Before any of this, run the V6.9 SQL (`run-tax-banking.sql`) in the [Supabase SQL editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new).

All variables go in [Netlify → built2bid → Environment variables](https://app.netlify.com/projects/built2bid/configuration/env). For each one:
1. Click **Add a variable**.
2. Tick **Contains secret values** for keys.
3. Choose the **Production** context only.

After adding variables, click **Trigger deploy** in [Netlify Deploys](https://app.netlify.com/projects/built2bid/deploys) so the site picks them up.

## A. Nightly job (do this once)

| Variable | Value |
|---|---|
| `TAX_BANKING_CRON_SECRET` | Any long random text. On a Mac, open Terminal, run `openssl rand -hex 32`, and paste the result into Netlify. |

## B. TaxJar (sales tax rates)

1. Sign up for **TaxJar Professional** at [taxjar.com/pricing](https://www.taxjar.com/pricing). The API is only on Professional, about $99/mo. TaxJar counts 10 API calls as 1 order.
2. In the TaxJar app, open the **account menu (top right) → TaxJar API**. Under **Live token**, click **Generate API Token** ([TaxJar's guide](https://support.taxjar.com/article/160-how-do-i-get-a-sales-tax-api-token)).
3. Add these Netlify variables (Production):

| Variable | Value |
|---|---|
| `TAX_PROVIDER` | `taxjar` |
| `TAXJAR_API_KEY` | the Live token (secret) |
| `TAX_PROVIDER_LIVE` | `true` |

4. Trigger a deploy. Then open any bid that has a project address and click **View tax details**. It should say "Licensed tax service". On **Financials → Tax & regulatory updates**, the "coming soon" banner disappears after the first nightly run (09:17 UTC).

To turn it off, delete `TAX_PROVIDER_LIVE`. Bids go back to the rate you type, clearly labelled.

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

To turn it off, delete `BANK_PROVIDER_LIVE`. Existing bank lines and reconciliations stay, and updates stop.

Sources: [TaxJar API token](https://support.taxjar.com/article/160-how-do-i-get-a-sales-tax-api-token), [TaxJar API FAQ](https://developers.taxjar.com/integrations/faq), [Plaid API docs](https://plaid.com/docs/api/), [Plaid glossary](https://plaid.com/docs/quickstart/glossary/).
