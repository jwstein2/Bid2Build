/**
 * Getting started tour content. One entry per step, in order. The tour only explains the real
 * New Bid workflow (trade → company or customer & project → estimate → scope → proposal); it never
 * creates or edits a bid. Images are stills from the "Meet Built2Bid" video (public/media/onboarding).
 */
/**
 * The intro video. `src: null` means a new video is being made (James, 2026-11-22: the old one quoted
 * outdated pricing): the tour, the homepage and the trade pages show <VideoPlaceholder> instead.
 * To ship the new video: put it in public/media under a NEW file name (mp4s are cached as immutable,
 * e.g. meet-built2bid-v2.mp4), optionally a poster, then set src, poster and duration here.
 */
export const WELCOME_VIDEO: { src: string | null; poster: string | null; width: number; height: number; duration: string | null } = {
  src: null,
  poster: null,
  width: 1280,
  height: 720,
  /** Shown on the play button. */
  duration: null,
};

export const welcomeVideoReady = () => Boolean(WELCOME_VIDEO.src);

export interface TourStep {
  id: string;
  /** Short label for the progress bar's accessible name. */
  label: string;
  title: string;
  subtitle?: string;
  body: string;
  bullets?: string[];
  note?: string;
  media: { kind: "video" } | { kind: "image"; src: string; alt: string };
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    label: "Welcome",
    title: "Welcome to Built2Bid!",
    subtitle: "Let's build your first bid.",
    body: "Built2Bid makes creating professional contractor estimates simple. This quick guided tour shows you how to build your first bid.",
    note: "Built2Bid helps you build, price, and present professional estimates. Every step of the tour makes sense on its own.",
    media: { kind: "video" },
  },
  {
    id: "trade",
    label: "Choose your trade",
    title: "What Are You Bidding Today?",
    body: "Every new estimate starts by choosing the type of project. Built2Bid opens the bid with sections and suggested items made for that trade.",
    bullets: [
      "Pick Roofing, Decks & Porches, Siding, Concrete, Painting, or any of 42 trades.",
      "Choose Other / Custom Project to start from a blank estimate.",
      "Need more than one trade on a job? Add another trade to the same project at any time.",
    ],
    media: { kind: "image", src: "/media/onboarding/trade.webp", alt: "The trade chooser with Roofing, Siding, Decks & Porches, Concrete and other trade tiles" },
  },
  {
    id: "company",
    label: "Set up your company",
    title: "Your Company, Your Brand",
    body: "Enter your company details once: name, contact, email, phone, address, logo, and brand colors. Built2Bid puts them on every proposal and reuses them on future bids.",
    bullets: [
      "Once your company profile is complete, the Company step shows a check mark.",
      "From then on, new bids go straight from trade selection to Customer & Project.",
      "Update your details any time in Company profile.",
    ],
    media: { kind: "image", src: "/media/onboarding/company.webp", alt: "The Business information form with company name, contact name, business email, phone and address filled in" },
  },
  {
    id: "customer",
    label: "Add your customer & project",
    title: "Who Are You Bidding For?",
    body: "Add the customer's name and the job site address, then give the project a title. Optional fields like email, phone, and private notes are there when you need them.",
    bullets: [
      "Pick a saved customer or add a new one.",
      "Your bids and customers stay in your dashboard to reuse or revisit later.",
      "Private project notes never appear on the proposal.",
    ],
    media: { kind: "image", src: "/media/onboarding/customer.webp", alt: "The Customer & project step with customer name, email, phone, project address and notes fields" },
  },
  {
    id: "estimate",
    label: "Build your estimate",
    title: "Build Your Estimate in Minutes",
    body: "Your trade's sections are ready to fill in. Price each line your way and watch totals, profit, and tax update as you go.",
    bullets: [
      "Tap suggested items to add them to a section.",
      "Enter quantities and your own unit costs.",
      "Use trade calculators for measurements like area, squares, boards, or concrete.",
      "Set markup or target margin, plus adjustments and sales tax.",
      "Mark each line as Labor, Material, or combined Labor / Material.",
    ],
    note: "Individual Unlimited subscribers can save frequently used items and rates to reuse on future bids.",
    media: { kind: "image", src: "/media/onboarding/estimate.webp", alt: "Estimate line items with quantity, unit cost, extended cost and price, plus suggested items" },
  },
  {
    id: "proposal",
    label: "Customize your proposal",
    title: "Make Every Bid Professional",
    body: "Before you present a price, spell out exactly what is included and what is not.",
    bullets: [
      "Scope of Work: what you'll provide and perform.",
      "Exclusions & Clarifications: what's not included and any assumptions.",
      "Generate a draft scope or exclusions from your estimate details, then edit anything.",
      "Project summary with your price, profit, and margin at a glance.",
      "Optional final bid rounding for a clean total.",
    ],
    media: { kind: "image", src: "/media/onboarding/proposal.webp", alt: "The Scope of Work editor with a drafted list of included work" },
  },
  {
    id: "review",
    label: "Review & create your bid",
    title: "You're Ready to Bid!",
    body: "Review your completed estimate, choose a proposal style and what your customer sees, then preview the customer-facing proposal. Download a branded PDF to send from your own email, and find every bid again in your dashboard.",
    note: "You're ready to create your first professional estimate with Built2Bid. Let's get bidding!",
    media: { kind: "image", src: "/media/onboarding/review.webp", alt: "The Proposal settings step with Preview customer proposal and Download PDF buttons and a live preview of the customer proposal" },
  },
];
