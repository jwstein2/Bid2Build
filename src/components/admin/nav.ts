/** Owner navigation, shared by the client shell and server pages. */
/** Primary owner navigation, ordered by the business lifecycle. */
export const PRIMARY = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/customers", label: "Customers", also: ["/admin/complimentary"] },
  { href: "/admin/revenue", label: "Revenue" },
  { href: "/admin/usage", label: "Product usage" },
  { href: "/admin/operations", label: "Operations", also: ["/admin/states", "/admin/definitions"] },
];
/** Existing owner tools, kept reachable from every page (and listed on Operations). */
export const TOOLS = [
  { href: "/admin/complimentary", label: "Complimentary access" },
  { href: "/admin/states", label: "Bids by state" },
  { href: "/admin/definitions", label: "Metric definitions" },
  { href: "/admin/sales", label: "Outreach funnel (Sales)" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/market", label: "Market intelligence" },
  { href: "/admin/templates", label: "Trade templates" },
  { href: "/admin/proposal-text", label: "Scope & exclusions" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/logs", label: "Import & PDF errors" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/settings/pricing", label: "Pricing integrations" },
];
