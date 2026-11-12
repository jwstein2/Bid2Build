"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Builder } from "@/components/builder/builder";
import { listLocalDrafts, loadLocalDraft, type LocalDraft } from "@/lib/drafts/local";
import type { BusinessProfile } from "@/lib/proposal/types";
import type { SessionUser } from "@/lib/supabase/server";
import { proposalConfigFrom } from "@/lib/data/mappers";

export function BuilderLoader({ draftId, user, business, autoExport }: { draftId: string | null; user: SessionUser | null; business: (BusinessProfile & { logoPath?: string | null }) | null; autoExport: boolean }) {
  const [draft, setDraft] = useState<LocalDraft | null | undefined>(undefined);
  useEffect(() => {
    const id = draftId ?? listLocalDrafts()[0]?.id;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
    setDraft(id ? loadLocalDraft(id) : null);
  }, [draftId]);

  if (draft === undefined) return <main className="grid min-h-screen place-items-center text-ink-soft" aria-busy="true">Loading your bid…</main>;
  if (draft === null) {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-center">
        <div>
          <h1 className="text-2xl font-extrabold">We couldn&apos;t find that draft on this device</h1>
          <p className="mt-2 text-ink-soft">{user ? "Saved bids are in your dashboard." : "Drafts are stored in the browser where you started them."}</p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/bids" className="rounded-lg bg-accent px-4 py-2 font-semibold text-navy">Start a new bid</Link>
            {user && <Link href="/dashboard" className="rounded-lg border border-line-strong px-4 py-2 font-semibold">Dashboard</Link>}
          </div>
        </div>
      </main>
    );
  }
  return (
    <Builder
      initialEstimate={draft.estimate}
      initialConfig={proposalConfigFrom(draft.proposalConfig)}
      initialBusiness={business && business.companyName ? business : null}
      mode="local"
      user={user}
      autoExport={autoExport}
    />
  );
}
