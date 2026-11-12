import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)]", className)}>{children}</div>;
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "danger" | "brand" | "accent"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-black/5 text-ink-soft",
    ok: "bg-ok-tint text-ok",
    warn: "bg-warn-tint text-warn",
    danger: "bg-danger-tint text-danger",
    brand: "bg-brand-tint text-brand",
    accent: "bg-accent-tint text-accent-dark",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "neutral", title, children, className }: { tone?: "neutral" | "ok" | "warn" | "danger"; title?: string; children?: ReactNode; className?: string }) {
  const tones = {
    neutral: "border-line bg-surface",
    ok: "border-ok/30 bg-ok-tint",
    warn: "border-warn/30 bg-warn-tint",
    danger: "border-danger/30 bg-danger-tint",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-ink-soft")}>{children}</div>}
    </div>
  );
}

export function Field({ label, hint, required, optional, htmlFor, children, error }: { label: string; hint?: string; required?: boolean; optional?: boolean; htmlFor?: string; children: ReactNode; error?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}
