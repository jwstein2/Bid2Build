import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { isUnifiedHomeEnabled } from "@/lib/env";
import { MyWorkCallout } from "@/components/workforce/hub/my-work-callout";
import { allowed } from "@/lib/dashboard/access";
import { QUICK_ACTIONS, QUICK_ACTION_KEYS, WIDGET_TYPES, widgetDef, type Option } from "@/lib/dashboard/registry";
import { DATASET_INFO, isDataset, type ChartPeriod } from "@/lib/dashboard/charts";
import { dataFor, loadLayout, loadViewer, visibleWidgets } from "@/lib/dashboard/server";
import { defaultTemplate } from "@/lib/dashboard/templates";
import { DashboardBuilder } from "@/components/dashboard/dashboard-builder";
import { WidgetBody, Frame } from "@/components/dashboard/widgets";

export const metadata: Metadata = { title: "Home", robots: { index: false } };

/**
 * Home: the personalized dashboard (V6.6). Each person's layout (per Contractor / Accountant Mode) is loaded,
 * widgets they may not access are left out before anything loads, and only the shown widgets' data is read,
 * each source once. Works with no customization: people without a saved layout get their company's default
 * or the best starting template for their role.
 */
export default async function HomePage() {
  if (!isUnifiedHomeEnabled()) notFound();
  const user = await getUser();
  if (!user) redirect("/login?next=/home");
  const db = await createClient();
  const viewer = await loadViewer(db, user.id);
  const loaded = await loadLayout(db, viewer, viewer.mode);
  const { shown } = visibleWidgets(loaded.layout, viewer.access);
  const data = dataFor(db, viewer);

  // Render every shown widget in parallel; one failing widget never takes the dashboard down.
  const entries = await Promise.all(shown.map(async (w): Promise<[string, ReactNode]> => {
    try { return [w.id, await WidgetBody({ inst: w, data, viewer })]; }
    catch (e) {
      console.error(JSON.stringify({ level: "error", scope: "dashboard.widget", type: w.type, message: (e as Error).message }));
      return [w.id, <Frame key={w.id} title={widgetDef(w.type)?.title ?? "Widget"}><p className="text-sm text-ink-soft">Nothing to show here yet.</p></Frame>];
    }
  }));

  // Project / trade choices for chart filters come from the viewer's own P&L (already loaded for their charts).
  const options: { jobs: Option[]; trades: Option[] } = { jobs: [], trades: [] };
  const chart = shown.find((w) => w.type === "chart" && isDataset(w.settings.dataset) && DATASET_INFO[w.settings.dataset].source === "pl");
  if (chart) {
    const pl = await data.pl(chart.settings.period as ChartPeriod, chart.settings.basis === "billed" ? "billed" : "cash");
    if (pl?.ok) {
      options.jobs = pl.data.jobs.slice(0, 200).map((j) => ({ value: j.id, label: `${j.number} · ${j.name}` }));
      options.trades = pl.data.trades.slice(0, 60).map((t) => ({ value: t.slug, label: t.name }));
    }
  }

  return (
    <div className="mx-auto max-w-7xl" data-testid="unified-home">
      <MyWorkCallout className="mb-4" />
      <DashboardBuilder
        key={viewer.mode}
        mode={viewer.mode}
        accountantModeAllowed={viewer.accountantModeAllowed}
        layout={{ template: loaded.layout.template, widgets: loaded.layout.widgets }}
        revision={loaded.revision}
        origin={loaded.origin}
        ready={loaded.ready}
        isCompanyOwner={loaded.isCompanyOwner}
        nodes={Object.fromEntries(entries)}
        allowedTypes={WIDGET_TYPES.filter((t) => allowed(viewer.access, widgetDef(t)!.requires))}
        allowedActions={QUICK_ACTION_KEYS.filter((k) => allowed(viewer.access, QUICK_ACTIONS[k].requires) && (!("write" in QUICK_ACTIONS[k]) || viewer.access.fin?.canWrite))}
        access={viewer.access}
        options={options}
        offerSetup={loaded.origin !== "mine"}
        defaultTemplate={defaultTemplate(viewer.access, viewer.mode)}
      />
    </div>
  );
}
