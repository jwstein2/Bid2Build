import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

// active:scale: a 2% press-in so a tap on a phone visibly registers (a contractor in gloves or bright sun
// otherwise can't tell the button took the tap). Transform only, so nothing around it moves.
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[color,background-color,border-color,box-shadow,scale] duration-(--motion-fast) ease-brand-out active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
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
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  function Button({ variant = "primary", size = "md", className, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
  },
);

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
