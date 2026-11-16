# Security review: V4.3 / V4.4

| Area | Control |
|---|---|
| Authorization | Every write goes through a SECURITY DEFINER function that checks `estimate_readable` plus the specific company permission (`create_change_orders`, `send_change_orders`, `edit_project_costs`, `view_subcontractor_costs`, `share_subcontractor_scopes`, `manage_proposal_templates`, `change_proposal_policy`, …). Tables are read-only to `authenticated` via RLS. |
| Owner-only policy | `change_proposal_policy` is in OWNER_ONLY_PERMISSIONS (app and SQL); the save function checks style and policy changes separately. |
| Subcontractor costs | `sub_quotes_for_estimate` returns `canView=false` and no quotes without cost permission; quotes never appear in proposals, shares or customer pages. |
| Change orders | Content hash computed in the database; versions and signatures are write-once (triggers); `internal_notes` excluded from the column grant and from sent content. Public signing uses hashed one-time tokens, 30-day expiry, same consent flow as proposals. |
| Scope sharing | Only selected fields are frozen into a share version; internal notes and costs are not shareable by construction (`shareContent`). Tokens are hashed; links expire and can be revoked; `/scope/` is noindex and excluded from analytics/robots. |
| Photos | Content sniffing, re-encode, metadata stripped, private bucket, signed URLs, per-request limits, rate limits. AI opt-in only (see PHOTOS.md). |
| Style | Resolver only touches presentation keys; a test asserts totals are identical before and after styling. Generated versions freeze the style stamp. |
| Invite inheritance | Runs with the service role only after `accept_company_invitation` succeeds; fills blanks only; never copies the owner's email. |
| CSRF / abuse | `sameOrigin` + per-route rate limits on every mutating route. |
