# V8.6 — Generate My Price Library

AI-assisted setup for the existing **Saved Items & Pricing Library**. A contractor types "Concrete" (or a full scope),
gets a draft catalog grouped by category, enters or confirms their own costs, resolves duplicates, and explicitly
approves what becomes a Saved Item or Saved Stack. No generated item or cost is permanent until approved.

## 1. Existing-system audit (what this builds on)

| Area | Where | How V8.6 uses it |
|---|---|---|
| Saved Items & Pricing Library page | `src/app/(app)/dashboard/items/page.tsx`, `components/library/library-manager.tsx` | New "Generate My Price Library" card at the top; list unchanged |
| Saved Items table | `public.saved_items` (own rows, RLS); free cap 250 via trigger (`20270106001000`) | Approval inserts here; cap still enforced |
| Saved Stacks + scaling | `public.assemblies` / `assembly_items` (`qty_per`, `waste_pct`, `round_up`), `lib/library/assemblies.ts` | Approved stacks are normal scaling assemblies; same engine (`scaleStack`) |
| Starter assemblies | `STARTER_ASSEMBLIES` (5 trades, ratios, no prices) | Untouched; generated stacks follow the same "starting ratios, no prices" rule |
| Supplier price import | `price_imports`, `price_records`, `price_import_apply` (`20261127001000`) | Supplier prices on Saved Items are cost source #2; `price_records` keeps audit history for approved updates |
| Target margin | `business_profiles.target_margin_pct` | Unchanged; approved items carry cost only, never selling price |
| Estimate Builder | `components/builder/saved-items.tsx`, `lineFromSaved()` copies values | Approved items appear in Suggested & Saved Items immediately (same table) |
| AI generation | `lib/ai/provider.ts` (Haiku 5.5, structured output, `AiUnavailableError`), `lib/ai-draft/*` | Same provider and model; dedicated schema; daily limit + monthly budget now shared via `lib/ai/budget.ts` |
| Trade registry | `lib/trades/catalog.ts` (40 trades, sections) | Allowed trade slugs + section names sent to the model; unknown trades dropped |
| Company pricing permission | `has_company_permission(.., 'manage_company_pricing')` | Required to save a generated stack as a company template |
| Demo isolation | Demo/practice sessions are separate auth users | All draft tables are own-rows-only, so demo drafts never touch real libraries |
| RLS | Own-row policies everywhere | Same pattern; approval through a `security definer` function that checks `auth.uid()` |

Not built (by design): no new Cost Library / Pricing Data page, no independent price database, no external price feed.
No licensed pricing source is connected, so cost source #4 is skipped.

## 2. Architecture

```
Step 1 /dashboard/items/generate            GeneratorStart  ──POST /api/library/drafts──▶ Haiku (1 call / batch)
Step 2 progress, cancel, retry                                      │ sanitizeLibrary (allowlist, no prices)
                                                                    │ findDuplicate + historySuggestion (plain code)
                                                                    ▼
                                                     library_drafts / library_draft_items / library_draft_stacks
Steps 3-6 /dashboard/items/generate/[id]   DraftReview ──PATCH /api/library/drafts/[id] (edits, autosave)
                                                       ──POST  op=preview  (counts, conflicts, price changes)
                                                       ──POST  op=approve ─▶ rpc library_draft_approve (1 transaction)
                                                                             ─▶ saved_items / assemblies / price_records
Step 7 "Saved to your library" → Saved Items page and the builder's Suggested & Saved Items
```

* `src/lib/library-generator/model.ts` — types, validation schemas, duplicate rules, cost sourcing, approval preview, stack checks (pure, tested).
* `src/lib/library-generator/generate.ts` — prompt, structured schema, sanitizer, one Haiku call.
* `src/lib/library-generator/server.ts` — row mapping, loading Saved Items / history / bid outline.
* `src/app/api/library/drafts/route.ts` — list + generate. `.../[id]/route.ts` — detail, edits, preview, approve.
* `src/components/library/generator/*` — entry card, Step 1, review, stacks, approval dialog, step bar.
* `supabase/migrations/20270115001000_library_generator.sql` — tables, RLS, guards, approval function.

## 3. Structured generation schema

The model returns only (see `generate.ts`):

```
categories[]: { name, items[]: { name, description, trade (allowed slug), item_type (material|labor|labor_material|equipment|subcontractor|permit|delivery|other),
                                  unit (Built2Bid UNITS enum), notes, conditions[], optional, confidence (low|medium|high), verify } }
stacks[]:     { name, trade, base_unit (square|square foot|square yard|linear foot|cubic yard|each), base_label, calculator (area|roof|""),
                assumptions[], components[]: { item_name, per, fixed_quantity, waste_pct, round_up, optional, formula_note } }
notes[]
```

There is **no price field**. The server also drops any entry whose text contains a dollar amount, caps sizes
(45 items / 4 stacks per batch), removes duplicates inside the batch and against the "already have" list, maps
unknown trades to the chosen trade, and keeps stack rows only when they point to a real item. The contractor's text
is wrapped in `<request>` tags and the system prompt says it is data, never instructions. Output can't call tools,
change settings or write anywhere except draft rows owned by the signed-in user.

## 4. Draft staging and approval

