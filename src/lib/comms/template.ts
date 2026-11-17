/** Follow-up template constants (client-safe: no trade catalog import). */
export const PLACEHOLDERS = ["first_name", "company_name", "sender_name", "project_type", "project_reference", "estimate_month"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const PLACEHOLDER_HELP: Record<Placeholder, string> = {
  first_name: "Customer's first name (blank if unknown)",
  company_name: "Your company name",
  sender_name: "Who the email is from",
  project_type: "Type of work, e.g. deck",
  project_reference: "\"the deck project we quoted for you back in March\" (or \"completed for you\")",
  estimate_month: "Month and year of the original estimate",
};

export const DEFAULT_SUBJECT = "Checking in on your {project_type} project";
export const DEFAULT_BODY = [
  "Hi {first_name},",
  "",
  "I wanted to check back in about {project_reference}.",
  "",
  "If it's still something you're considering, we'd be happy to revisit the estimate or look at a few options that might fit your budget better.",
  "",
  "No pressure either way. Just wanted to follow up.",
  "",
  "Thanks,",
  "{sender_name}",
].join("\n");

