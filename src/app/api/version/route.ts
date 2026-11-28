import { NextResponse } from "next/server";
import { CLIENT_BUILD_ID } from "@/lib/pwa/version";

/**
 * The production build this server is running. Open windows of the website or the installed desktop app compare it with
 * their own build to offer "Refresh to use the latest version". Public and harmless: an opaque deploy id, no user data.
 *
 * BUILT2BID_REQUIRED_UPDATE=on (set with an urgent security deploy, then removed) tells windows on any other build that
 * they must refresh; they still get the chance to save first.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const required = ["on", "true", "1"].includes((process.env.BUILT2BID_REQUIRED_UPDATE ?? "").trim().toLowerCase());
  return NextResponse.json(
    { build: CLIENT_BUILD_ID || "dev", required },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } },
  );
}
