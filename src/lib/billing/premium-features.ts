/** Copy for the Unlimited-only features, shared by the sidebar, dashboard cards and upgrade screens. */
export const PREMIUM_FEATURES = {
  library: {
    title: "Saved Items & Pricing",
    pitch: "Save your labor rates, material costs, and frequently used estimating items. Included with Unlimited.",
  },
  templates: {
    title: "Proposal Templates",
    pitch: "Customize and reuse professional proposal layouts. Included with Unlimited.",
  },
  internal_report: {
    title: "Internal Estimate Report",
    pitch: "A private PDF of your costs, markup, margin and profit by section and line item, for you and your team. Never shown to customers. Included with Unlimited and Enterprise.",
  },
} as const;

export type PremiumFeature = keyof typeof PREMIUM_FEATURES;
