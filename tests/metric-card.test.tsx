/**
 * Clickable KPI cards (Built2Bid UX standard): the whole card is one link or button, with an
 * accessible destination, and static cards stay plain. Rendered on the server, like the dashboards.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetricCard, MetricEmpty, MetricRecords } from "@/components/ui/metric-card";
import { Kpi } from "@/components/admin/cc";
import { byAccount } from "@/lib/admin/drill";
import { carry, parseView } from "@/lib/admin/view";
import type { AccountFact } from "@/lib/admin/model";

vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("MetricCard", () => {
  it("makes the whole card one link with a visible and spoken destination", () => {
    const html = renderToStaticMarkup(<MetricCard title="Pending invitations" value="0" href="/admin/complimentary?state=pending#grants" action="View pending invitations" />);
    expect(count(html, /<a /g)).toBe(1);
    expect(html).toContain('href="/admin/complimentary?state=pending#grants"');
    expect(html).toContain("metric-action");
    expect(html).toContain("View pending invitations");
    expect(count(html, /<button/g)).toBe(0);
  });
  it("opens a drawer from a single button when there is no page to go to", () => {
    const html = renderToStaticMarkup(<MetricCard title="Win rate" value="50%" drawer={{ id: "wr", title: "Win rate", body: <p>calc</p> }} />);
    expect(count(html, /<button/g)).toBe(1);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-metric-drawer="wr"');
    expect(count(html, /<a /g)).toBe(0);
  });
  it("supports an in-page filter button with a pressed state", () => {
    const html = renderToStaticMarkup(<MetricCard title="Drafts" value="2" onSelect={() => {}} pressed />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("metric-pressed");
  });
  it("keeps static cards plain and shows a loading skeleton", () => {
    const html = renderToStaticMarkup(<MetricCard title="Plan" value="Pro" loading />);
    expect(html).not.toContain("metric-action");
    expect(html).toContain('aria-label="Loading"');
  });
  it("owner KPI cards are clickable too", () => {
    const html = renderToStaticMarkup(<Kpi label="Past due" value={0} href="/admin/customers?cohort=past_due#accounts" action="View payment issues" def="Failed payments" />);
    expect(count(html, /<a /g)).toBe(1);
    expect(html).toContain("View payment issues");
  });
  it("empty states explain and offer a next step", () => {
    const html = renderToStaticMarkup(<><MetricRecords rows={[]} empty="No pending invitations." /><MetricEmpty action={{ href: "/admin/complimentary#grant", label: "Grant Complimentary Access" }}>Nothing yet.</MetricEmpty></>);
    expect(html).toContain("No pending invitations.");
    expect(html).toContain("Grant Complimentary Access");
  });
});

describe("drilldown links and lists", () => {
  it("carry() keeps the date range and test toggle, drops the current page's filters", () => {
    const v = parseView({ range: "90d", data: "all", channel: "google_ads", q: "x" });
    expect(carry("/admin/customers", v, { cohort: "signups" }, "accounts")).toBe("/admin/customers?range=90d&data=all&cohort=signups#accounts");
  });
  it("byAccount only lists accounts that are in the report's scope", () => {
    const f = (id: string) => ({ id, email: `${id}@x.com`, business: null }) as unknown as AccountFact;
    const r = byAccount([{ user_id: "a", at: "2026-11-10T00:00:00Z" }, { user_id: "a", at: "2026-11-11T00:00:00Z" }, { user_id: "hidden-test", at: "2026-11-11T00:00:00Z" }], [f("a")], null, { unit: "bids" });
    expect(r.total).toBe(2);
    expect(r.accounts).toBe(1);
    expect(r.rows[0]).toMatchObject({ label: "a@x.com", value: "2 bids", href: "/admin/customers/a" });
  });
});
