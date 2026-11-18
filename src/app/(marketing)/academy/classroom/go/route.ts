import { NextResponse, type NextRequest } from "next/server";

/** Trade switcher (works without JavaScript): /academy/classroom/go?trade=roofing -> /academy/classroom/roofing */
export function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("trade") ?? "";
  const dest = /^[a-z0-9-]{2,60}$/.test(t) ? `/academy/classroom/${t}` : "/academy/classroom";
  return NextResponse.redirect(new URL(dest, req.url), 303);
}
