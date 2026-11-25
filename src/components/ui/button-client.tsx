"use client";
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { buttonClass, Spinner, type ButtonSize as Size, type ButtonVariant as Variant } from "./button-styles";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  variant?: Variant;
  size?: Size;
  /**
   * Shows a spinner, disables the button and marks it busy. Pass the same flag you use for the
   * "Saving…" label so the click gets instant feedback however fast or slow the save is.
   */
  loading?: boolean;
  /** An async handler (one that returns a promise) puts the button in its loading state until it settles. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
};

/**
 * App button. Gives immediate feedback on every save-type action (James, 2026-11-25): either pass
 * `loading`, or give it an async `onClick` and the spinner shows from the moment of the click until the
 * promise settles. A second click while it is running is ignored, so nothing saves twice.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, type = "button", loading, onClick, disabled, children, ...props }, ref) {
    const [running, setRunning] = useState(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const busy = Boolean(loading) || running;
    const click = onClick
      ? (e: MouseEvent<HTMLButtonElement>) => {
          if (busy) { e.preventDefault(); return; }
          const r = onClick(e);
          if (r && typeof (r as PromiseLike<unknown>).then === "function") {
            setRunning(true);
            const done = () => { if (mounted.current) setRunning(false); };
            (r as PromiseLike<unknown>).then(done, done);
          }
        }
      : undefined;
    return (
      <button ref={ref} type={type} className={buttonClass(variant, size, className)} onClick={click}
        disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
        {busy && <Spinner />}
        {children}
      </button>
    );
  },
);

