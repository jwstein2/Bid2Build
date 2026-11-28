import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";
import { deploy, site } from "@/lib/site";
import { OnboardingHost } from "@/components/onboarding/onboarding-host";
import { DemoBannerAnywhere } from "@/components/demo/demo-controls";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { FunnelTracker } from "@/components/analytics/funnel-tracker";
import { gaMeasurementId } from "@/lib/seo/analytics";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { pixelId } from "@/lib/growth/consent";
import { OG_IMAGE } from "@/lib/seo/open-graph";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { AppRuntime } from "@/components/pwa/app-runtime";

// Public ids, inlined at build time. Analytics runs only on the indexable production deploy.
const gaId = deploy.allowIndexing ? gaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) : null;
// Meta Pixel: only with a configured id on indexable production, and only after the visitor allows it.
const metaPixelId = deploy.allowIndexing ? pixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID) : null;
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() || undefined;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: Contractor estimate and proposal software for every trade`, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { siteName: site.name, type: "website", locale: "en_US", title: `${site.name}: ${site.tagline}`, description: site.description, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "/" },
  // iPhone/iPad home screen app: opens full screen, labeled "Built2Bid" under the icon.
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
  // Optional: Search Console "HTML tag" verification. Not needed when the domain is verified by DNS.
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
  // impact.com publisher site verification (Home Depot affiliate application). Public, not a secret.
  // Bing Webmaster Tools site verification for https://built2bid.org/ (public, not a secret; no DNS change).
  other: { "impact-site-verification": "7d246bfc-cc5e-4068-8536-071c794657f8", "msvalidate.01": "6FD9B4E391B37E30EE8555E5F917FFE6" },
  // Belt and braces with robots.txt and the X-Robots-Tag header: non-production deploys are noindex.
  ...(deploy.allowIndexing ? {} : { robots: { index: false, follow: false } }),
};

export const viewport: Viewport = { themeColor: "#0b2d4d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the boot script may set data-theme on <html> before React hydrates.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies a saved Dark Mode choice before the first paint (no bright flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
        <DemoBannerAnywhere />
        {children}
        <OnboardingHost />
        {/* V10.1: offline notice, "Built2Bid has been updated" refresh prompt, offline-page service worker. */}
        <AppRuntime />
        {gaId && <><GoogleAnalytics measurementId={gaId} /><FunnelTracker /></>}
        {metaPixelId && <MetaPixel pixelId={metaPixelId} />}
      </body>
    </html>
  );
}
