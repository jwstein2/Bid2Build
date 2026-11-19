import { describe, expect, it } from "vitest";
import { appLoginRedirect, isPrivateAppPath } from "@/lib/auth/app-next";
import { safeNext } from "@/lib/http/redirect";

describe("signed-out app deep links keep their destination", () => {
  it("sends a private app page to /login with the page as next", () => {
    expect(appLoginRedirect("/financials/jobs/abc", "?do=invoice")).toBe("/login?next=%2Ffinancials%2Fjobs%2Fabc%3Fdo%3Dinvoice");
    expect(appLoginRedirect("/settings/billing", "")).toBe("/login?next=%2Fsettings%2Fbilling");
    expect(appLoginRedirect("/dashboard", "")).toBe("/login?next=%2Fdashboard");
  });
  it("round-trips through the login page's safeNext", () => {
    const url = new URL(appLoginRedirect("/projects/123", "?tab=schedule")!, "https://x.test");
    expect(safeNext(url.searchParams.get("next"))).toBe("/projects/123?tab=schedule");
  });
  it("leaves public pages, the sales portal and look-alike paths alone", () => {
    for (const p of ["/", "/pricing", "/login", "/company/join", "/sales", "/sales/leads", "/academy", "/dashboards", "/homepage", "/s/abc", "/api/financials/jobs/x"]) {
      expect(isPrivateAppPath(p)).toBe(false);
      expect(appLoginRedirect(p, "")).toBeNull();
    }
  });
  it("refuses protocol-relative or odd paths", () => {
    expect(appLoginRedirect("/dashboard", "?x=\\evil")).toBe("/login");
  });
});
