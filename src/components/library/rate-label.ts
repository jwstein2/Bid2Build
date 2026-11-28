import { formatCurrency } from "@/lib/estimate/money";
import { UNIT_ABBR } from "@/lib/trades/catalog";
import type { SavedItem } from "@/lib/library/saved-items";

/** "$45.00 / SQ", or "SQ · no rate" when the item has no saved price. */
export const rateLabel = (s: Pick<SavedItem, "unitCost" | "unit">) =>
  s.unitCost ? `${formatCurrency(s.unitCost)} / ${UNIT_ABBR[s.unit] ?? s.unit}` : `${UNIT_ABBR[s.unit] ?? s.unit} · no rate`;
