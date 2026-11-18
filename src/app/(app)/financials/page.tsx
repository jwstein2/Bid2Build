import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutGrid, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isFinBillingConfigured, isFinancialsEnabled } from "@/lib/env";
import { FinAddonCard } from "@/components/billing/fin-addon";
import { site } from "@/lib/site";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { loadFinState, loadHome, type Figure } from "@/lib/financials/loaders";
import { canUseAccountantMode } from "@/lib/financials/permissions";
import { CARDS, KPI_KEYS, QUICK_ACTIONS, QUICK_ACTION_NEEDS, type CardKey, type QuickAction } from "@/lib/financials/profiles/catalog";
import { PRESETS } from "@/lib/financials/profiles/presets";
import { KPI_LABELS, QUICK_ACTION_HINTS, QUICK_ACTION_LABELS, QUICK_ACTION_TARGET, REPORT_HREF, REPORT_LABELS } from "@/lib/financials/ui-labels";
import { formatCurrency } from "@/lib/estimate/money";
import { MetricCard } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BasisBadge } from "@/components/financials/basis";
import { AlertsPanel, type AlertRow } from "@/components/financials/alerts-panel";
import { CustomizeDashboard, ModeToggle } from "@/components/financials/customize-dashboard";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { ArrangeableCards, ArrangeableQuickActions } from "@/components/financials/home-arrange";
import { QuickActionsSection } from "@/components/financials/quick-actions-editor";
import { HomeOverview } from "@/components/financials/home-overview";
import { AccountantHome } from "@/components/financials/accounting/home";
import { ContractorNav } from "@/components/financials/accounting/contractor-nav";
import { loadAccountantMetrics, loadBank, loadLookups, loadQueue, queueTotal } from "@/lib/financials/accounting-load";
import { accountantActionsFor, QUEUE_KINDS, type QueueKind } from "@/lib/financials/accounting";

export const metadata: Metadata = { title: "Financials", robots: { index: false } };

const show = (f: Figure) => (f.money ? formatCurrency(f.value) : f.value);

/**
 * Financials home (Know Your Numbers). Driven by the trade profile + the person's role: which cards, quick
 * actions and reports appear comes from src/lib/financials/profiles; the person can customize and restore.
 * "Your cards" and the quick actions can be put in a new order by pressing and holding, then dragging.
 * Essential alerts are always shown. Every number opens the records behind it.
 */
