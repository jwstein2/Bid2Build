import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { contractorHomePath } from "@/lib/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    // id stays "/" so phones that already installed the app keep the same app.
    id: "/",
    // The installed app opens to the contractor start page (Home when it is on, sign-in first when signed out), not the marketing homepage.
    start_url: contractorHomePath(),
    scope: "/",
    display: "standalone",
    // V10.1 desktop app (Chrome/Edge on Windows and macOS): its own window, and a second launch focuses the open
    // Built2Bid window instead of stacking new ones.
    display_override: ["standalone", "minimal-ui"],
    launch_handler: { client_mode: ["focus-existing", "auto"] },
    lang: "en-US",
    dir: "ltr",
    categories: ["business", "productivity", "finance"],
    prefer_related_applications: false,
    background_color: "#F5F8FB",
    theme_color: "#0B2D4D",
    // Long-press shortcut on the Home Screen icon (Android; iPhone ignores it). Crews go straight to the time clock.
    shortcuts: [{ name: "My work & time clock", short_name: "My work", url: "/clock", icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }] }],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-256.png", sizes: "256x256", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-1024.png", sizes: "1024x1024", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/built2bid-mark.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // Shown in Chrome/Edge's desktop install dialog. Practice Mode sample data only (no real customers).
    screenshots: [
      { src: "/brand/screenshots/desktop-home.webp", sizes: "1280x670", type: "image/webp", form_factor: "wide", label: "Home: your business at a glance" },
      { src: "/brand/screenshots/desktop-pipeline.webp", sizes: "1280x670", type: "image/webp", form_factor: "wide", label: "Bids pipeline from draft to won" },
      { src: "/brand/screenshots/desktop-financials.webp", sizes: "1280x670", type: "image/webp", form_factor: "wide", label: "Financials and job profitability" },
    ],
  };
}
