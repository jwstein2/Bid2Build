import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Shown wherever the intro video goes while a new one is being made (WELCOME_VIDEO.src is null).
 * Same 16:9 footprint as the player, so layouts don't jump when the real video returns.
 */
export function VideoPlaceholder({ className, tone = "navy" }: { className?: string; tone?: "navy" | "light" }) {
  return (
    <div
      role="note"
      data-testid="video-placeholder"
      className={cn(
        "grid aspect-video w-full place-items-center rounded-xl p-6 text-center",
        tone === "navy" ? "bg-navy text-white" : "border border-line bg-paper text-ink",
        className,
      )}
    >
      <div className="max-w-sm">
        <Clapperboard className={cn("mx-auto h-9 w-9", tone === "navy" ? "text-accent" : "text-accent-dark")} aria-hidden />
        <p className="mt-3 font-display text-lg font-bold">New intro video coming soon</p>
        <p className={cn("mt-1 text-sm", tone === "navy" ? "text-[#C9D6E3]" : "text-ink-soft")}>
          We&apos;re recording a fresh walkthrough. In the meantime, the guided tour and Practice Mode show you everything.
        </p>
      </div>
    </div>
  );
}
