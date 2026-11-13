"use client";
import Link from "next/link";
import { Building2, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "b2b:profile-reminder-dismissed";

/**
 * Subtle, dismissible nudge to finish the company profile. Nothing here is required: it only
 * lists the details that make proposals look complete. Dismissal is remembered on this device.
 */
export function ProfileReminder({ missing }: { missing: string[] }) {
  const [hidden, setHidden] = useState(true);
  const signature = missing.join(",");
  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === signature; } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after hydration
    setHidden(dismissed);
  }, [signature]);
  if (!missing.length || hidden) return null;
  // Remembers exactly what was missing, so the reminder comes back only if the gaps change.
  const dismiss = () => { try { localStorage.setItem(KEY, signature); } catch { /* storage blocked */ } setHidden(true); };
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-brand/25 bg-brand-tint px-4 py-3 text-sm">
      <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Finish your company profile</p>
        <p className="text-ink-soft">Add your {listText(missing)} so every proposal carries your branding. <Link href="/settings/company" className="font-semibold text-accent-ink underline">Open company profile</Link></p>
      </div>
      <button type="button" onClick={dismiss} className="-m-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-black/5" aria-label="Dismiss company profile reminder"><X className="h-4 w-4" /></button>
    </div>
  );
}

function listText(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
