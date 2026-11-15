# E-signatures and signed bids

Homeowners review and sign a frozen proposal version through a private link, with no account and no payment. Contractors see signed bids at the top of the dashboard.

**Status:** behind `NEXT_PUBLIC_ESIGNATURES=on`, off everywhere until the owner approves release. Needs migration `supabase/migrations/20261115001000_e_signatures.sql` first (additive only).

## Contractor flow
1. Proposal step → **Create Signing Link** (also in the step footer and the preview dialog).
2. The server runs the same finalize path as Download PDF (`src/lib/export/finalize.ts`): readiness checks, render, `finalize_bid` (credits), private storage.
3. `create_signing_request` freezes that `estimate_versions` row plus the SHA-256 of the exact PDF, revokes older pending links for the bid (superseded), and stores a write-once copy of the PDF at `documents/<user>/<estimate>/signing/<request>.pdf`.
4. The dialog offers Copy link, **Send via My Email** (mailto with the link, contractor's own app), and Download PDF.
5. Links last 30 days, never past the proposal's expiration date (refused if that date has passed), max 90 days. Pending links can be revoked from the Proposal step.

## Customer flow (`/sign/<token>`)
Full proposal (scope, pricing, exclusions, payment schedule, terms, expiration), Download PDF, then: full legal name, email, typed or drawn signature (drawn = pointer events, works with touch/pen/mouse; typed is the accessible alternative), two unchecked boxes (ESIGN consent disclosure, acceptance of this proposal and total), **Accept & Sign Proposal**. Afterwards the page shows Signed and offers the signed copy.

## Bid quotas (no pricing change)
Signing links use `finalize_bid` unchanged: one credit per bid, ever. Downloading, sharing, creating links (again), reopening, and retrieving the signed PDF never charge again. A new link on an unchanged proposal maps to the existing version. Readiness failures never charge. Free accounts with no credits left get the normal upgrade prompt, so there is no free signing loophole. Unlimited and Enterprise unchanged.

## Data model
- `signing_requests`: token **hash** only, version, document hash, status pending/signed/revoked, expiry, revoke reason.
- `signatures`: the acceptance record (signer, email, method, typed text or PNG, consent version + text, acceptance text, consent time, document + content hashes, exact total and version number, IP, user agent, UTC time, verification = `link_possession`). Trigger makes evidence write-once; only `pdf_*` processing columns change. `unique(request_id)` = one signature per link.
- Delete guards: a signed bid or signed version can't be deleted directly (archive instead). Account deletion still cascades.
- Signing status is derived (`src/lib/esign/status.ts`) and kept separate from draft/finalized/archived and from the Enterprise `pipeline_stage`. Signing does not move the pipeline to Won; that stays a manual choice.

## Security controls
- 256-bit random tokens (`randomBytes(32)`), only SHA-256 stored; token shape checked before any lookup.
- Expiry, revocation, superseding, archived bids refuse signing.
- `accept_signing_request` locks the request row: concurrent submissions produce one signature; a replay by the same signer returns the same record; anyone else gets `already_signed`.
- Server re-validates everything (zod): consent and acceptance must be literally `true`; typed signature must match the name; drawn signature must be a real PNG of sane size. Consent/acceptance wording is rebuilt on the server from the frozen proposal.
- RLS: read follows the estimate (owner, plus Enterprise members whose existing permissions let them view that bid). No end-user writes; service role only through the functions above. `token_hash` column is not readable by signed-in users. Anon has no access.
- Only the bid's owner can create or revoke links (same rule as exporting).
- The signing page only ever reads the customer-facing `proposal` JSON, never the snapshot (internal costs/markups).
- `/sign/*` and `/api/sign/*`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`; robots.txt disallows `/sign/`. Customer PDFs are streamed, never storage URLs.
- Rate limits: create 10/min, accept 8 per 10 min, customer PDF 30 per 10 min (per IP, per instance).
- No view tracking, no reminders, no emails sent by Built2Bid.

## Signed PDF
`src/lib/pdf/signed-pdf.tsx`: the proposal exactly as reviewed, the signature filled into the customer acceptance line, plus an Electronic Signature Certificate page (signer, method, times, consent + acceptance text, hashes, IDs, IP, browser, honest verification wording). Stored privately at `documents/<user>/<estimate>/signed/<signature>.pdf`; its hash is recorded. If rendering fails after acceptance the bid stays Signed, `pdf_status = failed`, and every download retries it.

## Contractor surfaces
- Dashboard: **Recently Signed** section (last 30 days, newest first; customer, project, exact signed amount, local "Today at 2:14 PM", View Signed Proposal, Download Signed PDF, details) and a **Recently Signed Bids** count card. Refreshes when the tab regains focus (max once a minute). No polling, no Realtime.
- My Bids: Awaiting Signature / Signed vN / Expired / Revoked badges next to the existing status; signature filter (All bids / Awaiting Signature / Signed) that combines with the existing status, trade and search filters. Signed bids offer View signed and hide Delete.
- `/signed/<id>`: signature details, the exact signed version, Download Signed PDF, Audit record (JSON).

## Owner steps to turn it on
1. Run the migration in the [Supabase SQL Editor](https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new).
2. Complete `LEGAL_REVIEW.md` with an attorney.
3. Netlify → Site configuration → Environment variables: add `NEXT_PUBLIC_ESIGNATURES` = `on` (Deploy previews first, then Production), then redeploy (it is inlined at build time).

## Tests
- `tests/db/esign.test.ts` (real Postgres): creation rules, idempotent/concurrent acceptance, expiry/revoke/supersede/archive, immutability, delete guards, isolation incl. Enterprise and anon, account-deletion cascade.
- `tests/esign.test.ts`: status derivation, validation, expiry, tokens, wording, signing email, real signed-PDF render.
- `tests/esign-routes.test.ts`: one credit across export + links, readiness before credits, owner-only, flag off, accept validation, PDF failure keeps Signed.
- `scripts/esign/walk.mjs`: browser walk (dashboard, filters, signing page desktop/phone with a drawn signature, signed copy download, replay refusal, signed page, audit, builder link dialog, 320–1280px).
