# E-signature operating cost estimate

In-house on existing Supabase + Netlify. No per-document provider. Assumptions per signing request: one write-once proposal PDF copy (~100 KB), one signed PDF (~120 KB) when signed, database rows incl. a drawn-signature PNG (~25 KB), ~3 signing-page loads (~0.4 MB each incl. inlined logo), ~3 PDF downloads (~0.15 MB), ~8 server function invocations (create, page loads, accept + render, downloads). Rates: Supabase Pro includes 8 GB disk, 100 GB storage, 250 GB egress; overage about $0.125/GB disk, $0.021/GB storage, $0.09/GB egress. Netlify function limits depend on the current plan; check Netlify usage before high volume. Prices are estimates; verify current plan pages.

| Requests / month | New storage / month | New DB / month | Egress / month | Function invocations | Incremental monthly cost |
|---|---|---|---|---|---|
| 100 | ~22 MB | ~2.5 MB | ~0.2 GB | ~800 | $0 |
| 1,000 | ~0.2 GB | ~25 MB | ~1.7 GB | ~8,000 | $0 |
| 5,000 | ~1.1 GB | ~125 MB | ~8 GB | ~40,000 | $0 |
| 10,000 | ~2.2 GB | ~250 MB | ~17 GB | ~80,000 | $0 to ~$5 |
| 25,000 | ~5.5 GB | ~0.6 GB | ~42 GB | ~200,000 | ~$5 to ~$25 (functions; DB disk after ~12 months) |

Notes
- Storage and DB grow cumulatively: at 25,000/month, storage reaches ~66 GB and DB ~7.5 GB after a year, still inside Pro's included 100 GB / 8 GB, then pennies per GB.
- PDF rendering (1 to 3 s per signature) is the main compute. At 10,000+ signatures/month, watch Netlify function usage; this is the first allowance likely to matter.
- Optional email verification codes: $0 today (not built). If added via Resend: free up to 3,000/month, then about $20/month.
- Backups: included in Supabase Pro daily backups; point-in-time recovery is a paid add-on.
- Maintenance: no vendor contract; expect occasional engineering time for consent wording updates and PDF/template changes.
- For comparison, per-envelope e-signature APIs typically cost on the order of $1 to $3 per envelope (or plan minimums), i.e. $100 to $75,000/month across this range.
