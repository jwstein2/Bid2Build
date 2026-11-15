import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Clock, Download, ShieldCheck, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { isPmEnabled } from "@/lib/env";
import { rateLimit } from "@/lib/http/api";
import { loadLogoData, loadUpdateByToken, recordView } from "@/lib/schedule/publications";
import { site } from "@/lib/site";
import { ReportView } from "@/components/schedule/report-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your project update",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * Customer share page for one published schedule update. No account: the secret link is the only key,
 * and it shows only the frozen copy that was published (never the live schedule or anything internal).
 */
export default async function SharedUpdatePage({ params }: { params: Promise<{ token: string }> }) {
  if (!isPmEnabled()) notFound();
  const { token } = await params;
  if (!(await rateLimit("update-share-view", 60, 10 * 60_000))) {
    return <Shell><State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title="Please wait a moment">Too many requests. Try again in a few minutes.</State></Shell>;
  }
  const admin = createAdminClient();
  const u = await loadUpdateByToken(admin, token);
  if (!u) return <Shell><State icon={<XCircle className="h-8 w-8 text-danger" aria-hidden />} title="This link isn't valid">Check that you opened the full link from your contractor. If it still doesn&apos;t work, ask them for a new one.</State></Shell>;
  const r = u.content;
  const contact = [r.company.phone, r.company.email].filter(Boolean).join(" · ");
  if (u.phase !== "active") {
    return (
      <Shell company={r.company.name}>
        <State icon={<Clock className="h-8 w-8 text-warn" aria-hidden />} title={u.phase === "expired" ? "This link has expired" : "This link is no longer active"}>
          Please contact {r.company.name} for the latest project update{contact ? <>: <span className="font-semibold">{contact}</span></> : "."}
        </State>
      </Shell>
    );
  }
  void recordView(admin, u.id);
  const logo = r.brand.logo ? await loadLogoData(admin, u.logoPath) : null;
  return (
    <Shell company={r.company.name}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">Shared by {r.company.name}</p>
        <a href={`/api/updates/${token}/pdf`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 font-semibold text-navy hover:bg-black/5"><Download className="h-4 w-4" aria-hidden /> Download PDF</a>
      </div>
      <ReportView r={r} logoUrl={logo ? `data:image/png;base64,${logo.data.toString("base64")}` : null} version={u.version} />
      <p className="mt-6 flex items-start gap-2 text-xs text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>This link is private to you. It shows the update {r.company.name} published on {new Date(u.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Your contractor may publish newer updates.</span>
      </p>
    </Shell>
  );
}

function Shell({ company, children }: { company?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-3">
          <span className="truncate font-display font-extrabold text-navy">{company ?? "Project update"}</span>
          <span className="shrink-0 text-xs text-muted">Shared securely with {site.name}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[860px] px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

function State({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 text-center shadow-sm sm:p-10">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-black/5">{icon}</div>
      <h1 className="font-display text-2xl font-extrabold text-navy">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{children}</p>
    </div>
  );
}
