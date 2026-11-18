/** V6.7: which search result kinds a person may search, from feature switches and Team & Access. Client-safe. */
import { restrictedFor } from "@/lib/access/effective";
import type { FeatureId } from "@/lib/access/capabilities";
import { FIN_KINDS, PM_KINDS, SEARCH_KINDS, type SearchKind } from "./kinds";
import type { SearchCaps } from "./actions";

/** The workspace feature a result kind belongs to (V6.7): a kind is searched only when that feature is on. */
export const KIND_FEATURE: Record<SearchKind, FeatureId> = {
  customer: "customers", estimate: "bids", signature: "bids", saved_item: "pricing_library", assembly: "pricing_library",
  project: "schedule", task: "schedule", scope: "schedule", change_order: "schedule", photo: "schedule",
  resource: "team_directory", supplier: "team_directory", message: "communications",
  invoice: "fin_visibility", payment: "fin_visibility", bill: "fin_visibility", expense: "fin_visibility", vendor: "fin_visibility",
};

/**
 * Kinds this account can search at all: feature switches, then Team & Access. Turned-off kinds are never sent
 * to the database, so their titles, snippets, counts and related-record suggestions can't appear. Row-level
 * permissions are still enforced by the database (RLS) for everything that is searched.
 */
export function searchableKinds(caps: SearchCaps): SearchKind[] {
  return SEARCH_KINDS.filter((k) => (caps.flags.financials || !FIN_KINDS.includes(k)) && (caps.flags.pm || !PM_KINDS.includes(k))
    && !restrictedFor(caps.access, { feature: KIND_FEATURE[k] }));
}

