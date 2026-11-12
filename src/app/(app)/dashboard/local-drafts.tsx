"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listLocalDrafts } from "@/lib/drafts/local";
import { Notice } from "@/components/ui/misc";

/** Drafts started before signing in (or while offline) that haven't reached the account yet. */
export function LocalDraftsBanner() {
  const [drafts, setDrafts] = useState<{ id: string; title: string; savedAt: string }[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
  useEffect(() => { setDrafts(listLocalDrafts()); }, []);
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