export default async function FinancialsHome() {
  if (!isFinancialsEnabled()) notFound();
  const db = await createClient();
  const state = await loadFinState(db);
  if (state.kind !== "ready") {
    return <div className="mx-auto max-w-4xl space-y-4"><h1 className="text-3xl font-extrabold">Financials</h1><FinStateNotice state={state} /></div>;
  }
  const { ctx } = state;
  const { access, layout, profile } = ctx;
  const home = await loadHome(db, ctx);
  const perms = access.permissions;
  const canWrite = access.active && !access.readOnly;
  // Solo owners buy the add-on here (complimentary access needs no purchase).
  const soloOwner = access.kind === "solo" && access.role === "owner" && access.source !== "complimentary";
  const { data: mySub } = soloOwner
    ? await db.from("subscriptions").select("plan, status, current_period_end, fin_addon").neq("plan", "enterprise").in("status", ["active", "trialing", "past_due"]).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const essential = layout.cards.filter((c) => c.essential);
  const regular = layout.cards.filter((c) => !c.essential && c.visible);
  const { data: jobs } = await db.from("fin_jobs").select("id, estimate_id").eq("book_id", ctx.bookId);
  const jobHref = new Map(((jobs ?? []) as { id: string; estimate_id: string }[]).map((j) => [j.id, `/financials/jobs/${j.estimate_id}`] as const));
  const alerts: AlertRow[] = (home.alerts as unknown as AlertRow[]).map((a) => ({ ...a, jobHref: a.job_id ? jobHref.get(a.job_id) ?? null : null }));
  // Accountant Mode (saved per person; only offered to accounting roles, and it grants nothing): the accountant
  // numbers, review queue and accountant quick actions, from the same records as Contractor Mode.
  const accountant = layout.mode === "accountant" && perms.includes("view_company_financials");
  const acct = accountant ? await (async () => {
    const L = await loadLookups(db, ctx.bookId);
    const bank = await loadBank(db, ctx.bookId, L);
    const q = await loadQueue(db, ctx.bookId, L, bank);
    const m = await loadAccountantMetrics(db, ctx.bookId, bank, queueTotal(q));
    return { m, counts: Object.fromEntries(QUEUE_KINDS.map((k) => [k, q[k].length])) as Record<QueueKind, number> };
  })() : null;
  const quick = layout.quickActions;
  const quickLibrary = QUICK_ACTIONS.filter((q) => perms.includes(QUICK_ACTION_NEEDS[q]))
    .map((q) => ({ key: q, label: QUICK_ACTION_LABELS[q], hint: QUICK_ACTION_HINTS[q], built: Boolean(QUICK_ACTION_TARGET[q]) }));
  const slots = layout.cards.map((c) => ({ key: c.key, visible: c.visible }));
  const quickNode = (q: QuickAction) => {
    const target = QUICK_ACTION_TARGET[q];
    return target && canWrite
      ? <ButtonLink href={`/financials/records?view=jobs&do=${target}`} variant="secondary" size="sm">{QUICK_ACTION_LABELS[q]}</ButtonLink>
      : <span className="inline-flex min-h-9 items-center rounded-lg border border-dashed border-line px-3 text-sm text-muted" title="Coming in a later update">{QUICK_ACTION_LABELS[q]} · coming soon</span>;
  };
  const card = (key: CardKey, size: "md" | "sm" = "md") => {
    const f = home.cards[key];
    if (!f) return null;
    return (
      <MetricCard key={key} size={size} title={CARDS[key].title} value={show(f)} sub={f.sub ?? f.note} href={f.href} tone={f.tone} empty={f.empty}
        status={<BasisBadge basis={f.basis} />} action={f.value === "Coming soon" ? "See what's available" : "View records"} testId={`fin-card-${key}`} />
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6" data-testid="fin-home" data-preset={profile.presetKey} data-guide-page="financials.home" data-guide-trade={profile.trades.join(" ")}>
      {access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Know Your Numbers</p>
          <h1 className="text-3xl font-extrabold">Financials</h1>
          <p className="text-sm text-ink-soft">{access.name} · {PRESETS[profile.presetKey].label}{profile.trades.length > 1 ? ` + ${profile.trades.length - 1} more trade${profile.trades.length > 2 ? "s" : ""}` : ""}</p>
        </div>
        {canUseAccountantMode(perms) && <ModeToggle mode={layout.mode} />}
        {!accountant && perms.includes("view_company_financials") && <ButtonLink href="/financials/reports" variant="secondary" size="sm" data-guide="fin.reports-pl">Profit &amp; Loss</ButtonLink>}
        {!accountant && <ButtonLink href="/financials/receivables" variant="secondary" size="sm" data-guide="fin.receivables">Accounts receivable</ButtonLink>}
        {!access.sandbox && canWrite && <SandboxBar sandbox={false} canManage={perms.includes("manage_financial_config")} />}
        <ButtonLink href="/financials/tools" variant="secondary" size="sm" data-guide="fin.tools"><LayoutGrid className="h-4 w-4" aria-hidden /> All tools</ButtonLink>
        {perms.includes("manage_financial_config") && <ButtonLink href="/company/business-config" variant="ghost" size="sm" data-guide="fin.config"><Settings2 className="h-4 w-4" aria-hidden /> Trade setup</ButtonLink>}
      </header>

      {acct ? <AccountantHome m={acct.m} counts={acct.counts} actions={accountantActionsFor(perms)} /> : <ContractorNav company={perms.includes("view_company_financials")} />}

      {soloOwner && <FinAddonCard active={Boolean(mySub?.fin_addon)} periodEnd={mySub?.current_period_end ?? null} annual={mySub?.plan === "annual"} hasPlan={Boolean(mySub)} purchasable={isFinBillingConfigured()} />}
      {access.readOnly && !soloOwner && (home.jobs > 0
        ? <Notice tone="warn" title="Read-only">The Financials add-on lapsed. Everything stays readable and exportable; nothing was deleted.</Notice>
        : <Notice title="Financials isn't on your plan yet">
            <p>You can look around and set up your trades. Recording invoices, payments and costs turns on with the Financials add-on. For early access, email <a href={`mailto:${site.supportEmail}`} className="font-semibold underline">{site.supportEmail}</a>.</p>
            {/* Company Financials checkout isn't built yet (price not final): show where it will be, not a broken flow. */}
            <button type="button" disabled aria-disabled className="mt-2 inline-flex min-h-9 cursor-not-allowed items-center rounded-lg border border-dashed border-line px-3 text-sm font-semibold text-muted" data-testid="fin-company-addon-soon">
              Add Financials for your company · Coming soon
            </button>
          </Notice>)}
      {!ctx.configSaved && perms.includes("manage_financial_config") && (
        <Notice title="Tell Financials what kind of work you do">
          Your home page adapts to your trades and how you bill. <Link href="/company/business-config" className="font-semibold underline">Set up Business &amp; Trade Configuration</Link>
        </Notice>
      )}

      <section aria-labelledby="fin-kpi-h" data-guide="fin.kpis">
        <h2 id="fin-kpi-h" className="sr-only">Headline numbers</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {layout.kpis.map((k) => {
            const f = home.kpis[k];
            return <MetricCard key={k} title={KPI_LABELS[k]} value={show(f)} sub={f.sub} href={f.href} tone={f.tone} empty={f.empty} status={<BasisBadge basis={f.basis} />} hint={f.note} testId={`fin-kpi-${k}`} />;
          })}
        </div>
      </section>

      <HomeOverview bookId={ctx.bookId} company={perms.includes("view_company_financials")} />

      <section aria-labelledby="fin-essential-h" data-guide="fin.attention">
        <h2 id="fin-essential-h" className="mb-2 font-display text-lg font-extrabold">Needs attention</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{essential.map((c) => card(c.key, "sm"))}</div>
      </section>

      <AlertsPanel alerts={alerts} canAct={canWrite && (perms.includes("create_invoices") || perms.includes("manage_financial_config"))} />

      {(quick.length > 0 || ctx.quickActionsReady) && (
        <QuickActionsSection ready={ctx.quickActionsReady} selected={quick} from={layout.quickActionsFrom} cards={ctx.stored.user?.cards ?? []} kpis={layout.kpis}
          library={quickLibrary}
          row={ctx.quickActionsReady && quick.length > 1
            ? <ArrangeableQuickActions actions={quick.map((q) => ({ key: q, title: QUICK_ACTION_LABELS[q], node: quickNode(q) }))} cards={ctx.stored.user?.cards ?? []} kpis={layout.kpis} />
            : <div className="flex flex-wrap gap-2">{quick.map((q) => <span key={q} className="contents">{quickNode(q)}</span>)}</div>} />
      )}

      {regular.length > 0 && (
        <section aria-labelledby="fin-cards-h" data-guide="fin.cards">
          <h2 id="fin-cards-h" className="mb-2 font-display text-lg font-extrabold">Your cards</h2>
          {regular.length > 1
            ? <ArrangeableCards cards={regular.map((c) => ({ key: c.key, title: CARDS[c.key].title, node: card(c.key) }))} all={slots} kpis={layout.kpis} locked={regular.filter((c) => c.locked).map((c) => c.key)} />
            : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{regular.map((c) => card(c.key))}</div>}
        </section>
      )}

      <section aria-labelledby="fin-reports-h" data-guide="fin.reports" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="fin-reports-h" className="font-display text-lg font-extrabold">Reports for your kind of work</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {profile.reports.map((r) => (
            <li key={r}>{REPORT_HREF[r]
              ? <Link href={REPORT_HREF[r]!} className="flex min-h-11 items-center text-sm font-semibold text-accent-ink underline">{REPORT_LABELS[r]}</Link>
              : <span className="flex min-h-11 items-center text-sm text-muted">{REPORT_LABELS[r]}</span>}</li>
          ))}
        </ul>
      </section>

      <CustomizeDashboard
        cards={layout.cards.map((c) => ({ key: c.key, title: CARDS[c.key].title, visible: c.visible, locked: c.locked, essential: c.essential }))}
        kpis={layout.kpis} allKpis={KPI_KEYS} canCompany={perms.includes("manage_financial_config")}
        quick={{
          ready: ctx.quickActionsReady, selected: quick, from: layout.quickActionsFrom,
          options: quickLibrary,
        }} />
    </div>
  );
}
