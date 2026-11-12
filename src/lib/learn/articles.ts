/**
 * Learning center content. Plain, factual guidance only: no statistics, prices, or claims we
 * cannot support. Tax and legal topics point readers to qualified professionals.
 */
export interface ArticleBlock { h?: string; p?: string[]; list?: string[]; formula?: string[] }
export interface Article { slug: string; title: string; description: string; updated: string; blocks: ArticleBlock[] }

export const articles: Article[] = [
  {
    slug: "markup-vs-margin",
    title: "Markup vs. Margin: What Contractors Need to Know",
    description: "Markup and margin are not the same number. Learn the difference, the formulas, and how to convert between them so you price jobs for the profit you actually want.",
    updated: "2026-11-12",
    blocks: [
      { p: ["Markup and margin both describe profit, but they measure it against different numbers. Mixing them up is one of the most common reasons a job earns less than planned."] },
      { h: "Markup is a percent of cost", p: ["Markup tells you how much you add on top of what the job costs you."], formula: ["Price = Cost × (1 + Markup)", "Example: $10,000 cost × 1.25 = $12,500 price (25% markup)"] },
      { h: "Margin is a percent of price", p: ["Gross margin tells you what share of the customer's price is profit."], formula: ["Price = Cost ÷ (1 − Margin)", "Example: $10,000 cost ÷ 0.75 = $13,333.33 price (25% margin)"] },
      { h: "Why the same percent gives different prices", p: ["A 25% markup on a $10,000 job produces $2,500 of gross profit, which is only a 20% margin. To earn a 25% margin you need a 33.33% markup. The higher the percent, the wider the gap."] },
      { h: "Converting between them", formula: ["Margin = Markup ÷ (1 + Markup)", "Markup = Margin ÷ (1 − Margin)"], list: ["20% markup = 16.67% margin", "25% markup = 20% margin", "50% markup = 33.33% margin", "25% margin = 33.33% markup", "40% margin = 66.67% markup"] },
      { h: "Use one method, not both", p: ["Pick markup or margin for a given estimate and stay with it. Applying a markup and then also a margin target double-counts profit and overprices the job. In Bid2Build you choose one method per estimate, and the other number is shown for reference."] },
      { h: "Gross profit is not net profit", p: ["Gross profit is price minus the direct costs you entered. Your overhead (office, vehicles, insurance, your own salary) still has to come out of it. If overhead is not entered as line items, make sure your markup or margin is high enough to cover it."] },
      { h: "Sales tax is separate", p: ["Sales tax you collect is not revenue and should not be included in margin calculations. Compute your price first, then apply any tax that applies in your jurisdiction."] },
    ],
  },
  {
    slug: "how-to-write-a-contractor-estimate",
    title: "How to Write a Contractor Estimate, Step by Step",
    description: "A practical checklist for building an accurate estimate: scope, quantities, costs, overhead, profit, and the details customers look for.",
    updated: "2026-11-12",
    blocks: [
      { h: "1. Define the scope", p: ["Walk the job and write down exactly what you will do. Clear scope is the foundation of every number that follows, and it protects you when questions come up later."] },
      { h: "2. Measure and take off quantities", p: ["Measure in the units you buy and install in: square feet, linear feet, squares, cubic yards, hours. Add a reasonable waste factor where your trade normally needs one."] },
      { h: "3. Price your costs from real sources", p: ["Use current supplier quotes, your recent invoices, and your own labor rates. Avoid guessing: an estimate is only as accurate as its unit costs."], list: ["Materials and delivery", "Labor, including burden such as payroll taxes and insurance", "Equipment rental", "Subcontractors", "Permits, inspections, and disposal fees"] },
      { h: "4. Account for overhead and contingency", p: ["Decide whether to list overhead and contingency as line items or cover them in your markup. Either works, as long as you do it consistently."] },
      { h: "5. Apply markup or margin", p: ["Choose a pricing method and a target. See Markup vs. Margin for the formulas."] },
      { h: "6. Decide what the customer sees", p: ["Many contractors show section totals rather than every unit cost. Showing less detail protects your pricing; showing more can build trust on larger jobs. Choose per section."] },
      { h: "7. Add terms, exclusions, and a schedule", p: ["Spell out what is not included, any allowances, payment milestones, and how long the price is valid."] },
      { h: "8. Review before you send", p: ["Check quantities, confirm nothing is missing, and read the proposal as your customer will see it."] },
    ],
  },
  {
    slug: "what-to-include-in-a-proposal",
    title: "What to Include in a Construction Proposal",
    description: "The sections a professional proposal should have, from scope of work and exclusions to allowances, payment schedule, and acceptance.",
    updated: "2026-11-12",
    blocks: [
      { p: ["An estimate is your internal math. A proposal is the document your customer reads and signs. A clear proposal answers questions before they are asked."] },
      { h: "Core sections", list: ["Your company details and license number where required", "Customer and project address", "Scope of work in plain language", "Pricing, by section or as a single total", "Allowances, with what happens if selections exceed them", "Exclusions: what is not included", "Customer responsibilities, such as access, utilities, and clearing work areas", "Estimated schedule", "Payment schedule and accepted payment methods", "Expiration date for the price", "Terms and conditions", "Acceptance and signature area"] },
      { h: "Exclusions prevent disputes", p: ["Listing what you are not doing is as important as listing what you are. Common examples include hidden damage discovered during work, permit fees if the owner pulls permits, and finish work by others."] },
      { h: "Allowances", p: ["When the customer has not chosen a fixture or finish yet, include an allowance amount and state how overages or credits are handled."] },
      { h: "Have your terms reviewed", p: ["Contract requirements vary by state and project type. Have an attorney review your standard terms before relying on them."] },
    ],
  },
  {
    slug: "sales-tax-on-estimates",
    title: "Sales Tax on Contractor Estimates: The Basics",
    description: "How sales tax fits into an estimate, why it is not revenue, and why you should confirm the rules for your state and job type.",
    updated: "2026-11-12",
    blocks: [
      { p: ["Sales tax rules for construction vary widely. Depending on your state and the type of work, tax may apply to materials only, to the full contract, or not at all. This article covers how to handle tax in an estimate, not what your obligation is."] },
      { h: "Tax is collected, not earned", p: ["Sales tax you collect from a customer belongs to the taxing authority. It is not revenue and should not be counted in your markup, margin, or gross profit."] },
      { h: "Mark which items are taxable", p: ["If only some items are taxable in your situation, mark each line accordingly. Bid2Build applies the tax rate only to taxable lines and shows tax separately on the proposal."] },
      { h: "Discounts and adjustments", p: ["When you apply a discount or adjustment to the whole job, it is spread across taxable and non-taxable items in proportion to their price before tax is calculated."] },
      { h: "Confirm your rules", p: ["Check with your state's department of revenue or a tax professional to confirm what is taxable for your trade and project type."] },
    ],
  },
];

export const getArticle = (slug: string) => articles.find((a) => a.slug === slug);
