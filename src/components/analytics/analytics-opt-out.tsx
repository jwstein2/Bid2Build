"use client";
import { useEffect, useState } from "react";
import { GA_OPTOUT_COOKIE, gaOptedOut } from "@/lib/seo/ga-optout";

const YEAR = 60 * 60 * 24 * 365;

/** On/off switch for Google Analytics in this browser. Takes effect on the next page load. */
export function AnalyticsOptOut() {
  const [out, setOut] = useState<boolean | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- cookies are only readable after hydration
  useEffect(() => { setOut(gaOptedOut(document.cookie)); }, []);
  const set = (v: boolean) => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = v ? `${GA_OPTOUT_COOKIE}=1; Max-Age=${YEAR}; Path=/; SameSite=Lax${secure}` : `${GA_OPTOUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    setOut(v);
  };
  if (out === null) return null;
  return (
    <span className="mt-2 flex flex-wrap items-center gap-3" data-testid="ga-optout">
      <span className="text-sm">{out ? "Google Analytics is off in this browser." : "Google Analytics is on in this browser."}</span>
      <button type="button" onClick={() => set(!out)} className="min-h-11 rounded-lg border border-line px-3 text-sm font-semibold text-accent-ink hover:bg-accent-tint">
        {out ? "Turn analytics back on" : "Turn off Google Analytics"}
      </button>
    </span>
  );
}
