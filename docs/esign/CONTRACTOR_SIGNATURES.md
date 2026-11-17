# Contractor signatures (V5.3, Proposal Signature Management)

Contractor-side signatures on accepted proposals. This builds on the existing e-signature system (`README.md` in this folder). It doesn't replace it. The customer side (`signing_requests`, `signatures`, `/sign/<token>`) is unchanged, and so is every reader of `public.signatures` (pipeline, project reviews, Financial Command Center).

**Status:** behind `NEXT_PUBLIC_CONTRACTOR_SIGNING=on`, which also needs `NEXT_PUBLIC_ESIGNATURES=on`. It is off everywhere until the owner approves release. It needs migration `supabase/migrations/20261125001000_contractor_signatures.sql`, which is additive only. With the flag off, nothing changes for anyone, even after the migration is applied.

## 1. Audit of what already existed (and what was extended)

| Area | Existing | V5.3 change |
|---|---|---|
| Customer e-signature | `signing_requests`, `signatures` (write-once), `accept_signing_request`, signed PDF + certificate | Unchanged. After acceptance, `contractor_after_customer_signed` runs and the executed PDF is rendered when both sides have signed. |
| Versioning | `estimate_versions` frozen per finalize; a signing link freezes one version + PDF hash | Contractor signatures attach to that same frozen version, one per version. They never touch `estimates` or `estimate_versions`. |
| Company Profile | `/settings/company` | New card → **Proposal Signing** at `/settings/company/signing`. |
| Account Settings | `/settings/account` | New card → **My Signature** at `/settings/account/signature`. |
| Enterprise permissions | `company_members` roles, owner-granted keys like `change_proposal_policy` | Policy is managed by the owner, or by a member the owner gave `change_proposal_policy`. No new permission keys were added (to keep merges with the FCC branch small). |
| Signed PDF | `src/lib/pdf/signed-pdf.tsx` | Customer \| Contractor signature block, plus a contractor certificate section. "Fully Executed" appears only when both are recorded. |
| FCC / payments | Reads `public.signatures` + the frozen `paymentSchedule` | Untouched. Contractor signing never inserts signatures, never charges, and never moves the pipeline. Tested. |

## 2. Settings

