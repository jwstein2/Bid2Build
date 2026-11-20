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
    background_color: "#F5F8FB",
    theme_color: "#0B2D4D",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/built2bid-mark.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
