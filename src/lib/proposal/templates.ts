import type { ProposalTemplateId } from "./types";

/** Shared visual tokens so the HTML preview and the PDF renderer stay in lockstep. */
export interface TemplateStyle {
  id: ProposalTemplateId;
  name: string;
  description: string;
  header: "band" | "rule" | "dark" | "split";
  baseSize: number; // pt in PDF, scaled px in HTML
  titleSize: number;
  tableStriped: boolean;
  sectionGap: number;
  showSectionTotalsBar: boolean;
  compact: boolean;
}

export const TEMPLATES: TemplateStyle[] = [
  { id: "classic", name: "Classic Professional", description: "Brand-colored header band, clear ruled tables.", header: "band", baseSize: 10, titleSize: 20, tableStriped: false, sectionGap: 14, showSectionTotalsBar: true, compact: false },
  { id: "modern", name: "Modern Minimal", description: "Generous white space and a thin accent rule.", header: "rule", baseSize: 10, titleSize: 22, tableStriped: false, sectionGap: 18, showSectionTotalsBar: false, compact: false },
  { id: "premium", name: "Premium Construction", description: "Bold dark header with accent stripe.", header: "dark", baseSize: 10.5, titleSize: 24, tableStriped: true, sectionGap: 16, showSectionTotalsBar: true, compact: false },
  { id: "detailed", name: "Detailed Estimate", description: "Dense, zebra-striped tables for line-item heavy bids.", header: "split", baseSize: 9, titleSize: 18, tableStriped: true, sectionGap: 10, showSectionTotalsBar: true, compact: false },
  { id: "compact", name: "Compact One-Page", description: "Condensed layout that fits small jobs on one page.", header: "split", baseSize: 8.5, titleSize: 16, tableStriped: false, sectionGap: 8, showSectionTotalsBar: false, compact: true },
];

export const templateStyle = (id: ProposalTemplateId): TemplateStyle => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

/** Pick readable text color for a background hex. */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#16202e" : "#ffffff";
}
