import type { Metadata } from "next";
import { AnalyticsOptOut } from "@/components/analytics/analytics-opt-out";
import { LegalPage, H2, A } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Cookie Policy", alternates: { canonical: "/cookies" } };

const ROWS: [string, string, string, string][] = [
  ["Supabase sign-in (sb-…)", "Necessary", "Keeps you signed in", "Until you sign out or the session ends"],
  ["b2b_ref", "Necessary for the program", "Remembers the referral link you arrived from", "90 days"],
  ["b2b_rep", "Necessary for the program", "Remembers the sales representative link you arrived from", "90 days"],
  ["b2b_aff", "Necessary for the program", "Remembers the affiliate (creator partner) link you arrived from", "90 days"],
  ["b2b_attr", "Measurement (first party)", "Remembers which campaign link brought you here, so we can count sign-ups by source", "90 days"],
  ["b2b_vid", "Measurement (first party)", "A random visitor id. When you sign in, it links your earlier visits on this browser to your account, so we can see which campaigns lead to sign-ups and subscriptions. It contains no name or email", "13 months"],
  ["b2b_touch", "Measurement (first party)", "Your first and latest few visits from tagged links: campaign tags, the site you came from (its domain only), the landing page and the device type. Click ids are noted as present, never stored", "90 days"],
  ["b2b_ad_consent", "Necessary", "Remembers your ad measurement choice", "1 year"],
  ["b2b_ga_optout", "Necessary", "Remembers that you turned Google Analytics off", "1 year"],
  ["b2b_profile_reminder, b2b-demo-hint, b2b-demo-return, sales_view", "Functional", "Remember small display choices (a dismissed reminder, demo mode, which hub you last opened)", "Up to 1 year"],
  ["_ga, _ga_… (Google Analytics)", "Analytics", "Counts visits and how people find the site", "Up to 2 years"],
  ["_fbp, _fbc (Meta pixel)", "Advertising measurement", "Measures which of our ads brought you here. Only after you choose Allow", "Up to 90 days"],
];

export default function CookiePolicy() {
  return (
    <LegalPage title="Cookie Policy" updated="November 24, 2026" docKey="cookies">
      <p>Cookies are small files a website stores in your browser. {site.name} uses a few, plus similar browser storage for things like unsaved drafts and display preferences. This page lists them and how to control them. See also our <A href="/privacy">Privacy Policy</A>.</p>
      <H2>Cookies we use</H2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead><tr className="border-b border-line text-left text-ink"><th className="py-2 pr-3">Cookie</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Why</th><th className="py-2">How long</th></tr></thead>
          <tbody>{ROWS.map(([n, t, w, d]) => <tr key={n} className="border-b border-line align-top"><td className="py-2 pr-3 font-mono text-xs">{n}</td><td className="py-2 pr-3">{t}</td><td className="py-2 pr-3">{w}</td><td className="py-2">{d}</td></tr>)}</tbody>
        </table>
      </div>
      <H2>Your choices</H2>
      <p><strong>Ad measurement</strong> (Meta pixel) loads only if you choose Allow in our banner. If your browser sends a Global Privacy Control signal, we treat it as No and never show the banner. To change your choice, clear this site&apos;s cookies and the banner will ask again.</p>
      <p><strong>Google Analytics</strong> can be turned off for this browser here:</p>
      <AnalyticsOptOut />
      <p><strong>First-party visit measurement</strong> (b2b_vid and b2b_touch) is never set if your browser sends a Global Privacy Control signal or if you turned Google Analytics off above. Turning it off stops new visits being recorded; you can clear existing ones by deleting this site&apos;s cookies.</p>
      <p>You can also block or delete cookies in your browser settings. Blocking necessary cookies will stop sign-in from working. Analytics and ad cookies are never loaded on proposal signing links or sign-in links.</p>
      <H2>Questions</H2>
      <p><A href="mailto:privacy@built2bid.org">privacy@built2bid.org</A></p>
    </LegalPage>
  );
}
