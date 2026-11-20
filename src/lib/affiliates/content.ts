/**
 * Affiliate Hub copy that several pages share: the onboarding lessons, the program summary, talking points and
 * disclosure examples. No earnings promises, no fake testimonials. Lesson keys are stored in affiliate_lessons_done;
 * the database requires 10 completed lessons before the training step can finish.
 */

export const PROGRAM = {
  headline: "Build a Referral Portfolio That Pays for Up to 10 Years.",
  short: "Refer contractors to Built2Bid. When someone you refer becomes a paying customer, you earn one month of their subscription value once a year, for up to 10 years while they stay a paying customer.",
  annual: "Commissions are paid annually, not monthly: one payment per referred customer per eligible year.",
  noGuarantee: "Earnings depend on your referrals and on customers continuing to pay. They are not guaranteed, and examples are illustrations, not typical results.",
} as const;

export interface Lesson { key: string; title: string; body: string[]; check?: { q: string; a: string } }

export const LESSONS: Lesson[] = [
  { key: "how_it_works", title: "How the program works", body: [
    "You get a permanent link. When someone clicks it and creates a new Built2Bid account within 90 days, they're attributed to you.",
    "When that customer pays their first subscription invoice, your first annual commission is created.",
  ] },
  { key: "annual_not_monthly", title: "Annual, not monthly", body: [
    "You earn one month of the customer's eligible subscription value once a year, on the anniversary of their first payment.",
    "Example only: a customer on a $19.99/month plan earns you about $19.99 once a year, not $19.99 every month.",
  ], check: { q: "How often is a commission created for one customer?", a: "Once a year, on the anniversary." } },
  { key: "ten_year_term", title: "Up to 10 years", body: [
    "Each referred customer can create at most 10 annual commissions: the first payment plus up to nine anniversaries.",
    "The term starts at the first paid invoice and never restarts, even after an upgrade, a plan change, a cancellation or a return.",
  ] },
  { key: "eligibility", title: "What counts", body: [
    "An anniversary counts when the customer has a paid subscription covering that date. Upgrades raise the next anniversary's amount; downgrades lower it.",
    "Annual plans count as the annual price divided by 12. Sales tax, failed payments, refunds and chargebacks never count.",
    "Each commission waits 30 days before it can be paid. A refund or chargeback during that time cancels or reduces it.",
  ] },
  { key: "ftc_disclosure", title: "Always disclose (FTC)", body: [
    "U.S. law requires you to clearly tell your audience you earn a commission. Say it in the video itself, not only in the description, and put it before the link.",
    "Good: \"Built2Bid is a sponsor of this channel. I earn a commission if you sign up through my link.\" Use YouTube's paid promotion setting when it applies.",
  ], check: { q: "Where should the disclosure go?", a: "In the video itself and before the link, clearly." } },
  { key: "honest_claims", title: "Honest claims only", body: [
    "Only say what you've seen Built2Bid do. Don't promise savings, income or results, don't invent reviews or testimonials, and don't claim to be Built2Bid staff.",
    "If you share earnings, say they're your own and not typical.",
  ] },
  { key: "no_spam", title: "No spam or tricks", body: [
    "No unsolicited bulk email or texts, no posting links where they aren't allowed, no cookie stuffing or hidden links, and no ads bidding on the Built2Bid name.",
    "Referring yourself, your own businesses or fake accounts isn't allowed and ends commissions.",
  ] },
  { key: "brand_use", title: "Using our name and logo", body: [
    "Use the logos and screenshots from the Resources page as they are. Don't change them or suggest Built2Bid endorses anything else you promote.",
  ] },
  { key: "payouts_taxes", title: "Payouts and taxes", body: [
    "Payouts go by ACH to a U.S. bank account you connect on our payment provider's secure page. Built2Bid never sees your full account number.",
    "We need a W-9 before paying. You're an independent contractor and responsible for your own taxes; we may send you a 1099 when required.",
  ] },
  { key: "getting_started", title: "Getting started", body: [
    "Open Resources for talking points, a video outline, screenshots and your link or QR code. Add a campaign tag to see which videos work best.",
    "Questions? Email partners@built2bid.org.",
  ] },
];

export const TALKING_POINTS = [
  "Built2Bid is estimating and bid software for contractors: build an estimate, turn it into a professional proposal, and get it e-signed.",
  "It has templates for 40+ trades, a price library you can generate, and job costing after the bid is won.",
  "Plans are month to month with no long-term contract, and you can export your data anytime.",
  "There's a free plan to try it; paid plans start at $19.99/month or $199/year (check the pricing page for current prices).",
];

export const VIDEO_OUTLINE = [
  "Open with the disclosure: \"Built2Bid sponsors this video and I earn a commission if you sign up through my link.\"",
  "The problem: estimates take too long and look inconsistent.",
  "Show one real estimate from start to finished proposal in Built2Bid.",
  "Show the e-signature or job-costing step that matters most to your viewers.",
  "Be honest about what it doesn't do for your trade.",
  "Close with your link (and the disclosure again near the link).",
];

export const DISCLOSURES = [
  { where: "Spoken, in the first minute", text: "Quick note: Built2Bid sponsors this video, and I earn a commission if you sign up through my link." },
  { where: "Video description, above the link", text: "Affiliate link: I earn a commission if you sign up through this link, at no extra cost to you." },
  { where: "Short-form / social post", text: "#ad I earn a commission from Built2Bid if you sign up through my link." },
];
