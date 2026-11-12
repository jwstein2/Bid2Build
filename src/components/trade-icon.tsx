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

// Restrained brand-family tints: navy, cyan-ink and teal tones only (all icon colours >= 4.5:1 on their tint).
export const familyTint: Record<string, string> = {
  Exterior: "bg-[#e7eef6] text-[#0b2d4d]",
  Interior: "bg-[#e0f7fb] text-[#006a7c]",
  Systems: "bg-[#e3f6f3] text-[#0f766e]",
  Sitework: "bg-[#eef1f4] text-[#33465a]",
  Structures: "bg-[#e7eef6] text-[#1d4a73]",
  General: "bg-[#eef1f4] text-[#33465a]",
};
