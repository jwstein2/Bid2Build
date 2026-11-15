import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";
import { deploy, site } from "@/lib/site";
import { OnboardingHost } from "@/components/onboarding/onboarding-host";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { gaMeasurementId } from "@/lib/seo/analytics";
import { OG_IMAGE } from "@/lib/seo/open-graph";

// Public ids, inlined at build time. Analytics runs only on the indexable production deploy.
const gaId = deploy.allowIndexing ? gaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) : null;
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim() || undefined;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: Win more bids with professional contractor proposals`, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { siteName: site.name, type: "website", locale: "en_US", title: `${site.name}: ${site.tagline}`, description: site.description, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "/" },
  // Optional: Search Console "HTML tag" verification. Not needed when the domain is verified by DNS.
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
  // Belt and braces with robots.txt and the X-Robots-Tag header: non-production deploys are noindex.
  ...(deploy.allowIndexing ? {} : { robots: { index: false, follow: false } }),
};

export const viewport: Viewport = { themeColor: "#0b2d4d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
        {children}
        <OnboardingHost />
        {gaId && <GoogleAnalytics measurementId={gaId} />}
      </body>
    </html>
  );
}
