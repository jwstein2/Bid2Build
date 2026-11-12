import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // Keep the whole site out of search until the owner approves a public launch.
  if (process.env.NEXT_PUBLIC_ALLOW_INDEXING !== "true") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/dashboard", "/settings", "/builder", "/start/", "/estimates/", "/auth/", "/login"] },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
