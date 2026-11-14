"use client";
import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile bot check for code requests. Off (renders nothing) until
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; the matching secret goes in Supabase → Auth → Bot and Abuse
 * Protection, which then rejects any send without a valid token. Tokens are single-use, so the
 * caller bumps `resetKey` after each send.
 */
export const CAPTCHA_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();
export const captchaEnabled = () => Boolean(CAPTCHA_SITE_KEY);

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("captcha_load_failed")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function Captcha({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!CAPTCHA_SITE_KEY || !ref.current) return;
    let id: string | null = null;
    let gone = false;
    cb.current(null);
    loadScript().then(() => {
      if (gone || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: CAPTCHA_SITE_KEY,
        size: "flexible",
        appearance: "interaction-only",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(null),
        "error-callback": () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [resetKey]);

  if (!CAPTCHA_SITE_KEY) return null;
  return <div ref={ref} className="min-h-0" data-testid="captcha" />;
}
