import type { MetadataRoute } from "next";
import { deploy, site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // Previews, branch deploys and local builds are never indexable. Production is indexable only once
  // the owner sets NEXT_PUBLIC_ALLOW_INDEXING=true for the production context.
  if (!deploy.allowIndexing) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/staff", "/dashboard", "/settings", "/builder", "/start/", "/estimates/", "/auth/", "/login", "/sign/", "/signed/", "/co/", "/scope/", "/updates/", "/projects", "/academy/post/", "/academy/members", "/academy/leaderboard", "/academy/saved", "/academy/settings", "/academy/join", "/academy/manage", "/academy/classroom/go", "/meet/"] },
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
