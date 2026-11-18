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
  /** Optional outside link shown under the story (opens in a new tab). */
  link?: { href: string; label: string };
}

export const COMPANY = {
  legalName: "Built2Bid L.L.C.",
  /** Head office state (Stripe Tax head office and registration). */
  state: "Minnesota",
} as const;

/** Owner-supplied (James, 2026-11-18). No photo for now (James's choice). */
export const FOUNDER: FounderStory | null = {
  name: "James Stein",
  role: "Founder",
  story: [
    "I'm James Stein, founder of Built2Bid. I was born in Minnesota and still live here. Before construction I spent twelve years in sales. I started at Culligan, five years in residential and one in commercial, where I helped roll out their NetSuite software and saw what happens when a system doesn't fit the way people work. I was recruited to Marco Technologies, which deploys software, Cisco phone systems, printers, copiers and computers for businesses. Then I moved to State Farm, on the insurance side, which taught me how contractors and insurance work together.",
    "For almost five years now I've worked with AOS Home Solutions, a general contractor, where I helped grow their remodel work from decks alone into a full remodel portfolio. Now I'm building the software to make everyone's lives in our field a little easier.",
    "My first bidding system was one I built myself in Google Sheets, like a lot of you did in Sheets or Excel. Customers would ask for more detail, or tell me it looked like a spreadsheet. It did. I took the dashed lines out, but it still wasn't good enough, and I lost jobs to well-established companies running systems that cost tens of thousands of dollars.",
    "As we grew, I set up Google Workspace for our CRM and project folders. This past year we tried several of the well-known contractor platforms. The one we chose still doesn't do everything we need, so I work across it and QuickBooks, and they don't always talk to each other. I wanted one place where it all works together. That's what Built2Bid is for.",
    "I didn't build it alone. My network is more than 30 people: subcontractors, suppliers, my painter, my electrician, asphalt crews and the general contractor I work with. I asked all of them what they hate about the systems they use now and what they wish one would do. Their answers are why Built2Bid covers 37 trades, plus custom. It's made by trades and contractors, for trades and contractors.",
    "Every project in the AOS Home Solutions portfolio is work I sold, so you can see the kind of jobs Built2Bid was shaped around.",
    "At the end of the day, I'm the one putting the tool stack together, so we all have the right tools in the kit to do our real job: building things. I read the feedback myself and check the Academy community once a day, so if something isn't working for you, tell me.",
  ],
  link: { href: "https://aoshomesolutions.com", label: "See past projects at aoshomesolutions.com" },
};

/** Product and policy promises that are true today. Each maps to code or the Terms. */
export const PROMISES: { title: string; body: string; href?: string; link?: string }[] = [
  { title: "Your costs stay private", body: "Customer proposals are built only from customer prices. Your costs, markup and internal notes never appear in the preview or the PDF." },
  { title: "Export anytime", body: "Download everything in your account whenever you like, on any plan.", href: "/settings/account", link: "Export from Account settings" },
  { title: "No long-term contracts", body: "Cancel any time. Paid periods are non-refundable, and your plan stays active until the end of the period you paid for.", href: "/terms", link: "Read the Terms" },
  { title: "Security you can read", body: "Row-level data separation, passwordless sign-in and optional two-step sign-in. The details are published.", href: "/security", link: "How we protect your data" },
];
