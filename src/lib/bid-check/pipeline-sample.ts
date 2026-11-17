import type { BoardBid } from "../pipeline/board";

/**
 * Example bids for the follow-up result, shown on the real Pipeline board component. Titles follow the
 * contractor's trade; customers and amounts are examples.
 */
const TITLES: Record<string, string[]> = {
  decks: ["Composite deck, 16 × 20", "Deck resurfacing", "Covered porch rebuild", "Deck stairs and railings", "Pressure-treated deck"],
  painting: ["Interior repaint, 3 bedrooms", "Exterior repaint with trim", "Cabinet refinishing", "Basement walls and ceilings", "Garage and doors"],
  roofing: ["Roof replacement, 24 sq", "Storm-damage repair", "Garage roof, metal", "Ridge vent and flashing", "Roof replacement, 31 sq"],
  siding: ["Vinyl siding replacement", "Fiber cement, front elevation", "Soffit and fascia wrap", "Storm repair, west wall", "Siding and trim package"],
  concrete: ["Driveway replacement", "Garage slab", "Patio and walkway", "Front steps", "Stamped patio border"],
  kitchens: ["Kitchen remodel", "Kitchen backsplash and counters", "Pantry and island", "Kitchen refresh", "Galley kitchen remodel"],
  bathrooms: ["Hall bath remodel", "Primary shower conversion", "Powder room refresh", "Tub-to-shower", "Basement bathroom"],
  "interior-remodeling": ["Kitchen and main floor", "Basement finish", "Open-concept wall removal", "Primary suite remodel", "Whole-home refresh"],
  electrical: ["200-amp panel upgrade", "Kitchen circuits and lighting", "EV charger install", "Basement rough-in", "Recessed lighting"],
  drywall: ["Basement hang and finish", "Ceiling water-damage repair", "Garage fire-rated drywall", "Addition drywall", "Texture match, hallway"],
};

export function samplePipelineBids(templateSlug: string, now = new Date()): BoardBid[] {
  const t = TITLES[templateSlug] ?? ["Project A", "Project B", "Project C", "Project D", "Project E"];
  const day = 86_400_000;
  const ago = (d: number) => new Date(now.getTime() - d * day).toISOString();
  const base = (i: number, stage: BoardBid["stage"], status: BoardBid["status"], total: number, updated: number): BoardBid => ({
    id: `example-${i}`, title: t[i], customer: ["Example: Rivera", "Example: Chen", "Example: Patel", "Example: Olsen", "Example: Brooks"][i],
    number: `EST-10${i + 1}`, trades: [templateSlug], status, stage,
    createdAt: ago(updated + 3), updatedAt: ago(updated), stageChangedAt: ago(updated), wonAt: null, lostReason: null,
    latestVersion: { id: `v${i}`, number: 1, total, subtotal: total, cost: Math.round(total * 0.78) }, signing: null,
  });
  const bids: BoardBid[] = [
    base(0, "draft", "draft", 0, 0),
    base(1, "draft", "finalized", 8450, 1),
    base(2, "sent", "finalized", 12600, 6),
    { ...base(3, "pending", "finalized", 5980, 3), signing: { state: "awaiting" as const, signed: null, latest: { id: "r3", versionId: "v3", expiresAt: new Date(now.getTime() + 11 * day).toISOString(), createdAt: ago(3) } } },
    { ...base(4, "won", "finalized", 9875, 2), wonAt: ago(2), signing: { state: "signed" as const, signed: { id: "s4", at: ago(2), versionNumber: 1, total: 9875, pdfStatus: "ready" as const }, latest: { id: "r4", versionId: "v4", expiresAt: ago(-12), createdAt: ago(4) } } },
  ];
  return bids.map((b, i) => (i === 0 ? { ...b, latestVersion: null } : b));
}
