import type { Metadata } from "next";
import { LegalPage, H2, A } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Built2Bid's accessibility commitment and how to report a barrier.",
  alternates: { canonical: "/accessibility" },
};

export default function AccessibilityPage() {
  return (
    <LegalPage title="Accessibility" updated="November 21, 2026" docKey="accessibility">
      <p>We want everyone in the trades, and their customers, to be able to use Built2Bid. We are working toward the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA for the website, the app, proposal signing pages and customer-facing documents.</p>
      <H2>What we do</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Keyboard access and visible focus on controls, with labels for form fields and buttons.</li>
        <li>Text and color contrast checked in light and dark themes; touch targets sized for phones.</li>
        <li>Automated accessibility (axe) checks on key screens during design reviews, plus manual review of new screens.</li>
      </ul>
      <H2>Known limitations</H2>
      <p>Some generated PDFs (proposals and reports) may not yet be fully tagged for screen readers, and some charts rely on color. If you need any document in another format, ask and we&apos;ll provide it.</p>
      <H2>Report a barrier</H2>
      <p>Email <A href="mailto:support@built2bid.org">support@built2bid.org</A> with the page and what happened. We aim to reply within 2 business days.</p>
    </LegalPage>
  );
}