**Company Profile → Proposal Signing** (owner, or a member with `change_proposal_policy`):
- Require a contractor signature (default on).
- Who signs:
  - **A. Authorized company signature** (default signer: the owner, or a member authorized for any company contract).
  - **B. Assigned sales representative** (the bid's owner, if authorized and with a signature on file; otherwise the company signer).
  - **C. Manual countersignature.**
- Allow automatic application, either before the proposal is sent or right after the customer signs. This only works for a signer who personally authorized it.
- Who can sign for the company: the roster of members. You can authorize a member for their own bids or any company contract, give them a title, allow auto, or revoke.
  - Nobody can authorize themselves (`self_grant`).
  - Viewers can't be authorized.
  - Rows never include signature images.
- Every save is a new revision with history. Links created earlier keep the rules frozen when they were created.

**Account Settings → My Signature** (each person):
- Draw, upload (re-saved as a trimmed PNG; the original file isn't kept) or type a signature, with legal name and title.
- **Default: company-name signature.** The typed option starts as the company's name (Company Profile name, or the business profile name for solo accounts), shown on contracts as the signature with "By: name, title" under it. It is still a specific person's adopted signature: the same identity check, adoption statement and authority rules apply, the server only accepts the signer's own company name, and the certificate says "typed company name, signed by the person named above". A bare company name with no responsible person is never applied.
- **Identity check:** a signature is stored only if the person signed in within the last 15 minutes (Auth `last_sign_in_at`). Otherwise the page sends a one-time email code and verifies it first. The check used is stored with the credential. No made-up times.
- **Affirmative authorization:** "Adopt this signature" must be checked, and its exact wording is stored. Automatic application is a separate, optional, unchecked box with its own stored wording.
- Updating creates a new version. Contracts already signed keep the version they were signed with.
- "Stop automatic application" revokes auto only. "Remove signature" revokes everything. Both take effect immediately for future contracts only.
- Shows your authority: owner, the authorization you were given and by whom, or not authorized.

## 3. Workflows

The requirement is frozen per signing link in `contractor_signing_requirements` when the link is created.

| Sequence | How | Record |
|---|---|---|
| Contractor-first, interactive | Builder → **Sign now as …** before Create Signing Link (statement confirmed) | `interactive`, trigger `sign_before_send`, IP + browser + statement |
| Contractor-first, automatic | Policy auto + `before_send` + signer authorized auto | `auto_policy`, trigger `signing_link_created`, **no IP/device**, authorization time + wording |
| Customer-first, interactive | Customer signs → dashboard **Awaiting Contractor Signature** → signed page → **Countersign** (statement confirmed) | `interactive`, trigger `countersign_action` |
| Customer-first, automatic | Policy auto + `after_customer` | `auto_policy`, trigger `customer_signed` |

- **Missing signer** (nobody authorized, no signature on file, or auto revoked): the status is **Awaiting Contractor Signature**, with the reason and who must act. A signature is never filled in on anyone's behalf.
- **Fully executed** = customer signature + required contractor signature. `executed_at` = the later of the two times. The executed PDF is stored at `documents/<user>/<estimate>/executed/<signature>.pdf`, its hash is recorded, and failures retry on download.
- **Not required** (policy off): the contract counts as accepted on the customer signature, and no contractor line is filled in.
- **Historical contracts** (signed before this migration, so no requirement row): shown as signed, never as "awaiting". The owner may add a **corrective countersignature**. It is recorded separately with today's date (`corrective = true`) and never backdated. Automatic application is refused for historical contracts.

## 4. Legal and evidence integrity

- `contractor_signatures`, credentials, authorizations, requirements and events are write-once (triggers). Only revocation status columns change, plus FK nulling on account deletion.
- `applied_at` is always `now()`. Nothing is backdated, and no row is ever created for an existing signed contract by the migration.
- Automatic application is labeled everywhere (UI, PDF, certificate) as *"applied automatically under the signer's prior authorization … not a record of the signer personally signing at that moment"*. It stores no IP or user agent, because none exists.
- Each record keeps: signer, authority (business owner / company owner / company authorization + id), credential version, policy revision + snapshot, statement text, authorization time, document content hash, trigger, sequence, and IP/UA/session time for interactive signing.
- `contractor_signing_events` is an append-only history. It appears on the signed page as **Signature history** and in the audit record JSON.
- Tenant isolation: every function checks the actor against the bid's company. Existence checks run after the authority check, so outsiders learn nothing. Grants are service role only, and RLS is select-only.
- **Attorney review recommended before release:** the ESIGN/UETA attribution of automatically applied signatures, state-specific contractor contract rules (e.g. home improvement contract signature requirements), and the adoption/authorization wording in `src/lib/esign/contractor/config.ts`.

## 5. Tests (V5.3 checklist)

- `tests/db/contractor-signatures.test.ts`: 16 tests on real Postgres with every migration.
- `tests/contractor-signing.test.tsx`: 12 unit + PDF text tests.
- `scripts/contractor/walk.mjs`: 36 browser checks, real signing SQL via `scripts/radar/pg-rest.mjs`, test data only.

| # | Item | Where |
|---|---|---|
| 1 | Default policy = required, manual | DB "defaults" |
| 2 | Only owner / trusted manager edits policy | DB "permissions", walk |
| 3 | No self-grant; viewers excluded | DB "authorizations" |
| 4 | Signature adoption needs identity + adopt statement | route, walk (refused without adopt) |
| 5 | Credential versioning; old contracts keep old version | DB, walk (v1 → v2) |
| 6 | Mode A auto, contractor-first | DB, walk (siding) |
| 7 | Auto refused without signer's own authorization | DB "refusal cases" |
| 8 | Mode B rep signs own bids / fallback to company signer | DB "Mode B" |
| 9 | Mode C manual, customer-first, event order | DB, walk (deck) |
| 10 | Auto after customer | DB |
| 11 | Missing signer → Awaiting Contractor Signature, no signature | DB, walk |
| 12 | Revoking auto / authorization stops future use only | DB "revocation" |
| 13 | Ownership change | DB |
| 14 | Historical contract untouched; corrective is separate | DB, walk |
| 15 | Write-once / immutability; repeat countersign idempotent | DB, walk |
| 16 | Payment schedule + `signatures` unchanged (FCC) | DB "payment schedule" |
| 17 | Tenant isolation, no existence leak | DB "isolation" |
| 18 | Account deletion keeps evidence (FK nulling) | DB |
| 19 | Executed PDF: both signatures, certificate, auto wording, all templates | unit/PDF, walk download |
| 20 | Phone layouts (390px) without overflow | walk |

## 6. Production approval checklist (owner)

1. Review the PR and the Netlify preview. The preview has the flag off, so it behaves exactly like today.
2. Run the migration in the Supabase SQL Editor once: paste `20261125001000_contractor_signatures.sql` and press Run. It is additive only, touches no existing contracts, and is safe with the flag off.
3. Merge. With the flag off there is no visible change.
4. Optional, with a test account only: set `NEXT_PUBLIC_CONTRACTOR_SIGNING=on` in a Deploy Preview / branch context, adopt a signature, set the policy, and sign a test proposal as a test customer.
5. Have an attorney review section 4 and the wording in `config.ts`.
6. To release: set `NEXT_PUBLIC_CONTRACTOR_SIGNING=on` for Production in Netlify, then **Trigger deploy** (the flag is inlined at build time).
7. Roll back by removing the flag and redeploying. Data stays; customer signing keeps working as before.
