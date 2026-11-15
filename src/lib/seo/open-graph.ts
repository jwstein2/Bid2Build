import type { Metadata } from "next";
import { site } from "@/lib/site";

/**
 * Shared Open Graph defaults.
 *
 * In Next.js a page that sets its own `openGraph` replaces the root layout's object instead of
 * merging with it, which drops the file-based share image (src/app/opengraph-image.png). Pages that
 * customise their share title or description build their openGraph through this helper so links
 * shared on Facebook, LinkedIn, iMessage and Slack keep the picture, URL and site name.
 */
export const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: `${site.name} logo on a navy blueprint grid with the tagline: ${site.tagline}`,
} as const;

type OpenGraph = NonNullable<Metadata["openGraph"]>;

export function openGraphFor(input: { title: string; description: string; path: string; type?: "website" | "article"; ownImage?: boolean } & Partial<Pick<OpenGraph, "locale">>): OpenGraph {
  const { title, description, path, type = "website", ownImage = false } = input;
  // ownImage: the route segment has its own opengraph-image.tsx (trade pages, guides). Leave
  // `images` out so the generated per-page card is used instead of the generic brand image.
  return { title, description, url: path, siteName: site.name, type, locale: "en_US", ...(ownImage ? {} : { images: [OG_IMAGE] }) };
}
