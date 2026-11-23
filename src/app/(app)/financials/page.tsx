import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutGrid, Settings2 } from "lucide-react";
import { createClient, getUser } from "@/lib/supabase/server";
import { isFinBillingConfigured, isFinancialsEnabled } from "@/lib/env";
import { FinAddonCard } from "@/components/billing/fin-addon";
import { site } from "@/lib/site";
import { SandboxBar } from "@/components/financials/sandbox-bar";
import { loadFinState, loadHome, type Figure } from "@/lib/financials/loaders";
import { CARDS, KPI_KEYS, QUICK_ACTIONS, QUICK_ACTION_NEEDS, type CardKey, type KpiKey, type QuickAction } from "@/lib/financials/profiles/catalog";
import { PRESETS } from "@/lib/financials/profiles/presets";
import { KPI_LABELS, QUICK_ACTION_HREF, QUICK_ACTION_LABELS, QUICK_ACTION_TARGET, REPORT_HREF, REPORT_LABELS } from "@/lib/financials/ui-labels";
import { formatCurrency } from "@/lib/estimate/money";
import { MetricCard } from "@/components/ui/metric-card";
import { Notice } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { BasisBadge } from "@/components/financials/basis";
import { AlertsPanel, type AlertRow } from "@/components/financials/alerts-panel";
import { FinStateNotice } from "@/components/financials/fin-state-notice";
import { HomeOverview } from "@/components/financials/home-overview";
import { TaxBankSetupPrompt } from "@/components/tax-banking/setup-prompt";
import { AccountantHome } from "@/components/financials/accounting/home";
import { ContractorNav } from "@/components/financials/accounting/contractor-nav";
import { loadAccountantMetrics, loadBank, loadLookups, loadQueue, queueTotal } from "@/lib/financials/accounting-load";
import { accountantActionsFor, QUEUE_KINDS, type QueueKind } from "@/lib/financials/accounting";
import { DashboardBuilder } from "@/components/dashboard/dashboard-builder";
import { Frame, WidgetBody } from "@/components/dashboard/widgets";
import { allowed } from "@/lib/dashboard/access";
import { DATASET_INFO, isDataset, type ChartPeriod } from "@/lib/dashboard/charts";
import { FIN_CARD_KEYS, WIDGET_TYPES, instanceTitle, onPage, widgetDef, type Option } from "@/lib/dashboard/registry";
import type { WidgetInstance } from "@/lib/dashboard/schema";
import { dataFor, loadLayout, loadViewer } from "@/lib/dashboard/server";
import { defaultTemplate } from "@/lib/dashboard/templates";
import { financialsStartLayout, withRequiredSections } from "@/lib/dashboard/financials-page";

export const metadata: Metadata = { title: "Financials", robots: { index: false } };

const show = (f: Figure) => (f.money ? formatCurrency(f.value) : f.value);

