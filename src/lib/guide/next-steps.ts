/**
 * "What's next" after a customer signs (2026-11-22): the few steps that turn a signed proposal into a
 * running, billed job, in order, each with one link. Pure, so it's tested without a page.
 */
export interface NextStep { id: "countersign" | "schedule" | "bill" | "update"; title: string; why: string; href: string; label: string }

export function stepsAfterSigning(o: {
  estimateId: string;
  /** The contractor still has to countersign (contractor e-signing on). */
  awaitingContractor: boolean;
  /** Project scheduling (Project Command Center) switched on for the site. */
  scheduling: boolean;
  /** Financials switched on for the site. */
  financials: boolean;
}): NextStep[] {
  const steps: NextStep[] = [];
  if (o.awaitingContractor) steps.push({ id: "countersign", title: "Countersign the contract", why: "Add your signature below so both sides have a fully signed copy.", href: "#execution", label: "Countersign" });
  if (o.scheduling) steps.push({ id: "schedule", title: "Schedule the job", why: "Build the schedule from this estimate's sections, then assign your crew and subs.", href: `/projects/new?estimate=${o.estimateId}`, label: "Schedule Now" });
  if (o.financials) steps.push({ id: "bill", title: "Set up billing", why: "Plan the deposit and progress payments, then send invoices your customer can pay online.", href: `/financials/jobs/${o.estimateId}`, label: "Open job billing" });
  if (o.scheduling) steps.push({ id: "update", title: "Keep your customer in the loop", why: "Send progress updates from the schedule. You review each one before it goes out.", href: `/projects`, label: "Go to Projects" });
  return steps;
}