* Statuses: Generating, Draft, Under Review, Partially Approved, Approved, Archived, Failed (`library_drafts.status`).
* Candidates live in `library_draft_items` and never appear in the builder's catalog (it reads `saved_items` only).
* Drafts survive refreshes and sign-outs (database rows). A draft left "generating" for 2 minutes (closed tab, timeout) can be generated again.
* Review: search, category groups, Select All / Deselect All, per-category select, inline name/unit/cost/type/category/SKU/notes edits (autosave), remove/restore, duplicate choice, Save Draft, Approve Selected, Approve All Ready Items, Approve category.
* A trigger refuses any attempt to mark a candidate approved (or link it to a saved item) outside `library_draft_approve`.
* `library_draft_approve(p)`:
  * locks the draft, replays the stored result for a repeated `requestKey` (double-click / retry → no double insert), and only touches candidates still in `candidate` status;
  * refuses the whole call when a selected item is a possible duplicate without a choice;
  * saves priced items; unpriced items stay in the draft unless the contractor ticks **Unpriced Templates** (saved with no cost, shown as "Cost not set");
  * duplicate choices: keep existing (no write), add separate, update existing (needs a price; old price kept in `price_records`), fill in missing details (never replaces a price);
  * stacks only when listed explicitly; Unlimited required; company template only with `manage_company_pricing`;
  * everything in one transaction, so a failure (free plan stack, item cap, bad row) rolls back all of it.
* Before confirming, the dialog shows new, matched, updated, filled-in, awaiting price, skipped, stacks, conflicts and each saved price that would change.

## 5. Pricing verification design

Order (`initialCost`, `historySuggestion`):
1. The contractor's own approved Saved Item (exact match by normalized name + unit + trade, or same supplier SKU) — prefilled, labelled "From your Saved Items".
2. Their supplier price list (Saved Items with `price_source = supplier_import`) — prefilled, labelled with the supplier and date.
3. Their own past estimate costs — **suggestion only** ("Use $165.00 / CY · Median of 3 of your estimates, last Oct 2026"). Same normalized name, same unit, labor vs material compatible, same trade, last 18 months, median of up to 5. Applied only when the contractor taps it.
4. Licensed pricing source — none connected; skipped.
5. Unknown — blank, "Cost not set".

Changing an item's unit clears a cost that came from a saved item or history (it was for the old unit). No material rate,
labor rate, tax, overhead or selling price is ever generated. No external supplier subscription is required.

## 6. Saved Stack integration

Generated stacks become ordinary scaling assemblies: base measure (`scale_unit`/`scale_label`/`scale_calc`), per-unit amounts,
waste %, round up, fixed rows. Each stack shows its assumptions ("4 in thick", "5% waste") and plain warnings: same-unit
rows that aren't 1 per unit, concrete thickness implied by CY per SF (e.g. 0.012346 CY/SF ≈ 4.0 in), very high waste.
Ratios are editable before saving. A stack is saved only through its own confirmation, never by approving its items.

## 7. Estimate Builder integration

Approved items are rows in `saved_items`, so they appear in **Suggested & Saved Items** right away. Adding one copies its
values into the estimate (`lineFromSaved`); nothing links back, so a later library price change never alters an existing
estimate or issued proposal. Save Item, Save Stack, trade calculators, Generate Scope and target margins are unchanged.

## 8. Security

Own-row RLS on all draft tables (with a draft-ownership check on insert), approval function checks `auth.uid()` and
ownership, plan rules re-checked in SQL, company template permission re-checked in SQL, same-origin + rate limit (5/min)
+ daily AI limit + monthly AI budget on generation, bid outline reads only section names, scope text and item names
(no prices, customer, address or title) and only for bids RLS lets the user read. Prompts and outputs are not logged;
`ai_generations` stores counts, tokens and cost only. No cross-company retrieval and no training use.

## 9. AI operating cost (Haiku 5.5: $0.10 / M input, $0.50 / M output)

| Call | Input tokens | Output tokens | Cost |
|---|---|---|---|
| First catalog (25–40 items + up to 3 stacks) | ~2,500 | ~5,000–7,000 | ~$0.003–0.004 |
| Add labor / equipment / more in a category | ~2,500 | ~1,500–3,500 | ~$0.001–0.002 |
| Typical full setup (catalog + 4 add-ons) | | | **~$0.01 per contractor** |

1,000 contractors setting up in a month ≈ $10. Repeating the same new request within 24 hours reuses the saved draft
(no new call). Duplicate checks, cost sourcing, previews and approvals are plain code (no model calls). Generations count
toward the existing per-user daily limit (`AI_DAILY_LIMIT_PER_USER`, default 40) and the shared monthly budget
(`AI_MONTHLY_BUDGET_USD`, default $25), and show in the admin AI cost report as `library_generate`.

## 10. Deployment checklist

1. Run `supabase/migrations/20270115001000_library_generator.sql` in the Supabase SQL Editor (safe to run twice).
2. Merge the PR (Netlify deploys `main`). No new environment variables; uses the existing `ANTHROPIC_API_KEY` and `AI_MODEL` (Haiku by default).
3. Until the SQL runs, the generator card stays hidden and everything else works as before.
4. Smoke test on built2bid.org: Saved Items → Generate My Price Library → "Concrete" → enter one cost → Approve All Ready Items → open a bid → Suggested & Saved Items shows the item.
5. Rollback: `docs/library-generator/rollback_20270115001000.sql` (approved Saved Items and Stacks stay).
