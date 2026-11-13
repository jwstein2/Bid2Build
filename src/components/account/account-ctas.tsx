import { ArrowRight } from "lucide-react";
import { ButtonLink } from "../ui/button";
import { cn } from "@/lib/cn";
import { accountCtas, type AccountStatus, type Cta, type CtaOptions } from "@/lib/account/status";

const OUTLINE_DARK = "border border-white/40 bg-transparent text-white hover:bg-white/10";

/**
 * The primary + secondary call-to-action pair for the current visitor. Server-renderable: pass the
 * status from getAccountStatus(). Labels and destinations come from accountCtas() so every page agrees.
 */
export function AccountCtas({
  status, tone = "light", size = "lg", className, arrow, secondary: secondaryOverride, ...opts
}: CtaOptions & {
  status: AccountStatus;
  tone?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Show an arrow on the primary button. */
  arrow?: boolean;
  /** Replace the secondary action (e.g. "Start from blank" on trade pages). False hides it. */
  secondary?: Cta | false;
}) {
  const { primary, secondary } = accountCtas(status, opts);
  const second = secondaryOverride === undefined ? secondary : secondaryOverride;
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <ButtonLink href={primary.href} variant="accent" size={size} data-cta={primary.action}>
        {primary.label}{arrow && <ArrowRight className="h-4 w-4" aria-hidden />}
      </ButtonLink>
      {second && (
        <ButtonLink href={second.href} variant="secondary" size={size} data-cta={second.action} className={tone === "dark" ? OUTLINE_DARK : undefined}>
          {second.label}
        </ButtonLink>
      )}
    </div>
  );
}
