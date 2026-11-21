import type { ExtraFlow } from "@/lib/tax-banking/forecast";

/** A V9 flow plus where it came from (for drill-down and confidence). */
export interface ExtraFlowV9 extends ExtraFlow {
  source: "milestone" | "collection" | "commitment" | "estimate" | "payroll" | "whatif";
}
