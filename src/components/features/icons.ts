import { BarChart3, CalendarRange, Calculator, FileSpreadsheet, LayoutTemplate, Library, SquareKanban, type LucideIcon } from "lucide-react";
import type { FeatureId } from "@/lib/features/registry";

export const FEATURE_ICONS: Record<FeatureId, LucideIcon> = {
  library: Library,
  templates: LayoutTemplate,
  pipeline: SquareKanban,
  analytics: BarChart3,
  sales_pay: Calculator,
  internal_report: FileSpreadsheet,
  project_scheduling: CalendarRange,
};
