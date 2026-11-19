"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { analyticsAllowedOn } from "@/lib/seo/analytics";
import { AD_CONSENT_COOKIE, readConsentCookie } from "@/lib/growth/consent";

const YEAR = 60 * 60 * 24 * 365;
const cookieVal = (name: string) => document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];

/** Save the choice in the browser and, when signed in, on the account (with Meta's browser ids). */
async function saveChoice(granted: boolean) {
  document.cookie = `${AD_CONSENT_COOKIE}=${granted ? "granted" : "denied"}; Max-Age=${YEAR}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  // _fbp is written by the Pixel shortly after it loads; give it a moment.
  if (granted) await new Promise((r) => setTimeout(r, 1500));
  const fbp = granted ? cookieVal("_fbp") : undefined, fbc = granted ? cookieVal("_fbc") : undefined;
  await fetch("/api/account/ad-consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ granted, ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) }) }).catch(() => {});
}

/**
 * Meta Pixel with an explicit ad-measurement choice. Rendered by the root layout only when
 * NEXT_PUBLIC_META_PIXEL_ID is set on an indexable production deploy, so nothing loads today.
 * The Pixel script loads only after "Allow"; "No thanks" is remembered and nothing ad-related loads.
 * Never on pages whose URLs carry tokens (same exclusions as GA4).
 */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const [allowedPath] = useState(() => analyticsAllowedOn(pathname));
  const [choice, setChoice] = useState<"granted" | "denied" | null | "unknown">("unknown");
  useEffect(() => {
    // Global Privacy Control is an opt-out of ad measurement (Privacy Policy): no banner, nothing loads.
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cookies are only readable after hydration
    setChoice(gpc ? "denied" : readConsentCookie(document.cookie));
  }, []);
  if (!allowedPath || choice === "unknown") return null;
  const decide = (granted: boolean) => { setChoice(granted ? "granted" : "denied"); void saveChoice(granted); };
  return (
    <>
      {choice === "granted" && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`}
        </Script>
      )}
      {choice === null && (
        <div role="region" aria-label="Ad measurement choice" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-xl border border-line bg-surface p-4 text-sm shadow-lg" data-testid="ad-consent">
          <p className="text-ink">We&apos;d like to measure which of our ads bring contractors to Built2Bid, using Meta&apos;s pixel. No bid, customer or pricing details are ever shared. <a href="/cookies" className="font-semibold text-accent-ink underline">Cookie policy</a></p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => decide(true)} className="min-h-10 rounded-lg bg-navy px-4 font-semibold text-white">Allow</button>
            <button type="button" onClick={() => decide(false)} className="min-h-10 rounded-lg border border-line px-4 font-semibold text-ink">No thanks</button>
          </div>
        </div>
      )}
    </>
  );
}
