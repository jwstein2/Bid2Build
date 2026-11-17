import Link from "next/link";
import { Notice } from "../ui/misc";
import { pmUpgradeCopy } from "@/lib/marketing/catalog";

/**
 * What someone sees when they open Project Command Center without editing access. Free accounts are
 * told they need Unlimited first (the add-on can't be bought on Free); Unlimited accounts go straight
 * to the add-on on Subscription; company members are pointed at their admin.
 */
export function PmLockNotice({ kind, title, tone = "neutral", testId = "pm-lock" }: { kind: "free" | "unlimited" | "company"; title?: string; tone?: "neutral" | "warn"; testId?: string }) {
  const c = pmUpgradeCopy(kind);
  return (
    <div data-testid={testId} data-kind={kind}>
      <Notice tone={tone} title={title ?? c.title}>
        {c.body}{" "}
        {c.cta && <Link href={c.href} className="font-semibold underline" data-cta={kind === "free" ? "pm-plans" : "pm-unlock"}>{c.cta}</Link>}
      </Notice>
    </div>
  );
}
