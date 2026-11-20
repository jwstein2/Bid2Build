# Built2Bid legal document inventory (for outside counsel)

Prepared 2026-11-20 with the Legal Documentation Status Update V1. Built2Bid LLC (built2bid.org).

Every document below is the **current published version** and shows **"Current Published Version — Legal
Review Pending"** on the site. None has been reviewed by counsel yet; nothing in the code marks any document
as reviewed. The status of each document is recorded by the platform owner at **/admin/legal** once counsel
actually starts or finishes a review.

Source of truth for this list: `src/lib/legal/registry.ts`. Fuller background (verbatim live text, how each
rule works in the software, questions for counsel) is in the 2026-11-19 legal review package
(`Built2Bid-legal-review-2026-11-19.zip` in the project files).

## Published documents

| # | Document | Where | Version | Effective date | Last revised | Risk | Outstanding issues for counsel |
|---|---|---|---|---|---|---|---|
| 1 | Terms of Service | /terms | November 19, 2026 | Not stated | 2026-11-19 | High | L1, L2, L3, L5, L8 |
| 2 | Privacy Policy | /privacy | November 19, 2026 | Not stated | 2026-11-19 | High | L1, L2; marketing-email consent wording vs. lifecycle emails (package 01/03) |
| 3 | Cookie Policy | /cookies | November 19, 2026 | Not stated | 2026-11-19 | Medium | L1; Meta pixel consent is stored in the browser only |
| 4 | Referral Program Terms | /referral-terms | November 19, 2026 | Not stated | 2026-11-19 | Medium | L1; 12-reward cap disclosure |
| 5 | Free Trial, Pass and Gift Terms | /trial-terms | November 19, 2026 | Not stated | 2026-11-19 | Medium | L1 |
| 6 | Academy Terms and Community Rules | /academy-terms | November 19, 2026 | Not stated | 2026-11-19 | Medium | L1; DMCA process |
| 7 | Electronic Signature Disclosure | /esign-disclosure | November 19, 2026 | Not stated | 2026-11-19 | High | E-signatures live since 2026-11-15 before review (package 02) |
| 8 | Security Overview | /security | November 18, 2026 | Not stated | 2026-11-18 | Low | Informational only |

## In-product agreements and consents

| # | Item | Where it appears | Version | Acceptance record | Risk | Outstanding issues |
|---|---|---|---|---|---|---|
| 9 | Sign-up / sign-in agreement statement | Sign-in dialog | Unversioned | None per user | High | L2 |
| 10 | Customer Email Terms | Customers → Communications | 1 | Time, user, version per company | Medium | Sender responsibility, CAN-SPAM/CASL allocation |
| 11 | Sales Representative Compensation Program ("How you get paid") | Sales Portal (reps only) | V3 milestones; policy version stored per award | None | High | L6; randomized bonus is OFF |
| 12 | Creator Partner Program Terms | Creator workspace → Learning | creator-pilot-v1 | Time and version per program | Medium | FTC endorsement disclosure |

## Drafts that are NOT published (not on the site, no status badge)

Drafted 2026-11-19 for counsel, in the review package folder `11-draft-documents/`: Data Processing Addendum,
Subprocessor List, Sales Representative Agreement, Commission Plan, Team Subscription Terms. They need counsel
review before anything is published or signed.

## Excluded (historical or executed records, not changed)

* Signed proposals, signature evidence, signed PDFs and their audit events (e-signature records).
* Acceptance records: customer email terms acceptances, creator program confirmations, market-data consents,
  sales compensation award snapshots and policy versions, Academy rule acceptances.
* Contractors' own proposal terms (written by each contractor, not Built2Bid's documents).
* Earlier versions of the Terms and Privacy Policy (listed as version history on /legal; text in git history).

## Legal-review findings (flagged, not changed)

These came up while adding the status notice. Nothing below was changed in the documents.

* **L1. No effective dates.** Every document shows "Last updated" but none states an effective date. The status
  system records "Not stated" rather than inventing one.
* **L2. Sign-up acceptance isn't recorded.** "By continuing you agree to the Terms and Privacy Policy" sits under
  the sign-in button; no per-user record of the time or version accepted is stored. Counsel: is a recorded
  clickwrap (checkbox or stored acceptance + version) needed, and should existing users be asked to accept?
* **L3. Automatic renewal disclosure at checkout.** Renewal terms are in Terms §3 and the billing page, but the
  plan cards and checkout buttons on /pricing don't state the renewal terms next to the button. Check against
  Minnesota's automatic-renewal law (effective January 1, 2025) and California's.
* **L4. Market-data consent version label.** Consents are recorded with policy version `2026-11-draft`. The
  label was left as is because changing it would change what existing consent records point to.
* **L5. Renewal reminder promise.** Terms §3 promises an email at least 7 days before any renewal (monthly
  included). Confirm the Stripe settings actually send monthly reminders.
* **L6. Sales agreement referenced but not signed.** "How you get paid" says "Your written sales agreement has
  the details"; the agreement is still a draft (no reps are active and no commissions have been paid).
* **L7. Public downloads.** There are no downloadable legal PDFs on the site; the documents are web pages (they
  print with the status notice). The review package PDFs are for counsel only.
* **L8. Unilateral changes.** Terms §20 says continued use after 30 days' notice accepts material changes.
  Counsel: enforceability for existing paid subscribers, and when renewed consent is needed.

## Recording counsel's review

1. Open **/admin/legal** (platform owner only).
2. Set the document to **In Legal Review** when counsel starts, **Revision Required** if changes are requested
   (customers still see "review pending"), or **Reviewed by Legal Counsel** with the completion date once done.
3. Internal notes stay owner-only; customers only ever see the status and completion date.
4. When a document's text changes, update its version, dates and history in `src/lib/legal/registry.ts` and the
   page's "Last updated" date, and give the notice or consent the change requires.
