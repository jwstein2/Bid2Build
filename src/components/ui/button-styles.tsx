import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";
type Variant = ButtonVariant;
type Size = ButtonSize;

// active:scale: a 2% press-in so a tap on a phone visibly registers (a contractor in gloves or bright sun
// otherwise can't tell the button took the tap). Transform only, so nothing around it moves.
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[color,background-color,border-color,box-shadow,scale] duration-(--motion-fast) ease-brand-out active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
// While a save/submit is running the button stays readable (not the 50% "disabled" fade) so the spinner
// and "Saving…" label are the obvious feedback, and the wait cursor shows on desktop.
const busyClass = "aria-busy:cursor-wait aria-busy:disabled:opacity-80";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark shadow-sm",
  // Cyan surface always carries navy text (6.5:1). Never white on cyan.
  accent: "bg-accent text-navy hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:border-brand/50 hover:bg-paper",
  ghost: "text-ink-soft hover:bg-black/5 hover:text-ink",
  danger: "bg-danger text-white hover:brightness-95",
  link: "text-accent-ink underline-offset-4 hover:underline px-0",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 text-sm px-3 py-1.5",
  md: "min-h-11 text-[0.9375rem] px-4 py-2",
  lg: "min-h-12 font-display text-base px-6 py-3",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, busyClass, variants[variant], variant === "link" ? "" : sizes[size], className);
}

/** Small spinner used inside buttons and status lines while something is saving. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 shrink-0 animate-spin motion-reduce:animate-[spin_1.5s_linear_infinite]", className)} aria-hidden />;
}
