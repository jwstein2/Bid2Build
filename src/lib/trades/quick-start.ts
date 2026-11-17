import { getTrade } from "./catalog";
import type { QuickStartTrade } from "@/components/marketing/hero-quick-start";

const QUICK = ["roofing", "siding", "decks", "concrete", "kitchens", "bathrooms", "painting"];

export const quickStartTrades = (): QuickStartTrade[] =>
  QUICK.flatMap((slug) => {
    const t = getTrade(slug);
    if (!t) return [];
    const groups = t.template.groups.map((g) => g.name);
    return [{ slug, name: t.name, icon: t.icon, project: t.projects[0] ?? `${t.name} project`, groups: groups.slice(0, 6),
      lines: t.template.groups.reduce((n, g) => n + g.items.length, 0) }];
  });
