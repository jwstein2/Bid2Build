# Contextual feature walkthrough (V5.2)

"Feature walkthrough" now teaches **the page and view on screen, right there**. It never changes the
route, the view, filters, search text, form input or scroll position, and it never clicks, saves, sends
or charges anything.

## 1. Audit: what the old walkthrough did

| Behavior (before) | Where | Effect |
| --- | --- | --- |
| Starting the tour away from `/dashboard` stored a pending tour in `sessionStorage` and called `router.push("/dashboard")` | `feature-host.tsx` | Clicking "Feature walkthrough" on Customers, Projects, Settings or the builder threw you onto the Bids page |
| Steps came from the feature registry (one list for the whole product), each with its own `route` | `registry.ts` → `tourSteps()` | The tour talked about features on other pages and had nothing to say about the page you were on |
| Steps "revealed" a feature by switching the Bids view (`pick()`), which also rewrote the URL | `bids-workspace.tsx` | Your Table view became Pipeline (or Analytics) and stayed that way |
| "Open feature" on a step called `router.push(step.route)` | `feature-tour.tsx` | One click and you left the page mid-walkthrough |
| "Try it" clicked the real control | `feature-tour.tsx` | Could open menus or dialogs, or start actions, while the tour was still up |

**Root cause:** the walkthrough was built as a *product tour* (one fixed list of features, each with a
home page) and then re-used as the per-page help. Anything not on the current page had to be reached by
navigating or switching views, which is exactly what V5.2 forbids.

## 2. Architecture

