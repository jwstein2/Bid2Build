"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { analyticsAllowedOn } from "@/lib/seo/analytics";
import { gaOptedOut } from "@/lib/seo/ga-optout";

/**
 * Google Analytics 4 tag. Rendered from the root layout only on indexable production deploys with a
 * measurement id (see src/lib/seo/analytics.ts). Page views on client-side navigation are recorded by
 * GA4's enhanced measurement ("page changes based on browser history events", on by default).
 *
 * The decision is made on the first page of the visit: someone who lands on a signing link, auth
 * callback or claim page never loads the tag at all, so those tokens never reach Google.
 */
export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const [allowed] = useState(() => analyticsAllowedOn(pathname));
  // Visitors who turned analytics off on /privacy#analytics never load the tag (read after hydration).
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- cookies are only readable after hydration
  useEffect(() => { setOptedOut(gaOptedOut(document.cookie)); }, []);
  if (!allowed || optedOut !== false) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${measurementId}');`}
      </Script>
    </>
  );
}
