"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { unsavedLocalDrafts, type LocalDraftEntry } from "@/lib/drafts/local";
import { Notice } from "@/components/ui/misc";

/**
 * Drafts started before signing in (or while offline), or edits the server never confirmed, that haven't
 * reached the account yet. Plain safety copies of bids already in the account (`accountIds`) don't count.
 */
export function LocalDraftsBanner({ accountIds }: { accountIds: string[] }) {
  const [drafts, setDrafts] = useState<LocalDraftEntry[]>([]);
  const key = accountIds.join(",");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
  useEffect(() => { setDrafts(unsavedLocalDrafts(key ? key.split(",") : [])); }, [key]);
  if (!drafts.length) return null;
  return (
    <Notice tone="warn" title={`You have ${drafts.length} draft${drafts.length > 1 ? "s" : ""} saved only on this device`}>
      Open {drafts.length > 1 ? "each one" : "it"} to save it to your account:{" "}
      {drafts.slice(0, 5).map((d, i) => (
        <span key={d.id}>{i > 0 && ", "}<Link className="font-semibold text-brand underline" href={`/builder?draft=${d.id}`}>{d.title || "Untitled"}</Link></span>
      ))}
    </Notice>
  );
}
