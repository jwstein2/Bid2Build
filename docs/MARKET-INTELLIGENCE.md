# Market Pricing Intelligence

Admin-only analytics built from finalized proposals of contractors who opted in. Lives at `/admin/market`.

## Data flow
```
Builder (optional "Project details": sector, work type, project type, trade measurements, bid outcome)
  -> estimate_project_profiles (RLS, per user; excluded from the version hash)
Export/finalize -> record_export() creates the immutable version
  -> captureObservation() (best effort, never blocks the PDF)
     buildObservation(): de-identified payload, classified + unit-normalized lines
  -> market_capture(): checks flag + consent, one row per version, strips costs without cost consent,
     marks only the newest version of each estimate as is_latest
Admin dashboard -> market_report(view, filters) (SECURITY DEFINER, is_admin, suppression, audit)
Recompute (Settings or pg_cron) -> retention purge, anomaly detection, monthly segment_stats
```

## Privacy and competition safeguards
- **Consent** (`public.market_consent`, Settings > Account): all off by default. Three separate opt-ins: customer prices, internal costs/margins, future commercial reports. Turning prices off deletes the contributor's observations; turning costs off strips costs and margins. History in `market.consent_events`.
- **Separation**: schema `market` is not exposed by the API and has no grants to `anon`/`authenticated`. Contributors are random keys. No customer or business names, contact details, addresses, notes, descriptions, estimate numbers or proposal text are stored. Item and group names are scrubbed of emails/phones/addresses; group names are shown only when 20+ businesses use the same one.
- **Suppression**: every statistic needs `min_contributors` (default and DB-enforced floor: 20) distinct businesses; repeated bids from one business count once. ZIP rows are listed only above the ZIP threshold. Suppression is applied in SQL, not just hidden in the UI.
- **Anomalies** are internal data-quality signals. They show a pseudonymous business ref, never an identity, and the UI states that an outlier is not a wrong or unfair price.
- **Not built (deliberately)**: contractor-facing comparisons, price recommendations, supplier catalogs, alerts, external reports. Flag `market_external_products` stays off until legal review.
- **Retention**: real observations older than `retention_months` (default 120) are purged on recompute. Deleting an estimate or account cascades.

## Classification
`src/lib/market/classify.ts`: deterministic rules for component, material, brand, product line, specs, cost class, with a confidence score. The comparison key only gets more specific with evidence, so "Trex decking", "Trex Enhance Basics 1x6" and "composite deck board" are never pooled. Items under 0.75 confidence are excluded from material comparisons and queued in **Classifications**, where admins correct, merge or split; corrections apply to past and future observations with the same text. AI-assisted suggestions are not enabled yet (the review queue is the hook for them).

## Units and trade models
- `units.ts`: canonical units per family; area/length/volume/weight convert to a base (squares and SY to SF, CF to CY). Days, weeks, packages and lump sums are never converted.
- `trade-models.ts`: measurement fields, project types, the standardized project unit and a complexity rule for 21 trades (decks, roofing, kitchens, bathrooms, siding, concrete, painting, flooring, tile, fencing, windows/doors, HVAC, electrical, plumbing, drywall, gutters, insulation, paving, basements, additions, garages, landscaping). Price per unit is reported only for single-trade projects with a measured size, split by project type and complexity.

## Anomaly engine (`market.detect_anomalies`)
Peers = same comparison key + normalized unit + cost class (state peers when the state has enough, else national), within `peer_window_months`, high-confidence lines only. Robust z = 0.6745 (x - median) / MAD, MAD floored at 5% of the median; IQR fences when MAD is zero. Ratios near 9, 12, 27, 100 or 144 are labeled suspected unit mix-ups. Also: price per project unit by trade/type/complexity, margins (per-business medians as peers, plus negative or above `margin_high_pct`), suspected duplicates, and cost class contradicting the description. Admin decisions: genuine premium, complex scope, data entry error, unit conversion error, insufficient data, needs investigation. The two error decisions exclude the row from statistics.

## Synthetic demo data
Settings > "Load synthetic data" creates ~840 bids from 120 fictional businesses (`synthetic.ts`, seeded). Stored with `is_synthetic`, shown only when the Synthetic dataset is selected, bannered on every page, never mixed with real data, removable in one click.

## Operations
- Apply `supabase/migrations/20261112000900_market_intelligence.sql` (non-destructive: new tables/functions only).
- Optional nightly recompute with pg_cron (snippet at the end of the migration).
- Tests: `tests/market.test.ts` (classification, units, capture, filters) and `tests/db/market.test.ts` (capture/duplicates, isolation, admin auth, suppression, stats, anomalies, consent and deletion, synthetic separation).
