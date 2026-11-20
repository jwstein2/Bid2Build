import type { Metadata } from "next";
import { LegalPage, H2, UL, A, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Academy Terms and Community Rules", alternates: { canonical: "/academy-terms" } };

export default function AcademyTerms() {
  return (
    <LegalPage title="Academy Terms and Community Rules" updated={LEGAL_UPDATED} docKey="academy-terms">
      <p>The {site.name} Contractor Academy (courses, resources and the community) is run by Built2Bid L.L.C. These terms add to our <A href="/terms">Terms of Service</A> and apply when you join or post.</p>
      <H2>Community rules</H2>
      <p>The current rules are shown on the <A href="/academy/about">About page</A> and when you join. In short: be professional, share real experience, no spam or lead selling, protect customer privacy, and confirm local rules with the authority that covers your area.</p>
      <H2>What you post</H2>
      <UL>
        <li>You keep ownership of what you post. You give {site.name} a non-exclusive, worldwide, royalty-free licence to host, display, copy, format and share it within the Academy and in features that show Academy content, for as long as it stays posted (and in backups for a short time after).</li>
        <li>Only post what you have the right to share. Don&apos;t post other people&apos;s documents, photos, customer details or copyrighted material without permission.</li>
        <li>You are responsible for your posts. Don&apos;t post anything unlawful, hateful, harassing, misleading or sexually explicit, and no malware or scams.</li>
      </UL>
      <H2>Moderation</H2>
      <p>Moderators may edit formatting, hide, lock or remove posts and suspend members who break these terms, and may do so without notice. Reports go to the moderation team; repeated false reports may be treated as abuse. Points and leaderboards are for fun and have no cash value.</p>
      <H2>Advice in the Academy</H2>
      <p>Lessons and member posts are general information, not professional, legal, tax, engineering or safety advice. Licensing, permits, codes, tax and contract rules vary by location: confirm with the authority or a licensed professional where you work. Built2Bid doesn&apos;t check member posts for accuracy.</p>
      <H2>Third-party content</H2>
      <p>Some resources link to or embed videos and articles by other creators, credited to them. Those belong to their owners and their own terms apply; embedded videos play through the original platform. Featuring a resource doesn&apos;t mean the creator endorses {site.name}, unless we say so.</p>
      <H2>Copyright complaints</H2>
      <p>If you believe something in the Academy infringes your copyright, email <A href="mailto:support@built2bid.org">support@built2bid.org</A> with: your contact details, the work you own, the link to the material, a statement that you believe in good faith the use isn&apos;t authorized, a statement that your notice is accurate and, under penalty of perjury, that you are the owner or authorized to act for the owner, and your physical or electronic signature. We remove infringing material promptly and may close the accounts of repeat infringers. A member whose post was removed may send a counter-notice to the same address.</p>
      <H2>Privacy</H2>
      <p>Your profile, posts and activity are visible as your Academy privacy settings allow. See our <A href="/privacy">Privacy Policy</A>.</p>
    </LegalPage>
  );
}
