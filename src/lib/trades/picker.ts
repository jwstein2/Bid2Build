import { trades } from "./catalog";
import type { PickerTrade } from "@/components/marketing/trade-picker";

export const pickerTrades = (): PickerTrade[] =>
  trades.map((t) => ({ slug: t.slug, name: t.name, icon: t.icon, family: t.family, featured: t.featured, blurb: t.seoTitle }));
