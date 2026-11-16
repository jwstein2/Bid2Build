import type { Metadata } from "next";
import { HardHat, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { hashSigningToken, isSigningToken } from "@/lib/esign/token";
import { SHAREABLE_FIELDS } from "@/lib/operations/scope";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scope of work", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

type Shared = { content: { title: string; trade: string | null; project: string; company: string; assignee: string | null; fields: Record<string, string> }; photoIds: string[]; version: number; sharedAt: string; expiresAt: string };

/** What a subcontractor sees: only the fields the contractor chose to share, as last updated. */
export default async function ScopeSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = isSigningToken(token) ? await admin.rpc("scope_share_read", { p_token_hash: hashSigningToken(token) }) : { data: null };
  const s = data as Shared | null;
  if (!s) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper px-4"><div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        <XCircle className="mx-auto h-8 w-8 text-danger" aria-hidden /><h1 className="mt-2 font-display text-2xl font-extrabold text-navy">This link isn&apos;t active</h1>
        <p className="mt-2 text-ink-soft">It may have expired or been replaced. Ask the contractor who sent it for the current scope.</p></div></div>
    );
  }
  let photos: { url: string }[] = [];
  if (s.photoIds.length) {
    const { data: rows } = await admin.from("project_photos").select("storage_path").in("id", s.photoIds).is("archived_at", null);
    const paths = ((rows ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
    if (paths.length) { const { data: signed } = await admin.storage.from("project-photos").createSignedUrls(paths, 3600); photos = (signed ?? []).flatMap((x) => (x.signedUrl ? [{ url: x.signedUrl }] : [])); }
  }
  const c = s.content;
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface"><div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-3"><span className="truncate font-display font-extrabold text-navy">{c.company || "Scope of work"}</span><span className="text-xs text-muted">Shared with {site.name}</span></div></header>
      <main id="main" className="mx-auto max-w-[860px] space-y-4 px-4 py-6">
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted"><HardHat className="h-4 w-4" aria-hidden /> Scope of work · version {s.version}</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-navy">{c.title}</h1>
          <p className="text-sm text-ink-soft">{c.project}{c.assignee ? ` · for ${c.assignee}` : ""} · updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(s.sharedAt))}</p>
        </section>
        {SHAREABLE_FIELDS.filter((f) => c.fields[f.key]).map((f) => (
          <section key={f.key} className="rounded-2xl border border-line bg-surface p-5"><h2 className="font-bold text-navy">{f.label}</h2><p className="mt-1 whitespace-pre-line text-ink-soft">{c.fields[f.key]}</p></section>
        ))}
        {photos.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-5"><h2 className="font-bold text-navy">Photos</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{photos.map((p, i) => <a key={i} href={p.url} target="_blank" rel="noopener"><img src={p.url} alt={`Site photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" /></a>)}</div>
          </section>
        )}
        <p className="text-xs text-muted">This page shows only what the contractor chose to share. Questions go to {c.company || "the contractor"}. Link works until {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(s.expiresAt))}.</p>
      </main>
    </div>
  );
}
