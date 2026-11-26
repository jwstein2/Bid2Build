import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from "./button-styles";

export { buttonClass, Spinner, type ButtonSize, type ButtonVariant } from "./button-styles";

export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// Button holds click state (async onClick → loading), so it lives in a client module. buttonClass,
// Spinner and ButtonLink stay here so server components can keep using them directly.
export { Button } from "./button-client";