- **Registry** `src/lib/features/page-guides.ts` (pure data + functions, no React, no AI).
  - `PAGE_GUIDES[pageKey] = { route, label, requires?, steps[] }`
  - Each step: `target` (one id or several, the first visible wins), `title`, `body`, `hint?`,
    `requires?` (signedIn, unlimited, pmView, pmEdit, permission, owner, company, admin), `locked?`
    (copy shown instead when the requirement isn't met, e.g. "included with Unlimited"), `feature?`
    (dropped while that feature is unreleased), `reveal?` (opens local UI temporarily).
  - Order = array order. `resolveGuide(page, ctx, trade)` filters, fills trade placeholders and returns
    ready-to-show steps.
- **Page marker** `data-guide-page="<page key>"` on the page wrapper. The innermost visible marker wins;
  one inside an open dialog wins over the page behind it. Pages with views (Bids, Projects, customer
  tabs, builder steps) set the key from the *current* view, so the view on screen decides the tutorial.
- **Targets** `data-guide="<id>"` on real controls. Ids are semantic (`bids.search`,
  `builder.saved-items`), never CSS selectors or DOM positions. A unit test fails if a registry target
  doesn't exist literally in the app source.
- **Trade** `data-guide-trade="<slugs>"` on bid/project screens. `pickTrade(screen, account)` prefers the
  trades on screen, then the account's most common trades from its last 25 estimates.
- **Context** `GET /api/features?guide=1` adds `{ admin, pm: { view, edit }, company: { role, owner,
  permissions }, trades }` to the existing features payload. No new tables; no SQL.
- **Host** `FeatureHost` listens for the start event. No ids → page guide for `activePage()`. Feature
  ids → announcement walkthrough (What's New / "Your New Features Are Ready"), still on the current
  page. Mounted in the app layout, and with `auto={false}` in the estimate builder and the owner command
  center.
- **Tour** `FeatureTour` renders the spotlight + card. A transparent shield absorbs clicks on the page
  so nothing can be triggered by accident. Scroll positions of every scrolled container and focus are
  restored on close.
- **Completion** is remembered in `auth.user_metadata.b2b_features.guides` (list of page keys). It only
  stops nothing: every walkthrough can be replayed any time.

## 3. Route / view definitions

| Page key | Route / view | Steps (targets, in order) |
| --- | --- | --- |
| dashboard.pipeline | /dashboard?view=pipeline | bids.alerts, bids.view-tabs, bids.kpis, bids.search, bids.stage, bids.card, bids.card-menu, bids.new-bid, bids.help |
| dashboard.table | /dashboard?view=table | bids.view-tabs, bids.table-search, bids.table-filters, bids.row, bids.open, bids.row-actions, bids.new-bid |
| dashboard.analytics | /dashboard?view=analytics | bids.view-tabs, bids.search, bids.analytics-kpis, bids.sales-pay, bids.new-bid |
| builder.company | /estimates/[id] · Company | builder.steps, company.business, company.branding, builder.save |
| builder.project | /estimates/[id] · Customer & project | builder.steps, builder.customer, builder.project-details, builder.trades |
| builder.estimate | /estimates/[id] · Estimate | builder.section, builder.calculator, builder.saved-items, builder.item-details, builder.add-trade, builder.pricing, builder.customer-view |
| builder.scope | /estimates/[id] · Scope & exclusions | builder.scope, builder.exclusions |
| builder.proposal | /estimates/[id] · Proposal | builder.signing, builder.payment-schedule, builder.preview, builder.send, builder.internal-report |
| customers.directory | /dashboard/customers | customers.tabs, customers.metrics, customers.controls, customers.row, customers.new |
| customers.detail.overview | /dashboard/customers/[id] | customer.tabs, customer.contact, customer.next, customer.activity-summary, customer.comms, customer.new-bid |
| customers.detail.bids / .projects / .activity | customer tabs | customer.tabs + that tab's list |
| customers.communications | /dashboard/customers/communications | customers.tabs, customers.comms-center |
| projects.overview / .calendar / .timeline / .workload / .mywork | /projects?view=… | projects.views + that view's controls |
| projects.list | /projects (no PM add-on) | projects.schedules, projects.ready |
| project.detail | /projects/[id] | project.summary, project.tabs, project.schedule (editor or viewer copy), project.updates |
| projects.schedule-now | Schedule Now wizard | schedule.steps, schedule.step, schedule.calendar / schedule.calendar-toggle |
| projects.team | /projects/team | team.directory, team.add |
| library.items / library.templates | /dashboard/items, /dashboard/templates | items.search, items.add, items.locked / templates.editor |
| settings.company / .billing / .account / .pricing | /settings/… | company profile, plan, credits, manage, upgrade, PM add-on, sign-in, sharing, account actions, pricing data |
| company.overview / .pipeline / .users / .proposal-style / .billing | /company/… (Enterprise) | KPIs, stages, team, approval rule, filters, members, invite, teams, style editor, policy, licenses, seats, portal |
| whats-new | /whats-new | whats-new.releases, whats-new.tour |
| admin | /admin/* (platform owner only) | admin.nav, admin.tools, admin.test-data, admin.exit |

**Financials** (Financial Command Center, merged to `main` behind `NEXT_PUBLIC_FINANCIALS`, off in
production, so these guides can only start once it's turned on):

| Page key | Route / view | Steps (targets, in order) |
| --- | --- | --- |
| financials.home | /financials | fin.kpis, fin.attention, fin.alerts, fin.quick, fin.cards, fin.reports, fin.mode, fin.customize, fin.tools, fin.config |
| financials.records | /financials/records | fin.record-tabs, fin.won-bids, fin.records-list |
| financials.tools | /financials/tools | fin.tool-groups |
| financials.job | job not opened yet | fin.open-job |
| financials.job.billing / .costs / .review | job tabs (also the project's Financials tab) | fin.job-tabs, then contract, milestones, invoices, payments / cost actions, budget, profit, cost lists / review queue |
| company.business-config | /company/business-config | fin.trade-config, fin.config-preview |
| company.ai-automation | /company/ai-automation | fin.ai-toggles |

Financial roles are handled by the screens themselves (they hide what a role can't use) plus the
walkthrough's rule of skipping steps whose control isn't on screen: a view-only seat gets 7 home steps
(no quick actions, trade setup or Accountant Mode), an owner gets 10. Job tips use the job's own trades.

## 4. Trade-adaptive copy (one engine, deterministic)

Copy uses placeholders `{trade} {job} {materials} {labor} {item} {sub} {recurring} {phases}` filled
from `TRADE_VOCAB` for ten trade families (decks, electrical, service, landscaping, exterior, concrete,
remodel, finishes, washing, general). Every catalog trade maps to a family (tested).

Same step ("Estimate sections" + Scope tip), different trades:

| Trade | Copy |
| --- | --- |
| Decks | Sections group the work, such as footings, framing, decking and railing. · For a 16×20 composite deck, list each phase… |
| Electrical | …such as permit, rough-in, inspection and trim-out. · For a 200 A panel upgrade… |
| Landscaping | …such as grading, hardscape, planting and cleanup. · For a patio and planting install… |
| Roofing/siding | …such as tear-off, dry-in, install and cleanup. · For a full roof replacement… |
| Washing | …such as setup, pre-treat, wash and rinse. · For a house wash and driveway clean… |
| General | …such as site prep, framing, rough-ins and finish. · For a garage addition… |

A deck bid opened by an electrician gets deck copy: the trade on screen wins.

## 5. Permission and entitlement filtering

- **Free vs Unlimited:** premium controls (Saved Items, etc.) get "included with Unlimited" copy instead
  of how-to steps.
- **PM add-on:** viewers see "You can view it; a schedule editor makes changes"; editors see how to drag
  and publish. Schedule Now needs edit access.
- **Enterprise:** company screens follow the member's permissions (`manage_users`, `manage_teams`,
  `manage_billing`, `view_analytics`, `change_proposal_policy`, `view_communications`); owner-only steps
  like "Approval rule" are hidden from managers. Solo accounts own their own data and see everything
  that applies to them.
- **Platform owner:** the command center guide is for admins only.
- **Unreleased features** are never shown.
- Steps whose control isn't on screen (e.g. no alerts, empty list) are skipped and not counted;
  in development a missing target is logged (`window.__b2bGuideMissing` + console warning).

## 6. Hidden controls

Prefer the visible parent (e.g. sub quotes are explained on the visible ▸ item-details toggle). Where
local UI must open (phone menu for library items, a Bids view panel for a feature announcement), the
owner opens it temporarily and puts it back when the step changes or the tour ends, unless the person
changed it themselves.

## 7. Mobile, tablet, themes, motion

- Phones: the card docks to the top or bottom, whichever side has more room; tall targets scroll to the
  top so both fit. Safe-area insets respected; no horizontal overflow (checked on every step).
- The phone menu closes when the walkthrough starts so the page is visible.
- Touch targets are 44 px on phones; keyboard: ←/→ Back/Next, Esc closes; focus returns to where it was.
- Light, Dark and Black use theme tokens; reduced motion = instant scroll, no transitions.
- "Show me how this page works" sits in the builder header, the owner command center, and in the Bids
  help (?) popover.

## 8. Test evidence

- `tests/page-guides.test.ts`: 93 unit tests (targets exist, copy complete, semantic ids, view decides
  tutorial, no Financials, trade coverage, placeholders filled for every family, trade precedence,
  permission filtering, completion state, and a source guard: no router pushes or programmatic clicks
  in the walkthrough code).
- `scripts/features/page-guide-walk.mjs`: Playwright walk against the mock backend, **501/501 checks**
  (plus `WALK_FINANCIALS=1` against the real `fin_*` SQL on a throwaway local database: **274/274**, owner,
  project manager and view-only seats, desktop / tablet Black / phone Dark)
  across desktop (1440×1000), tablet (iPad Mini) and phone (iPhone 13) in Light, Dark and Black. Every
  step checks: spotlight on the real control, card in view and covering < 35% of the target, no
  horizontal overflow, URL unchanged. Each run checks: no writes besides the completion record, typed
  search text / date range / scroll position preserved, Back/Next/Skip/Close/Escape, the shield blocks
  clicks, missing targets dropped, phone menu closed.
  Run: `node scripts/features/page-guide-walk.mjs <screenshot dir>` with the mock (`MOCK_PIPELINE=1
  MOCK_ADMIN=1 node scripts/ux-audit/mock-supabase.mjs`) and `next start` running.
