import { BarChart3, CalendarRange, Calculator, ClipboardCheck, FilePlus2, FileSpreadsheet, HandCoins, LayoutTemplate, Library, Palette, SquareKanban, type LucideIcon } from "lucide-react";
import type { FeatureId } from "@/lib/features/registry";

export const FEATURE_ICONS: Record<FeatureId, LucideIcon> = {
  library: Library,
  templates: LayoutTemplate,
  pipeline: SquareKanban,
  analytics: BarChart3,
  sales_pay: Calculator,
  internal_report: FileSpreadsheet,
  project_scheduling: CalendarRange,
  sub_quotes: HandCoins,
  change_orders: FilePlus2,
  project_operations: ClipboardCheck,
  proposal_style: Palette,
};
