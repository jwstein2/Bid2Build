# E-signatures: items for attorney review before public release

This is an engineering summary, not legal advice. Built2Bid does not guarantee enforceability in every state.

## What the system does today (relevant to ESIGN 15 U.S.C. 7001 and UETA)
- **Intent to sign:** typed name or drawn mark, plus a final "Accept & Sign Proposal" action.
- **Consent to electronic records:** separate unchecked box with a consumer disclosure (paper copy on request, how to withdraw consent before signing, hardware/software needed, how to get a copy). Version `esign-consent-2026-11-15` is stored with every signature.
- **Association with the record:** signature tied to one frozen version and the SHA-256 of the exact PDF reviewed; certificate page embedded in the signed PDF.
- **Record retention / ability to retain:** the customer can download the reviewed PDF and the signed copy from the link; the contractor can download the signed PDF and a JSON audit record.
- **Attribution:** only possession of the private link is checked. We record name, email, IP, browser, and times, and we say plainly that identity was **not** verified.

## Questions for counsel
1. Is the consent disclosure wording sufficient under ESIGN 7001(c) for consumers (homeowners), including the "demonstrate ability to access" requirement? Should we add a step where the signer opens the PDF before consenting?
2. **Home improvement / home solicitation contract rules by state** (e.g. required contract contents, contractor license number display, mandatory notices): Built2Bid proposals may not contain all required terms. Should signing be labeled "proposal acceptance" rather than "contract", and should contractors be warned that state-required contract terms are their responsibility?
3. **Three-day right to cancel** (FTC Cooling-Off Rule, 16 CFR 429, and state equivalents) for contracts signed at the buyer's home or away from the seller's place of business: is a cancellation notice needed, and in what form for remote e-signing?
4. Certain notices may require paper or specific delivery (e.g. some lien-law / preliminary notices, cancellation notices). Confirm none are being delivered through this flow.
5. Is link possession + email adequate attribution for typical contract values, or should email one-time-code verification be required above a threshold? (Evaluated, not built: it would need Resend sends, roughly 3,000 free/month then about $20/month; no paid SMS.)
6. Retention period for signature records and IP addresses; privacy policy and Terms updates to describe signing data, who controls it (contractor vs Built2Bid), and deletion when a contractor deletes their account (records are currently deleted with the account).
7. Contractor countersignature: today only the customer signs; the contractor's side of the acceptance line stays blank. Is that acceptable or should the contractor sign before sending?
8. Terms of Service: allocate responsibility to contractors for contract content and lawful use of e-signatures.

## Security items for a second review
- Rate limits are per server instance (in-memory); a shared store would harden accept/create endpoints at scale.
- Drawn signature PNGs are stored in the database row (bounded to 400 KB data URL).
- Signing tokens appear in URLs by design; mitigated with no-referrer, no-store, noindex, revocation and expiry.
