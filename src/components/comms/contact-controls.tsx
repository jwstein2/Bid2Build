"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ContactStatus } from "@/lib/comms/types";

/** Pause / resume / mark replied for one contact (server enforces permission and suppression rules). */
export function ContactControls({ id, status }: { id: string; status: ContactStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: string) => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/comms/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setErr(d?.error?.message ?? "Something went wrong."); else router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "eligible" && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => act("pause")}>Pause follow-ups</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => act("mark_replied")}>Mark replied</Button></>}
      {(status === "paused" || status === "replied") && <Button size="sm" disabled={busy} onClick={() => act("resume")}>Resume follow-ups</Button>}
      {err && <p className="text-xs text-danger" role="alert">{err}</p>}
    </div>
  );
}
