import { cn } from "@/lib/cn";
import { avatarTone, initials } from "./format";

export function Avatar({ id, name, level, size = "md" }: { id: string; name: string; level?: number; size?: "sm" | "md" | "lg" }) {
  const dims = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <span className="relative inline-block shrink-0">
      <span className={cn("grid place-items-center rounded-full font-bold", dims, avatarTone(id))} aria-hidden>{initials(name)}</span>
      {level !== undefined && (
        <span className="absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full border-2 border-surface bg-accent text-[10px] font-extrabold text-navy" title={`Level ${level}`}>
          {level}<span className="sr-only"> (level)</span>
        </span>
      )}
    </span>
  );
}
