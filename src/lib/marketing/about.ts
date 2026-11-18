/**
 * Facts for /about and the homepage trust block.
 *
 * Rule (V8 addendum): only verified company facts go here. No testimonials, user counts, awards,
 * years in business or support guarantees unless the owner supplies evidence.
 *
 * The founder story is owner-supplied. Until `founder` is filled in, /about renders without a
 * founder section (nothing is invented, and no placeholder text reaches customers).
 */
export interface FounderStory {
  name: string;
  /** e.g. "Founder" */
  role: string;
  /** Short paragraphs in the founder's own words. */
  story: string[];
  /** Optional path under /public, e.g. "/about/founder.webp". */
  photo?: string;
  photoAlt?: string;
}

export const COMPANY = {
  legalName: "Built2Bid L.L.C.",
  /** Head office state (Stripe Tax head office and registration). */
  state: "Minnesota",
} as const;

/** Owner-supplied (James, 2026-11-18). Photo optional, not added yet. */
export const FOUNDER: FounderStory | null = {
  name: "James Stein",
  role: "Founder",
  story: [
    "I'm James Stein, the founder of Built2Bid. I spent twelve years as a sales rep before moving into construction, and I've now spent five years working for a general contractor that does mostly remodeling.",
    "Those two jobs taught me that a lot of a contractor's work is selling the job: pricing it right and getting a clear, professional proposal in front of the customer. Built2Bid is the tool I wanted for that part of the work.",
    "I read the feedback myself. I check the Academy community once a day, so if something on the site isn't working for you, tell me.",
  ],
};

/** Product and policy promises that are true today. Each maps to code or the Terms. */
export const PROMISES: { title: string; body: string; href?: string; link?: string }[] = [
  { title: "Your costs stay private", body: "Customer proposals are built only from customer prices. Your costs, markup and internal notes never appear in the preview or the PDF." },
  { title: "Export anytime", body: "Download everything in your account whenever you like, on any plan.", href: "/settings/account", link: "Export from Account settings" },
  { title: "No long-term contracts", body: "Cancel any time. Paid periods are non-refundable, and your plan stays active until the end of the period you paid for.", href: "/terms", link: "Read the Terms" },
  { title: "Security you can read", body: "Row-level data separation, passwordless sign-in and optional two-step sign-in. The details are published.", href: "/security", link: "How we protect your data" },
];
