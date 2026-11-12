import {
  Archive, ArrowDownToLine, Bath, BoxSelect, BrickWall, Building, Building2, CookingPot, DoorOpen, Droplets, Fan, Fence, Frame,
  Grid2x2, Hammer, HardHat, House, Layers, LayoutGrid, Paintbrush, PanelsTopLeft, Route, Shovel, Sofa, Sparkles, Sprout, Square,
  Thermometer, Tractor, Trees, Warehouse, Waves, Wrench, Zap, type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  Archive, ArrowDownToLine, Bath, BoxSelect, BrickWall, Building, Building2, CookingPot, DoorOpen, Droplets, Fan, Fence, Frame,
  Grid2x2, Hammer, HardHat, House, Layers, LayoutGrid, Paintbrush, PanelsTopLeft, Route, Shovel, Sofa, Sparkles, Sprout, Square,
  Thermometer, Tractor, Trees, Warehouse, Waves, Wrench, Zap,
};

export function TradeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = icons[name] ?? Hammer;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}

export const familyTint: Record<string, string> = {
  Exterior: "bg-[#e8eef6] text-[#1f3a5f]",
  Interior: "bg-[#f3ece3] text-[#8a4b16]",
  Systems: "bg-[#e9f1ec] text-[#2f6a47]",
  Sitework: "bg-[#efece4] text-[#5b5236]",
  Structures: "bg-[#ece9f3] text-[#4b3f7a]",
  General: "bg-[#eef0f2] text-[#3b4656]",
};