/**
 * Financials home (Know Your Numbers), laid out with the same dashboard builder as Home: "Customize Page" moves
 * (drag, arrows, Move buttons), resizes, configures, removes and adds cards and sections, and restores defaults.
 * Contractor Mode and Accountant Mode each keep their own layout, per person. A person's first layout starts from
 * the trade profile + role (src/lib/financials/profiles). Essential alerts are always shown (they can be moved,
 * not removed). Every number opens the records behind it.
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
  // V6.9 onboarding: tax setup and a bank connection (tables may not exist yet: errors read as "already done").
  const manageCfg = ctx.access.permissions.includes("manage_financial_config") && ctx.access.active && !ctx.access.readOnly;
  const [taxProf, bankConn] = manageCfg ? await Promise.all([
    db.from("fin_tax_profiles").select("book_id", { count: "exact", head: true }).eq("book_id", ctx.bookId),
    db.from("fin_bank_connections").select("id", { count: "exact", head: true }).eq("book_id", ctx.bookId).neq("status", "disconnected"),
  ]) : [null, null];
  const setup = { needsTax: Boolean(taxProf && !taxProf.error && taxProf.count === 0), needsBank: Boolean(bankConn && !bankConn.error && bankConn.count === 0) };
  const perms = access.permissions;
  const canWrite = access.active && !access.readOnly;
  // Solo owners buy the add-on here (complimentary access needs no purchase).
  const soloOwner = access.kind === "solo" && access.role === "owner" && access.source !== "complimentary";
  const { data: mySub } = soloOwner
    ? await db.from("subscriptions").select("plan, status, current_period_end, fin_addon").neq("plan", "enterprise").in("status", ["active", "trialing", "past_due"]).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const essential = layout.cards.filter((c) => c.essential);
  const { data: jobs } = await db.from("fin_jobs").select("id, estimate_id").eq("book_id", ctx.bookId);
  const jobHref = new Map(((jobs ?? []) as { id: string; estimate_id: string }[]).map((j) => [j.id, `/financials/jobs/${j.estimate_id}`] as const));
  const alerts: AlertRow[] = (home.alerts as unknown as AlertRow[]).map((a) => ({ ...a, jobHref: a.job_id ? jobHref.get(a.job_id) ?? null : null }));

  // The page is laid out with the dashboard builder (same controls as Home). Each person keeps one Financials
  // layout per mode; until they save one it starts from what the Financials layout rules pick for them.
  const user = await getUser();
  if (!user) notFound();
  const viewer = await loadViewer(db, user.id, state);
  const mode = viewer.mode;
  // Accountant Mode (saved per person; only offered to accounting roles, and it grants nothing).
  const accountant = mode === "accountant";
  const start = () => financialsStartLayout({ mode, kpis: layout.kpis, quickActions: layout.quickActions, cards: layout.cards.filter((c) => !c.essential && c.visible).map((c) => c.key) });
  const loaded = await loadLayout(db, viewer, mode, "financials", start);
  const widgets = withRequiredSections(loaded.layout.widgets);
  const shown = widgets.filter((w) => { const def = widgetDef(w.type); return def && onPage(def, "financials", mode) && allowed(viewer.access, def.requires); });

  const firstCardId = shown.find((w) => w.type === "fin_page_card")?.id;
  const cardAllowed = (k: CardKey) => CARDS[k].needs.every((n) => perms.includes(n)) && (!CARDS[k].accountantOnly || accountant);
  const quickAllowed = QUICK_ACTIONS.filter((q) => perms.includes(QUICK_ACTION_NEEDS[q]));
  const acct = accountant && shown.some((w) => w.type === "fin_page_accountant") ? await (async () => {
    const L = await loadLookups(db, ctx.bookId);
    const bank = await loadBank(db, ctx.bookId, L);
    const q = await loadQueue(db, ctx.bookId, L, bank);
    const m = await loadAccountantMetrics(db, ctx.bookId, bank, queueTotal(q));
    return { m, counts: Object.fromEntries(QUEUE_KINDS.map((k) => [k, q[k].length])) as Record<QueueKind, number> };
  })() : null;

  const quickNode = (q: QuickAction) => {
    const href = QUICK_ACTION_HREF[q];
    // A page link (e.g. the export reports) is read-only, so it works for read-only books too; the page re-checks access.
    if (href && perms.includes(QUICK_ACTION_NEEDS[q])) return <ButtonLink href={href} variant="secondary" size="sm">{QUICK_ACTION_LABELS[q]}</ButtonLink>;
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
  const empty = (title: string, text: string) => <Frame title={title}><p className="text-sm text-ink-soft">{text}</p></Frame>;

  // Home widgets placed on this page (charts, receivables, P&L…) render exactly as on Home.
  const data = dataFor(db, viewer);
  const body = async (w: WidgetInstance): Promise<ReactNode> => {
    switch (w.type) {
      case "fin_page_nav": return <ContractorNav company={perms.includes("view_company_financials")} />;
      case "fin_page_accountant": return acct ? <AccountantHome m={acct.m} counts={acct.counts} actions={accountantActionsFor(perms)} /> : empty("Accountant overview", "Shown in Accountant Mode.");
      case "fin_page_kpis": {
        const keys = ((w.settings.kpis as string[]) ?? []).filter((k): k is KpiKey => (KPI_KEYS as readonly string[]).includes(k));
        if (!keys.length) return empty("Headline numbers", "Pick numbers in this card's settings.");
        return (
          <section aria-label="Headline numbers" data-guide="fin.kpis" className="grid h-full grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
            {keys.map((k) => {
              const f = home.kpis[k];
              return <MetricCard key={k} title={KPI_LABELS[k]} value={show(f)} sub={f.sub} href={f.href} tone={f.tone} empty={f.empty} status={<BasisBadge basis={f.basis} />} hint={f.note} testId={`fin-kpi-${k}`} />;
            })}
          </section>
        );
      }
      case "fin_page_overview": return <HomeOverview bookId={ctx.bookId} company={perms.includes("view_company_financials")} />;
      case "fin_page_attention": return (
        <section aria-labelledby="fin-essential-h" data-guide="fin.attention" className="h-full">
          <h2 id="fin-essential-h" className="mb-2 font-display text-lg font-extrabold">Needs attention</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">{essential.map((c) => card(c.key, "sm"))}</div>
        </section>
      );
      case "fin_page_alerts": return <AlertsPanel alerts={alerts} canAct={canWrite && (perms.includes("create_invoices") || perms.includes("manage_financial_config"))} />;
      case "fin_page_quick": {
        const keys = ((w.settings.actions as string[]) ?? []).filter((q): q is QuickAction => (quickAllowed as readonly string[]).includes(q));
        return (
          <div className="h-full" data-guide="fin.quick"><Frame title="Quick actions">
            {keys.length ? <div className="flex flex-wrap gap-2" data-testid="fin-quick-row">{keys.map((q) => <span key={q} className="contents">{quickNode(q)}</span>)}</div>
              : <p className="text-sm text-ink-soft">Pick actions in this card&apos;s settings.</p>}
          </Frame></div>
        );
      }
      case "fin_page_card": {
        const k = w.settings.card as CardKey;
        if (!Object.hasOwn(CARDS, k) || !cardAllowed(k)) return empty(CARDS[k]?.title ?? "Card", accountant || !CARDS[k]?.accountantOnly ? "You don't have access to this card." : "Shown in Accountant Mode.");
        const node = card(k) ?? empty(CARDS[k].title, "Nothing to show here yet.");
        // The first card carries the page guide's "Your cards" step.
        return w.id === firstCardId ? <div className="h-full" data-guide="fin.cards">{node}</div> : node;
      }
      case "fin_page_reports": return (
        <section aria-labelledby="fin-reports-h" data-guide="fin.reports" className="h-full rounded-xl border border-line bg-surface p-4">
          <h2 id="fin-reports-h" className="font-display text-lg font-extrabold">Reports for your kind of work</h2>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-1">
            {profile.reports.map((r) => (
              <li key={r}>{REPORT_HREF[r]
                ? <Link href={REPORT_HREF[r]!} className="flex min-h-11 items-center text-sm font-semibold text-accent-ink underline">{REPORT_LABELS[r]}</Link>
                : <span className="flex min-h-11 items-center text-sm text-muted">{REPORT_LABELS[r]}</span>}</li>
            ))}
          </ul>
        </section>
      );
      default: return WidgetBody({ inst: w, data, viewer });
    }
  };
  // Render every shown section in parallel; one failing section never takes the page down.
  const entries = await Promise.all(shown.map(async (w): Promise<[string, ReactNode]> => {
    try { return [w.id, await body(w)]; }
    catch (e) {
      console.error(JSON.stringify({ level: "error", scope: "financials.section", type: w.type, message: (e as Error).message }));
      return [w.id, empty(instanceTitle(w.type, w.settings), "Nothing to show here yet.")];
    }
  }));

  // Project / trade choices for chart filters (same as Home).
  const options: { jobs: Option[]; trades: Option[] } = { jobs: [], trades: [] };
  const chart = shown.find((w) => w.type === "chart" && isDataset(w.settings.dataset) && DATASET_INFO[w.settings.dataset].source === "pl");
  if (chart) {
    const pl = await data.pl(chart.settings.period as ChartPeriod, chart.settings.basis === "billed" ? "billed" : "cash");
    if (pl?.ok) {
      options.jobs = pl.data.jobs.slice(0, 200).map((j) => ({ value: j.id, label: `${j.number} · ${j.name}` }));
      options.trades = pl.data.trades.slice(0, 60).map((t) => ({ value: t.slug, label: t.name }));
    }
  }

  const notices = (
    <>
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
      {manageCfg && <TaxBankSetupPrompt {...setup} />}
      {!ctx.configSaved && perms.includes("manage_financial_config") && (
        <Notice title="Tell Financials what kind of work you do">
          Your home page adapts to your trades and how you bill. <Link href="/company/business-config" className="font-semibold underline">Set up Business &amp; Trade Configuration</Link>
        </Notice>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4" data-testid="fin-home" data-preset={profile.presetKey} data-guide-page="financials.home" data-guide-trade={profile.trades.join(" ")}>
      {access.sandbox && <SandboxBar sandbox canManage={perms.includes("manage_financial_config")} />}
      <DashboardBuilder
        key={mode}
        page="financials"
        noun="card"
        guide="fin.customize"
        templates={false}
        eyebrow="Know Your Numbers"
        title="Financials"
        subtitle={`${access.name} · ${PRESETS[profile.presetKey].label}${profile.trades.length > 1 ? ` + ${profile.trades.length - 1} more trade${profile.trades.length > 2 ? "s" : ""}` : ""}`}
        headerActions={<>
          {!accountant && perms.includes("view_company_financials") && <ButtonLink href="/financials/reports" variant="secondary" size="sm" data-guide="fin.reports-pl">Profit &amp; Loss</ButtonLink>}
          {!accountant && <ButtonLink href="/financials/receivables" variant="secondary" size="sm" data-guide="fin.receivables">Accounts receivable</ButtonLink>}
          {!access.sandbox && canWrite && <SandboxBar sandbox={false} canManage={perms.includes("manage_financial_config")} />}
          <ButtonLink href="/financials/tools" variant="secondary" size="sm" data-guide="fin.tools"><LayoutGrid className="h-4 w-4" aria-hidden /> All tools</ButtonLink>
          {perms.includes("manage_financial_config") && <ButtonLink href="/company/business-config" variant="ghost" size="sm" data-guide="fin.config"><Settings2 className="h-4 w-4" aria-hidden /> Trade setup</ButtonLink>}
        </>}
        beforeGrid={notices}
        mode={mode}
        accountantModeAllowed={viewer.accountantModeAllowed}
        layout={{ template: null, widgets }}
        revision={loaded.revision}
        origin={loaded.origin}
        ready={loaded.ready}
        isCompanyOwner={loaded.isCompanyOwner}
        nodes={Object.fromEntries(entries)}
        allowedTypes={WIDGET_TYPES.filter((t) => { const def = widgetDef(t)!; return onPage(def, "financials", mode) && allowed(viewer.access, def.requires); })}
        allowedActions={[]}
        optionFilter={{
          "fin_page_card.card": FIN_CARD_KEYS.filter(cardAllowed),
          "fin_page_quick.actions": [...quickAllowed],
        }}
        access={viewer.access}
        options={options}
        offerSetup={false}
        defaultTemplate={defaultTemplate(viewer.access, mode)}
      />
    </div>
  );
}
