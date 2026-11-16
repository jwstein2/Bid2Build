import { describe, expect, it } from "vitest";
import { captureAttribution, parseAttribution } from "@/lib/growth/attribution";
import { classifyChannel } from "@/lib/admin/channels";
import { normalizeReferralCode, oneMonthCents, referralLandingPath, referralLink } from "@/lib/growth/referral";
import { UTM_PRESETS, utmLink } from "@/lib/growth/utm-links";

const ORIGIN = "https://built2bid.org";
/** What the owner report would say for a signup that first landed on this URL. */
const channelFor = (href: string) => {
  const a = captureAttribution(new URL(href), null, null);
  return classifyChannel(a ? { utm_source: a.source, utm_medium: a.medium, utm_campaign: a.campaign, first_campaign_id: a.campaignId, referrer_host: a.referrer ?? "(none)", source: a.source ?? (a.ref ? "referral" : undefined) } : null);
};

describe("referral links", () => {
  it("normalizes codes and builds the short link + tagged landing URL", () => {
    expect(normalizeReferralCode(" ab3de7gh ")).toBe("AB3DE7GH");
    expect(normalizeReferralCode("bad code")).toBeNull();
    expect(normalizeReferralCode("<script>")).toBeNull();
    expect(referralLink("AB3DE7GH", ORIGIN)).toBe("https://built2bid.org/r/AB3DE7GH");
    expect(referralLandingPath("AB3DE7GH")).toBe("/?ref=AB3DE7GH&utm_source=referral&utm_medium=referral&utm_campaign=refer_a_contractor");
  });
  it("the /r/ hop is never first-touch; the landing URL classifies as Referral", () => {
    expect(captureAttribution(new URL(`${ORIGIN}/r/AB3DE7GH`), "https://www.facebook.com/", null)).toBeNull();
    expect(parseAttribution(new URL(ORIGIN + referralLandingPath("AB3DE7GH")))?.ref).toBe("AB3DE7GH");
    expect(channelFor(ORIGIN + referralLandingPath("AB3DE7GH"))).toBe("referral");
  });
  it("prices one free month from the referrer's own plan", () => {
    expect(oneMonthCents({ unit_amount: 1999, recurring: { interval: "month" } })).toBe(1999);
    expect(oneMonthCents({ unit_amount: 14900, recurring: { interval: "year" } })).toBe(1242);
    expect(oneMonthCents({ unit_amount: 4999, recurring: { interval: "month", interval_count: 1 } })).toBe(4999);
    expect(oneMonthCents({ unit_amount: 0, recurring: { interval: "month" } })).toBeNull();
    expect(oneMonthCents({ unit_amount: 1999, recurring: null })).toBeNull();
  });
});

describe("owner UTM links land in the right channel", () => {
  for (const [key, p] of Object.entries(UTM_PRESETS)) {
    it(`${key} -> ${p.channel}`, () => {
      for (const path of ["/", "/pricing", "/bids/roofing"]) expect(channelFor(utmLink(ORIGIN, path, p, "test_post"))).toBe(p.channel);
    });
  }
  it("paid Facebook ads still count as Meta Ads, and untagged Facebook clicks as Organic Social", () => {
    expect(channelFor(`${ORIGIN}/?utm_source=facebook&utm_medium=paid_social`)).toBe("meta_ads");
    expect(classifyChannel({ referrer_host: "facebook.com" })).toBe("social");
    expect(classifyChannel({ utm_source: "newsletter" })).toBe("referral");
  });
});

describe("/r/<code> route", () => {
  it("redirects with a relative Location so visitors stay on the domain they used", async () => {
    const { GET } = await import("@/app/r/[code]/route");
    const res = await GET(new Request("https://abc123--built2bid.netlify.app/r/ab3de7gh"), { params: Promise.resolve({ code: "ab3de7gh" }) } as never);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/?ref=AB3DE7GH&utm_source=referral&utm_medium=referral&utm_campaign=refer_a_contractor");
    const bad = await GET(new Request("https://built2bid.org/r/x"), { params: Promise.resolve({ code: "<x>" }) } as never);
    expect(bad.headers.get("location")).toBe("/");
  });
});
