/**
 * Copy for the Unlimited-only features, shared by the sidebar, dashboard cards and upgrade screens.
 * Derived from the feature registry (src/lib/features/registry.ts): edit copy there.
 */
import { FEATURES, type PremiumFeatureId } from "@/lib/features/registry";

export type PremiumFeature = PremiumFeatureId;

export const PREMIUM_FEATURES = Object.fromEntries(
  FEATURES.filter((f) => f.entitlement === "unlimited").map((f) => [f.id, { title: f.name, pitch: f.pitch ?? f.description }]),
) as Record<PremiumFeature, { title: string; pitch: string }>;
