import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: Professional contractor bids, without the busywork`, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { siteName: site.name, type: "website", title: `${site.name}: ${site.tagline}`, description: site.description },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = { themeColor: "#0b2d4d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
